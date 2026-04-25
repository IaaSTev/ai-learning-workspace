import { memTrace } from "@/lib/mem-trace";
import type { RagChunkRecord, RagSourceType } from "./types";
import { embedQuery } from "./embeddings";
import {
  loadLectureChunksForCourse,
  RETRIEVAL_CANDIDATE_CAP,
} from "./store";

function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d === 0 ? 0 : dot / d;
}

function sourceWeight(t: RagSourceType): number {
  switch (t) {
    case "lecture_material":
      return 1.0;
    case "handwritten_note_summary":
      return 0.95;
    case "textbook":
      return 0.9;
    case "syllabus":
      return 0.65;
    default:
      return 0.8;
  }
}

function topicBoost(
  chunk: RagChunkRecord,
  sessionTopic: string,
): number {
  const st = sessionTopic.trim().toLowerCase();
  if (!st) return 1;
  const mt = chunk.metadata.topic?.trim().toLowerCase() ?? "";
  if (mt && (mt.includes(st) || st.includes(mt))) return 1.18;
  const body = chunk.text.toLowerCase();
  if (body.includes(st)) return 1.08;
  return 1;
}

/** Normalize for lexical overlap (filename / topic labels). */
function normalizeForMatch(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/\.pdf$/i, "")
    .replace(/[_\-]+/g, " ")
    .replace(/\s+/g, " ");
}

/**
 * 0..1 overlap between session topic hint and a target string (topic title or file name).
 * Substring match → 1; else token Jaccard on whitespace-split tokens.
 */
function lexicalOverlapScore(sessionTopic: string, target: string): number {
  const st = normalizeForMatch(sessionTopic);
  const tt = normalizeForMatch(target);
  if (!st || !tt) return 0;
  if (st.includes(tt) || tt.includes(st)) return 1;
  const ta = st.split(" ").filter(Boolean);
  const tb = tt.split(" ").filter(Boolean);
  if (ta.length === 0 || tb.length === 0) return 0;
  const setB = new Set(tb);
  let inter = 0;
  for (const x of ta) if (setB.has(x)) inter++;
  const union = ta.length + tb.length - inter;
  return union === 0 ? 0 : inter / union;
}

type ScoredChunk = {
  chunk: RagChunkRecord;
  score: number;
  cosineSimilarity: number;
};

type PdfGroupAgg = {
  fileKey: string;
  /** Representative display name (first non-empty fileName in group). */
  fileLabel: string;
  rows: ScoredChunk[];
  /** Mean of top-up-to-5 cosine similarities in this PDF (semantic strength). */
  semanticGroup: number;
  topicMatch: number;
  fileMatch: number;
  groupScore: number;
  maxCosine: number;
};

/**
 * Single-PDF-first group score (tunable):
 * - semanticGroup: how well chunks in this PDF match the query (embedding cosine).
 * - topicMatch: sessionTopic vs metadata.topic (max over chunks in PDF).
 * - fileMatch: sessionTopic vs file name stem.
 *
 * Formula: 0.55 * semanticGroup + 0.30 * topicMatch + 0.15 * fileMatch
 */
const GROUP_SEMANTIC_WEIGHT = 0.55;
const GROUP_TOPIC_WEIGHT = 0.3;
const GROUP_FILE_WEIGHT = 0.15;

const FALLBACK_MAX_COSINE_LT = 0.26;
const FALLBACK_STRONG_CHUNK_COSINE = 0.19;
const FALLBACK_MIN_STRONG_CHUNKS = 2;
/** If top-2 PDFs are nearly tied and best PDF is not clearly strong, use cross-PDF. */
const FALLBACK_GROUP_SCORE_MARGIN = 0.035;
const FALLBACK_AMBIGUOUS_MAX_COSINE_LT = 0.4;

function fileGroupKey(chunk: RagChunkRecord): string {
  const n = chunk.metadata.fileName?.trim();
  return n || "(unknown)";
}

function meanTopCosines(cosines: number[], k: number): number {
  if (cosines.length === 0) return 0;
  const sorted = [...cosines].sort((a, b) => b - a);
  const take = Math.min(k, sorted.length);
  let s = 0;
  for (let i = 0; i < take; i++) s += sorted[i];
  return s / take;
}

function buildPdfGroups(
  scored: ScoredChunk[],
  topicHint: string,
): PdfGroupAgg[] {
  const byKey = new Map<string, ScoredChunk[]>();
  for (const row of scored) {
    const k = fileGroupKey(row.chunk);
    const list = byKey.get(k);
    if (list) list.push(row);
    else byKey.set(k, [row]);
  }

  const out: PdfGroupAgg[] = [];
  for (const [fileKey, rows] of byKey) {
    const cosines = rows.map((r) => r.cosineSimilarity);
    const semanticGroup = meanTopCosines(cosines, 5);
    let topicMatch = 0;
    for (const r of rows) {
      topicMatch = Math.max(
        topicMatch,
        lexicalOverlapScore(topicHint, r.chunk.metadata.topic ?? ""),
      );
    }
    const fileLabel =
      rows.find((r) => r.chunk.metadata.fileName?.trim())?.chunk.metadata
        .fileName?.trim() ?? fileKey;
    const fileMatch =
      fileKey === "(unknown)"
        ? 0
        : lexicalOverlapScore(topicHint, fileLabel);
    const groupScore =
      GROUP_SEMANTIC_WEIGHT * semanticGroup +
      GROUP_TOPIC_WEIGHT * topicMatch +
      GROUP_FILE_WEIGHT * fileMatch;
    const maxCosine = cosines.length ? Math.max(...cosines) : 0;
    out.push({
      fileKey,
      fileLabel,
      rows,
      semanticGroup,
      topicMatch,
      fileMatch,
      groupScore,
      maxCosine,
    });
  }
  out.sort((a, b) => b.groupScore - a.groupScore);
  return out;
}

function shouldFallbackToCrossPdf(
  winner: PdfGroupAgg | undefined,
  groups: PdfGroupAgg[],
): { fallback: boolean; reason: string } {
  if (!winner) return { fallback: true, reason: "no_winner_group" };
  if (winner.maxCosine < FALLBACK_MAX_COSINE_LT) {
    return {
      fallback: true,
      reason: `max_cosine_lt_${FALLBACK_MAX_COSINE_LT}`,
    };
  }
  const strong = winner.rows.filter(
    (r) => r.cosineSimilarity >= FALLBACK_STRONG_CHUNK_COSINE,
  ).length;
  if (strong < FALLBACK_MIN_STRONG_CHUNKS) {
    return {
      fallback: true,
      reason: `strong_chunks_lt_${FALLBACK_MIN_STRONG_CHUNKS}`,
    };
  }
  if (groups.length >= 2) {
    const second = groups[1];
    if (
      winner.groupScore - second.groupScore < FALLBACK_GROUP_SCORE_MARGIN &&
      winner.maxCosine < FALLBACK_AMBIGUOUS_MAX_COSINE_LT
    ) {
      return { fallback: true, reason: "ambiguous_top_pdf" };
    }
  }
  return { fallback: false, reason: "single_pdf_ok" };
}

export type RetrievedSnippet = {
  text: string;
  sourceType: RagSourceType;
  topic: string;
  fileName?: string;
  page?: number;
  score: number;
};

function sourceTypeDistribution(chunks: RagChunkRecord[]): Record<string, number> {
  const d: Record<string, number> = {};
  for (const c of chunks) {
    const k = c.metadata.sourceType;
    d[k] = (d[k] ?? 0) + 1;
  }
  return d;
}

/**
 * Course-wide lecture_material candidates (capped), then single-PDF-first ranking with optional cross-PDF fallback.
 */
export async function retrieveForQuery(options: {
  apiKey: string;
  courseId: string;
  query: string;
  sessionTopic: string;
  sessionTopicSlug?: string;
  topK?: number;
  maxChars?: number;
}): Promise<{ snippets: RetrievedSnippet[]; contextBlock: string }> {
  memTrace("retrieve retrieveForQuery START");
  try {
    const topK = options.topK ?? 8;
    const maxChars = options.maxChars ?? 6000;
    const topicBiasText =
      options.sessionTopic.trim() ||
      (options.sessionTopicSlug && options.sessionTopicSlug.trim()
        ? options.sessionTopicSlug
            .trim()
            .replace(/_/g, " ")
            .replace(/\s+/g, " ")
        : "");

    memTrace("retrieve before course-wide lecture candidate load");
    const chunks = loadLectureChunksForCourse(
      options.courseId,
      RETRIEVAL_CANDIDATE_CAP,
    );
    memTrace("retrieve after course-wide lecture candidate load");

    const dist = sourceTypeDistribution(chunks);
    console.log("[rag/retrieve]", {
      courseId: options.courseId,
      retrievalMode: "single_pdf_first",
      sessionTopic: options.sessionTopic || "(empty)",
      sessionTopicSlug: options.sessionTopicSlug || "(empty)",
      topicBiasText: topicBiasText || "(none)",
      topicBiasApplied: Boolean(topicBiasText),
      loadedChunkCount: chunks.length,
      candidateCap: RETRIEVAL_CANDIDATE_CAP,
      sourceTypeDistribution: dist,
    });

    if (chunks.length === 0) {
      return { snippets: [], contextBlock: "" };
    }

    memTrace("retrieve before embedQuery");
    const qEmb = await embedQuery(options.query.slice(0, 8000), options.apiKey);
    memTrace("retrieve after embedQuery");

    const TEXT_PREVIEW_MAX = 280;

    const scored: ScoredChunk[] = chunks.map((c) => {
      const cosineSimilarity = cosine(qEmb, c.embedding);
      const w = sourceWeight(c.metadata.sourceType);
      // Topic is now a soft rerank hint only; it never filters candidates.
      const tb = topicBoost(c, topicBiasText);
      const score =
        cosineSimilarity * w * tb * (1 + 1 / (1 + c.metadata.priority));
      return { chunk: c, score, cosineSimilarity };
    });

    scored.sort((a, b) => b.score - a.score);

    const pdfGroups = buildPdfGroups(scored, topicBiasText);
    const winner = pdfGroups[0];
    const { fallback: crossPdfFallback, reason: fallbackReason } =
      shouldFallbackToCrossPdf(winner, pdfGroups);

    const topGroupsLog = pdfGroups.slice(0, 5).map((g) => ({
      fileKey: g.fileKey,
      fileLabel: g.fileLabel,
      groupScore: g.groupScore,
      semanticGroup: g.semanticGroup,
      topicMatch: g.topicMatch,
      fileMatch: g.fileMatch,
      maxCosine: g.maxCosine,
      chunkCount: g.rows.length,
    }));

    console.log("[rag/retrieve] single_pdf_first groups", {
      courseId: options.courseId,
      topicBiasText: topicBiasText || "(none)",
      winnerFile: winner?.fileLabel ?? null,
      crossPdfFallback,
      fallbackReason,
      topGroups: topGroupsLog,
    });

    let picked: ScoredChunk[];
    if (crossPdfFallback) {
      picked = scored.slice(0, topK);
    } else {
      const inPdf = scored.filter(
        (r) => fileGroupKey(r.chunk) === winner.fileKey,
      );
      inPdf.sort((a, b) => b.score - a.score);
      picked = inPdf.slice(0, topK);
    }

    const top3 = picked.slice(0, 3);
    console.log("[rag/retrieve] top3 retrieved (acceptance)", {
      userQuestion: options.query.slice(0, 800),
      courseId: options.courseId,
      retrievalMode: crossPdfFallback
        ? "single_pdf_first_fallback_cross_pdf"
        : "single_pdf_first",
      primaryPdf: winner?.fileLabel ?? null,
      crossPdfFallback,
      fallbackReason,
      topicBiasText: topicBiasText || "(none)",
      results: top3.map((row, i) => {
        const t = row.chunk.text;
        const preview =
          t.length <= TEXT_PREVIEW_MAX
            ? t
            : `${t.slice(0, TEXT_PREVIEW_MAX)}…`;
        return {
          rank: i + 1,
          score: row.score,
          cosineSimilarity: row.cosineSimilarity,
          textPreview: preview,
          metadata: {
            topic: row.chunk.metadata.topic,
            fileName: row.chunk.metadata.fileName ?? null,
            page: row.chunk.metadata.page ?? null,
            sourceType: row.chunk.metadata.sourceType,
          },
        };
      }),
    });

    const snippets: RetrievedSnippet[] = picked.map(({ chunk, score }) => ({
      text: chunk.text,
      sourceType: chunk.metadata.sourceType,
      topic: chunk.metadata.topic,
      fileName: chunk.metadata.fileName,
      page: chunk.metadata.page,
      score,
    }));

    let contextBlock = "";
    for (const s of snippets) {
      const header = `[${s.sourceType}${s.fileName ? ` · ${s.fileName}` : ""}${s.page != null ? ` · p.${s.page}` : ""} · topic: ${s.topic}]`;
      const piece = `${header}\n${s.text}\n\n`;
      if (contextBlock.length + piece.length > maxChars) break;
      contextBlock += piece;
    }

    return { snippets, contextBlock: contextBlock.trim() };
  } finally {
    memTrace("retrieve retrieveForQuery END");
  }
}
