import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { NextResponse } from "next/server";
import { memTrace } from "@/lib/mem-trace";
import { PDFParse } from "pdf-parse";
import { logPdfExtractDiagnostics } from "@/lib/rag/pdf-extract-diagnostics";
import { ingestLecturePlainText } from "@/lib/rag/ingest-lecture";

export const runtime = "nodejs";

const workerFsPath = join(
  process.cwd(),
  "node_modules",
  "pdfjs-dist",
  "build",
  "pdf.worker.mjs",
);
if (existsSync(workerFsPath)) {
  PDFParse.setWorker(pathToFileURL(workerFsPath).href);
}

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Server misconfiguration: OPENAI_API_KEY is not set" },
      { status: 500 },
    );
  }

  const formData = await request.formData();
  const file = formData.get("file");
  const courseId = formData.get("courseId");
  const topic = formData.get("topic");
  const topicSlug = formData.get("topicSlug");

  if (!file || !(file instanceof File)) {
    return NextResponse.json(
      { error: 'Expected PDF in field "file"' },
      { status: 400 },
    );
  }

  if (typeof courseId !== "string" || !courseId.trim()) {
    return NextResponse.json(
      { error: 'Expected string "courseId"' },
      { status: 400 },
    );
  }

  const topicStr =
    typeof topic === "string" && topic.trim() ? topic.trim() : "General";
  const topicSlugStr =
    typeof topicSlug === "string" && topicSlug.trim() ? topicSlug.trim() : "";

  const isPdf =
    file.type === "application/pdf" ||
    file.name.toLowerCase().endsWith(".pdf");

  if (!isPdf) {
    return NextResponse.json({ error: "File must be a PDF" }, { status: 400 });
  }

  let parser: PDFParse | undefined;

  memTrace("api/rag/ingest-lecture POST handler START");
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    memTrace("api/rag/ingest-lecture after file.arrayBuffer -> Buffer");
    parser = new PDFParse({ data: buffer });
    const result = await parser.getText();
    memTrace("api/rag/ingest-lecture after PDF getText (plain text extracted)");
    const text = result.text ?? "";

    logPdfExtractDiagnostics("rag/ingest-lecture", text);

    if (!text.trim()) {
      return NextResponse.json(
        { error: "No text could be extracted from this PDF" },
        { status: 422 },
      );
    }

    memTrace("api/rag/ingest-lecture before ingestLecturePlainText");
    console.log("[rag/ingest-lecture] request topic binding", {
      courseId: courseId.trim(),
      topic: topicStr,
      topicSlug: topicSlugStr || "(derived-from-topic)",
      fileName: file.name,
    });
    const { chunkCount, truncated } = await ingestLecturePlainText({
      apiKey,
      courseId: courseId.trim(),
      topic: topicStr,
      topicSlug: topicSlugStr,
      fileName: file.name,
      plainText: text,
    });

    if (chunkCount === 0) {
      return NextResponse.json(
        { error: "No chunks produced from PDF text" },
        { status: 422 },
      );
    }

    memTrace("api/rag/ingest-lecture after ingestLecturePlainText");
    return NextResponse.json({
      ok: true,
      chunkCount,
      truncated,
      topic: topicStr,
      courseId: courseId.trim(),
    });
  } catch (err) {
    console.error("[rag/ingest-lecture]", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Failed to ingest lecture PDF",
      },
      { status: 500 },
    );
  } finally {
    memTrace("api/rag/ingest-lecture POST handler END");
    if (parser) {
      try {
        await parser.destroy();
      } catch {
        /* ignore */
      }
    }
  }
}
