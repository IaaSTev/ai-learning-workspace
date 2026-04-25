import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { NextResponse } from "next/server";
import { PDFParse } from "pdf-parse";
import { extractCourseFromPlainText } from "@/lib/course-extraction";

export const runtime = "nodejs";

// Turbopack bundles pdf.js with a broken worker path; point at the real file under node_modules.
const workerFsPath = join(
  process.cwd(),
  "node_modules",
  "pdfjs-dist",
  "build",
  "pdf.worker.mjs",
);
if (existsSync(workerFsPath)) {
  PDFParse.setWorker(pathToFileURL(workerFsPath).href);
} else {
  console.warn("[parse-syllabus] pdf.worker.mjs not found at:", workerFsPath);
}

function parseErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message) {
    return err.message;
  }
  return "Unknown error";
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const file = formData.get("file");

  if (!file || !(file instanceof File)) {
    return NextResponse.json(
      { error: 'Expected a PDF file in field "file"' },
      { status: 400 },
    );
  }

  const isPdf =
    file.type === "application/pdf" ||
    file.name.toLowerCase().endsWith(".pdf");

  if (!isPdf) {
    return NextResponse.json(
      { error: "File must be a PDF" },
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

  let parser: PDFParse | undefined;

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    parser = new PDFParse({ data: buffer });

    const result = await parser.getText();
    const text = result.text ?? "";

    console.log(
      `[parse-syllabus] "${file.name}": extracted ${text.length} characters`,
    );
    console.log("[parse-syllabus] extracted text:\n", text);

    if (!text.trim()) {
      return NextResponse.json(
        { error: "No text could be extracted from this PDF" },
        { status: 422 },
      );
    }

    const extracted = await extractCourseFromPlainText(text, {
      apiKey,
      sourceKind: "pdf",
      sourceLabel: file.name,
      hintForPairing: file.name,
      logPrefix: "[parse-syllabus]",
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

    return NextResponse.json(extracted);
  } catch (err) {
    console.error("[parse-syllabus] PDF or pipeline failed:", err);
    return NextResponse.json(
      {
        error: `Failed to parse PDF: ${parseErrorMessage(err)}`,
      },
      { status: 422 },
    );
  } finally {
    if (parser) {
      try {
        await parser.destroy();
      } catch {
        // Ignore cleanup failures.
      }
    }
  }
}
