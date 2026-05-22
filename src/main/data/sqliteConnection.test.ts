import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  SqliteExecutionError,
  createAppSqliteConnection,
  createTemporarySqliteConnection,
  type SqliteConnection
} from "./sqliteConnection";

describe("SQLite connection foundation", () => {
  it("creates temporary databases under the OS temp directory and cleans them up", () => {
    const temporary = createTemporarySqliteConnection("hcb2-sqlite-test-");

    try {
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
});
