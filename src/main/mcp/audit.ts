import type { McpAuditEvent, McpAuditRecorder } from "./types";

export class MemoryMcpAuditRecorder implements McpAuditRecorder {
  readonly events: McpAuditEvent[] = [];

  record(event: McpAuditEvent): void {
    this.events.push(event);
  }
}

export function sanitizeAuditText(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/\b(token|secret|password|credential)=([^,\s]+)/gi, "$1=[redacted]")
    .replace(/[\r\n]/g, "")
    .trim()
    .slice(0, 120);
}

export function argumentKeysDescription(argumentsObject: Record<string, unknown>): string {
  const keys = Object.keys(argumentsObject).sort();
  return keys.length === 0 ? "none" : keys.join(",");
}
