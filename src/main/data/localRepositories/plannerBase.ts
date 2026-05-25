import { performance } from "node:perf_hooks";
import type { SqliteConnection } from "../sqliteConnection";
import { LocalHistoryRepository } from "./historyRepository";
import type { LocalPerformanceRepository } from "./performanceRepository";

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
}
