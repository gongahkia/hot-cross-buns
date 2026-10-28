import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CoreStore } from "./coreStore";

const directories: string[] = [];
function pathForTest(): string {
  if (!process.env.HCB_TEST_DATABASE_ROOT) throw new Error("Tests require an isolated database root.");
  const directory = mkdtempSync(join(process.env.HCB_TEST_DATABASE_ROOT, "migration-safety-"));
  directories.push(directory);
  return join(directory, "workspace.sqlite");
}
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

describe("workspace migration safety", () => {
  it("reopens a current workspace without changing its serialized database", () => {
    const path = pathForTest();
    let store = new CoreStore(path);
    store.dispatch("tasks", "create", { title: "Durable snapshot" });
    store.dispatch("notes", "create", { title: "Durable note", body: "Indexed cinnamon" });
    store.close();
    const readBytes = () => {
      const db = new Database(path, { readonly: true });
      try { return db.serialize(); } finally { db.close(); }
    };
    const before = readBytes();
    store = new CoreStore(path);
    expect(store.dispatch("search", "query", { query: "cinnamon" }).items).toHaveLength(1);
    store.close();
    expect(readBytes().equals(before)).toBe(true);
  });

  it.each([0, 1, 2, 999])("rejects schema %s and preserves existing records and version", (version) => {
    const path = pathForTest();
    const database = new Database(path);
    database.exec("CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY); CREATE TABLE precious_notes(body TEXT)");
    if (version) database.prepare("INSERT INTO schema_migrations VALUES(?)").run(version);
    database.prepare("INSERT INTO precious_notes VALUES(?)").run("Only copy of these notes");
    database.close();
    expect(() => new CoreStore(path)).toThrow(/incompatible.*not been reset/);
    const preserved = new Database(path, { readonly: true });
    try {
      expect(preserved.prepare("SELECT body FROM precious_notes").get()).toEqual({ body: "Only copy of these notes" });
      expect(preserved.prepare("SELECT version FROM schema_migrations").all()).toEqual(version ? [{ version }] : []);
      expect(preserved.prepare("SELECT name FROM sqlite_master WHERE name='settings'").get()).toBeUndefined();
    } finally { preserved.close(); }
  });

  it("rejects an unrecognized nonempty database without seeding a workspace over it", () => {
    const path = pathForTest();
    const database = new Database(path);
    database.exec("CREATE TABLE notes(body TEXT); INSERT INTO notes VALUES('unrecognized valuable data')");
    database.close();
    expect(() => new CoreStore(path)).toThrow(/incompatible/);
    const preserved = new Database(path, { readonly: true });
    try { expect(preserved.prepare("SELECT body FROM notes").get()).toEqual({ body: "unrecognized valuable data" }); }
    finally { preserved.close(); }
  });

  it("preserves local tasks, events, and undo when reopening alongside a Google account", () => {
    const path = pathForTest();
    let store = new CoreStore(path);
    const task = store.dispatch("tasks", "create", { title: "Local task", listId: "inbox" });
    const event = store.dispatch("calendar", "create", { title: "Local event", calendarId: "primary", startsAt: "2027-01-01T09:00:00Z", endsAt: "2027-01-01T10:00:00Z" });
    store.upsertGoogleAccount({ googleAccountId: "connected-elsewhere", connectionState: "connected" });
    const undo = store.dispatch("undo", "status");
    store.close();
    store = new CoreStore(path);
    try {
      expect(store.dispatch("tasks", "get", { id: task.id }).title).toBe("Local task");
      expect(store.dispatch("calendar", "get", { id: event.id }).title).toBe("Local event");
      expect(store.dispatch("undo", "status")).toEqual(undo);
    } finally { store.close(); }
  });

  it("fails startup on a missing FTS index instead of silently reseeding or degrading search", () => {
    const path = pathForTest();
    const store = new CoreStore(path);
    const task = store.dispatch("tasks", "create", { title: "Preserved cinnamon task" });
    store.close();
    const broken = new Database(path);
    broken.exec("DROP TABLE search_index");
    broken.close();
    expect(() => new CoreStore(path)).toThrow(/full-text search index|search_index/);
    const preserved = new Database(path, { readonly: true });
    try { expect(preserved.prepare("SELECT title FROM tasks WHERE id=?").get(task.id)).toEqual({ title: "Preserved cinnamon task" }); }
    finally { preserved.close(); }
  });
});
