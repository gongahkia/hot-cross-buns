import type { LocalPerformanceTiming } from "@shared/ipc/contracts";
import { redactMetadata } from "@shared/redaction";
import type { SqliteConnection } from "../sqliteConnection";

export class LocalPerformanceRepository {
  private readonly memoryTimings: LocalPerformanceTiming[] = [];
  private nextMemoryId = 1;

  constructor(private readonly connection: SqliteConnection) {}

  record(timing: {
    kind: LocalPerformanceTiming["kind"];
    name: string;
    durationMs: number;
    metadata?: Record<string, string | number | boolean | null>;
    createdAt?: string;
  }): void {
    if (timing.kind === "sqlite_query") {
      this.recordMemory(timing);
      return;
    }

    try {
      this.connection.run(
        `INSERT INTO local_performance_timings
          (kind, name, duration_ms, metadata_json, created_at)
         VALUES (?, ?, ?, ?, ?);`,
        [
          timing.kind,
          timing.name,
          Math.max(0, Math.round(timing.durationMs * 100) / 100),
          JSON.stringify(redactMetadata(timing.metadata)),
          timing.createdAt ?? new Date().toISOString()
        ]
      );
    } catch {
      // Diagnostics must not break the user-facing read path.
    }
  }

  listRecent(limit = 50): LocalPerformanceTiming[] {
    const safeLimit = Math.max(1, Math.min(100, limit));
    const persisted = this.connection.query<{
      id: number;
      kind: LocalPerformanceTiming["kind"];
      name: string;
      durationMs: number;
      metadataJson: string | null;
      createdAt: string;
    }>(
      `SELECT id, kind, name, duration_ms AS durationMs, metadata_json AS metadataJson, created_at AS createdAt
       FROM local_performance_timings
       ORDER BY created_at DESC, id DESC
       LIMIT ?;`,
      [safeLimit]
    ).map((row) => {
      const metadata = parseMetadata(row.metadataJson);

      return {
        id: row.id,
        kind: row.kind,
        name: row.name,
        durationMs: row.durationMs,
        ...(metadata === undefined ? {} : { metadata }),
        createdAt: row.createdAt
      };
    });

    return [...this.memoryTimings, ...persisted]
      .sort((left, right) =>
        right.createdAt.localeCompare(left.createdAt) ||
        ((right.id ?? 0) - (left.id ?? 0))
      )
      .slice(0, safeLimit);
  }

  listSlowSqliteQueries(limit = 10): Array<{ name: string; durationMs: number; createdAt: string }> {
    const safeLimit = Math.max(1, Math.min(10, limit));

    const persisted = this.connection.query<{ name: string; durationMs: number; createdAt: string }>(
      `SELECT name, duration_ms AS durationMs, created_at AS createdAt
       FROM local_performance_timings
       WHERE kind = 'sqlite_query'
       ORDER BY duration_ms DESC, created_at DESC, id DESC
       LIMIT ?;`,
      [safeLimit]
    );

    return [
      ...this.memoryTimings
        .filter((timing) => timing.kind === "sqlite_query")
        .map((timing) => ({
          name: timing.name,
          durationMs: timing.durationMs,
          createdAt: timing.createdAt
        })),
      ...persisted
    ]
      .sort((left, right) =>
        right.durationMs - left.durationMs ||
        right.createdAt.localeCompare(left.createdAt)
      )
      .slice(0, safeLimit);
  }

  private recordMemory(timing: {
    kind: LocalPerformanceTiming["kind"];
    name: string;
    durationMs: number;
    metadata?: Record<string, string | number | boolean | null>;
    createdAt?: string;
  }): void {
    this.memoryTimings.unshift({
      id: this.nextMemoryId++,
      kind: timing.kind,
      name: timing.name,
      durationMs: Math.max(0, Math.round(timing.durationMs * 100) / 100),
      ...(timing.metadata === undefined ? {} : { metadata: redactMetadata(timing.metadata) }),
      createdAt: timing.createdAt ?? new Date().toISOString()
    });

    if (this.memoryTimings.length > 500) {
      this.memoryTimings.length = 500;
    }
  }
}

function parseMetadata(
  metadataJson: string | null
): Record<string, string | number | boolean | null> | undefined {
  if (!metadataJson) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(metadataJson);

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return undefined;
    }

    const metadata: Record<string, string | number | boolean | null> = {};

    for (const [key, value] of Object.entries(parsed)) {
      if (
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean" ||
        value === null
      ) {
        metadata[key] = value;
      }
    }

    return Object.keys(metadata).length === 0 ? undefined : metadata;
  } catch {
    return undefined;
  }
}
