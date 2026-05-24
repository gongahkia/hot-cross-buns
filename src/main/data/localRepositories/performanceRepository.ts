import type { LocalPerformanceTiming } from "@shared/ipc/contracts";
import { redactMetadata } from "@shared/redaction";
import type { SqliteConnection } from "../sqliteConnection";

export class LocalPerformanceRepository {
  constructor(private readonly connection: SqliteConnection) {}

  record(timing: {
    kind: LocalPerformanceTiming["kind"];
    name: string;
    durationMs: number;
    metadata?: Record<string, string | number | boolean | null>;
    createdAt?: string;
  }): void {
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
    return this.connection.query<{
      id: number;
      kind: LocalPerformanceTiming["kind"];
      name: string;
      durationMs: number;
      createdAt: string;
    }>(
      `SELECT id, kind, name, duration_ms AS durationMs, created_at AS createdAt
       FROM local_performance_timings
       ORDER BY created_at DESC, id DESC
       LIMIT ?;`,
      [safeLimit]
    );
  }

  listSlowSqliteQueries(limit = 10): Array<{ name: string; durationMs: number; createdAt: string }> {
    const safeLimit = Math.max(1, Math.min(10, limit));

    return this.connection.query<{ name: string; durationMs: number; createdAt: string }>(
      `SELECT name, duration_ms AS durationMs, created_at AS createdAt
       FROM local_performance_timings
       WHERE kind = 'sqlite_query'
       ORDER BY duration_ms DESC, created_at DESC, id DESC
       LIMIT ?;`,
      [safeLimit]
    );
  }
}
