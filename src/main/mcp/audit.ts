import type { McpAuditEvent, McpAuditRecorder } from "./types";
import { redactAuditText, redactSensitiveKey } from "@shared/redaction";

export class MemoryMcpAuditRecorder implements McpAuditRecorder {
  readonly events: McpAuditEvent[] = [];

  record(event: McpAuditEvent): void {
    this.events.push(event);
  }
}

export function sanitizeAuditText(value: string): string {
  return redactAuditText(value);
}

export function argumentKeysDescription(argumentsObject: Record<string, unknown>): string {
  const keys = Object.keys(argumentsObject).map(redactSensitiveKey).sort();
  return keys.length === 0 ? "none" : keys.join(",");
}
