import { performance } from "node:perf_hooks";
import type { SqliteConnection } from "../sqliteConnection";
import type { SqliteWriteOperation } from "../sqliteConnection";
import { LocalHistoryRepository } from "./historyRepository";
import type { LocalPerformanceRepository } from "./performanceRepository";

type LocalTagEntityKind = "task" | "event" | "note";

export class PlannerRepositoryBase {
  protected readonly history: LocalHistoryRepository;

  constructor(
    protected readonly connection: SqliteConnection,
    protected readonly timings?: LocalPerformanceRepository
  ) {
    this.history = new LocalHistoryRepository(connection);
  }

  protected measureSqlite<T>(name: string, operation: () => T): T {
    const startedAt = performance.now();

    try {
      return operation();
    } finally {
      this.timings?.record({
        kind: "sqlite_query",
        name,
        durationMs: performance.now() - startedAt
      });
    }
  }

  protected recordHistory(input: {
    kind: string;
    summary: string;
    resourceId?: string | null;
    metadata?: Record<string, unknown>;
  }): void {
    this.history.record(input);
  }

  protected tagSyncOperations(input: {
    entityKind: LocalTagEntityKind;
    entityId: string;
    tags: readonly string[];
    now: string;
  }): SqliteWriteOperation[] {
    const tags = normalizeLocalTagNames(input.tags);
    const operations: SqliteWriteOperation[] = [
      {
        kind: "run",
        sql: "DELETE FROM local_entity_tags WHERE entity_kind = ? AND entity_id = ?;",
        params: [input.entityKind, input.entityId]
      }
    ];

    for (const tag of tags) {
      const normalized = normalizeLocalTagName(tag);
      operations.push(
        {
          kind: "run",
          sql: `INSERT INTO local_tags (id, name, normalized_name, color, created_at, updated_at, deleted_at)
                VALUES (?, ?, ?, NULL, ?, ?, NULL)
                ON CONFLICT(normalized_name) DO UPDATE SET
                  name = excluded.name,
                  updated_at = excluded.updated_at,
                  deleted_at = NULL;`,
          params: [localTagIdForName(normalized), tag, normalized, input.now, input.now]
        },
        {
          kind: "run",
          sql: `INSERT OR IGNORE INTO local_entity_tags (tag_id, entity_kind, entity_id, created_at)
                SELECT id, ?, ?, ?
                FROM local_tags
                WHERE normalized_name = ? AND deleted_at IS NULL
                LIMIT 1;`,
          params: [input.entityKind, input.entityId, input.now, normalized]
        }
      );
    }

    return operations;
  }

  protected tagDeleteEntityOperations(entityKind: LocalTagEntityKind, entityId: string): SqliteWriteOperation[] {
    return [
      {
        kind: "run",
        sql: "DELETE FROM local_entity_tags WHERE entity_kind = ? AND entity_id = ?;",
        params: [entityKind, entityId]
      }
    ];
  }

  protected shouldQueueRemoteMutations(): boolean {
    return shouldQueueRemoteMutationsForConnection(this.connection);
  }

  protected remoteMutationOperations(operation: SqliteWriteOperation): SqliteWriteOperation[] {
    return remoteMutationOperationsForConnection(this.connection, operation);
  }
}

export function shouldQueueRemoteMutationsForConnection(connection: SqliteConnection): boolean {
  const row = connection.get<{ valueJson: string }>(
    `SELECT value_json AS valueJson
     FROM local_settings
     WHERE scope = 'storage' AND key = 'backend'
     LIMIT 1;`
  );

  if (!row) {
    return true;
  }

  try {
    const value = JSON.parse(row.valueJson);
    return value !== "hcb-local" && value !== "hcb-hoster";
  } catch {
    return true;
  }
}

export function remoteMutationOperationsForConnection(
  connection: SqliteConnection,
  operation: SqliteWriteOperation
): SqliteWriteOperation[] {
  return shouldQueueRemoteMutationsForConnection(connection) ? [operation] : [];
}

export function normalizeLocalTagNames(tags: readonly string[]): string[] {
  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const value of tags) {
    const tag = value.trim().replace(/\s+/g, " ");
    const key = normalizeLocalTagName(tag);

    if (!tag || seen.has(key)) {
      continue;
    }

    seen.add(key);
    normalized.push(tag);
  }

  return normalized.slice(0, 64);
}

export function normalizeLocalTagName(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

export function localTagIdForName(normalizedName: string): string {
  let hash = 2166136261;

  for (let index = 0; index < normalizedName.length; index += 1) {
    hash ^= normalizedName.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return `tag:${(hash >>> 0).toString(36)}`;
}
