/**
 * Native adapter diagnostics must never write OAuth credentials or raw Google
 * responses. Keep this tiny structured boundary until the full log exporter
 * is restored.
 */
export const appLogger = {
  warn(message: string, category: string, metadata: Record<string, unknown> = {}): void {
    console.warn(`[hcb:${category}] ${message}`, redact(metadata));
  }
};

function redact(metadata: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(metadata).map(([key, value]) => [
    key,
    /token|secret|authorization/i.test(key) ? "[redacted]" : value
  ]));
}
