import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoreStore } from "./coreStore";
import { GoogleSyncService } from "./googleSync";
import Database from "better-sqlite3";

type RemoteTask = Record<string, any>;
const fixtures: Array<{ store: CoreStore; directory: string }> = [];

function createFixture() {
  const root = process.env.HCB_TEST_DATABASE_ROOT;
  if (!root) throw new Error("HCB_TEST_DATABASE_ROOT is required for sync integration tests.");
  const directory = mkdtempSync(join(root, "hcb-google-sync-"));
  const store = new CoreStore(join(directory, "hcb.sqlite"));
  fixtures.push({ store, directory });
  const accountId = store.upsertGoogleAccount({ googleAccountId: "account", displayName: "Test", connectionState: "connected" }).accountId;
  const remoteList = { id: "remote-list", title: "Inbox", etag: "list-v1" };
  const remoteLists = new Map([[remoteList.id, remoteList]]);
  const list = store.upsertGoogleTaskList(remoteList, accountId);
  store.dispatch("settings", "update", { syncCalendarEventsEnabled: false });
  const remoteTasks = new Map<string, RemoteTask>();
  let loseNextCreateResponse = false;
  let revision = 1;
  const googleFetch = vi.fn(async (_accountId: string, target: URL, init: RequestInit = {}): Promise<Response> => {
    const method = init.method ?? "GET";
    if (method === "GET") {
      if (target.pathname.endsWith("/lists")) return Response.json({ items: [...remoteLists.values()] });
      if (target.pathname.endsWith("/tasks")) return Response.json({ items: [...remoteTasks.values()] });
    }
    if (method === "PATCH" && target.pathname.endsWith(`/lists/${remoteList.id}`)) {
      const ifMatch = new Headers(init.headers).get("if-match");
      if (ifMatch && ifMatch !== remoteList.etag) return Response.json({}, { status: 412 });
      Object.assign(remoteList, JSON.parse(String(init.body)), { etag: `list-v${++revision}` });
      return Response.json(remoteList);
    }
    if (method === "POST" && target.pathname.endsWith("/tasks")) {
      const id = `remote-task-${++revision}`;
      const task = { ...JSON.parse(String(init.body)), id, etag: `v${revision}`, position: String(revision).padStart(8, "0") };
      remoteTasks.set(id, task);
      if (loseNextCreateResponse) {
        loseNextCreateResponse = false;
        throw new TypeError("Simulated lost response after the server accepted creation");
      }
      return Response.json(task);
    }
    if (method === "POST" && target.pathname.endsWith("/move")) {
      const task = remoteTasks.get(target.pathname.split("/").at(-2)!);
      if (!task) return Response.json({}, { status: 404 });
      const parent = target.searchParams.get("parent");
      const siblings = [...remoteTasks.values()].filter((item) => item.id !== task.id && (item.parent ?? null) === parent)
        .sort((a, b) => a.position.localeCompare(b.position));
      const previous = target.searchParams.get("previous");
      const previousIndex = previous ? siblings.findIndex((item) => item.id === previous) : -1;
      if (previous && previousIndex < 0) return Response.json({}, { status: 400 });
      if (parent) task.parent = parent;
      else delete task.parent;
      siblings.splice(previousIndex + 1, 0, task);
      siblings.forEach((item, index) => { item.position = String(index + 1).padStart(8, "0"); });
      task.etag = `v${++revision}`;
      return Response.json(task);
    }
    const taskId = target.pathname.split("/").at(-1)!;
    const task = remoteTasks.get(taskId);
    if (method === "PATCH" && task) {
      if (new Headers(init.headers).has("if-match") && new Headers(init.headers).get("if-match") !== task.etag) return Response.json({}, { status: 412 });
      // Model Google's PATCH merge: omitted fields survive, explicit null deletes.
      for (const [key, value] of Object.entries(JSON.parse(String(init.body)))) {
        if (value === null) delete task[key];
        else task[key] = value;
      }
      task.etag = `v${++revision}`;
      return Response.json(task);
    }
    throw new Error(`Unexpected Google request: ${method} ${target}`);
  });
  const service = new GoogleSyncService(store, { onConnectionChange: () => () => undefined, googleFetch } as never);
  const importTask = (remote: RemoteTask) => {
    const task: RemoteTask = { title: "Task", etag: `v${++revision}`, position: "00000001", ...remote };
    remoteTasks.set(task.id, task);
    return store.upsertGoogleTask(task, list.id)!;
  };
  return { store, service, accountId, list, remoteList, remoteLists, remoteTasks, googleFetch, importTask,
    loseCreateResponse: () => { loseNextCreateResponse = true; } };
}

function createCalendarFixture() {
  const fixture = createFixture();
  const { store, accountId, googleFetch } = fixture;
  const remoteCalendar = { id: "remote-calendar", summary: "Calendar" };
  const calendar = store.upsertGoogleCalendar(remoteCalendar, accountId);
  const remoteEvents = new Map<string, RemoteTask>();
  store.dispatch("settings", "update", { syncTasksEnabled: false, syncCalendarEventsEnabled: true });
  const taskTransport = googleFetch.getMockImplementation()!;
  googleFetch.mockImplementation(async (_accountId, target, init = {}) => {
    if (target.hostname === "tasks.googleapis.com") return taskTransport(_accountId, target, init);
    if ((init.method ?? "GET") === "GET") {
      if (target.pathname.endsWith("/calendarList")) return Response.json({ items: [remoteCalendar] });
      if (target.pathname.endsWith("/events")) return Response.json({ items: [...remoteEvents.values()], nextSyncToken: "next-token" });
    }
    throw new Error(`Unexpected Google request: ${init.method ?? "GET"} ${target}`);
  });
  const importEvent = (id: string) => {
    const event = {
      id, summary: id, etag: "v1",
      start: { dateTime: "2026-10-22T09:00:00Z" }, end: { dateTime: "2026-10-22T10:00:00Z" }
    };
    remoteEvents.set(id, event);
    return store.upsertGoogleEvent(event, calendar.id)!;
  };
  return { ...fixture, calendar, remoteCalendar, remoteEvents, importEvent };
}

afterEach(() => {
  vi.useRealTimers();
  for (const { store, directory } of fixtures.splice(0)) {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

describe.skipIf(process.versions.modules !== "130")("Google sync with durable SQLite state", () => {
  it("reconciles cancelled recurring instances after token expiry and a later complete snapshot", async () => {
    const { store, service, accountId, calendar, remoteEvents, googleFetch } = createCalendarFixture();
    const master = { id: "series", summary: "Daily", start: { dateTime: "2026-10-22T09:00:00Z" },
      end: { dateTime: "2026-10-22T10:00:00Z" }, recurrence: ["RRULE:FREQ=DAILY;COUNT=3"] };
    remoteEvents.set("series", master);
    remoteEvents.set("cancelled", { id: "cancelled", status: "cancelled", recurringEventId: "series", originalStartTime: { dateTime: "2026-10-23T09:00:00Z" } });
    store.upsertGoogleEvent(master, calendar.id);
    store.setGoogleSyncToken(accountId, "events:remote-calendar", "expired");
    const transport = googleFetch.getMockImplementation()!;
    googleFetch.mockImplementation(async (account, target, init) => target.searchParams.get("syncToken") === "expired"
      ? new Response(null, { status: 410 }) : transport(account, target, init));
    const events = () => store.dispatch("calendar", "listEvents", { start: "2026-10-22T00:00:00Z", end: "2026-10-25T00:00:00Z" }).items;
    await service.runNow({ readOnly: true });
    expect(events()).toHaveLength(2);
    remoteEvents.delete("cancelled");
    await service.forceFullResync({ accountId });
    expect(events()).toHaveLength(3);
  });

  it("removes remotely deleted task lists and their cache while preserving Calendar events and notes", async () => {
    const { store, service, accountId, list, remoteLists, importTask } = createFixture();
    const task = importTask({ id: "removed-task" });
    const block = store.dispatch("calendar", "scheduleTaskBlock", {
      taskId: task.id, calendarId: "primary", startsAt: "2026-10-22T09:00:00Z", durationMinutes: 30
    });
    const note = store.dispatch("notes", "create", { title: "Local note", body: "Keep this content" });
    const otherAccount = store.upsertGoogleAccount({ googleAccountId: "other-account", connectionState: "disconnected" });
    const otherList = store.upsertGoogleTaskList({ id: list.googleId, title: "Same id, other account" }, otherAccount.accountId);
    for (const mutation of store.pendingSyncMutations(500)) store.completeSyncMutation(mutation.id);
    store.dispatch("settings", "update", {
      selectedTaskListIds: [list.id, otherList.id], starredTaskIds: [task.id],
      perTabListFilters: { tasks: { useCustomFilter: true, selectedTaskListIds: [list.id, otherList.id] } }
    });
    store.setGoogleSyncToken(accountId, `tasks-updated:${list.googleId}`, "2026-10-21T09:00:00Z");
    remoteLists.clear();

    await service.runNow({ readOnly: true });

    expect(store.googleTaskListForSync(list.id)).toBeNull();
    expect(store.googleTaskForSync(task.id)).toBeNull();
    expect(store.googleTaskListForSync(otherList.id)).not.toBeNull();
    expect(store.dispatch("calendar", "listScheduledTaskBlocks", {}).items).toEqual([]);
    expect(store.googleEventForSync(block.calendarEventId)).not.toBeNull();
    expect(store.dispatch("notes", "get", { id: note.id }).body).toBe("Keep this content");
    expect(store.googleSyncToken(accountId, `tasks-updated:${list.googleId}`)).toBeNull();
    expect(store.dispatch("settings", "get", {})).toMatchObject({
      selectedTaskListIds: [otherList.id], starredTaskIds: [],
      perTabListFilters: { tasks: { selectedTaskListIds: [otherList.id] } }
    });
    expect(store.unresolvedSyncMutationCount(accountId)).toBe(0);
  });

  it.each(["create", "edit", "rename"])("preserves and flags unsent %s writes to a removed Google list", async (operation) => {
    const { store, service, accountId, list, remoteLists, importTask, googleFetch } = createFixture();
    if (operation === "create") store.dispatch("tasks", "create", { listId: list.id, title: "Unsent task" });
    if (operation === "edit") {
      const task = importTask({ id: "edited-task" });
      store.dispatch("tasks", "update", { id: task.id, title: "Unsent edit" });
    }
    if (operation === "rename") store.dispatch("tasks", "renameTaskList", { id: list.id, title: "Unsent rename" });
    remoteLists.clear();

    expect((await service.runNow()).state).toBe("error");
    expect((await service.runNow()).state).toBe("error");

    expect(store.googleTaskListForSync(list.id)).not.toBeNull();
    expect(store.unresolvedSyncMutationCount(accountId)).toBe(1);
    expect(store.pendingSyncMutations(100, accountId)).toEqual([]);
    const mutation = store.dispatch("diagnostics", "pendingMutations", {}).mutations[0];
    expect(mutation).toMatchObject({ status: "failed", lastErrorMessage: expect.stringContaining("list was removed") });
    expect(googleFetch.mock.calls.every(([, , init]) => !init?.method || init.method === "GET")).toBe(true);
    store.dispatch("diagnostics", "cancelPendingMutation", { id: mutation.id });
    await service.runNow({ readOnly: true });
    expect(store.googleTaskListForSync(list.id)).toBeNull();
  });

  it("does not prune task lists when a later list page fails", async () => {
    const { store, service, list, googleFetch } = createFixture();
    googleFetch.mockImplementation(async (_account, target) => target.searchParams.has("pageToken")
      ? new Response(null, { status: 503 })
      : Response.json({ items: [], nextPageToken: "failing-page" }));
    await expect(service.runNow({ readOnly: true })).rejects.toThrow();
    expect(store.googleTaskListForSync(list.id)).not.toBeNull();
  });

  it("retains local task lists not yet created on Google", async () => {
    const { store, service, accountId, remoteLists } = createFixture();
    const local = store.dispatch("tasks", "createTaskList", { accountId, title: "Unsent list" });
    remoteLists.clear();
    await service.runNow({ readOnly: true });
    expect(store.googleTaskListForSync(local.id)?.title).toBe("Unsent list");
    expect(store.pendingSyncMutations(100, accountId)).toEqual([expect.objectContaining({ kind: "taskList.create" })]);
  });

  it("preserves a moved task's local identity when its former Google list disappears", async () => {
    const { store, service, accountId, list, importTask, remoteLists } = createFixture();
    const task = importTask({ id: "moved-task" });
    const destinationRemote = { id: "destination", title: "Destination", etag: "v1" };
    const destination = store.upsertGoogleTaskList(destinationRemote, accountId);
    remoteLists.clear();
    remoteLists.set(destinationRemote.id, destinationRemote);
    await service.runNow({ readOnly: true });
    expect(store.googleTaskListForSync(list.id)).toBeNull();
    expect(store.googleTaskForSync(task.id)).toMatchObject({ listId: destination.id, googleId: "moved-task" });
  });

  it("marks tasks absent from an explicit full snapshot deleted without affecting other lists", async () => {
    const { store, service, accountId, list, importTask, remoteTasks } = createFixture();
    const missing = importTask({ id: "missing" });
    const local = store.dispatch("tasks", "create", { title: "Device-local task", listId: "inbox" });
    remoteTasks.clear();
    store.setGoogleSyncToken(accountId, `tasks-updated:${list.googleId}`, "2026-10-21T09:00:00Z");

    await service.forceFullResync({ accountId });

    expect(store.dispatch("tasks", "get", { id: missing.id }).status).toBe("deleted");
    expect(store.dispatch("tasks", "list", { listId: list.id, status: "all" }).items).toEqual([]);
    expect(store.dispatch("tasks", "get", { id: local.id }).status).toBe("active");
  });

  it("preserves pending, conflicted, and unbound tasks absent from a full snapshot", async () => {
    const { store, service, list, importTask, remoteTasks } = createFixture();
    const pending = importTask({ id: "pending" });
    const conflicted = importTask({ id: "conflicted" });
    remoteTasks.clear();
    store.dispatch("tasks", "update", { id: pending.id, title: "Pending edit" });
    store.dispatch("tasks", "update", { id: conflicted.id, title: "Conflicting edit" });
    const conflict = store.pendingSyncMutations(500).find((mutation) => mutation.entityId === conflicted.id)!;
    store.deferSyncMutation(conflict.id, "Changed elsewhere", false);
    const created = store.dispatch("tasks", "create", { listId: list.id, title: "Unsent task" });

    await service.runNow({ readOnly: true });

    for (const task of [pending, conflicted, created]) {
      expect(store.dispatch("tasks", "get", { id: task.id }).status).toBe("active");
    }
    expect(store.googleTaskForSync(pending.id)?.title).toBe("Pending edit");
    expect(store.googleTaskForSync(conflicted.id)?.title).toBe("Conflicting edit");
  });

  it("does not reconcile a failed Tasks snapshot or advance its checkpoint", async () => {
    const { store, service, accountId, list, importTask, remoteTasks, googleFetch } = createFixture();
    const missing = importTask({ id: "missing" });
    remoteTasks.clear();
    const transport = googleFetch.getMockImplementation()!;
    googleFetch.mockImplementation(async (account, target, init) => {
      if (!target.pathname.endsWith("/tasks")) return transport(account, target, init);
      return target.searchParams.has("pageToken")
        ? new Response(null, { status: 503 })
        : Response.json({ items: [], nextPageToken: "failing-page" }, { headers: { date: "Wed, 21 Oct 2026 10:00:00 GMT" } });
    });
    await expect(service.runNow({ readOnly: true })).rejects.toThrow();
    expect(store.dispatch("tasks", "get", { id: missing.id }).status).toBe("active");
    expect(store.googleSyncToken(accountId, `tasks-updated:${list.googleId}`)).toBeNull();

    googleFetch.mockImplementation(transport);
    await service.runNow({ readOnly: true });
    expect(store.dispatch("tasks", "get", { id: missing.id }).status).toBe("deleted");
  });

  it("retains unchanged tasks absent from an incremental delta", async () => {
    const { store, service, accountId, list, importTask, remoteTasks, googleFetch } = createFixture();
    const unchanged = importTask({ id: "unchanged" });
    remoteTasks.clear();
    store.setGoogleSyncToken(accountId, `tasks-updated:${list.googleId}`, "2026-10-21T09:00:00Z");
    await service.runNow({ readOnly: true });
    expect(store.dispatch("tasks", "get", { id: unchanged.id }).status).toBe("active");
    expect(googleFetch.mock.calls.find(([, target]) => target.pathname.endsWith("/tasks"))?.[1].searchParams.get("updatedMin"))
      .toBe("2026-10-21T08:59:59.000Z");
  });

  it("reconciles an expired Calendar token against every page of the replacement snapshot", async () => {
    const { store, service, accountId, calendar, remoteEvents, googleFetch, importEvent } = createCalendarFixture();
    const retained = importEvent("retained");
    const task = store.dispatch("tasks", "create", { listId: "inbox", title: "Keep my task" });
    const block = store.dispatch("calendar", "scheduleTaskBlock", {
      taskId: task.id, calendarId: calendar.id, startsAt: "2026-10-22T11:00:00Z", durationMinutes: 30
    });
    store.bindGoogleEvent(block.calendarEventId, { id: "deleted-remotely", etag: "v1" });
    for (const mutation of store.pendingSyncMutations(500)) store.completeSyncMutation(mutation.id);
    store.setGoogleSyncToken(accountId, "events:remote-calendar", "expired-token");
    const transport = googleFetch.getMockImplementation()!;
    googleFetch.mockImplementation(async (account, target, init) => {
      if (!target.pathname.endsWith("/events")) return transport(account, target, init);
      if (target.searchParams.has("syncToken")) return new Response(null, { status: 410 });
      if (!target.searchParams.has("pageToken")) return Response.json({ items: [], nextPageToken: "second-page" });
      return Response.json({ items: [...remoteEvents.values()], nextSyncToken: "replacement-token" });
    });

    await service.runNow({ readOnly: true });

    expect(store.googleEventForSync(retained.id)?.googleId).toBe("retained");
    expect(store.googleEventForSync(block.calendarEventId)).toBeNull();
    expect(store.dispatch("calendar", "listScheduledTaskBlocks", {}).items).toEqual([]);
    expect(store.dispatch("tasks", "get", { id: task.id })).toMatchObject({ plannedStart: null, plannedEnd: null });
    expect(store.googleSyncToken(accountId, "events:remote-calendar")).toBe("replacement-token");
    expect(googleFetch.mock.calls.filter(([, target]) => target.pathname.endsWith("/events")).map(([, target]) =>
      [target.searchParams.get("syncToken"), target.searchParams.get("pageToken")]
    )).toEqual([["expired-token", null], [null, null], [null, "second-page"]]);
    expect(store.unresolvedSyncMutationCount(accountId)).toBe(0);
  });

  it.each(["create", "edit", "delete"])("preserves unsent event %s writes when a Calendar disappears", async (operation) => {
    const { store, service, accountId, calendar, importEvent, googleFetch } = createCalendarFixture();
    const event = operation === "create"
      ? store.dispatch("calendar", "create", {
        calendarId: calendar.id, title: "Unsent event", startsAt: "2026-10-22T09:00:00Z", endsAt: "2026-10-22T10:00:00Z"
      })
      : importEvent("unsent-event");
    if (operation === "edit") store.dispatch("calendar", "update", { id: event.id, title: "Unsent edit" });
    if (operation === "delete") store.dispatch("calendar", "delete", { id: event.id });
    googleFetch.mockImplementation(async () => Response.json({ items: [] }));

    expect((await service.runNow()).state).toBe("error");
    expect(store.googleCalendarForSync(calendar.id)).not.toBeNull();
    if (operation !== "delete") expect(store.googleEventForSync(event.id)).not.toBeNull();
    expect(store.unresolvedSyncMutationCount(accountId)).toBe(1);
    expect(store.pendingSyncMutations(100, accountId)).toEqual([]);
    const mutation = store.dispatch("diagnostics", "pendingMutations", {}).mutations[0];
    expect(mutation).toMatchObject({ status: "failed", lastErrorMessage: expect.stringContaining("Calendar was removed") });
    expect(googleFetch.mock.calls.every(([, , init]) => !init?.method || init.method === "GET")).toBe(true);
    store.dispatch("diagnostics", "cancelPendingMutation", { id: mutation.id });
    await service.runNow({ readOnly: true });
    expect(store.googleCalendarForSync(calendar.id)).toBeNull();
  });

  it("recognizes a removed Calendar as the source of a pending event move", async () => {
    const { store, service, accountId, calendar, importEvent, googleFetch } = createCalendarFixture();
    const event = importEvent("moving-event");
    const destinationRemote = { id: "destination", summary: "Destination" };
    const destination = store.upsertGoogleCalendar(destinationRemote, accountId);
    store.dispatch("calendar", "update", { id: event.id, calendarId: destination.id });
    googleFetch.mockImplementation(async (_account, target) => Response.json(target.pathname.endsWith("/calendarList")
      ? { items: [destinationRemote] } : { items: [], nextSyncToken: "next-token" }));
    expect((await service.runNow()).state).toBe("error");
    expect(store.googleCalendarForSync(calendar.id)).not.toBeNull();
    expect(store.googleEventForSync(event.id)?.calendarId).toBe(destination.id);
    expect(store.pendingSyncMutations(100, accountId)).toEqual([]);
    expect(store.unresolvedSyncMutationCount(accountId)).toBe(1);
  });

  it("removes absent events on an explicit full resync while retaining other calendars", async () => {
    const { store, service, accountId, remoteEvents, importEvent } = createCalendarFixture();
    const missing = importEvent("missing");
    const other = store.dispatch("calendar", "create", {
      calendarId: "primary", title: "Local event", startsAt: "2026-10-22T09:00:00Z", endsAt: "2026-10-22T10:00:00Z"
    });
    store.bindGoogleEvent(other.id, { id: "other-calendar-event" });
    remoteEvents.clear();
    store.setGoogleSyncToken(accountId, "events:remote-calendar", "old-token");

    await service.forceFullResync({ accountId });

    expect(store.googleEventForSync(missing.id)).toBeNull();
    expect(store.googleEventForSync(other.id)?.googleId).toBe("other-calendar-event");
  });

  it("retains absent Calendar events with unsent edits or creations during a full pull", async () => {
    const { store, service, calendar, remoteEvents, importEvent, googleFetch } = createCalendarFixture();
    const pending = importEvent("pending");
    const conflicted = importEvent("conflicted");
    remoteEvents.clear();
    store.dispatch("calendar", "update", { id: pending.id, title: "Unsent edit" });
    store.dispatch("calendar", "update", { id: conflicted.id, title: "Conflicting edit" });
    const conflict = store.pendingSyncMutations(500).find((mutation) => mutation.entityId === conflicted.id)!;
    store.deferSyncMutation(conflict.id, "Changed elsewhere", false);
    const created = store.dispatch("calendar", "create", {
      calendarId: calendar.id, title: "Unsent creation", startsAt: "2026-10-22T09:00:00Z", endsAt: "2026-10-22T10:00:00Z"
    });

    await service.runNow({ readOnly: true });

    expect(store.googleEventForSync(pending.id)?.title).toBe("Unsent edit");
    expect(store.googleEventForSync(conflicted.id)?.title).toBe("Conflicting edit");
    expect(store.googleEventForSync(created.id)?.title).toBe("Unsent creation");
    expect(googleFetch.mock.calls.every(([, , init]) => !init?.method || init.method === "GET")).toBe(true);
  });

  it("does not prune a Calendar snapshot or advance its token when a later page fails", async () => {
    const { store, service, accountId, importEvent, remoteEvents, googleFetch } = createCalendarFixture();
    const missing = importEvent("missing");
    remoteEvents.clear();
    const transport = googleFetch.getMockImplementation()!;
    googleFetch.mockImplementation(async (account, target, init) => {
      if (!target.pathname.endsWith("/events")) return transport(account, target, init);
      return target.searchParams.has("pageToken")
        ? new Response(null, { status: 503 })
        : Response.json({ items: [], nextPageToken: "failing-page" });
    });

    await expect(service.runNow({ readOnly: true })).rejects.toThrow();
    expect(store.googleEventForSync(missing.id)).not.toBeNull();
    expect(store.googleSyncToken(accountId, "events:remote-calendar")).toBeNull();
    googleFetch.mockImplementation(transport);
    await service.runNow({ readOnly: true });
    expect(store.googleEventForSync(missing.id)).toBeNull();
    expect(store.googleSyncToken(accountId, "events:remote-calendar")).toBe("next-token");
  });

  it("retains unchanged events absent from an incremental delta", async () => {
    const { store, service, accountId, importEvent, remoteEvents } = createCalendarFixture();
    const unchanged = importEvent("unchanged");
    remoteEvents.clear();
    store.setGoogleSyncToken(accountId, "events:remote-calendar", "valid-token");
    await service.runNow({ readOnly: true });
    expect(store.googleEventForSync(unchanged.id)).not.toBeNull();
    expect(store.googleSyncToken(accountId, "events:remote-calendar")).toBe("next-token");
  });

  it("does not reconcile an incomplete Calendar response without its final sync token", async () => {
    const { store, service, importEvent, googleFetch } = createCalendarFixture();
    const cached = importEvent("cached");
    const transport = googleFetch.getMockImplementation()!;
    googleFetch.mockImplementation(async (account, target, init) => target.pathname.endsWith("/events")
      ? Response.json({ items: [] }) : transport(account, target, init));
    await expect(service.runNow({ readOnly: true })).rejects.toThrow("sync token");
    expect(store.googleEventForSync(cached.id)).not.toBeNull();
  });

  it("does not replay a create from a snapshot taken while Google's response is in flight", async () => {
    const fixture = createFixture();
    const { store, service, list, accountId, googleFetch, remoteTasks } = fixture;
    store.dispatch("tasks", "create", { listId: list.id, title: "Interrupted create" });
    const transport = googleFetch.getMockImplementation()!;
    let finishResponse!: () => void;
    googleFetch.mockImplementation(async (account, target, init) => {
      const response = await transport(account, target, init);
      if (init?.method === "POST" && target.pathname.endsWith("/tasks")) {
        await new Promise<void>((resolve) => { finishResponse = resolve; });
      }
      return response;
    });
    const syncing = service.runNow();
    try {
      await vi.waitFor(() => expect(finishResponse).toBeTypeOf("function"));
      const directory = mkdtempSync(join(process.env.HCB_TEST_DATABASE_ROOT!, "hcb-interrupted-create-"));
      const path = join(directory, "hcb.sqlite");
      await store.backupTo(path);
      const restarted = new CoreStore(path);
      fixtures.push({ store: restarted, directory });
      expect(restarted.pendingSyncMutations(100, accountId)).toEqual([]);
      const restartedService = new GoogleSyncService(restarted, { onConnectionChange: () => () => undefined, googleFetch } as never);
      expect((await restartedService.runNow()).state).toBe("error");
      expect(remoteTasks.size).toBe(1);
      expect(googleFetch.mock.calls.filter(([, , init]) => init?.method === "POST")).toHaveLength(1);
    } finally {
      finishResponse?.();
      await syncing;
    }
  });

  it.each([6, 8])("upgrades a version %s database without changing notes, Google bindings, or queued writes", (version) => {
    const { store, accountId, list } = createFixture();
    const note = store.dispatch("notes", "create", { title: "Preserve me", body: "Local-only content" });
    const task = store.dispatch("tasks", "create", { listId: list.id, title: "Queued during upgrade" });
    store.setGoogleSyncToken(accountId, "events:calendar", "old-calendar-token");
    store.setGoogleSyncToken(accountId, "tasks-updated:remote-list", "2026-10-21T10:00:00Z");
    const fixture = fixtures.at(-1)!;
    const path = join(fixture.directory, "hcb.sqlite");
    store.close();
    const legacy = new Database(path);
    legacy.exec("DROP TABLE google_event_cancellations; DROP INDEX events_google_recurring_calendar_idx; DELETE FROM schema_migrations");
    if (version === 6) legacy.exec("ALTER TABLE outbox DROP COLUMN creation_started; DROP INDEX outbox_unresolved_account_idx");
    legacy.prepare("INSERT INTO schema_migrations(version) VALUES(?)").run(version);
    legacy.close();
    const upgraded = new CoreStore(path);
    fixture.store = upgraded;
    expect(upgraded.dispatch("notes", "get", { id: note.id }).body).toBe("Local-only content");
    expect(upgraded.googleTaskListForSync(list.id)?.googleId).toBe("remote-list");
    expect(upgraded.pendingSyncMutations(100, accountId)).toEqual([expect.objectContaining({ entityId: task.id, kind: "task.create" })]);
    expect(upgraded.didResetDeveloperData).toBe(false);
    expect(upgraded.dispatch("diagnostics", "summary", {}).database.schemaVersion).toBe(9);
    expect(upgraded.googleSyncToken(accountId, "events:calendar")).toBeNull();
    expect(upgraded.googleSyncToken(accountId, "tasks-updated:remote-list")).toBe("2026-10-21T10:00:00Z");
    upgraded.setGoogleSyncToken(accountId, "events:calendar", "rebuilt-calendar-token");
    upgraded.close();
    const restarted = new CoreStore(path);
    fixture.store = restarted;
    expect(restarted.googleSyncToken(accountId, "events:calendar")).toBe("rebuilt-calendar-token");
  });

  it("never re-creates an ambiguous task through a later edit or after restarting", async () => {
    const fixture = createFixture();
    const { store, service, accountId, list, googleFetch, remoteTasks } = fixture;
    const task = store.dispatch("tasks", "create", { listId: list.id, title: "Create once" });
    store.dispatch("tasks", "update", { id: task.id, notes: "Queued after creation" });
    fixture.loseCreateResponse();
    expect((await service.runNow()).state).toBe("error");
    expect((await service.runNow()).state).toBe("error");
    expect(remoteTasks.size).toBe(1);
    expect(googleFetch.mock.calls.filter(([, , init]) => init?.method === "POST")).toHaveLength(1);
    expect(store.unresolvedSyncMutationCount(accountId)).toBe(2);
    expect(store.pendingSyncMutations(100, accountId)).toEqual([]);
    expect(store.dispatch("diagnostics", "pendingMutations", {}).mutations.find((entry: RemoteTask) => entry.status === "failed")?.lastErrorMessage).toContain("Check Google before retrying");

    const path = join(fixtures.at(-1)!.directory, "hcb.sqlite");
    store.close();
    const reopened = new CoreStore(path);
    fixtures.at(-1)!.store = reopened;
    expect(reopened.pendingSyncMutations(100, accountId)).toEqual([]);
  });

  it.each(["server failure", "unreadable response"])("does not repeat an accepted create after a %s", async (failure) => {
    const { store, service, list, googleFetch, remoteTasks } = createFixture();
    store.dispatch("tasks", "create", { listId: list.id, title: "Accepted despite the failure" });
    const transport = googleFetch.getMockImplementation()!;
    googleFetch.mockImplementation(async (account, target, init) => {
      const response = await transport(account, target, init);
      return init?.method === "POST" && target.pathname.endsWith("/tasks")
        ? failure === "server failure" ? new Response(null, { status: 503 }) : new Response("unreadable", { status: 200 })
        : response;
    });
    expect((await service.runNow()).state).toBe("error");
    expect((await service.runNow()).state).toBe("error");
    expect(remoteTasks.size).toBe(1);
    expect(googleFetch.mock.calls.filter(([, , init]) => init?.method === "POST")).toHaveLength(1);
  });

  it("retries a creation rejected by a rate limit only after backoff", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { store, service, list, accountId, googleFetch, remoteTasks } = createFixture();
    store.dispatch("tasks", "create", { listId: list.id, title: "Rate-limited creation" });
    const transport = googleFetch.getMockImplementation()!;
    let rateLimited = true;
    googleFetch.mockImplementation(async (account, target, init) => {
      if (rateLimited && init?.method === "POST" && target.pathname.endsWith("/tasks")) {
        rateLimited = false;
        return new Response(null, { status: 429 });
      }
      return transport(account, target, init);
    });
    await service.runNow();
    await service.runNow();
    expect(remoteTasks.size).toBe(0);
    expect(store.pendingSyncMutations(100, accountId)).toEqual([]);
    vi.setSystemTime(Date.now() + 60_000);
    await service.runNow();
    expect(remoteTasks.size).toBe(1);
    expect(store.unresolvedSyncMutationCount(accountId)).toBe(0);
  });

  it("keeps insertion order, blocks deferred writes, and lets other accounts sync", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-21T10:00:00Z"));
    const { store, accountId, list } = createFixture();
    const task = store.dispatch("tasks", "create", { listId: list.id, title: "First" });
    store.dispatch("tasks", "update", { id: task.id, title: "Second" });
    const queued = store.pendingSyncMutations(100, accountId);
    expect(queued.map((entry) => entry.kind)).toEqual(["task.create", "task.update"]);
    const otherAccount = store.upsertGoogleAccount({ googleAccountId: "other", displayName: "Other", connectionState: "connected" }).accountId;
    const otherList = store.upsertGoogleTaskList({ id: "other-list", title: "Other" }, otherAccount);
    store.dispatch("tasks", "create", { listId: otherList.id, title: "Independent" });

    store.deferSyncMutation(queued[0].id, "Temporary failure", true);
    expect(store.pendingSyncMutations(100, accountId)).toEqual([]);
    expect(store.pendingSyncMutations(100).map((entry) => entry.accountId)).toEqual([otherAccount]);
    vi.setSystemTime(Date.now() + 60_000);
    expect(store.pendingSyncMutations(100, accountId).map((entry) => entry.id)).toEqual(queued.map((entry) => entry.id));
    store.deferSyncMutation(queued[0].id, "Ambiguous create", false);
    expect(store.pendingSyncMutations(100, accountId)).toEqual([]);
    store.dispatch("diagnostics", "retryPendingMutation", { id: queued[0].id });
    expect(store.pendingSyncMutations(100, accountId).map((entry) => entry.id)).toEqual(queued.map((entry) => entry.id));
  });

  it("delivers a queued list rename without losing it to the initial pull", async () => {
    const { store, service, list, remoteList, accountId } = createFixture();
    store.dispatch("tasks", "renameTaskList", { id: list.id, title: "Renamed offline" });
    await service.runNow();
    expect(remoteList.title).toBe("Renamed offline");
    expect(store.googleTaskListForSync(list.id)?.title).toBe("Renamed offline");
    expect(store.unresolvedSyncMutationCount(accountId)).toBe(0);
  });

  it("preserves a list rename as a conflict and overwrites only after explicit retry", async () => {
    const { store, service, list, remoteList, accountId } = createFixture();
    store.dispatch("tasks", "renameTaskList", { id: list.id, title: "Local rename" });
    remoteList.title = "Changed elsewhere";
    remoteList.etag = "external-revision";
    expect((await service.runNow()).state).toBe("error");
    expect(remoteList.title).toBe("Changed elsewhere");
    expect(store.googleTaskListForSync(list.id)).toMatchObject({ title: "Local rename", googleEtag: "list-v1" });
    const failed = store.dispatch("diagnostics", "pendingMutations", {}).mutations[0];
    store.dispatch("diagnostics", "retryPendingMutation", { id: failed.id });
    await service.runNow();
    expect(remoteList.title).toBe("Local rename");
    expect(store.unresolvedSyncMutationCount(accountId)).toBe(0);
  });

  it("clears a synced task's notes and date through PATCH and retains the clear on later pulls", async () => {
    const { store, service, remoteTasks, importTask, googleFetch } = createFixture();
    const task = importTask({ id: "dated-task", notes: "Remove these notes", due: "2026-10-22T00:00:00.000Z" });
    store.dispatch("tasks", "update", { id: task.id, notes: "", dueDate: null });
    await service.runNow();
    await service.runNow();
    expect(remoteTasks.get("dated-task")).not.toHaveProperty("due");
    expect(remoteTasks.get("dated-task")?.notes).toBe("");
    expect(store.dispatch("tasks", "get", { id: task.id })).toMatchObject({ notes: "", dueAt: null });
    const patch = googleFetch.mock.calls.find(([, , init]) => init?.method === "PATCH");
    expect(JSON.parse(String(patch?.[2]?.body))).toMatchObject({ notes: "", due: null });
  });

  it("clears user notes while preserving HCB metadata and retains an existing date", async () => {
    const { store, service, remoteTasks, importTask } = createFixture();
    const task = importTask({ id: "priority-task", notes: "Remove only the prose", due: "2026-10-22T00:00:00.000Z" });
    store.dispatch("tasks", "update", { id: task.id, notes: "", priority: "high" });
    await service.runNow();
    expect(store.dispatch("tasks", "get", { id: task.id })).toMatchObject({ notes: "", priority: "high", dueAt: "2026-10-22T00:00:00.000Z" });
    expect(remoteTasks.get("priority-task")?.notes).not.toContain("Remove only the prose");
    expect(remoteTasks.get("priority-task")?.notes).toContain("[HCB task metadata v1:");
  });

  it.each([false, true])("syncs sibling order in both directions (subtasks=%s)", async (subtasks) => {
    const { store, service, importTask, list, googleFetch } = createFixture();
    const parent = subtasks ? importTask({ id: "parent", title: "Parent" }) : null;
    const tasks = ["A", "B", "C"].map((title, index) => importTask({
      id: title, title, position: String(index + 1).padStart(8, "0"), ...(parent ? { parent: "parent" } : {})
    }));
    const order = () => store.dispatch("tasks", "list", { listId: list.id, parentId: parent?.id ?? null, status: "all" }).items.map((task: RemoteTask) => task.title);
    store.dispatch("tasks", "move", { id: tasks[2].id, listId: list.id, previousTaskId: null });
    expect(order()).toEqual(["C", "A", "B"]);
    await service.runNow();
    expect(order()).toEqual(["C", "A", "B"]);
    const firstMove = googleFetch.mock.calls.find(([, target]) => target.pathname.endsWith("/move"));
    expect(firstMove?.[1].searchParams.has("previous")).toBe(false);
    expect(firstMove?.[1].searchParams.get("parent")).toBe(subtasks ? "parent" : null);
    store.dispatch("tasks", "move", { id: tasks[2].id, listId: list.id, previousTaskId: tasks[1].id });
    await service.runNow();
    expect(order()).toEqual(["A", "B", "C"]);
    const moves = googleFetch.mock.calls.filter(([, target]) => target.pathname.endsWith("/move"));
    expect(moves).toHaveLength(2);
    expect(moves[1][1].searchParams.get("previous")).toBe("B");
  });

  it("does not reposition a task when only its title changes", async () => {
    const { store, service, importTask, googleFetch } = createFixture();
    const task = importTask({ id: "ordinary-edit", title: "Before" });
    store.dispatch("tasks", "update", { id: task.id, title: "After" });
    await service.runNow();
    expect(googleFetch.mock.calls.some(([, target]) => target.pathname.endsWith("/move"))).toBe(false);
    expect(store.dispatch("tasks", "get", { id: task.id }).title).toBe("After");
  });
  it("restores Google's task immediately and settles later edits without replaying them", async () => {
    const { store, service, list, accountId, importTask, remoteTasks, googleFetch } = createFixture();
    const task = importTask({ id: "conflicted", title: "Original", notes: "old" });
    store.dispatch("tasks", "update", { id: task.id, title: "Local title" });
    store.dispatch("tasks", "update", { id: task.id, notes: "Local notes" });
    Object.assign(remoteTasks.get("conflicted")!, { title: "Google title", notes: "Google notes", etag: "external" });
    store.setGoogleSyncToken(accountId, "tasks-updated:remote-list", "2026-10-21T10:00:00Z");
    await service.runNow();
    const id = store.dispatch("diagnostics", "pendingMutations", {}).mutations[0].id;
    const preview = await service.previewMutationResolution({ id });
    expect(preview).toMatchObject({ affectedCount: 2, canKeepLocal: true });
    expect(preview.items[0]).toMatchObject({ local: { title: "Local title" }, google: { title: "Google title" } });
    googleFetch.mockClear();
    await service.resolveMutation({ id, reviewId: preview.reviewId, strategy: "google" });
    expect(store.dispatch("tasks", "get", { id: task.id })).toMatchObject({ title: "Google title", notes: "Google notes", listId: list.id });
    expect(store.unresolvedSyncMutationCount(accountId)).toBe(0);
    await service.runNow();
    expect(googleFetch.mock.calls.every(([, , init]) => !init?.method || init.method === "GET")).toBe(true);
    expect(store.dispatch("undo", "status", {}).canUndo).toBe(false);
  });

  it("keeps the latest local task edit and retries the related chain together", async () => {
    const { store, service, importTask, remoteTasks, accountId } = createFixture();
    const task = importTask({ id: "overwrite", title: "Original" });
    store.dispatch("tasks", "update", { id: task.id, title: "Local one" });
    store.dispatch("tasks", "update", { id: task.id, title: "Local two" });
    Object.assign(remoteTasks.get("overwrite")!, { title: "Google edit", etag: "external" });
    await service.runNow();
    const id = store.dispatch("diagnostics", "pendingMutations", {}).mutations[0].id;
    const preview = await service.previewMutationResolution({ id });
    await service.resolveMutation({ id, reviewId: preview.reviewId, strategy: "local" });
    await service.runNow();
    expect(remoteTasks.get("overwrite")!.title).toBe("Local two");
    expect(store.unresolvedSyncMutationCount(accountId)).toBe(0);
  });

  it("never retries an ambiguous creation through recovery and imports the accepted task once", async () => {
    const fixture = createFixture();
    const { store, service, list, accountId, googleFetch, remoteTasks } = fixture;
    const task = store.dispatch("tasks", "create", { listId: list.id, title: "Accepted once" });
    store.dispatch("tasks", "update", { id: task.id, notes: "Preserve this text before choosing Google" });
    fixture.loseCreateResponse(); await service.runNow();
    const id = store.dispatch("diagnostics", "pendingMutations", {}).mutations[0].id;
    expect(() => store.dispatch("diagnostics", "retryPendingMutation", { id })).toThrow("may already have created");
    const preview = await service.previewMutationResolution({ id });
    expect(preview).toMatchObject({ uncertainCreation: true, canKeepLocal: false, affectedCount: 2 });
    await expect(service.resolveMutation({ id, reviewId: preview.reviewId, strategy: "local" })).rejects.toThrow("may already have created");
    await service.resolveMutation({ id, reviewId: preview.reviewId, strategy: "google" });
    expect(store.unresolvedSyncMutationCount(accountId)).toBe(0);
    expect(store.dispatch("tasks", "list", { listId: list.id }).items).toHaveLength(1);
    await service.runNow();
    expect(remoteTasks.size).toBe(1);
    expect(googleFetch.mock.calls.filter(([, , init]) => init?.method === "POST")).toHaveLength(1);
  });

  it.each(["local", "google"])("rejects a stale comparison after a %s edit without cancelling writes", async (changed) => {
    const { store, service, importTask, remoteTasks, accountId } = createFixture();
    const task = importTask({ id: "stale", title: "Original" });
    store.dispatch("tasks", "update", { id: task.id, title: "Local" });
    const id = store.dispatch("diagnostics", "pendingMutations", {}).mutations[0].id;
    const preview = await service.previewMutationResolution({ id });
    if (changed === "local") store.dispatch("tasks", "update", { id: task.id, notes: "New typing" });
    else remoteTasks.get("stale")!.title = "New Google edit";
    await expect(service.resolveMutation({ id, reviewId: preview.reviewId, strategy: "google" })).rejects.toThrow(/changes arrived|Google changed/);
    expect(store.unresolvedSyncMutationCount(accountId)).toBe(changed === "local" ? 2 : 1);
    expect(store.dispatch("tasks", "get", { id: task.id }).title).toBe("Local");
  });

  it("leaves writes and optimistic state intact when a comparison page fails", async () => {
    const { store, service, importTask, googleFetch, accountId } = createFixture();
    const task = importTask({ id: "offline", title: "Original" });
    store.dispatch("tasks", "update", { id: task.id, title: "Local" });
    const id = store.dispatch("diagnostics", "pendingMutations", {}).mutations[0].id;
    const transport = googleFetch.getMockImplementation()!;
    googleFetch.mockImplementation(async (account, target, init) => target.pathname.endsWith("/tasks") ? new Response(null, { status: 503 }) : transport(account, target, init));
    await expect(service.previewMutationResolution({ id })).rejects.toThrow("503");
    expect(store.unresolvedSyncMutationCount(accountId)).toBe(1);
    expect(store.dispatch("tasks", "get", { id: task.id }).title).toBe("Local");
  });

  it("restores a renamed list and cancels its queued dependent task edits", async () => {
    const { store, service, list, importTask, remoteList, accountId } = createFixture();
    const task = importTask({ id: "dependent", title: "Google task" });
    store.dispatch("tasks", "renameTaskList", { id: list.id, title: "Local list" });
    store.dispatch("tasks", "update", { id: task.id, title: "Local task" });
    remoteList.title = "Google list";
    const id = store.dispatch("diagnostics", "pendingMutations", {}).mutations[0].id;
    const preview = await service.previewMutationResolution({ id });
    expect(preview.affectedCount).toBe(2);
    await service.resolveMutation({ id, reviewId: preview.reviewId, strategy: "google" });
    expect(store.googleTaskListForSync(list.id)!.title).toBe("Google list");
    expect(store.googleTaskForSync(task.id)!.title).toBe("Google task");
    expect(store.unresolvedSyncMutationCount(accountId)).toBe(0);
  });

  it("restores locally deleted lists, tasks and events with stable identities", async () => {
    const { store, service, list, importTask } = createFixture();
    const task = importTask({ id: "deleted-local-list-task", title: "Google task" });
    store.dispatch("tasks", "deleteTaskList", { id: list.id });
    let id = store.dispatch("diagnostics", "pendingMutations", {}).mutations[0].id;
    let preview = await service.previewMutationResolution({ id });
    await service.resolveMutation({ id, reviewId: preview.reviewId, strategy: "google" });
    expect(store.googleTaskListForSync(list.id)!.title).toBe("Inbox");
    expect(store.googleTaskForSync(task.id)!.title).toBe("Google task");
    const calendarFixture = createCalendarFixture();
    const event = calendarFixture.importEvent("deleted-local-event");
    calendarFixture.store.dispatch("calendar", "delete", { id: event.id });
    id = calendarFixture.store.dispatch("diagnostics", "pendingMutations", {}).mutations[0].id;
    preview = await calendarFixture.service.previewMutationResolution({ id });
    await calendarFixture.service.resolveMutation({ id, reviewId: preview.reviewId, strategy: "google" });
    expect(calendarFixture.store.googleEventForSync(event.id)!.googleId).toBe("deleted-local-event");
  });

  it("rolls the queue decision back when a fetched event cannot be imported", async () => {
    const { store, service, importEvent, remoteEvents, accountId } = createCalendarFixture();
    const event = importEvent("invalid-event");
    store.dispatch("calendar", "update", { id: event.id, title: "Local" });
    delete remoteEvents.get("invalid-event")!.start;
    const id = store.dispatch("diagnostics", "pendingMutations", {}).mutations[0].id;
    const preview = await service.previewMutationResolution({ id });
    await expect(service.resolveMutation({ id, reviewId: preview.reviewId, strategy: "google" })).rejects.toThrow();
    expect(store.unresolvedSyncMutationCount(accountId)).toBe(1);
    expect(store.googleEventForSync(event.id)!.title).toBe("Local");
  });

  it("restores an optimistic Calendar move to its source with the same local identity", async () => {
    const { store, service, importEvent, accountId, calendar } = createCalendarFixture();
    const event = importEvent("moved-event");
    const destination = store.upsertGoogleCalendar({ id: "destination", summary: "Destination" }, accountId);
    store.dispatch("calendar", "update", { id: event.id, calendarId: destination.id, title: "Moved locally" });
    const id = store.dispatch("diagnostics", "pendingMutations", {}).mutations[0].id;
    const preview = await service.previewMutationResolution({ id });
    await service.resolveMutation({ id, reviewId: preview.reviewId, strategy: "google" });
    expect(store.googleEventForSync(event.id)).toMatchObject({ calendarId: calendar.id, title: "moved-event", googleId: "moved-event" });
    expect(store.unresolvedSyncMutationCount(accountId)).toBe(0);
  });

  it("discards a series split and its successor edits as one reviewed operation", async () => {
    const { store, service, calendar, importEvent, remoteEvents, accountId } = createCalendarFixture();
    const event = importEvent("series-recovery");
    const remote = remoteEvents.get("series-recovery")!;
    remote.recurrence = ["RRULE:FREQ=DAILY;COUNT=5"];
    store.upsertGoogleEvent(remote, calendar.id);
    const successor = store.dispatch("calendar", "update", { id: event.id, scope: "following", originalStartAt: "2026-10-24T09:00:00.000Z", title: "Split locally", startsAt: "2026-10-24T09:00:00.000Z", endsAt: "2026-10-24T10:00:00.000Z" });
    store.dispatch("calendar", "update", { id: successor.id, description: "Later successor edit" });
    const id = store.dispatch("diagnostics", "pendingMutations", {}).mutations[0].id;
    const preview = await service.previewMutationResolution({ id });
    expect(preview).toMatchObject({ affectedCount: 2, canKeepLocal: false });
    await service.resolveMutation({ id, reviewId: preview.reviewId, strategy: "google" });
    expect(store.googleEventForSync(successor.id)).toBeNull();
    expect(store.googleEventForSync(event.id)!.recurrenceLines).toEqual(remote.recurrence);
    expect(store.unresolvedSyncMutationCount(accountId)).toBe(0);
  });

  it("resolves list deletion and its scheduled Calendar deletions together", async () => {
    const { store, service, importTask, calendar, list, remoteEvents, accountId } = createCalendarFixture();
    const task = importTask({ id: "scheduled-task", title: "Scheduled task" });
    const block = store.dispatch("calendar", "scheduleTaskBlock", { taskId: task.id, calendarId: calendar.id, startsAt: "2026-10-22T09:00:00.000Z", endsAt: "2026-10-22T10:00:00.000Z" });
    const remote = { id: "scheduled-event", summary: "Scheduled task", etag: "v1", start: { dateTime: block.startsAt }, end: { dateTime: block.endsAt } };
    remoteEvents.set(remote.id, remote);
    store.bindGoogleEvent(block.calendarEventId, remote);
    for (const mutation of store.pendingSyncMutations()) store.completeSyncMutation(mutation.id);
    store.dispatch("tasks", "deleteTaskList", { id: list.id });
    const id = store.dispatch("diagnostics", "pendingMutations", {}).mutations[0].id;
    const preview = await service.previewMutationResolution({ id });
    expect(preview.affectedCount).toBe(2);
    expect(preview.items.map((item) => item.kind)).toContain("taskList");
    await service.resolveMutation({ id, reviewId: preview.reviewId, strategy: "google" });
    expect(store.googleTaskForSync(task.id)).toMatchObject({ title: "Scheduled task", plannedStart: block.startsAt, plannedEnd: block.endsAt });
    expect(store.googleEventForSync(block.calendarEventId)!.googleId).toBe(remote.id);
    expect(store.dispatch("calendar", "listScheduledTaskBlocks", {}).items).toEqual([expect.objectContaining({ id: block.id, taskId: task.id, calendarEventId: block.calendarEventId })]);
    expect(store.unresolvedSyncMutationCount(accountId)).toBe(0);
  });

  it("restores a moved block's scheduling record and leaves unrelated writes queued", async () => {
    const { store, service, importTask, calendar, remoteEvents, importEvent, accountId } = createCalendarFixture();
    const task = importTask({ id: "block-task", title: "Block task" });
    const block = store.dispatch("calendar", "scheduleTaskBlock", { taskId: task.id, calendarId: calendar.id, startsAt: "2026-10-22T09:00:00.000Z", endsAt: "2026-10-22T10:00:00.000Z" });
    const remote = { id: "block-event", summary: "Block task", start: { dateTime: block.startsAt }, end: { dateTime: block.endsAt } };
    remoteEvents.set(remote.id, remote); store.bindGoogleEvent(block.calendarEventId, remote);
    for (const mutation of store.pendingSyncMutations()) store.completeSyncMutation(mutation.id);
    store.dispatch("calendar", "moveScheduledTaskBlock", { id: block.id, startsAt: "2026-10-23T09:00:00.000Z" });
    const unrelated = importEvent("unrelated"); store.dispatch("calendar", "update", { id: unrelated.id, title: "Keep queued" });
    const id = store.dispatch("diagnostics", "pendingMutations", {}).mutations[0].id;
    const preview = await service.previewMutationResolution({ id });
    expect(preview.affectedCount).toBe(1);
    await service.resolveMutation({ id, reviewId: preview.reviewId, strategy: "google" });
    expect(store.dispatch("calendar", "listScheduledTaskBlocks", {}).items[0]).toMatchObject({ startsAt: block.startsAt, endsAt: block.endsAt });
    expect(store.googleTaskForSync(task.id)!.plannedStart).toBe(block.startsAt);
    expect(store.googleEventForSync(unrelated.id)!.title).toBe("Keep queued");
    expect(store.unresolvedSyncMutationCount(accountId)).toBe(1);
  });

  it("restores an unscheduled block from its event deletion without stale scheduling undo", async () => {
    const { store, service, importTask, calendar, remoteEvents } = createCalendarFixture();
    const task = importTask({ id: "unscheduled-task", title: "Unscheduled task" });
    const block = store.dispatch("calendar", "scheduleTaskBlock", { taskId: task.id, calendarId: calendar.id, startsAt: "2026-10-22T09:00:00.000Z", endsAt: "2026-10-22T10:00:00.000Z" });
    const remote = { id: "unscheduled-event", summary: "Unscheduled task", start: { dateTime: block.startsAt }, end: { dateTime: block.endsAt } };
    remoteEvents.set(remote.id, remote); store.bindGoogleEvent(block.calendarEventId, remote);
    for (const mutation of store.pendingSyncMutations()) store.completeSyncMutation(mutation.id);
    store.dispatch("calendar", "unscheduleTaskBlock", { id: block.id });
    const id = store.dispatch("diagnostics", "pendingMutations", {}).mutations[0].id;
    const preview = await service.previewMutationResolution({ id });
    await service.resolveMutation({ id, reviewId: preview.reviewId, strategy: "google" });
    expect(store.dispatch("calendar", "listScheduledTaskBlocks", {}).items).toEqual([expect.objectContaining({ id: block.id, calendarEventId: block.calendarEventId })]);
    expect(store.googleTaskForSync(task.id)!.plannedStart).toBe(block.startsAt);
    expect(store.dispatch("undo", "status", {}).canUndo).toBe(false);
  });

  it.each([404, 410, 403, 412])("handles a repeated Google deletion returning %s without reviving the item", async (status) => {
    const { store, service, list, googleFetch, remoteLists, accountId } = createFixture();
    store.dispatch("tasks", "deleteTaskList", { id: list.id }); remoteLists.delete("remote-list");
    const transport = googleFetch.getMockImplementation()!;
    googleFetch.mockImplementation(async (account, target, init) => init?.method === "DELETE" ? new Response(null, { status }) : transport(account, target, init));
    await service.runNow();
    expect(store.unresolvedSyncMutationCount(accountId)).toBe([404, 410].includes(status) ? 0 : 1);
    expect(store.googleTaskListForSync(list.id)).toBeNull();
  });
  it.each([404, 410])("settles repeated task and event deletions returning %s", async (status) => {
    const taskFixture = createFixture();
    const task = taskFixture.importTask({ id: "already-deleted-task", title: "Task" });
    taskFixture.store.dispatch("tasks", "delete", { id: task.id }); taskFixture.remoteTasks.delete("already-deleted-task");
    let transport = taskFixture.googleFetch.getMockImplementation()!;
    taskFixture.googleFetch.mockImplementation(async (account, target, init) => init?.method === "DELETE" ? new Response(null, { status }) : transport(account, target, init));
    await taskFixture.service.runNow();
    expect(taskFixture.store.unresolvedSyncMutationCount(taskFixture.accountId)).toBe(0);
    const eventFixture = createCalendarFixture();
    const event = eventFixture.importEvent("already-deleted-event");
    eventFixture.store.dispatch("calendar", "delete", { id: event.id }); eventFixture.remoteEvents.clear();
    const eventTransport = eventFixture.googleFetch.getMockImplementation()!;
    eventFixture.googleFetch.mockImplementation(async (account, target, init) => init?.method === "DELETE" ? new Response(null, { status }) : eventTransport(account, target, init));
    await eventFixture.service.runNow();
    expect(eventFixture.store.unresolvedSyncMutationCount(eventFixture.accountId)).toBe(0);
  });

  it("recovers an accepted Calendar creation without a duplicate local event or lost later recurrence edit", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { store, service, calendar, remoteEvents, googleFetch, accountId } = createCalendarFixture();
    const event = store.dispatch("calendar", "create", { calendarId: calendar.id, title: "Accepted Calendar event", startsAt: "2026-10-22T09:00:00Z", endsAt: "2026-10-22T10:00:00Z" });
    const transport = googleFetch.getMockImplementation()!;
    let loseResponse = true;
    googleFetch.mockImplementation(async (account, target, init) => {
      if (init?.method === "POST" && target.pathname.endsWith("/events")) {
        const body = JSON.parse(String(init.body));
        if (remoteEvents.has(body.id)) return new Response(null, { status: 409 });
        remoteEvents.set(body.id, { ...body, etag: "created" });
        if (loseResponse) { loseResponse = false; throw new TypeError("Response lost after Calendar accepted the event"); }
        return Response.json(remoteEvents.get(body.id));
      }
      if (init?.method === "PATCH") {
        const remote = remoteEvents.get(target.pathname.split("/").at(-1)!);
        if (!remote) return new Response(null, { status: 404 });
        Object.assign(remote, JSON.parse(String(init.body)), { etag: "patched" }); return Response.json(remote);
      }
      return transport(account, target, init);
    });
    await service.runNow();
    expect(store.dispatch("calendar", "listEvents", {}).items).toHaveLength(1);
    expect(store.googleEventForSync(event.id)!.googleId).toBe([...remoteEvents.keys()][0]);
    store.dispatch("calendar", "update", { id: event.id, recurrenceLines: ["RRULE:FREQ=DAILY;COUNT=3"], description: "Latest local text" });
    vi.setSystemTime(Date.now() + 60_000); await service.runNow();
    expect(remoteEvents.size).toBe(1);
    expect([...remoteEvents.values()][0]).toMatchObject({ description: "Latest local text", recurrence: ["RRULE:FREQ=DAILY;COUNT=3"] });
    expect(store.unresolvedSyncMutationCount(accountId)).toBe(0);
  });

  it("retains a cleared Calendar description after PATCH and later pulls", async () => {
    const { store, service, calendar, importEvent, remoteEvents, googleFetch } = createCalendarFixture();
    const event = importEvent("clear-description");
    remoteEvents.get("clear-description")!.description = "Old **Markdown**";
    store.upsertGoogleEvent(remoteEvents.get("clear-description")!, calendar.id);
    store.dispatch("calendar", "update", { id: event.id, description: "" });
    const transport = googleFetch.getMockImplementation()!;
    googleFetch.mockImplementation(async (account, target, init) => {
      if (init?.method === "PATCH") {
        const remote = remoteEvents.get("clear-description")!;
        Object.assign(remote, JSON.parse(String(init.body))); return Response.json(remote);
      }
      return transport(account, target, init);
    });
    await service.runNow(); await service.runNow();
    const patch = googleFetch.mock.calls.find(([, , init]) => init?.method === "PATCH")![2]!;
    expect(JSON.parse(String(patch.body)).description).toBe("");
    expect(remoteEvents.get("clear-description")!.description).toBe("");
    expect(store.googleEventForSync(event.id)!.description).toBe("");
  });

});
