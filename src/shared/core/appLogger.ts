/**
 * Native adapter diagnostics must never write OAuth credentials or raw Google
 * responses. Keep this tiny structured boundary until the full log exporter
 * is restored.
 */
const entries: Array<{ id: string; level: string; message: string; category: string; timestamp: string; metadata: Record<string, unknown> }> = [];
export const appLogger = {
  warn(message: string, category: string, metadata: Record<string, unknown> = {}): void {
    entries.push({ id: `${Date.now()}-${entries.length}`, level: "warn", message, category, timestamp: new Date().toISOString(), metadata: redact(metadata) });
    if (entries.length > 200) entries.shift();
    console.warn(`[hcb:${category}] ${message}`, redact(metadata));
  },
  snapshot(input: Record<string, unknown> = {}): { entries: typeof entries; persistedText: string } {
    const limit = Math.max(1, Math.min(200, Number(input.limit) || 200));
    const visible = input.minimumLevel === "error" ? [] : entries.slice(-limit).map((entry) => ({ ...entry, metadata: {}, formattedLine: `${entry.timestamp} ${entry.level} [${entry.category}] ${entry.message}` }));
    return { entries: visible, persistedText: visible.map((entry) => `${entry.timestamp} ${entry.level} [${entry.category}] ${entry.message}`).join("\n") };
  },
  clear(): void {
    entries.length = 0;
  }
};

function redact(metadata: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(metadata).map(([key, value]) => [
    key,
    /token|secret|authorization/i.test(key) ? "[redacted]" : value
  ]));
}
