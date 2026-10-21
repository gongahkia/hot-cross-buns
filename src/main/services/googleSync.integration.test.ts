import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoreStore } from "./coreStore";
import { GoogleSyncService } from "./googleSync";

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
      if (init.headers && new Headers(init.headers).get("if-match") !== remoteList.etag) return Response.json({}, { status: 412 });
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
    const task = { title: "Task", etag: `v${++revision}`, position: "00000001", ...remote };
    remoteTasks.set(task.id, task);
    return store.upsertGoogleTask(task, list.id)!;
  };
  return { store, service, accountId, list, remoteList, remoteTasks, googleFetch, importTask,
    loseCreateResponse: () => { loseNextCreateResponse = true; } };
}

afterEach(() => {
  vi.useRealTimers();
  for (const { store, directory } of fixtures.splice(0)) {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

describe.skipIf(process.versions.modules !== "130")("Google sync with durable SQLite state", () => {
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
});
