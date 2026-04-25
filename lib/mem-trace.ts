/**
 * Temporary heap tracing (remove after debugging OOM).
 * Node-only: logs rss, heapUsed, heapTotal, external, arrayBuffers.
 */
export function memTrace(step: string): void {
  if (
    typeof process === "undefined" ||
    typeof process.memoryUsage !== "function"
  ) {
    console.log(`[memtrace] ${step} SKIP (not Node / no process.memoryUsage)`);
    return;
  }
  const u = process.memoryUsage() as NodeJS.MemoryUsage & {
    arrayBuffers?: number;
  };
  console.log(`[memtrace] ${step}`, {
    rss: u.rss,
    heapUsed: u.heapUsed,
    heapTotal: u.heapTotal,
    external: u.external,
    arrayBuffers: u.arrayBuffers ?? 0,
  });
}
