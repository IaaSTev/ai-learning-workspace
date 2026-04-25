import { memTrace } from "@/lib/mem-trace";
import type { RagChunkMetadata, RagChunkRecord } from "./types";
import { embedTexts } from "./embeddings";
import { getSyllabusTopicSignature, replaceSyllabusChunks } from "./store";

function newId(prefix: string): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? `${prefix}-${crypto.randomUUID()}`
    : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Syllabus as structure layer only — short navigational chunks (rag.md §3.1, §9.3).
 */
export async function syncSyllabusTopics(options: {
  apiKey: string;
  courseId: string;
  courseName: string;
  topics: { title: string }[];
}): Promise<{ chunkCount: number; skipped?: boolean }> {
  memTrace("ingest-syllabus-structure syncSyllabusTopics START");
  try {
  const titles = options.topics
    .map((t) => t.title.trim())
    .filter(Boolean);
  if (titles.length === 0) {
    memTrace(
      "ingest-syllabus-structure before DB write replaceSyllabusChunks (empty topics)",
    );
    await replaceSyllabusChunks(options.courseId, []);
    memTrace(
      "ingest-syllabus-structure after DB write replaceSyllabusChunks (empty topics)",
    );
    return { chunkCount: 0 };
  }

  const incomingSig = titles.map((t) => t.toLowerCase()).join("\n");
  memTrace("ingest-syllabus-structure before DB read getSyllabusTopicSignature");
  const existingSig = await getSyllabusTopicSignature(options.courseId);
  memTrace("ingest-syllabus-structure after DB read getSyllabusTopicSignature");
  if (existingSig !== null && existingSig === incomingSig) {
    return { chunkCount: titles.length, skipped: true };
  }

  const now = Date.now();
  const texts = titles.map(
    (title, i) =>
      `Course: ${options.courseName}\nTopic order ${i + 1}: ${title}\n(This entry describes course structure; it is not full teaching content.)`,
  );

  memTrace("ingest-syllabus-structure before embedding batch (syllabus embedTexts)");
  const embeddings = await embedTexts(texts, options.apiKey);
  memTrace("ingest-syllabus-structure after embedding batch (syllabus embedTexts)");

  const records: RagChunkRecord[] = titles.map((title, i) => {
    const metadata: RagChunkMetadata = {
      courseId: options.courseId,
      sourceType: "syllabus",
      topic: title,
      priority: 90,
      indexedAt: now,
    };
    return {
      id: newId("syl"),
      text: texts[i],
      embedding: embeddings[i],
      metadata,
    };
  });

  memTrace("ingest-syllabus-structure before DB write replaceSyllabusChunks");
  await replaceSyllabusChunks(options.courseId, records);
  memTrace("ingest-syllabus-structure after DB write replaceSyllabusChunks");
  return { chunkCount: records.length };
  } finally {
    memTrace("ingest-syllabus-structure syncSyllabusTopics END");
  }
}
