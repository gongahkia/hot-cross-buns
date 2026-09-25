import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CoreStore } from "./coreStore";

const stores: Array<{ store: CoreStore; directory: string }> = [];

function createStore(): CoreStore {
  const directory = mkdtempSync(join(tmpdir(), "hcb-core-store-"));
  const store = new CoreStore(join(directory, "hcb.sqlite"));
  stores.push({ store, directory });
  return store;
}

afterEach(() => {
  for (const { store, directory } of stores.splice(0)) {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

// better-sqlite3 is compiled by Electron's postinstall hook. Node/Vitest has a
// different ABI in this repository, so these run in Electron smoke/CI where
// the ABI matches instead of failing every Node-only unit invocation.
describe.skipIf(process.versions.modules !== "130")("CoreStore", () => {
  it("isolates same Google resource ids across accounts", () => {
    const store = createStore();
    const first = store.upsertGoogleAccount({ id: "google-a", email: "a@example.test", connectionState: "connected" });
    const second = store.upsertGoogleAccount({ id: "google-b", email: "b@example.test", connectionState: "connected" });
    const firstList = store.upsertGoogleTaskList({ id: "shared-list", title: "Inbox" }, first.accountId);
    const secondList = store.upsertGoogleTaskList({ id: "shared-list", title: "Inbox" }, second.accountId);

    store.upsertGoogleTask({ id: "shared-task", title: "First", status: "needsAction", position: "0001" }, firstList.id);
    store.upsertGoogleTask({ id: "shared-task", title: "Second", status: "needsAction", position: "0001" }, secondList.id);

    const tasks = store.dispatch("tasks", "list", { status: "all", limit: 50 }).items;
    expect(tasks.filter((task: { title: string }) => task.title === "First")).toHaveLength(1);
    expect(tasks.filter((task: { title: string }) => task.title === "Second")).toHaveLength(1);
    expect(tasks.find((task: { title: string }) => task.title === "First").accountId).toBe(first.accountId);
    expect(tasks.find((task: { title: string }) => task.title === "Second").accountId).toBe(second.accountId);
  });

  it("persists task blocks, availability, and reversible writes", () => {
    const store = createStore();
    const task = store.dispatch("tasks", "create", { listId: "inbox", title: "Write release notes", durationMinutes: 30 });
    const block = store.dispatch("calendar", "scheduleTaskBlock", {
      taskId: task.id, calendarId: "primary", startsAt: "2026-10-02T09:00:00.000Z", durationMinutes: 30
    });
    const bootstrap = store.dispatch("bootstrap", "get", { calendarRange: { start: "2026-10-02T00:00:00.000Z", end: "2026-10-03T00:00:00.000Z" } });
    expect(bootstrap.scheduledTaskBlocks.items.map((item: { id: string }) => item.id)).toContain(block.id);

    const availability = store.dispatch("calendar", "exportAvailability", {
      calendarIds: ["primary"], start: "2026-10-02T08:00:00.000Z", end: "2026-10-02T11:00:00.000Z", format: "text"
    });
    expect(availability.busyBlockCount).toBe(1);
    expect(availability.text).toContain("Busy:");

    expect(store.dispatch("undo", "status", {}).canUndo).toBe(true);
    expect(store.dispatch("undo", "undo", {}).applied).toBe(true);
    expect(store.dispatch("undo", "redo", {}).applied).toBe(true);
  });

  it("returns a preview before smart scheduling applies task blocks", () => {
    const store = createStore();
    const task = store.dispatch("tasks", "create", { listId: "inbox", title: "Schedule me", durationMinutes: 45, priority: "high" });
    const preview = store.dispatch("calendar", "smartReschedule", {
      date: "2026-10-06", calendarId: "primary", apply: false, workingHours: { start: 9, end: 12 }
    });
    expect(preview.applied).toBe(false);
    expect(preview.suggestions.some((suggestion: { taskId: string }) => suggestion.taskId === task.id)).toBe(true);

    const applied = store.dispatch("calendar", "smartReschedule", {
      date: "2026-10-06", calendarId: "primary", apply: true, workingHours: { start: 9, end: 12 }
    });
    expect(applied.applied).toBe(true);
    expect(store.dispatch("calendar", "listScheduledTaskBlocks", { limit: 20 }).items.some((block: { taskId: string }) => block.taskId === task.id)).toBe(true);
  });

  it("queues a same-account Calendar move and rejects a cross-account move", () => {
    const store = createStore();
    const first = store.upsertGoogleAccount({ id: "google-a", email: "a@example.test", connectionState: "connected" });
    const second = store.upsertGoogleAccount({ id: "google-b", email: "b@example.test", connectionState: "connected" });
    const source = store.upsertGoogleCalendar({ id: "source", summary: "Source" }, first.accountId);
    const destination = store.upsertGoogleCalendar({ id: "destination", summary: "Destination" }, first.accountId);
    const foreign = store.upsertGoogleCalendar({ id: "foreign", summary: "Foreign" }, second.accountId);
    const event = store.dispatch("calendar", "create", {
      calendarId: source.id, title: "Move me", startsAt: "2026-10-06T09:00:00.000Z", endsAt: "2026-10-06T10:00:00.000Z", allDay: false
    });
    store.bindGoogleEvent(event.id, { id: "remote-event", etag: "etag" });

    const moved = store.dispatch("calendar", "update", { id: event.id, calendarId: destination.id });
    expect(moved.calendarId).toBe(destination.id);
    const mutation = store.pendingSyncMutations(20, first.accountId).at(-1);
    expect(mutation?.kind).toBe("event.move");
    expect(mutation?.payload).toMatchObject({ sourceCalendarId: source.id, destinationCalendarId: destination.id });
    expect(() => store.dispatch("calendar", "update", { id: event.id, calendarId: foreign.id }))
      .toThrow("Calendar events cannot be moved between Google accounts.");
  });
});
