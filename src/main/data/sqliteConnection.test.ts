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

  it("runs migrations on the primary SQLite adapter without deprecated note tables", () => {
    const temporary = createTemporarySqliteConnection("hcb2-sqlite-migration-test-");

    try {
      const result = runLocalDataMigrations(temporary.connection);
      const localNoteTables = temporary.connection.query<{ name: string }>(
        `SELECT name
         FROM sqlite_master
         WHERE name IN ('local_notes', 'local_notes_fts', 'local_note_links', 'local_note_properties', 'local_note_lists')
         ORDER BY name;`
      );

      expect(result.appliedVersions).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
      expect(localNoteTables).toEqual([]);
    } finally {
      temporary.cleanup();
    }
  });

  it("backfills calendar event local timezone during local migrations", () => {
    const temporary = createTemporarySqliteConnection("hcb2-sqlite-event-timezone-migration-");

    try {
      temporary.connection.exec(`
        CREATE TABLE google_calendar_events (
          id TEXT PRIMARY KEY,
          start_time_zone TEXT,
          end_time_zone TEXT
        );

        INSERT INTO google_calendar_events (id, start_time_zone, end_time_zone)
        VALUES ('event-1', NULL, NULL);
      `);

      const result = runLocalDataMigrations(temporary.connection, {
        defaultTimeZone: "Asia/Singapore"
      });
      const row = temporary.connection.get<{ hcbKind: string | null; localTimeZone: string | null }>(
        "SELECT hcb_kind AS hcbKind, local_time_zone AS localTimeZone FROM google_calendar_events WHERE id = ?;",
        ["event-1"]
      );

      expect(result.appliedVersions).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
      expect(row?.localTimeZone).toBe("Asia/Singapore");
      expect(row?.hcbKind).toBeNull();
    } finally {
      temporary.cleanup();
    }
  });

  it("forces one calendar full resync when existing events predate color id caching", () => {
    const temporary = createTemporarySqliteConnection("hcb2-sqlite-event-color-resync-");

    try {
      temporary.connection.exec(`
        CREATE TABLE google_calendar_events (
          id TEXT PRIMARY KEY,
          start_time_zone TEXT,
          end_time_zone TEXT,
          local_time_zone TEXT,
          recurrence_rule TEXT,
          color_id TEXT,
          deleted_at TEXT
        );

        CREATE TABLE google_sync_checkpoints (
          id TEXT PRIMARY KEY,
          account_id TEXT NOT NULL,
          resource_type TEXT NOT NULL,
          resource_id TEXT NOT NULL,
          checkpoint_type TEXT NOT NULL,
          checkpoint_value TEXT NOT NULL,
          metadata_json TEXT NOT NULL DEFAULT '{}',
          last_successful_sync_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(account_id, resource_type, resource_id, checkpoint_type)
        );

        INSERT INTO google_calendar_events (id, color_id, deleted_at)
        VALUES ('event-1', NULL, NULL);

        INSERT INTO google_sync_checkpoints (
          id, account_id, resource_type, resource_id, checkpoint_type,
          checkpoint_value, last_successful_sync_at, updated_at
        ) VALUES
          ('calendar-checkpoint', 'account-1', 'calendar', 'calendar-1', 'sync_token', 'token', '2026-05-22T00:00:00.000Z', '2026-05-22T00:00:00.000Z'),
          ('task-checkpoint', 'account-1', 'task_list', 'tasks-1', 'watermark', 'token', '2026-05-22T00:00:00.000Z', '2026-05-22T00:00:00.000Z');
      `);

      runLocalDataMigrations(temporary.connection);
      const rows = temporary.connection.query<{ resourceType: string }>(
        "SELECT resource_type AS resourceType FROM google_sync_checkpoints ORDER BY resource_type;"
      );

      expect(rows).toEqual([{ resourceType: "task_list" }]);
    } finally {
      temporary.cleanup();
    }
  });

  it("adds calendar event recurrence rule during local migrations", () => {
    const temporary = createTemporarySqliteConnection("hcb2-sqlite-event-recurrence-migration-");

    try {
      temporary.connection.exec(`
        CREATE TABLE google_calendar_events (
          id TEXT PRIMARY KEY,
          start_time_zone TEXT,
          end_time_zone TEXT,
          local_time_zone TEXT
        );
      `);

      runLocalDataMigrations(temporary.connection);
      const columns = temporary.connection
        .query<{ name: string }>("PRAGMA table_info(google_calendar_events);")
        .map((row) => row.name);

      expect(columns).toContain("recurrence_rule");
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
