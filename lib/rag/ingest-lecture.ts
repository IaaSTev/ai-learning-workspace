import { memTrace } from "@/lib/mem-trace";
import type { RagChunkMetadata, RagChunkRecord } from "./types";
import { chunkPlainText } from "./chunk-text";
import { EMBEDDING_BATCH_SIZE, embedTexts } from "./embeddings";
import {
  deleteLectureMaterialChunksForTopic,
  getRagDb,
  insertLectureChunks,
} from "./store";
import { topicToSlug } from "./shard-layout";

/** Cap chunks per upload to limit memory + embedding API load (large PDFs). */
const MAX_CHUNKS_PER_UPLOAD = 120;

function newId(prefix: string): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? `${prefix}-${crypto.randomUUID()}`
    : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export async function ingestLecturePlainText(options: {
  apiKey: string;
  courseId: string;
  topic: string;
  topicSlug?: string;
  fileName: string;
  plainText: string;
}): Promise<{ chunkCount: number; truncated: boolean }> {
  memTrace("ingest-lecture ingestLecturePlainText START");
  try {
    const topicLabel = options.topic.trim() || "General";
    const topicSlug =
      (options.topicSlug && options.topicSlug.trim()) || topicToSlug(topicLabel);
    const plainLen = options.plainText.length;
    memTrace("ingest-lecture before chunkPlainText");
    const { chunks: parts, truncated: chunkingTruncated } = chunkPlainText(
      options.plainText,
      {
        fileName: options.fileName,
        maxChunks: MAX_CHUNKS_PER_UPLOAD,
      },
    );
    memTrace("ingest-lecture after chunkPlainText");

    memTrace("ingest-lecture before getRagDb (lecture path)");
    const db = getRagDb();
    memTrace("ingest-lecture after getRagDb (lecture path)");

    const removedPrior = deleteLectureMaterialChunksForTopic(
      options.courseId,
      topicLabel,
    );
    console.log("[rag/ingest-lecture] replace lecture chunks for topic", {
      courseId: options.courseId,
      topic: topicLabel,
      topicSlug,
      removedPriorRows: removedPrior,
    });

    if (parts.length === 0) {
      return { chunkCount: 0, truncated: false };
    }

    const totalChunkChars = parts.reduce((a, p) => a + p.text.length, 0);
    const avgChunkChars =
      parts.length > 0 ? totalChunkChars / parts.length : 0;

    const previewLen = 120;
    const chunkPreviewsFirst5 = parts.slice(0, 5).map((p, i) => ({
      i,
      len: p.text.length,
      preview:
        p.text.length <= previewLen
          ? p.text
          : `${p.text.slice(0, previewLen)}…`,
    }));

    console.log("[rag/ingest-lecture] chunk stats", {
      plainTextLength: plainLen,
      chunkCount: parts.length,
      avgChunkChars: Math.round(avgChunkChars * 10) / 10,
      chunkingTruncated,
      maxChunks: MAX_CHUNKS_PER_UPLOAD,
      chunkPreviewsFirst5,
    });

    const now = Date.now();

    const batchSize = EMBEDDING_BATCH_SIZE;
    const totalBatches = Math.ceil(parts.length / batchSize);

    console.log("[rag/ingest-lecture]", {
      phase: "start",
      courseId: options.courseId,
      topic: topicLabel,
      topicSlug,
      uploadChunkCount: parts.length,
      batchSize,
      totalBatches,
    });

    for (let b = 0; b < totalBatches; b++) {
      const slice = parts.slice(b * batchSize, (b + 1) * batchSize);
      const texts = slice.map((p) => p.text);
      memTrace(
        `ingest-lecture before embedding batch ${b + 1}/${totalBatches}`,
      );
      const embeddings = await embedTexts(texts, options.apiKey);
      memTrace(
        `ingest-lecture after embedding batch ${b + 1}/${totalBatches}`,
      );

      const batchRecords: RagChunkRecord[] = slice.map((p, j) => {
        const metadata: RagChunkMetadata = {
          courseId: options.courseId,
          sourceType: "lecture_material",
          topic: topicLabel,
          topicSlug,
          fileName: options.fileName,
          page: p.pageHint,
          priority: 10,
          indexedAt: now,
        };
        return {
          id: newId("lec"),
          text: p.text,
          embedding: embeddings[j],
          metadata,
        };
      });

      memTrace(
        `ingest-lecture before insertLectureChunks batch ${b + 1}/${totalBatches}`,
      );
      insertLectureChunks(batchRecords);
      memTrace(
        `ingest-lecture after insertLectureChunks batch ${b + 1}/${totalBatches}`,
      );

      memTrace(
        `ingest-lecture before DB count read batch ${b + 1}/${totalBatches}`,
      );
      const after = (
        db
          .prepare(
            `SELECT COUNT(*) AS c FROM rag_chunks WHERE course_id = ? AND source_type = 'lecture_material' AND topic = ?`,
          )
          .get(options.courseId, topicLabel) as { c: number }
      ).c;
      memTrace(
        `ingest-lecture after DB count read batch ${b + 1}/${totalBatches}`,
      );

      console.log("[rag/ingest-lecture]", {
        phase: "batch-insert",
        courseId: options.courseId,
        topic: topicLabel,
        batchIndex: b + 1,
        batchTotal: totalBatches,
        rowsInsertedThisBatch: batchRecords.length,
        lectureRowsForTopicAfter: after,
      });
    }

    return { chunkCount: parts.length, truncated: chunkingTruncated };
  } finally {
    memTrace("ingest-lecture ingestLecturePlainText END");
  }
}
