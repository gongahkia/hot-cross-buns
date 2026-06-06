import { describe, expect, it } from "vitest";
import { runLocalDataMigrations } from "../migrations";
import { createTemporarySqliteConnection } from "../sqliteConnection";
import { LocalPerformanceRepository } from "./performanceRepository";

describe("local performance repository", () => {
  it("roundtrips sanitized timing metadata", () => {
    const temporary = createTemporarySqliteConnection("hcb2-performance-repository-");

    try {
      runLocalDataMigrations(temporary.connection);
      const repository = new LocalPerformanceRepository(temporary.connection);

      repository.record({
        kind: "startup",
        name: "startup.bootstrap.get",
        durationMs: 12.345,
        metadata: {
          outcome: "used",
          payloadBytes: 1234,
          accepted: true,
          token: "secret-value"
        },
        createdAt: "2026-06-06T00:00:00.000Z"
      });

      expect(repository.listRecent(1)).toEqual([
        {
          id: expect.any(Number),
          kind: "startup",
          name: "startup.bootstrap.get",
          durationMs: 12.35,
          metadata: {
            "[redacted]": "[redacted]",
            outcome: "used",
            payloadBytes: 1234,
            accepted: true
          },
          createdAt: "2026-06-06T00:00:00.000Z"
        }
      ]);
    } finally {
      temporary.cleanup();
    }
  });

  it("keeps SQLite query timings visible without synchronous persistence", () => {
    const temporary = createTemporarySqliteConnection("hcb2-performance-repository-");

    try {
      runLocalDataMigrations(temporary.connection);
      const repository = new LocalPerformanceRepository(temporary.connection);

      repository.record({
        kind: "sqlite_query",
        name: "tasks.list",
        durationMs: 42.424,
        createdAt: "2026-06-06T00:00:00.000Z"
      });

      expect(repository.listRecent(1)).toEqual([
        expect.objectContaining({
          kind: "sqlite_query",
          name: "tasks.list",
          durationMs: 42.42
        })
      ]);
      expect(repository.listSlowSqliteQueries(1)).toEqual([
        {
          name: "tasks.list",
          durationMs: 42.42,
          createdAt: "2026-06-06T00:00:00.000Z"
        }
      ]);
    } finally {
      temporary.cleanup();
    }
  });
});
