import { randomUUID } from "node:crypto";
import type { JsonValue, McpPermissionMode } from "./types";

interface PendingConfirmation {
  toolName: string;
  canonicalArguments: string;
  permissionMode: McpPermissionMode;
  credentialRevision: string;
  clientKey: string;
  expiresAtMs: number;
}

export interface ConfirmationContext {
  toolName: string;
  arguments: Record<string, unknown>;
  permissionMode: McpPermissionMode;
  credentialRevision: string;
  clientKey: string;
  now: Date;
}

export interface McpConfirmationStoreOptions {
  ttlMs?: number;
}

const defaultTtlMs = 5 * 60 * 1000;

export class McpConfirmationStore {
  private readonly ttlMs: number;
  private readonly pending = new Map<string, PendingConfirmation>();

  constructor(options: McpConfirmationStoreOptions = {}) {
    this.ttlMs = options.ttlMs ?? defaultTtlMs;
  }

  create(context: ConfirmationContext): string {
    this.prune(context.now);
    const confirmationId = randomUUID();

    this.pending.set(confirmationId, {
      toolName: context.toolName,
      canonicalArguments: canonicalArguments(context.arguments),
      permissionMode: context.permissionMode,
      credentialRevision: context.credentialRevision,
      clientKey: context.clientKey,
      expiresAtMs: context.now.getTime() + this.ttlMs
    });

    return confirmationId;
  }

  consume(confirmationId: string, context: ConfirmationContext): boolean {
    this.prune(context.now);
    const confirmation = this.pending.get(confirmationId);

    if (!confirmation) {
      return false;
    }

    this.pending.delete(confirmationId);

    return (
      confirmation.toolName === context.toolName &&
      confirmation.permissionMode === context.permissionMode &&
      confirmation.credentialRevision === context.credentialRevision &&
      confirmation.clientKey === context.clientKey &&
      confirmation.expiresAtMs >= context.now.getTime() &&
      confirmation.canonicalArguments === canonicalArguments(context.arguments)
    );
  }

  clear(): void {
    this.pending.clear();
  }

  private prune(now: Date): void {
    const nowMs = now.getTime();

    for (const [id, confirmation] of this.pending.entries()) {
      if (confirmation.expiresAtMs < nowMs) {
        this.pending.delete(id);
      }
    }
  }
}

function canonicalArguments(argumentsObject: Record<string, unknown>): string {
  const clone = { ...argumentsObject };
  delete clone.dryRun;
  delete clone.confirmationId;

  return JSON.stringify(stableJsonValue(clone));
}

function stableJsonValue(value: unknown): JsonValue {
  if (value === null) {
    return null;
  }

  if (Array.isArray(value)) {
    return value.map(stableJsonValue);
  }

  switch (typeof value) {
    case "string":
    case "number":
    case "boolean":
      return value;
    case "object": {
      const input = value as Record<string, unknown>;
      const output: Record<string, JsonValue> = {};

      for (const key of Object.keys(input).sort()) {
        const next = stableJsonValue(input[key]);

        if (next !== undefined) {
          output[key] = next;
        }
      }

      return output;
    }
    default:
      return null;
  }
}
