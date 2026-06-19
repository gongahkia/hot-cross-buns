import { randomUUID } from "node:crypto";
import type { LocalAgentRepository } from "../data/localRepositories/agentRepository";
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
  repository?: LocalAgentRepository;
}

const defaultTtlMs = 5 * 60 * 1000;

export class McpConfirmationStore {
  private readonly ttlMs: number;
  private readonly pending = new Map<string, PendingConfirmation>();
  private readonly repository?: LocalAgentRepository;

  constructor(options: McpConfirmationStoreOptions = {}) {
    this.ttlMs = options.ttlMs ?? defaultTtlMs;
    this.repository = options.repository;
  }

  create(context: ConfirmationContext & { preview?: Record<string, unknown> }): string {
    this.prune(context.now);
    const confirmationId = randomUUID();
    const expiresAt = new Date(context.now.getTime() + this.ttlMs);

    this.pending.set(confirmationId, {
      toolName: context.toolName,
      canonicalArguments: canonicalArguments(context.arguments),
      permissionMode: context.permissionMode,
      credentialRevision: context.credentialRevision,
      clientKey: context.clientKey,
      expiresAtMs: expiresAt.getTime()
    });
    this.repository?.create({
      id: confirmationId,
      toolName: context.toolName,
      argumentsObject: normalizedArguments(context.arguments),
      preview: context.preview ?? {},
      permissionMode: context.permissionMode,
      credentialRevision: context.credentialRevision,
      clientKey: context.clientKey,
      createdAt: context.now.toISOString(),
      expiresAt: expiresAt.toISOString()
    });

    return confirmationId;
  }

  consume(confirmationId: string, context: ConfirmationContext): boolean {
    this.prune(context.now);
    const confirmation = this.pending.get(confirmationId);

    if (!confirmation) {
      return this.repository?.consume(confirmationId, {
        toolName: context.toolName,
        argumentsObject: normalizedArguments(context.arguments),
        permissionMode: context.permissionMode,
        credentialRevision: context.credentialRevision,
        clientKey: context.clientKey,
        now: context.now.toISOString()
      }) ?? false;
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

  markApplied(confirmationId: string, now = new Date()): void {
    this.repository?.markApplied(confirmationId, now.toISOString());
  }

  markFailed(confirmationId: string, error: unknown, now = new Date()): void {
    const message = error instanceof Error ? error.message : String(error);
    this.repository?.markFailed(confirmationId, message, now.toISOString());
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
  const clone = normalizedArguments(argumentsObject);
  return JSON.stringify(stableJsonValue(clone));
}

function normalizedArguments(argumentsObject: Record<string, unknown>): Record<string, unknown> {
  const clone = { ...argumentsObject };
  delete clone.dryRun;
  delete clone.confirmationId;
  delete clone.passphrase;
  return clone;
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
