import { performance } from "node:perf_hooks";
import type { SqliteConnection } from "../sqliteConnection";
import type { LocalPerformanceRepository } from "./performanceRepository";

export class PlannerRepositoryBase {
  constructor(
    protected readonly connection: SqliteConnection,
    protected readonly timings?: LocalPerformanceRepository
  ) {}

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
}
