import Database from "better-sqlite3";
import { memTrace } from "@/lib/mem-trace";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import type {
  RagChunkRecord,
  RagChunkMetadata,
  RagCourseIndex,
  RagManifestV1,
  RagSourceType,
} from "./types";
import { topicToSlug } from "./shard-layout";

function dataDir(): string {
  const fromEnv = process.env.RAG_DATA_DIR?.trim();
  if (fromEnv) return fromEnv;
  return join(tmpdir(), "study-agent-mvp-rag");
}

/** Single SQLite file for all courses (MVP). Override with RAG_SQLITE_PATH. */
export function ragSqlitePath(): string {
  const fromEnv = process.env.RAG_SQLITE_PATH?.trim();
  if (fromEnv) return fromEnv;
  return join(dataDir(), "rag.sqlite");
}

export const RETRIEVAL_CANDIDATE_CAP = 2000;

let _db: Database.Database | null = null;

export function getRagDb(): Database.Database {
  if (_db) return _db;
  memTrace("store getRagDb first open START");
  try {
    const path = ragSqlitePath();
    mkdirSync(dirname(path), { recursive: true });
    memTrace("store getRagDb before new Database()");
    _db = new Database(path);
    _db.pragma("journal_mode = WAL");
    initSchema(_db);
    memTrace("store getRagDb after initSchema");
    return _db;
  } finally {
    memTrace("store getRagDb first open END");
  }
}

function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS rag_chunks (
      id TEXT PRIMARY KEY,
      course_id TEXT NOT NULL,
      source_type TEXT NOT NULL,
      topic TEXT NOT NULL,
      topic_slug TEXT NOT NULL,
      week TEXT,
      chapter TEXT,
      section TEXT,
      page INTEGER,
      file_name TEXT,
      priority INTEGER NOT NULL,
      indexed_at INTEGER NOT NULL,
      text TEXT NOT NULL,
      embedding_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_rag_chunks_course ON rag_chunks(course_id);
    CREATE INDEX IF NOT EXISTS idx_rag_chunks_course_source ON rag_chunks(course_id, source_type);
    CREATE INDEX IF NOT EXISTS idx_rag_chunks_course_topic_slug ON rag_chunks(course_id, topic_slug);
  `);
}

type ChunkRow = {
  id: string;
  course_id: string;
  source_type: string;
  topic: string;
  topic_slug: string;
  week: string | null;
  chapter: string | null;
  section: string | null;
  page: number | null;
  file_name: string | null;
  priority: number;
  indexed_at: number;
  text: string;
  embedding_json: string;
};

function rowToRecord(row: ChunkRow): RagChunkRecord {
  const meta: RagChunkMetadata = {
    courseId: row.course_id,
    sourceType: row.source_type as RagSourceType,
    topic: row.topic,
    week: row.week ?? undefined,
    chapter: row.chapter ?? undefined,
    section: row.section ?? undefined,
    page: row.page ?? undefined,
    fileName: row.file_name ?? undefined,
    priority: row.priority,
    indexedAt: row.indexed_at,
  };
  return {
    id: row.id,
    text: row.text,
    embedding: JSON.parse(row.embedding_json) as number[],
    metadata: meta,
  };
}

function recordInsertParams(r: RagChunkRecord): unknown[] {
  const m = r.metadata;
  return [
    r.id,
    m.courseId,
    m.sourceType,
    m.topic,
    m.topicSlug ?? topicToSlug(m.topic),
    m.week ?? null,
    m.chapter ?? null,
    m.section ?? null,
    m.page ?? null,
    m.fileName ?? null,
    m.priority,
    m.indexedAt,
    r.text,
    JSON.stringify(r.embedding),
  ];
}

/**
 * Remove prior lecture chunks for one topic so re-ingest replaces instead of appends.
 * SQL: DELETE FROM rag_chunks WHERE course_id = ? AND source_type = 'lecture_material' AND topic = ?
 */
export function deleteLectureMaterialChunksForTopic(
  courseId: string,
  topic: string,
): number {
  const db = getRagDb();
  const info = db
    .prepare(
      `DELETE FROM rag_chunks WHERE course_id = ? AND source_type = 'lecture_material' AND topic = ?`,
    )
    .run(courseId, topic);
  const removed = info.changes;
  console.log("[rag/store] deleteLectureMaterialChunksForTopic", {
    courseId,
    topic,
    removed,
  });
  return removed;
}

/** Batch INSERT lecture (or any) chunks — no full-shard rewrite. */
export function insertLectureChunks(records: RagChunkRecord[]): void {
  if (records.length === 0) return;
  memTrace("store insertLectureChunks START");
  try {
    memTrace("store insertLectureChunks before DB write transaction");
    const db = getRagDb();
    const stmt = db.prepare(`
    INSERT INTO rag_chunks (
      id, course_id, source_type, topic, topic_slug,
      week, chapter, section, page, file_name,
      priority, indexed_at, text, embedding_json
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `);
    const tx = db.transaction((rows: RagChunkRecord[]) => {
      for (const r of rows) stmt.run(...recordInsertParams(r));
    });
    tx(records);
    memTrace("store insertLectureChunks after DB write transaction");
  } finally {
    memTrace("store insertLectureChunks END");
  }
  const first = records[0];
  console.log("[rag/store] insertLectureChunks", {
    inserted: records.length,
    courseId: first?.metadata.courseId,
    topic: first?.metadata.topic,
    topicSlug: first ? topicToSlug(first.metadata.topic) : null,
  });
}

/** Replace all syllabus structure chunks for a course. */
export function replaceSyllabusChunks(
  courseId: string,
  newChunks: RagChunkRecord[],
): void {
  memTrace("store replaceSyllabusChunks START");
  try {
    memTrace("store replaceSyllabusChunks before DB transaction");
    const db = getRagDb();
    const del = db.prepare(
      "DELETE FROM rag_chunks WHERE course_id = ? AND source_type = 'syllabus'",
    );
    const ins = db.prepare(`
    INSERT INTO rag_chunks (
      id, course_id, source_type, topic, topic_slug,
      week, chapter, section, page, file_name,
      priority, indexed_at, text, embedding_json
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `);
    const tx = db.transaction(() => {
      del.run(courseId);
      for (const r of newChunks) ins.run(...recordInsertParams(r));
    });
    tx();
    memTrace("store replaceSyllabusChunks after DB transaction");
    console.log("[rag/store] replaceSyllabusChunks", {
      courseId,
      deletedThenInserted: newChunks.length,
    });
  } finally {
    memTrace("store replaceSyllabusChunks END");
  }
}

export function getSyllabusTopicSignature(courseId: string): string | null {
  memTrace("store getSyllabusTopicSignature START");
  try {
    memTrace("store getSyllabusTopicSignature before DB read");
    const db = getRagDb();
    const rows = db
      .prepare(
        `SELECT topic FROM rag_chunks WHERE course_id = ? AND source_type = 'syllabus' ORDER BY indexed_at ASC, id ASC`,
      )
      .all(courseId) as { topic: string }[];
    memTrace("store getSyllabusTopicSignature after DB read");
    if (rows.length === 0) return null;
    return rows.map((r) => r.topic.trim().toLowerCase()).join("\n");
  } finally {
    memTrace("store getSyllabusTopicSignature END");
  }
}

/** Build manifest-equivalent from DISTINCT lecture topics in DB. */
export function buildManifestForCourse(courseId: string): RagManifestV1 {
  memTrace("store buildManifestForCourse before DB reads");
  const db = getRagDb();
  const rows = db
    .prepare(
      `SELECT topic_slug, MAX(topic) AS label FROM rag_chunks
       WHERE course_id = ? AND source_type = 'lecture_material'
       GROUP BY topic_slug`,
    )
    .all(courseId) as { topic_slug: string; label: string }[];

  const gen = db
    .prepare(
      `SELECT 1 FROM rag_chunks WHERE course_id = ? AND topic_slug = 'general' LIMIT 1`,
    )
    .get(courseId);

  const manifest: RagManifestV1 = {
    version: 1,
    courseId,
    lectureShards: rows.map((r) => ({
      slug: r.topic_slug,
      label: r.label ?? r.topic_slug,
    })),
    hasGeneral: Boolean(gen),
    updatedAt: Date.now(),
  };
  memTrace("store buildManifestForCourse after DB reads");
  return manifest;
}

export function syllabusShardExists(courseId: string): boolean {
  const db = getRagDb();
  const row = db
    .prepare(
      `SELECT 1 AS ok FROM rag_chunks WHERE course_id = ? AND source_type = 'syllabus' LIMIT 1`,
    )
    .get(courseId) as { ok: number } | undefined;
  return Boolean(row);
}

/**
 * Parse virtual shard paths from selectShardRelativePaths into SQL filters,
 * then load capped candidate rows for similarity scoring.
 */
export function loadChunksForRetrievalPaths(
  courseId: string,
  paths: string[],
  cap: number,
): RagChunkRecord[] {
  let includeSyllabus = false;
  const topicSlugs = new Set<string>();

  for (const p of paths) {
    if (p === "syllabus.json") includeSyllabus = true;
    else if (p === "general.json") topicSlugs.add("general");
    else if (p.startsWith("topic-") && p.endsWith(".json")) {
      topicSlugs.add(p.slice("topic-".length, -".json".length));
    }
  }

  const db = getRagDb();
  const slugs = [...topicSlugs];
  let rows: ChunkRow[];

  memTrace("store loadChunksForRetrievalPaths before candidate SQL query");

  if (includeSyllabus && slugs.length > 0) {
    const placeholders = slugs.map(() => "?").join(",");
    rows = db
      .prepare(
        `SELECT * FROM rag_chunks WHERE course_id = ?
         AND (
           source_type = 'syllabus'
           OR (source_type != 'syllabus' AND topic_slug IN (${placeholders}))
         )
         LIMIT ?`,
      )
      .all(courseId, ...slugs, cap) as ChunkRow[];
  } else if (includeSyllabus && slugs.length === 0) {
    rows = db
      .prepare(
        `SELECT * FROM rag_chunks WHERE course_id = ? AND source_type = 'syllabus' LIMIT ?`,
      )
      .all(courseId, cap) as ChunkRow[];
  } else if (!includeSyllabus && slugs.length > 0) {
    const placeholders = slugs.map(() => "?").join(",");
    rows = db
      .prepare(
        `SELECT * FROM rag_chunks WHERE course_id = ?
         AND source_type != 'syllabus' AND topic_slug IN (${placeholders})
         LIMIT ?`,
      )
      .all(courseId, ...slugs, cap) as ChunkRow[];
  } else {
    rows = [];
  }

  memTrace(
    "store loadChunksForRetrievalPaths after SQL (before rowToRecord map)",
  );

  console.log("[rag/store] loadChunksForRetrievalPaths", {
    courseId,
    includeSyllabus,
    topicSlugs: slugs,
    sourceTypeFilter:
      includeSyllabus && slugs.length > 0
        ? "syllabus OR lecture_material IN topic_slug"
        : includeSyllabus
          ? "syllabus_only"
          : slugs.length > 0
            ? "lecture_non_syllabus IN topic_slug"
            : "none",
    candidateRowCap: cap,
    candidateRowsLoaded: rows.length,
  });

  const mapped = rows.map(rowToRecord);
  memTrace(
    "store loadChunksForRetrievalPaths after candidate load (rowToRecord done)",
  );
  return mapped;
}

/** Course-wide fallback: load lecture_material candidates when topic bucket misses. */
export function loadLectureChunksForCourse(
  courseId: string,
  cap: number,
): RagChunkRecord[] {
  memTrace("store loadLectureChunksForCourse before fallback SQL query");
  const db = getRagDb();
  const rows = db
    .prepare(
      `SELECT * FROM rag_chunks WHERE course_id = ? AND source_type = 'lecture_material' LIMIT ?`,
    )
    .all(courseId, cap) as ChunkRow[];
  memTrace("store loadLectureChunksForCourse after fallback SQL query");
  console.log("[rag/store] loadLectureChunksForCourse", {
    courseId,
    candidateRowCap: cap,
    candidateRowsLoaded: rows.length,
  });
  return rows.map(rowToRecord);
}

/** Async wrapper for compatibility with existing retrieve code. */
export async function readManifest(
  courseId: string,
): Promise<RagManifestV1> {
  return buildManifestForCourse(courseId);
}

/** @deprecated Legacy JSON index — not used with SQLite MVP. */
export async function loadCourseIndex(
  courseId: string,
): Promise<RagCourseIndex> {
  const db = getRagDb();
  const rows = db
    .prepare(
      `SELECT * FROM rag_chunks WHERE course_id = ? LIMIT ?`,
    )
    .all(courseId, 10_000) as ChunkRow[];
  return {
    courseId,
    chunks: rows.map(rowToRecord),
  };
}

/** @deprecated Legacy JSON write — no-op with SQLite. */
export async function saveCourseIndex(_index: RagCourseIndex): Promise<void> {
  void _index;
  console.warn("[rag/store] saveCourseIndex is deprecated with SQLite; ignored.");
}
