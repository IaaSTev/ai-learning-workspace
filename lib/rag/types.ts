/**
 * RAG metadata aligned with rag.md — course-aware, topic via metadata,
 * not a global flat store.
 */

export type RagSourceType =
  | "syllabus"
  | "lecture_material"
  | "handwritten_note_summary"
  | "textbook";

export type RagChunkMetadata = {
  courseId: string;
  sourceType: RagSourceType;
  /** Primary topic label for this chunk (session / syllabus topic). */
  topic: string;
  /** Stable topic key; falls back to slug(topic) when omitted. */
  topicSlug?: string;
  week?: string;
  fileName?: string;
  chapter?: string;
  section?: string;
  page?: number;
  /** Lower = higher rank when ties (see retrieve). */
  priority: number;
  indexedAt: number;
};

export type RagChunkRecord = {
  id: string;
  text: string;
  embedding: number[];
  metadata: RagChunkMetadata;
};

export type RagCourseIndex = {
  courseId: string;
  chunks: RagChunkRecord[];
};

/** Course-level index layout v1 — points at shard files, no embeddings inline. */
export type RagManifestV1 = {
  version: 1;
  courseId: string;
  /** Lecture material shards (topic-based files under the course directory). */
  lectureShards: { slug: string; label: string }[];
  hasGeneral: boolean;
  updatedAt: number;
};
