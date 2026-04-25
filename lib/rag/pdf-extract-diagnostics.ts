/**
 * One-off stats for PDF text from pdf-parse / pdf.js (no full text logging).
 */

const LINE_PREVIEW_MAX = 200;

export type PdfExtractDiagnostics = {
  textLength: number;
  lineCount: number;
  nonEmptyLineCount: number;
  uniqueNonEmptyLineCount: number;
  formFeedCount: number;
  previewFirst500: string;
  previewLast500: string;
  topRepeatedLines: { line: string; count: number }[];
};

export function computePdfExtractDiagnostics(text: string): PdfExtractDiagnostics {
  const lines =
    text.length === 0 ? [] : text.split(/\r\n|\n|\r/);
  const lineCount = lines.length;
  const nonEmptyLines: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (t.length > 0) nonEmptyLines.push(t);
  }
  const nonEmptyLineCount = nonEmptyLines.length;

  const uniqueSet = new Set(nonEmptyLines);
  const uniqueNonEmptyLineCount = uniqueSet.size;

  let formFeedCount = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 12) formFeedCount += 1;
  }

  const freq = new Map<string, number>();
  for (const line of nonEmptyLines) {
    freq.set(line, (freq.get(line) ?? 0) + 1);
  }
  const topRepeatedLines = [...freq.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 10)
    .map(([line, count]) => ({
      line:
        line.length > LINE_PREVIEW_MAX
          ? `${line.slice(0, LINE_PREVIEW_MAX)}…`
          : line,
      count,
    }));

  return {
    textLength: text.length,
    lineCount,
    nonEmptyLineCount,
    uniqueNonEmptyLineCount,
    formFeedCount,
    previewFirst500: text.slice(0, 500),
    previewLast500: text.length <= 500 ? text : text.slice(-500),
    topRepeatedLines,
  };
}

export function logPdfExtractDiagnostics(label: string, text: string): void {
  const d = computePdfExtractDiagnostics(text);
  console.log(`[${label}] pdf extract diagnostics`, {
    textLength: d.textLength,
    lineCount: d.lineCount,
    nonEmptyLineCount: d.nonEmptyLineCount,
    uniqueNonEmptyLineCount: d.uniqueNonEmptyLineCount,
    formFeedCount: d.formFeedCount,
    previewFirst500: d.previewFirst500,
    previewLast500: d.previewLast500,
    topRepeatedLines: d.topRepeatedLines,
  });
}
