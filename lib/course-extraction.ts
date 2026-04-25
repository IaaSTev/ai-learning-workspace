/**
 * Shared: plain text → courseName + topics (OpenAI + heuristics).
 * Used by PDF syllabus API and web URL API.
 */

import { memTrace } from "@/lib/mem-trace";

export const MAX_COURSE_TEXT_CHARS = 120_000;

/** After URL pre-filter: max chars passed into the first model call for web pages. */
export const MAX_WEB_MODEL_INPUT_CHARS = 24_000;

/** If the first model pass returns no topics (web only): optional tiny second LLM on a short slice. */
export const WEB_FALLBACK_LLM_MAX_CHARS = 8_000;

/**
 * Keep schedule/outline-like lines + document head (course codes/titles).
 * Reduces peak memory before embedding text in HTTP JSON to OpenAI.
 */
export function filterPlainTextForWebExtraction(
  plain: string,
  maxOut: number,
): string {
  const normalized = plain.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const head = normalized.slice(0, 6_000);
  const tail = normalized.slice(6_000);
  const lines = tail.split("\n");

  const scheduleHint =
    /week|lecture|schedule|syllabus|outline|calendar|topic|unit|module|chapter|reading|exam|homework|assignment|lab\b|section\b|course\s+outline|tentative/i;
  const weekLike = /week\s*\d|lecture\s*\d|class\s*\d|day\s*\d/i;
  const outlineLike =
    /^\s*\d{1,2}[\.\)]\s+\S|^[•\u2022\-\*]\s+\S|^\s*[A-Za-z]{2,12}\s+\d{3}/;
  const junk =
    /^(skip\s+to|cookie|javascript|enable\s+js|sign\s*in|log\s*in|subscribe)/i;

  const kept: string[] = [];
  let total = head.length + 1;

  for (const line of lines) {
    const t = line.replace(/\s+/g, " ").trim();
    if (t.length < 4 || t.length > 480) continue;
    if (junk.test(t)) continue;

    let score = 0;
    if (scheduleHint.test(t)) score += 2;
    if (weekLike.test(t)) score += 2;
    if (outlineLike.test(t)) score += 1;
    if (/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}/i.test(
      t,
    )) {
      score += 1;
    }
    if (/\d{1,2}\/\d{1,2}/.test(t) || /\d{4}-\d{2}-\d{2}/.test(t)) score += 1;

    if (score >= 2 || (score >= 1 && t.length < 200)) {
      kept.push(t);
      total += t.length + 1;
      if (total >= maxOut) break;
    }
  }

  let out = `${head}\n${kept.join("\n")}`.trim();
  if (out.length < maxOut * 0.25 && normalized.length > 6_000) {
    const need = maxOut - out.length;
    out = `${out}\n${normalized.slice(6_000, 6_000 + need)}`.trim();
  }
  if (out.length > maxOut) {
    out = out.slice(0, maxOut);
  }
  return out;
}

export function openaiModel(): string {
  return process.env.OPENAI_MODEL ?? "gpt-4o";
}

export type TopicsPayload = {
  courseName: string;
  topics: { title: string }[];
};

export type CourseExtractionResult = {
  courseName: string;
  topics: { title: string }[];
  parseHints?: string[];
};

function stripJsonFence(text: string): string {
  let t = text.trim();
  if (t.startsWith("```")) {
    const firstLineEnd = t.indexOf("\n");
    if (firstLineEnd !== -1) {
      t = t.slice(firstLineEnd + 1);
    }
    const endFence = t.lastIndexOf("```");
    if (endFence !== -1) {
      t = t.slice(0, endFence);
    }
    return t.trim();
  }
  return t;
}

function normalizeTopicItem(item: unknown): string | null {
  if (typeof item === "string") {
    const s = item.trim();
    return s.length > 0 ? s : null;
  }
  if (!item || typeof item !== "object") {
    return null;
  }
  const o = item as Record<string, unknown>;
  const v = o.title ?? o.name ?? o.topic ?? o.text ?? o.heading;
  if (typeof v === "string") {
    const s = v.trim();
    return s.length > 0 ? s : null;
  }
  if (v != null) {
    const s = String(v).trim();
    return s.length > 0 ? s : null;
  }
  return null;
}

export function safeParseTopicsJson(raw: string): TopicsPayload | null {
  const cleaned = stripJsonFence(raw);
  try {
    const parsed: unknown = JSON.parse(cleaned);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    const obj = parsed as Record<string, unknown>;
    const rawName =
      obj.courseName ??
      obj.course_title ??
      obj.courseTitle ??
      obj.className ??
      obj.title;
    let courseName = "";
    if (typeof rawName === "string") {
      courseName = rawName.trim();
    } else if (rawName != null) {
      courseName = String(rawName).trim();
    }

    let topicsIn = obj.topics;
    if (!Array.isArray(topicsIn) && Array.isArray(obj.items)) {
      topicsIn = obj.items;
    }
    if (!Array.isArray(topicsIn)) {
      return null;
    }
    const topics: { title: string }[] = [];
    for (const item of topicsIn) {
      const title = normalizeTopicItem(item);
      if (title) {
        topics.push({ title });
      }
    }
    return { courseName, topics };
  } catch {
    return null;
  }
}

const SYSTEM_PROMPT = `You read university course syllabi (plain text from a PDF file or a web page).

Return ONE JSON object with exactly these keys: "courseName" and "topics".

courseName:
- Use the real course designation and/or title AS PRINTED in the document (e.g. "CS 174", "COMPSCI 330: Data Structures").
- Look in headers, title blocks, and first pages. Do NOT use only the file name or URL path as the course name.
- If several appear, prefer the one that includes both department/code and title when available.

topics:
- Produce a HIGH-LEVEL course outline: merge related lectures into ONE topic per major theme.
- If the schedule splits one theme across multiple weeks or parts (e.g. "Divide & Conquer I", "Divide & Conquer II", "Lecture 5–6: Dynamic Programming"), combine them into a single short title such as "Divide & Conquer" or "Dynamic Programming" — do NOT emit separate topics for Part I/II/III or lecture numbers for the same unit.
- Drop parenthetical detail from titles when merging (keep titles concise, typically 2–8 words).
- Aim for roughly 8–15 topics for a full-semester course; avoid listing every single lecture as its own row unless the syllabus truly has no larger groupings.
- Preserve a sensible teaching order (e.g. broad themes in sequence).
- Skip ONLY lines that are purely administrative with no subject matter (e.g. "Office hours: Mon 3pm", "Grading: 40% exams").

Output valid JSON only. Shape:
{"courseName":"...","topics":[{"title":"..."},...]}`;

const FALLBACK_TOPICS_PROMPT = `The following text is from a course syllabus or course page.

Build a MERGED outline of major instructional themes. Combine multi-lecture blocks that share the same core subject into one topic title (e.g. all "Parallel Algorithms …" lectures → one topic "Parallel Algorithms"; all "Graph Traversal …" → one topic "Graph Traversal").

Ignore pure policy/grading/contact lines.

Return JSON only:
{"topics":[{"title":"string"},...]}
Use short, high-level titles; preserve course order; aim for roughly 8–15 topics. If you find nothing instructional, return {"topics":[]}.`;

function buildUserPrompt(
  text: string,
  sourceKind: "pdf" | "web",
  sourceLabel: string,
): string {
  if (sourceKind === "pdf") {
    return `The PDF file is named "${sourceLabel}" — do not use this filename as courseName; extract the real course name from the text below.

Merge related lectures/weeks into single high-level topic titles (no duplicate themes split as Part I/II).

Syllabus text:
---
${text}
---`;
  }
  return `Content was loaded from this URL: ${sourceLabel}
Do not use the URL path or domain alone as the course name unless the page clearly shows that as the course title. Extract the real course name and outline from the text below.

Merge related lectures into single high-level topic titles (no duplicate themes split as Part I/II).

Page text:
---
${text}
---`;
}

/** `hintForPairing`: PDF filename or URL path segment — used to pair "174" with "CS" in body text. */
export function guessCourseNameFromText(
  text: string,
  hintForPairing: string,
): string | null {
  const head = text.slice(0, 24_000).replace(/\r\n/g, "\n");

  const withTitle = head.match(
    /\b([A-Za-z]{2,12})\s+(\d{3}[A-Z]?)\s*:\s*([^\n]{2,120})/,
  );
  if (withTitle) {
    const dept = withTitle[1].toUpperCase();
    return `${dept} ${withTitle[2]}: ${withTitle[3].trim()}`;
  }

  const multiWord = head.match(
    /(?:^|\n)\s*((?:[A-Za-z]{2,12}\s+){1,2}\d{3}[A-Z]?)(?:\s+[\u2013\-]\s*|\s+:\s*)([^\n]{2,100})/,
  );
  if (multiWord) {
    const a = `${multiWord[1]}`.trim();
    const b = `${multiWord[2]}`.trim();
    if (a.length + b.length < 160) {
      return `${a}: ${b}`;
    }
  }

  const codeOnly = head.match(/\b([A-Za-z]{2,12}\s+\d{3}[A-Z]?)\b/);
  if (codeOnly?.[1]) {
    return codeOnly[1].trim();
  }

  const fnDigits = hintForPairing.match(/(\d{3})/);
  if (fnDigits) {
    const num = fnDigits[1];
    const paired = head.match(
      new RegExp(
        `\\b(CS|STAT|MATH|ECE|COMP|COMPSCI|INFO|PHYS|CHEM|BIO|ECON|LING|PSYCH|ENGL)\\s*${num}\\b`,
        "i",
      ),
    );
    if (paired?.[1]) {
      return `${paired[1].toUpperCase()} ${num}`;
    }
  }

  return null;
}

const LINE_ADMIN =
  /^(office hours|grading|attendance|policy|academic integrity|contact|instructor|ta\b|email|phone|zoom|canvas|copyright|disability|due date|weight\b)/i;

export function extractTopicsHeuristic(text: string): { title: string }[] {
  const normalized = text.replace(/\r/g, "\n");
  let lines = normalized
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l.length >= 4 && l.length <= 220);

  if (lines.length < 8 && text.length > 400) {
    lines = text
      .split(/(?<=[.!?])\s+|(?:\s{2,})|\t+/)
      .map((l) => l.replace(/\s+/g, " ").trim())
      .filter((l) => l.length >= 12 && l.length <= 220);
  }

  const out: { title: string }[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    if (LINE_ADMIN.test(line)) continue;
    const topicLike =
      /^(week|lecture|unit|chapter|module|lab|section|part|topic)\s*\d+/i.test(
        line,
      ) ||
      /^\d{1,2}[\.\)]\s+[A-Za-z]/.test(line) ||
      /^[•\u2022\-\*]\s+\S/.test(line) ||
      (line.includes(":") &&
        /week|lecture|read|chapter|topic|lab|unit|module|introduction|overview/i.test(
          line,
        ));

    if (topicLike) {
      const key = line.slice(0, 120);
      if (!seen.has(key)) {
        seen.add(key);
        out.push({ title: line });
      }
    }
  }

  return out.slice(0, 80);
}

async function openaiChatJson(params: {
  apiKey: string;
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
  logPrefix?: string;
}): Promise<string | null> {
  memTrace("course-extraction openaiChatJson START");
  try {
  memTrace("course-extraction openaiChatJson before OpenAI request");
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${params.apiKey}`,
    },
    body: JSON.stringify({
      model: openaiModel(),
      temperature: params.temperature ?? 0.25,
      max_tokens: params.maxTokens ?? 4096,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: params.system },
        { role: "user", content: params.user },
      ],
    }),
  });

  const json: unknown = await res.json();
  memTrace("course-extraction openaiChatJson after OpenAI response body");
  if (!res.ok) {
    console.error(`${params.logPrefix ?? "[course-extract]"} OpenAI error:`, json);
    return null;
  }

  if (
    typeof json === "object" &&
    json !== null &&
    "choices" in json &&
    Array.isArray((json as { choices: unknown }).choices)
  ) {
    const c = (json as { choices: { message?: { content?: string } }[] })
      .choices[0]?.message?.content;
    if (typeof c === "string" && c.length > 0) {
      return c;
    }
  }
  return null;
  } finally {
    memTrace("course-extraction openaiChatJson END");
  }
}

export async function extractCourseFromPlainText(
  text: string,
  options: {
    apiKey: string;
    sourceKind: "pdf" | "web";
    /** PDF file name, or canonical page URL */
    sourceLabel: string;
    /** For pairing course numbers with dept (e.g. filename or URL path last segment) */
    hintForPairing: string;
    logPrefix?: string;
  },
): Promise<CourseExtractionResult | { error: string; status: number }> {
  memTrace("course-extraction extractCourseFromPlainText START");
  try {
  const log = options.logPrefix ?? "[course-extract]";
  const maxBodyChars =
    options.sourceKind === "web"
      ? MAX_WEB_MODEL_INPUT_CHARS
      : MAX_COURSE_TEXT_CHARS;
  let body = text;
  if (body.length > maxBodyChars) {
    body = `${body.slice(0, maxBodyChars)}\n\n[...truncated for processing]`;
  }

  const userContent = buildUserPrompt(
    body,
    options.sourceKind,
    options.sourceLabel,
  );

  const content = await openaiChatJson({
    apiKey: options.apiKey,
    system: SYSTEM_PROMPT,
    user: userContent,
    temperature: 0.25,
    maxTokens: 4096,
    logPrefix: log,
  });

  if (!content) {
    return {
      error: "Empty or failed response from language model",
      status: 502,
    };
  }

  let parsed = safeParseTopicsJson(content);
  if (!parsed) {
    console.error(`${log} Failed to parse model JSON:`, content);
    return {
      error: "Failed to parse structured output from the model",
      status: 422,
    };
  }

  console.log(
    `${log} First model pass — courseName length:`,
    parsed.courseName.length,
    "topics:",
    parsed.topics.length,
  );

  const parseHints: string[] = [];
  let topics = parsed.topics;
  let webFallbackKind: "none" | "heuristic" | "tiny_llm" = "none";

  if (parsed.topics.length === 0 && body.length > 400) {
    if (options.sourceKind === "web") {
      const heur = extractTopicsHeuristic(body);
      if (heur.length > 0) {
        topics = heur;
        webFallbackKind = "heuristic";
        parseHints.push("web_heuristic_topics_after_first_pass");
        console.log(
          `${log} Web: heuristic topics after empty first pass:`,
          heur.length,
        );
      } else {
        const tiny = body.slice(0, WEB_FALLBACK_LLM_MAX_CHARS);
        webFallbackKind = "tiny_llm";
        parseHints.push("web_tiny_llm_fallback");
        console.log(
          `${log} Web: tiny LLM fallback (no second full-page pass), excerpt chars:`,
          tiny.length,
        );
        const fb = await openaiChatJson({
          apiKey: options.apiKey,
          system: FALLBACK_TOPICS_PROMPT,
          user: `Syllabus excerpt:\n---\n${tiny}\n---`,
          temperature: 0.2,
          maxTokens: 2048,
          logPrefix: log,
        });
        if (fb) {
          const fbParsed = safeParseTopicsJson(fb);
          if (fbParsed && fbParsed.topics.length > 0) {
            topics = fbParsed.topics;
          }
        }
      }
    } else {
      console.log(`${log} Retrying with topic-focused prompt (PDF full text)…`);
      const fb = await openaiChatJson({
        apiKey: options.apiKey,
        system: FALLBACK_TOPICS_PROMPT,
        user: `Syllabus text:\n---\n${body}\n---`,
        temperature: 0.2,
        maxTokens: 4096,
        logPrefix: log,
      });
      if (fb) {
        const fbParsed = safeParseTopicsJson(fb);
        if (fbParsed && fbParsed.topics.length > 0) {
          topics = fbParsed.topics;
        }
      }
    }
  }

  if (
    topics.length === 0 &&
    body.replace(/\s/g, "").length > 50 &&
    options.sourceKind === "pdf"
  ) {
    const heur = extractTopicsHeuristic(body);
    if (heur.length > 0) {
      console.log(`${log} Applied heuristic topic lines: ${heur.length}`);
      topics = heur;
      parseHints.push("topics_inferred_from_line_patterns");
    }
  }

  if (options.sourceKind === "web") {
    console.log(`${log} Web fallback triggered:`, webFallbackKind, {
      topicCount: topics.length,
    });
  }

  let courseName = parsed.courseName;
  if (!courseName) {
    courseName = guessCourseNameFromText(body, options.hintForPairing) ?? "";
  }
  if (!courseName) {
    if (options.sourceKind === "pdf") {
      courseName = options.sourceLabel
        .replace(/\.pdf$/i, "")
        .replace(/_/g, " ")
        .trim();
    } else {
      try {
        const u = new URL(options.sourceLabel);
        const last = u.pathname.split("/").filter(Boolean).pop() ?? u.hostname;
        courseName = decodeURIComponent(last).replace(/[-_]/g, " ").trim();
      } catch {
        courseName = options.sourceLabel;
      }
    }
    parseHints.push("course_name_from_filename_or_url");
  }

  return {
    courseName,
    topics,
    ...(parseHints.length > 0 ? { parseHints } : {}),
  };
  } finally {
    memTrace("course-extraction extractCourseFromPlainText END");
  }
}
