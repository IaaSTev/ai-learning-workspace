import { NextResponse } from "next/server";
import {
  extractCourseFromPlainText,
  filterPlainTextForWebExtraction,
  MAX_WEB_MODEL_INPUT_CHARS,
} from "@/lib/course-extraction";
import { memTrace } from "@/lib/mem-trace";

export const runtime = "nodejs";

const FETCH_TIMEOUT_MS = 25_000;
const MAX_HTML_BYTES = 2_000_000;

function parseErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message) {
    return err.message;
  }
  return "Unknown error";
}

/** Block obvious SSRF targets (localhost / metadata). */
function assertPublicHttpUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new Error("Invalid URL");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error("Only http(s) URLs are allowed");
  }
  const host = u.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "0.0.0.0" ||
    host === "[::1]" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host === "metadata.google.internal"
  ) {
    throw new Error("This URL is not allowed");
  }
  return u;
}

/**
 * Regex/HTML-stripping path (no Cheerio DOM) to lower peak memory vs parsing full HTML in a tree.
 */
function htmlToPlainTextLite(html: string): string {
  let s = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  s = s.replace(/<\/(p|div|h[1-6]|li|tr|table|section|article)\s*>/gi, "\n");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<[^>]+>/g, " ");
  s = s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  return s
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Expected JSON body with { "url": "https://..." }' },
      { status: 400 },
    );
  }

  const urlRaw =
    typeof body === "object" &&
    body !== null &&
    "url" in body &&
    typeof (body as { url: unknown }).url === "string"
      ? (body as { url: string }).url.trim()
      : "";

  if (!urlRaw) {
    return NextResponse.json(
      { error: 'Missing string field "url"' },
      { status: 400 },
    );
  }

  let pageUrl: URL;
  try {
    pageUrl = assertPublicHttpUrl(urlRaw);
  } catch (e) {
    return NextResponse.json(
      { error: parseErrorMessage(e) },
      { status: 400 },
    );
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Server misconfiguration: OPENAI_API_KEY is not set" },
      { status: 500 },
    );
  }

  let canonicalUrl = pageUrl.toString();

  memTrace("parse-syllabus-url POST handler START");
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(canonicalUrl, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent":
          "StudyAgentMVP/1.0 (+https://github.com) syllabus-fetch",
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
      },
    });
    clearTimeout(t);

    memTrace("parse-syllabus-url after fetch (response ok, before body)");

    if (!res.ok) {
      return NextResponse.json(
        { error: `Failed to fetch page: HTTP ${res.status}` },
        { status: 502 },
      );
    }

    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.includes("application/pdf")) {
      return NextResponse.json(
        {
          error:
            "This URL points to a PDF file. Download it and use “Parse Syllabus” with the PDF instead.",
        },
        { status: 400 },
      );
    }

    const buf = await res.arrayBuffer();
    memTrace("parse-syllabus-url after res.arrayBuffer");
    if (buf.byteLength > MAX_HTML_BYTES) {
      return NextResponse.json(
        { error: "Page is too large to process" },
        { status: 422 },
      );
    }

    const decoder = new TextDecoder("utf-8");
    let html = decoder.decode(buf);
    const rawHtmlLength = html.length;
    if (!html.trim()) {
      return NextResponse.json(
        { error: "Empty response from URL" },
        { status: 422 },
      );
    }

    if (res.url) {
      canonicalUrl = res.url;
    }

    let plainFull = htmlToPlainTextLite(html);
    html = "";
    memTrace("parse-syllabus-url after htmlToPlainTextLite");
    const plainTextLength = plainFull.length;

    const filtered = filterPlainTextForWebExtraction(
      plainFull,
      MAX_WEB_MODEL_INPUT_CHARS,
    );
    plainFull = "";
    memTrace("parse-syllabus-url after filterPlainTextForWebExtraction");
    const filteredTextLength = filtered.length;

    console.log("[parse-syllabus-url] text sizes", {
      url: canonicalUrl,
      rawHtmlLength,
      plainTextLength,
      filteredTextLength,
      modelInputBudget: MAX_WEB_MODEL_INPUT_CHARS,
    });

    if (!filtered.replace(/\s/g, "").length) {
      return NextResponse.json(
        {
          error:
            "No readable text on this page (it may be mostly images or require login).",
        },
        { status: 422 },
      );
    }

    const pathSeg =
      canonicalUrl.split("/").filter(Boolean).pop() ?? canonicalUrl;
    const hintForPairing = decodeURIComponent(pathSeg || "");

    memTrace("parse-syllabus-url before extractCourseFromPlainText (OpenAI)");
    const extracted = await extractCourseFromPlainText(filtered, {
      apiKey,
      sourceKind: "web",
      sourceLabel: canonicalUrl,
      hintForPairing,
      logPrefix: "[parse-syllabus-url]",
    });

    if ("error" in extracted) {
      return NextResponse.json(
        {
          error: extracted.error,
          courseName: "",
          topics: [],
        },
        { status: extracted.status },
      );
    }

    return NextResponse.json({ ...extracted, sourceUrl: canonicalUrl });
  } catch (err) {
    console.error("[parse-syllabus-url]", err);
    if (err instanceof Error && err.name === "AbortError") {
      return NextResponse.json(
        { error: "Request timed out while fetching the URL" },
        { status: 504 },
      );
    }
    return NextResponse.json(
      { error: `Failed to parse URL: ${parseErrorMessage(err)}` },
      { status: 422 },
    );
  } finally {
    memTrace("parse-syllabus-url POST handler END");
  }
}
