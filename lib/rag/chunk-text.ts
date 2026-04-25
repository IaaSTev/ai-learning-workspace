/**
 * Lecture / plain text chunking (rag.md §10.2) — page-ish blocks, not arbitrary whole-book windows only.
 */

const DEFAULT_MAX = 1600;
const OVERLAP = 200;

export type PlainTextChunk = { text: string; pageHint?: number };

export type ChunkPlainTextOptions = {
  maxChars?: number;
  fileName?: string;
  /** Stop after this many chunks (reduces memory vs. building the full list then slicing). */
  maxChunks?: number;
};

/**
 * Splits cleaned text into page-ish chunks. When `maxChunks` is set, stops as soon as that
 * many chunks are collected so the `parts` array never grows past the cap.
 */
export function chunkPlainText(
  text: string,
  options?: ChunkPlainTextOptions,
): { chunks: PlainTextChunk[]; truncated: boolean } {
  const maxChars = options?.maxChars ?? DEFAULT_MAX;
  const maxChunks = options?.maxChunks;
  const limit = maxChunks ?? Number.POSITIVE_INFINITY;

  const cleaned = text.replace(/\r\n/g, "\n").trim();
  if (!cleaned) {
    return { chunks: [], truncated: false };
  }

  const parts: PlainTextChunk[] = [];

  /** Heuristic: form-feed often indicates page breaks in extracted PDF text. */
  const segments = cleaned.split(/\f+/);
  let pageNum = 1;
  let truncated = false;

  segmentsLoop: for (const seg of segments) {
    const s = seg.trim();
    if (!s) {
      pageNum += 1;
      continue;
    }

    if (s.length <= maxChars) {
      parts.push({ text: s, pageHint: pageNum });
      if (parts.length >= limit) {
        truncated = maxChunks != null;
        break segmentsLoop;
      }
      pageNum += 1;
      continue;
    }

    let start = 0;
    while (start < s.length) {
      const end = Math.min(start + maxChars, s.length);
      let slice = s.slice(start, end);
      if (end < s.length) {
        const lastPara = slice.lastIndexOf("\n\n");
        if (lastPara > maxChars * 0.4) {
          slice = slice.slice(0, lastPara).trimEnd();
        }
      }

      const trimmed = slice.trim();
      if (trimmed) {
        parts.push({ text: trimmed, pageHint: pageNum });
        if (parts.length >= limit) {
          truncated = maxChunks != null;
          break segmentsLoop;
        }
      }

      const chunkLen = slice.length;
      let nextStart: number;
      if (chunkLen === 0) {
        nextStart = end;
      } else if (chunkLen <= OVERLAP) {
        // Overlap subtraction would not move forward; advance past this chunk instead.
        nextStart = start + chunkLen;
      } else {
        nextStart = start + chunkLen - OVERLAP;
      }
      if (nextStart <= start) nextStart = end;
      if (nextStart <= start) nextStart = Math.min(start + 1, s.length);

      start = Math.min(nextStart, s.length);
    }
    pageNum += 1;
  }

  return { chunks: parts, truncated };
}
