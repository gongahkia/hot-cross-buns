import { createHash, randomUUID } from "node:crypto";
import type {
  AgentActionListRequest,
  AgentActionListResponse,
  AgentActionStatus,
  AgentActionSummary
} from "@shared/ipc/contracts";
import type { McpPermissionMode } from "../../mcp/types";
import type { SqliteConnection } from "../sqliteConnection";
import { pageBounds, pageFromRows, validationFailure } from "./shared";

interface AgentActionRow extends Record<string, unknown> {
  id: string;
  status: AgentActionStatus;
  toolName: string;
  argumentsJson: string;
  previewJson: string;
  summary: string;
  permissionMode: McpPermissionMode;
  credentialRevision: string;
  clientKey: string;
  createdAt: string;
  expiresAt: string;
  updatedAt: string;
  appliedAt: string | null;
  errorMessage: string | null;
}

export interface AgentActionCreateInput {
  id?: string;
  toolName: string;
  argumentsObject: Record<string, unknown>;
  preview: Record<string, unknown>;
  permissionMode: McpPermissionMode;
  credentialRevision: string;
  clientKey: string;
  createdAt: string;
  expiresAt: string;
}

export interface StoredAgentAction {
  id: string;
  status: AgentActionStatus;
  toolName: string;
  argumentsObject: Record<string, unknown>;
  permissionMode: McpPermissionMode;
  credentialRevision: string;
  clientKey: string;
  expiresAt: string;
}

export class LocalAgentRepository {
  constructor(private readonly connection: SqliteConnection) {}

  create(input: AgentActionCreateInput): string {
    const id = input.id ?? randomUUID();
    const summary = actionSummary(input.toolName, input.preview);
    this.connection.run(
      `INSERT INTO local_agent_actions (
         id, status, tool_name, arguments_json, preview_json, summary,
         permission_mode, credential_revision, client_key, created_at, expires_at,
         updated_at, applied_at, error_message
       ) VALUES (?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL);`,
      [
        id,
        input.toolName,
        stableJson(input.argumentsObject),
        stableJson(input.preview),
        summary,
        input.permissionMode,
        input.credentialRevision,
        input.clientKey,
        input.createdAt,
        input.expiresAt,
        input.createdAt
      ]
    );
    return id;
  }

  list(request: AgentActionListRequest): AgentActionListResponse {
    this.expireOld();
    const { limit, offset } = pageBounds(request.cursor, request.limit, 50, 100);
    const statuses = request.statuses ?? ["pending"];
    const params: Array<string | number> = [];
    const where = statuses.length > 0
      ? `status IN (${statuses.map(() => "?").join(", ")})`
      : "1 = 1";
    params.push(...statuses);
    const rows = this.connection.query<AgentActionRow>(
      `${selectAgentActionRows()}
       WHERE ${where}
       ORDER BY created_at DESC, id DESC
       LIMIT ? OFFSET ?;`,
      [...params, limit, offset]
    );
    const total = this.connection.get<{ count: number }>(
      `SELECT COUNT(*) AS count FROM local_agent_actions WHERE ${where};`,
      params
    )?.count ?? rows.length;
    return pageFromRows(rows.map(agentActionSummary), limit, offset, total);
  }

  requirePending(id: string, now = new Date().toISOString()): StoredAgentAction {
    this.expireOld(now);
    const row = this.connection.get<AgentActionRow>(
      `${selectAgentActionRows()} WHERE id = ? LIMIT 1;`,
      [id]
    );
    if (!row || row.status !== "pending") {
      throw validationFailure("Agent action is not pending.");
    }
    return {
      id: row.id,
      status: row.status,
      toolName: row.toolName,
      argumentsObject: parseObject(row.argumentsJson),
      permissionMode: row.permissionMode,
      credentialRevision: row.credentialRevision,
      clientKey: row.clientKey,
      expiresAt: row.expiresAt
    };
  }

  markApproved(id: string, now = new Date().toISOString()): void {
    this.updateStatus(id, "approved", now);
  }

  markApplied(id: string, now = new Date().toISOString()): void {
    this.connection.run(
      `UPDATE local_agent_actions
       SET status = 'applied', updated_at = ?, applied_at = ?, error_message = NULL
       WHERE id = ?;`,
      [now, now, id]
    );
  }

  markFailed(id: string, errorMessage: string, now = new Date().toISOString()): void {
    this.connection.run(
      `UPDATE local_agent_actions
       SET status = 'failed', updated_at = ?, error_message = ?
       WHERE id = ?;`,
      [now, errorMessage.slice(0, 500), id]
    );
  }

  reject(id: string, now = new Date().toISOString()): AgentActionSummary {
    this.requirePending(id, now);
    this.updateStatus(id, "rejected", now);
    return this.requireSummary(id);
  }

  requireSummary(id: string): AgentActionSummary {
    const row = this.connection.get<AgentActionRow>(
      `${selectAgentActionRows()} WHERE id = ? LIMIT 1;`,
      [id]
    );
    if (!row) {
      throw validationFailure("Agent action was not found.");
    }
    return agentActionSummary(row);
  }

  clearExpired(now = new Date().toISOString()): number {
    this.expireOld(now);
    return this.connection.run(
      "DELETE FROM local_agent_actions WHERE status = 'expired';"
    ).changes;
  }

  consume(id: string, input: {
    toolName: string;
    argumentsObject: Record<string, unknown>;
    permissionMode: McpPermissionMode;
    credentialRevision: string;
    clientKey: string;
    now: string;
  }): boolean {
    const action = this.connection.get<AgentActionRow>(
      `${selectAgentActionRows()} WHERE id = ? AND status = 'pending' LIMIT 1;`,
      [id]
    );
    if (!action || action.expiresAt < input.now) {
      if (action) {
        this.updateStatus(id, "expired", input.now);
      }
      return false;
    }
    const matches =
      action.toolName === input.toolName &&
      action.permissionMode === input.permissionMode &&
      action.credentialRevision === input.credentialRevision &&
      action.clientKey === input.clientKey &&
      action.argumentsJson === stableJson(input.argumentsObject);
    if (matches) {
      this.updateStatus(id, "approved", input.now);
    }
    return matches;
  }

  private updateStatus(id: string, status: AgentActionStatus, now: string): void {
    this.connection.run(
      "UPDATE local_agent_actions SET status = ?, updated_at = ? WHERE id = ?;",
      [status, now, id]
    );
  }

  private expireOld(now = new Date().toISOString()): void {
    this.connection.run(
      `UPDATE local_agent_actions
       SET status = 'expired', updated_at = ?
       WHERE status = 'pending' AND expires_at < ?;`,
      [now, now]
    );
  }
}

function selectAgentActionRows(): string {
  return `SELECT
           id,
           status,
           tool_name AS toolName,
           arguments_json AS argumentsJson,
           preview_json AS previewJson,
           summary,
           permission_mode AS permissionMode,
           credential_revision AS credentialRevision,
           client_key AS clientKey,
           created_at AS createdAt,
           expires_at AS expiresAt,
           updated_at AS updatedAt,
           applied_at AS appliedAt,
           error_message AS errorMessage
         FROM local_agent_actions`;
}

function agentActionSummary(row: AgentActionRow): AgentActionSummary {
  return {
    id: row.id,
    status: row.status,
    toolName: row.toolName,
    summary: row.summary,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    updatedAt: row.updatedAt,
    appliedAt: row.appliedAt,
    errorMessage: row.errorMessage
  };
}

function actionSummary(toolName: string, preview: Record<string, unknown>): string {
  const message = typeof preview.message === "string" ? preview.message : "";
  const title = typeof preview.title === "string" ? preview.title : "";
  const base = [message, title].map((value) => value.trim()).find(Boolean) ?? toolName;
  return `${toolName}: ${base}`.slice(0, 500);
}

function stableJson(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

function stableValue(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(stableValue);
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, stableValue(entry)])
  );
}

function parseObject(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value) as unknown;
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : {};
}

export function localAgentSecret(): string {
  return createHash("sha256").update("hot-cross-buns-agent").digest("hex");
}
