import { NextResponse } from "next/server";
import { memTrace } from "@/lib/mem-trace";
import { syncSyllabusTopics } from "@/lib/rag/ingest-syllabus-structure";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Server misconfiguration: OPENAI_API_KEY is not set" },
      { status: 500 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Expected JSON object" }, { status: 400 });
  }

  const b = body as Record<string, unknown>;
  const courseId = typeof b.courseId === "string" ? b.courseId.trim() : "";
  const courseName =
    typeof b.courseName === "string" ? b.courseName.trim() : "";
  const rawTopics = b.topics;

  if (!courseId) {
    return NextResponse.json({ error: "courseId required" }, { status: 400 });
  }

  const topics: { title: string }[] = [];
  if (Array.isArray(rawTopics)) {
    for (const t of rawTopics) {
      if (t && typeof t === "object" && "title" in t) {
        const title = (t as { title: unknown }).title;
        if (typeof title === "string" && title.trim()) {
          topics.push({ title: title.trim() });
        }
      }
    }
  }

  memTrace("api/rag/sync-syllabus POST handler START");
  try {
    const { chunkCount } = await syncSyllabusTopics({
      apiKey,
      courseId,
      courseName: courseName || "Course",
      topics,
    });
    return NextResponse.json({ ok: true, chunkCount });
  } catch (err) {
    console.error("[rag/sync-syllabus]", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Failed to sync syllabus topics",
      },
      { status: 500 },
    );
  } finally {
    memTrace("api/rag/sync-syllabus POST handler END");
  }
}
