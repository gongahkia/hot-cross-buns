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
  const list = store.upsertGoogleTaskList(remoteList, accountId);
  store.dispatch("settings", "update", { syncCalendarEventsEnabled: false });
  const remoteTasks = new Map<string, RemoteTask>();
  let loseNextCreateResponse = false;
  let revision = 1;
  const googleFetch = vi.fn(async (_accountId: string, target: URL, init: RequestInit = {}): Promise<Response> => {
    const method = init.method ?? "GET";
    if (method === "GET") {
      if (target.pathname.endsWith("/lists")) return Response.json({ items: [remoteList] });
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
      if (new Headers(init.headers).get("if-match") !== task.etag) return Response.json({}, { status: 412 });
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
  return { store, service, accountId, list, remoteList, remoteTasks, googleFetch, importTask,
    loseCreateResponse: () => { loseNextCreateResponse = true; } };
}

function createCalendarFixture() {
  const fixture = createFixture();
  const { store, accountId, googleFetch } = fixture;
  const remoteCalendar = { id: "remote-calendar", summary: "Calendar" };
  const calendar = store.upsertGoogleCalendar(remoteCalendar, accountId);
  const remoteEvents = new Map<string, RemoteTask>();
  store.dispatch("settings", "update", { syncTasksEnabled: false, syncCalendarEventsEnabled: true });
  googleFetch.mockImplementation(async (_accountId, target, init = {}) => {
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

  it("upgrades a version 6 database without changing notes, Google bindings, or queued writes", () => {
    const { store, accountId, list } = createFixture();
    const note = store.dispatch("notes", "create", { title: "Preserve me", body: "Local-only content" });
    const task = store.dispatch("tasks", "create", { listId: list.id, title: "Queued during upgrade" });
    const fixture = fixtures.at(-1)!;
    const path = join(fixture.directory, "hcb.sqlite");
    store.close();
    const legacy = new Database(path);
    legacy.exec("ALTER TABLE outbox DROP COLUMN creation_started; DROP INDEX outbox_unresolved_account_idx; DELETE FROM schema_migrations; INSERT INTO schema_migrations(version) VALUES(6)");
    legacy.close();
    const upgraded = new CoreStore(path);
    fixture.store = upgraded;
    expect(upgraded.dispatch("notes", "get", { id: note.id }).body).toBe("Local-only content");
    expect(upgraded.googleTaskListForSync(list.id)?.googleId).toBe("remote-list");
    expect(upgraded.pendingSyncMutations(100, accountId)).toEqual([expect.objectContaining({ entityId: task.id, kind: "task.create" })]);
    expect(upgraded.didResetDeveloperData).toBe(false);
    expect(upgraded.dispatch("diagnostics", "summary", {}).database.schemaVersion).toBe(8);
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
});
