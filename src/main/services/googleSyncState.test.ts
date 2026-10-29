import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CoreStore, schemaVersion } from "./coreStore";

const fixtures: Array<{ store: CoreStore; directory: string; path: string }> = [];
function fixture() {
  if (!process.env.HCB_TEST_DATABASE_ROOT) throw new Error("An isolated database root is required.");
  const directory = mkdtempSync(join(process.env.HCB_TEST_DATABASE_ROOT, "sync-state-"));
  const path = join(directory, "workspace.sqlite");
  const result = { store: new CoreStore(path), path, directory };
  fixtures.push(result);
  return result;
}
function connected(store: CoreStore, id = "account") {
  const accountId = store.upsertGoogleAccount({ googleAccountId: id, connectionState: "connected" }).accountId;
  const list = store.upsertGoogleTaskList({ id: "list", title: "Tasks", etag: "list-v1" }, accountId);
  const task = store.upsertGoogleTask({ id: "task", title: "Remote title", notes: "Remote notes", etag: "task-v1", position: "001" }, list.id)!;
  return { accountId, list, task };
}
afterEach(() => {
  for (const item of fixtures.splice(0)) {
    item.store.close();
    rmSync(item.directory, { recursive: true, force: true });
  }
});

describe("durable Google baselines and local intents", () => {
  it("persists the remote baseline and exact local field changes across restart", () => {
    const f = fixture();
    const { accountId, task } = connected(f.store);
    expect(f.store.googleSyncState(accountId, "task", task.id)?.dirtyFields).toEqual([]);
    f.store.dispatch("tasks", "update", { id: task.id, title: "Local title" });
    f.store.close();
    f.store = new CoreStore(f.path);
    expect(f.store.googleSyncState(accountId, "task", task.id)).toMatchObject({
      baseline: { remoteId: "task", collectionId: "list", etag: "task-v1", fields: { title: "Remote title" } }, dirtyFields: ["title"]
    });
    expect(f.store.pendingSyncMutations(10, accountId)[0].intent).toMatchObject({
      snapshot: { id: task.id, title: "Local title", notes: "Remote notes" }, changedFields: ["title"], barrier: false
    });
  });

  it("freezes each queued snapshot instead of reading newer content into an earlier command", () => {
    const { store } = fixture();
    const { accountId, task } = connected(store);
    store.dispatch("tasks", "update", { id: task.id, title: "First" });
    store.dispatch("tasks", "update", { id: task.id, notes: "Second" });
    const writes = store.pendingSyncMutations(10, accountId);
    expect(writes[0].intent).toMatchObject({ snapshot: { title: "First", notes: "Remote notes" }, changedFields: ["title"] });
    expect(writes[1].intent).toMatchObject({ snapshot: { title: "First", notes: "Second" }, changedFields: ["notes"] });
    expect(store.googleSyncState(accountId, "task", task.id)?.dirtyFields).toEqual(["notes", "title"]);
  });

  it("bases a late receipt on what was submitted while retaining newer dirty fields", () => {
    const { store } = fixture();
    const { accountId, task } = connected(store);
    store.dispatch("tasks", "update", { id: task.id, title: "Submitted" });
    const submitted = store.googleTaskForSync(task.id)!;
    store.dispatch("tasks", "update", { id: task.id, title: "Newer" });
    store.bindGoogleTask(task.id, { id: "task", etag: "task-v2", title: "Submitted" }, submitted);
    expect(store.googleSyncState(accountId, "task", task.id)).toMatchObject({
      baseline: { etag: "task-v2", fields: { title: "Submitted", notes: "Remote notes" } }, dirtyFields: ["title"]
    });
    expect(store.googleTaskForSync(task.id)?.title).toBe("Newer");
    expect(store.pendingSyncMutations(10, accountId)).toHaveLength(2);
  });

  it("tracks a return to the baseline as clean without discarding queued undo commands", () => {
    const { store } = fixture();
    const { accountId, task } = connected(store);
    store.dispatch("tasks", "update", { id: task.id, title: "Edited" });
    store.dispatch("undo", "undo");
    expect(store.googleSyncState(accountId, "task", task.id)?.dirtyFields).toEqual([]);
    expect(store.pendingSyncMutations(10, accountId)).toHaveLength(2);
  });

  it("isolates identical Google resource IDs belonging to different accounts", () => {
    const { store } = fixture();
    const a = connected(store, "first"), b = connected(store, "second");
    store.dispatch("tasks", "update", { id: a.task.id, title: "First account only" });
    expect(store.googleSyncState(a.accountId, "task", a.task.id)?.dirtyFields).toEqual(["title"]);
    expect(store.googleSyncState(b.accountId, "task", b.task.id)?.dirtyFields).toEqual([]);
    expect(store.googleSyncState(b.accountId, "task", a.task.id)).toBeNull();
  });

  it("records ordering, moves and deletions as barriers", () => {
    const { store } = fixture();
    const { accountId, list, task } = connected(store);
    const other = store.upsertGoogleTaskList({ id: "other", title: "Other" }, accountId);
    store.dispatch("tasks", "update", { id: task.id, previousTaskId: null });
    store.dispatch("tasks", "update", { id: task.id, listId: other.id });
    store.dispatch("tasks", "delete", { id: task.id });
    const writes = store.pendingSyncMutations(10, accountId);
    expect(writes.map((write) => write.intent?.barrier)).toEqual([true, true, true]);
    expect(writes[0].intent?.snapshot.listId).toBe(list.id);
    expect(writes[1].intent?.snapshot.listId).toBe(other.id);
    expect(store.googleSyncState(accountId, "task", task.id)?.dirtyFields).toContain("deletion");
  });

  it("retains local edits beyond Google's field limits for later recovery", () => {
    const { store } = fixture();
    const { accountId, task } = connected(store);
    store.dispatch("tasks", "update", { id: task.id, notes: "n".repeat(9000) });
    expect(store.pendingSyncMutations(10, accountId)[0].intent?.snapshot.notes).toHaveLength(9000);
  });

  it("tracks event receipts separately from newer edits and recurring commands", () => {
    const { store } = fixture();
    const { accountId } = connected(store);
    const calendar = store.upsertGoogleCalendar({ id: "primary", summary: "Calendar", accessRole: "owner" }, accountId);
    const event = store.upsertGoogleEvent({ id: "event", etag: "event-v1", summary: "Remote", start: { dateTime: "2026-10-29T01:00:00Z", timeZone: "UTC" }, end: { dateTime: "2026-10-29T02:00:00Z", timeZone: "UTC" } }, calendar.id)!;
    store.dispatch("calendar", "update", { id: event.id, title: "Submitted" });
    const submitted = store.googleEventForSync(event.id)!;
    store.dispatch("calendar", "update", { id: event.id, title: "Newer" });
    store.bindGoogleEvent(event.id, { id: "event", etag: "event-v2" }, submitted);
    expect(store.googleSyncState(accountId, "event", event.id)).toMatchObject({ baseline: { fields: { summary: "Submitted" } }, dirtyFields: ["summary"] });
    store.dispatch("calendar", "update", { id: event.id, recurrenceLines: ["RRULE:FREQ=DAILY;COUNT=2"] });
    expect(store.pendingSyncMutations(10, accountId).at(-1)?.intent?.barrier).toBe(true);
  });

  it("upgrades schema 9 without inventing baselines or changing legacy pending intents", () => {
    const f = fixture();
    const { accountId, task } = connected(f.store);
    f.store.dispatch("tasks", "update", { id: task.id, title: "Unsent legacy edit" });
    const queued = f.store.pendingSyncMutations(10, accountId)[0];
    f.store.close();
    const db = new Database(f.path);
    db.exec("DROP TABLE google_sync_state; ALTER TABLE outbox DROP COLUMN sync_intent_json; DELETE FROM schema_migrations WHERE version>9; INSERT OR IGNORE INTO schema_migrations VALUES(9)");
    db.close();
    f.store = new CoreStore(f.path);
    expect(f.store.dispatch("diagnostics", "summary").database.schemaVersion).toBe(schemaVersion);
    expect(f.store.googleSyncState(accountId, "task", task.id)).toBeNull();
    expect(f.store.pendingSyncMutations(10, accountId)[0]).toMatchObject({ id: queued.id, payload: queued.payload, intent: null });
    expect(f.store.googleTaskForSync(task.id)?.title).toBe("Unsent legacy edit");
    f.store.dispatch("undo", "undo");
    expect(f.store.googleTaskForSync(task.id)?.title).toBe("Remote title");
  });

  it("undoes and redoes only the edited task fields after a remote update", () => {
    const { store } = fixture();
    const { accountId, list, task } = connected(store);
    store.dispatch("tasks", "update", { id: task.id, title: "Local title" });
    for (const mutation of store.pendingSyncMutations(10, accountId)) store.completeSyncMutation(mutation.id);
    store.upsertGoogleTask({ id: "task", etag: "v2", title: "Local title", notes: "Phone notes", due: "2026-11-03" }, list.id);
    store.dispatch("undo", "undo");
    expect(store.googleTaskForSync(task.id)).toMatchObject({ title: "Remote title", notes: "Phone notes", dueAt: "2026-11-03" });
    store.dispatch("undo", "redo");
    expect(store.googleTaskForSync(task.id)).toMatchObject({ title: "Local title", notes: "Phone notes", dueAt: "2026-11-03" });
    expect(store.pendingSyncMutations(10, accountId).map((mutation) => mutation.intent?.changedFields)).toEqual([["title"], ["title"]]);
  });

  it("scopes legacy whole-record undo entries when executing them", () => {
    const f = fixture();
    const { accountId, list, task } = connected(f.store);
    f.store.dispatch("tasks", "update", { id: task.id, title: "Local title" });
    for (const mutation of f.store.pendingSyncMutations(10, accountId)) f.store.completeSyncMutation(mutation.id);
    const db = new Database(f.path);
    const operation = (title: string) => JSON.stringify({ namespace: "tasks", action: "update", payload: {
      id: task.id, title, notes: "Remote notes", dueDate: null, priority: "none", listId: list.id, parentId: null
    } });
    db.prepare("UPDATE undo_entries SET inverse_json=?,forward_json=?").run(operation("Remote title"), operation("Local title"));
    db.close();
    f.store.upsertGoogleTask({ id: "task", etag: "v2", title: "Local title", notes: "Phone notes" }, list.id);
    f.store.dispatch("undo", "undo");
    expect(f.store.googleTaskForSync(task.id)).toMatchObject({ title: "Remote title", notes: "Phone notes" });
    f.store.dispatch("undo", "redo");
    expect(f.store.googleTaskForSync(task.id)).toMatchObject({ title: "Local title", notes: "Phone notes" });
  });

  it("undoes a task reorder and preserves its explicit outgoing order commands", () => {
    const { store } = fixture();
    const { accountId, list, task: a } = connected(store);
    const b = store.upsertGoogleTask({ id: "b", title: "B", position: "002" }, list.id)!;
    const c = store.upsertGoogleTask({ id: "c", title: "C", position: "003" }, list.id)!;
    store.dispatch("tasks", "update", { id: c.id, previousTaskId: null });
    const order = () => [a, b, c].map((task) => store.googleTaskForSync(task.id)!).sort((x, y) => x.sortOrder.localeCompare(y.sortOrder)).map((task) => task.id);
    expect(order()).toEqual([c.id, a.id, b.id]);
    store.dispatch("undo", "undo");
    expect(order()).toEqual([a.id, b.id, c.id]);
    store.dispatch("undo", "redo");
    expect(order()).toEqual([c.id, a.id, b.id]);
    expect(store.pendingSyncMutations(10, accountId).map((mutation) => mutation.payload.previousTaskId)).toEqual([null, b.id, null]);
    expect(store.pendingSyncMutations(10, accountId).every((mutation) => mutation.intent?.barrier)).toBe(true);
  });

  it("preserves a remote event time change when undoing its local title edit", () => {
    const { store } = fixture();
    const { accountId } = connected(store);
    const calendar = store.upsertGoogleCalendar({ id: "primary", summary: "Calendar", accessRole: "owner" }, accountId);
    const remote = { id: "event", summary: "Remote", start: { dateTime: "2026-10-29T01:00:00Z", timeZone: "UTC" }, end: { dateTime: "2026-10-29T02:00:00Z", timeZone: "UTC" } };
    const event = store.upsertGoogleEvent(remote, calendar.id)!;
    store.dispatch("calendar", "update", { id: event.id, title: "Local" });
    for (const mutation of store.pendingSyncMutations(10, accountId)) store.completeSyncMutation(mutation.id);
    store.upsertGoogleEvent({ ...remote, summary: "Local", start: { ...remote.start, dateTime: "2026-10-30T01:00:00Z" }, end: { ...remote.end, dateTime: "2026-10-30T02:00:00Z" } }, calendar.id);
    store.dispatch("undo", "undo");
    expect(store.googleEventForSync(event.id)).toMatchObject({ title: "Remote", startsAt: "2026-10-30T01:00:00.000Z", endsAt: "2026-10-30T02:00:00.000Z" });
    store.dispatch("undo", "redo");
    expect(store.googleEventForSync(event.id)).toMatchObject({ title: "Local", startsAt: "2026-10-30T01:00:00.000Z" });
  });
});
