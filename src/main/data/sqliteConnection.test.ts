import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runLocalDataMigrations } from "./migrations";
import {
  SqliteExecutionError,
  createSqliteConnection,
  createAppSqliteConnection,
  createTemporarySqliteConnection,
  type SqliteConnection
} from "./sqliteConnection";

function firstPragmaValue(connection: SqliteConnection, pragma: string): unknown {
  const row = connection.pragma<Record<string, unknown>>(pragma)[0];

  return row === undefined ? undefined : Object.values(row)[0];
}

describe("SQLite connection foundation", () => {
  it("creates temporary databases under the OS temp directory and cleans them up", () => {
    const temporary = createTemporarySqliteConnection("hcb2-sqlite-test-");

    try {
      expect(temporary.connection.adapterKind).toBe("better-sqlite3");
      expect(temporary.directory.startsWith(tmpdir())).toBe(true);
      expect(temporary.databasePath.startsWith(temporary.directory)).toBe(true);
      expect(existsSync(temporary.directory)).toBe(true);

      temporary.connection.exec("CREATE TABLE notes (id TEXT PRIMARY KEY, title TEXT NOT NULL);");
      temporary.connection.run("INSERT INTO notes (id, title) VALUES (?, ?);", [
        "note-1",
        "Local only"
      ]);

      expect(
        temporary.connection.get<{ title: string }>("SELECT title FROM notes WHERE id = ?;", [
          "note-1"
        ])
      ).toEqual({
        title: "Local only"
      });
    } finally {
      temporary.cleanup();
    }

    expect(existsSync(temporary.directory)).toBe(false);
  });

  it("applies production pragmas and keeps durable pragmas after reopening", () => {
    const temporary = createTemporarySqliteConnection("hcb2-sqlite-pragmas-test-");
    const databasePath = temporary.databasePath;

    try {
      expect(firstPragmaValue(temporary.connection, "foreign_keys")).toBe(1);
      expect(firstPragmaValue(temporary.connection, "journal_mode")).toBe("wal");
      expect(firstPragmaValue(temporary.connection, "synchronous")).toBe(1);
      expect(firstPragmaValue(temporary.connection, "temp_store")).toBe(2);
      expect(firstPragmaValue(temporary.connection, "cache_size")).toBe(-65536);
      expect(firstPragmaValue(temporary.connection, "mmap_size")).toBe(268435456);
      expect(firstPragmaValue(temporary.connection, "busy_timeout")).toBe(30000);

      temporary.connection.close();
      const reopened = createSqliteConnection(databasePath);

      try {
        expect(reopened.adapterKind).toBe("better-sqlite3");
        expect(firstPragmaValue(reopened, "foreign_keys")).toBe(1);
        expect(firstPragmaValue(reopened, "journal_mode")).toBe("wal");
        expect(firstPragmaValue(reopened, "synchronous")).toBe(1);
        expect(firstPragmaValue(reopened, "busy_timeout")).toBe(30000);
      } finally {
        reopened.close();
      }
    } finally {
      temporary.cleanup();
    }
  });

  it("supports explicit prepared statements for repeated writes and reads", () => {
    const temporary = createTemporarySqliteConnection("hcb2-sqlite-prepared-test-");

    try {
      temporary.connection.exec("CREATE TABLE counters (id TEXT PRIMARY KEY, value INTEGER NOT NULL);");
      const insert = temporary.connection.prepare("INSERT INTO counters (id, value) VALUES (?, ?);");
      const select = temporary.connection.prepare("SELECT value FROM counters WHERE id = ?;");

      expect(insert.run(["counter-1", 1])).toMatchObject({ changes: 1 });
      expect(insert.run(["counter-2", 2])).toMatchObject({ changes: 1 });
      expect(select.get<{ value: number }>(["counter-2"])).toEqual({ value: 2 });
    } finally {
      temporary.cleanup();
    }
  });

  it("runs migrations and FTS queries on the primary SQLite adapter", () => {
    const temporary = createTemporarySqliteConnection("hcb2-sqlite-migration-test-");

    try {
      const result = runLocalDataMigrations(temporary.connection);

      temporary.connection.run(
        `INSERT INTO local_notes (id, title, body, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?);`,
        [
          "note-1",
          "SQLite native adapter",
          "FTS should query migrated note content.",
          "2026-05-22T00:00:00.000Z",
          "2026-05-22T00:00:00.000Z"
        ]
      );

      const rows = temporary.connection.query<{ title: string }>(
        `SELECT notes.title
         FROM local_notes_fts
         INNER JOIN local_notes notes ON notes.rowid = local_notes_fts.rowid
         WHERE local_notes_fts MATCH ?;`,
        ["native"]
      );

      expect(result.appliedVersions).toEqual([1, 2, 3]);
      expect(rows).toEqual([{ title: "SQLite native adapter" }]);
    } finally {
      temporary.cleanup();
    }
  });

  it("creates app database connections only from caller-supplied temporary roots in tests", () => {
    const appSupportDirectory = mkdtempSync(join(tmpdir(), "hcb2-app-db-test-"));
    let connection: SqliteConnection | undefined;

    try {
      connection = createAppSqliteConnection({
        appSupportDirectory,
        filename: "test.sqlite3"
      });

      expect(connection.databasePath).toBe(join(appSupportDirectory, "data", "test.sqlite3"));
      connection.exec("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);");
      connection.run("INSERT INTO settings (key, value) VALUES (?, ?);", ["theme", "system"]);

      expect(
        connection.get<{ value: string }>("SELECT value FROM settings WHERE key = ?;", ["theme"])
      ).toEqual({
        value: "system"
      });
    } finally {
      connection?.close();
      rmSync(appSupportDirectory, { recursive: true, force: true });
    }
  });

  it("rolls back all writes when a transaction operation fails", () => {
    const temporary = createTemporarySqliteConnection("hcb2-sqlite-rollback-test-");

    try {
      temporary.connection.exec("CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT NOT NULL);");

      expect(() =>
        temporary.connection.executeTransaction([
          {
            kind: "run",
            sql: "INSERT INTO tasks (id, title) VALUES (?, ?);",
            params: ["task-1", "Draft"]
          },
          {
            kind: "run",
            sql: "INSERT INTO tasks (id, title) VALUES (?, ?);",
            params: ["task-1", "Duplicate"]
          }
        ])
      ).toThrowError(SqliteExecutionError);

      expect(temporary.connection.query("SELECT id, title FROM tasks;")).toEqual([]);
    } finally {
      temporary.cleanup();
    }
  });

  it("keeps the native SQLite binding compatible with packaged Electron builds", () => {
    const packageJson = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
    };
    const builderConfig = readFileSync(join(process.cwd(), "electron-builder.yml"), "utf8");

    expect(packageJson.dependencies?.["better-sqlite3"]).toBeDefined();
    expect(builderConfig).toContain("npmRebuild: true");
    expect(builderConfig).toContain("node_modules/better-sqlite3/**/*");
    expect(builderConfig).toContain("better_sqlite3.node");
  });
});
