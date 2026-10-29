import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoreStore } from "./coreStore";
import { GoogleSyncService } from "../../shared/google/GoogleSyncService";
import { SyncPersistenceError, type GoogleSyncPlatform } from "../../shared/google/types";

type Kind = "task" | "event";
type RecordValue = Record<string, any>;
type Request = { method: string; url: URL; body?: RecordValue; etag: string | null };
const cleanup: Array<() => void> = [];

/** Real SQLite/outbox/undo and service; only the Google transport is replaced. */
function fixture(kind: Kind) {
  if (!process.env.HCB_TEST_DATABASE_ROOT) throw new Error("An isolated database root is required.");
  const directory = mkdtempSync(join(process.env.HCB_TEST_DATABASE_ROOT, "sync-faults-"));
  const path = join(directory, "workspace.sqlite");
  let store = new CoreStore(path);
  cleanup.push(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  const accountId = store.upsertGoogleAccount({ googleAccountId: "fault-account", connectionState: "connected" }).accountId;
  const remoteList = { id: "list", title: "Tasks", etag: "list-v1" };
  const remoteCalendar = { id: "calendar", summary: "Calendar", accessRole: "owner" };
  const collection = kind === "task" ? store.upsertGoogleTaskList(remoteList, accountId) : store.upsertGoogleCalendar(remoteCalendar, accountId);
  store.dispatch("settings", "update", { syncMode: "manual", syncTasksEnabled: kind === "task", syncCalendarEventsEnabled: kind === "event" });
  const initial: RecordValue = kind === "task" ? { id: "item", title: "Original", notes: "Original notes", status: "needsAction", position: "001", etag: "v1" }
    : { id: "item", summary: "Original", description: "Original notes", start: { dateTime: "2026-10-29T09:00:00Z" }, end: { dateTime: "2026-10-29T10:00:00Z" }, etag: "v1" };
  const remote = new Map<string, RecordValue>([["item", initial]]);
  const item = kind === "task" ? store.upsertGoogleTask(initial, collection.id)! : store.upsertGoogleEvent(initial, collection.id)!;
  const requests: Request[] = [];
  let revision = 1;
  const faults: {
    before?: (request: Request) => void | Response | Promise<void | Response>;
    after?: (request: Request, resource: RecordValue) => void | Response | Promise<void | Response>;
  } = {};
  const platform: GoogleSyncPlatform = {};
  const oauth = { onConnectionChange: () => () => undefined, googleFetch: async (_account: string, target: string | URL, init: RequestInit = {}) => {
    const url = new URL(target);
    const request = { method: init.method ?? "GET", url, body: init.body ? JSON.parse(String(init.body)) : undefined, etag: new Headers(init.headers).get("if-match") };
    requests.push(request);
    const injected = await faults.before?.(request);
    if (injected) return injected;
    const id = decodeURIComponent(url.pathname.split("/").at(-1)!);
    if (request.method === "GET") {
      if (id === "lists") return Response.json({ items: [remoteList] });
      if (id === "calendarList") return Response.json({ items: [remoteCalendar] });
      if (["tasks", "events"].includes(id)) return Response.json({ items: [...remote.values()], nextSyncToken: "token" });
      if (id === "list") return Response.json(remoteList);
      return remote.has(id) ? Response.json(remote.get(id)) : new Response(null, { status: 404 });
    }
    if (request.method === "POST") {
      const createdId = request.body?.id ?? `created-${++revision}`;
      if (remote.has(createdId)) return new Response(null, { status: 409 });
      const created = { ...request.body, id: createdId, etag: `v${++revision}` };
      remote.set(createdId, created);
      return await faults.after?.(request, created) ?? Response.json(created);
    }
    const current = remote.get(id);
    if (!current) return new Response(null, { status: 404 });
    if (request.etag && request.etag !== current.etag) return new Response(null, { status: 412 });
    if (request.method === "DELETE") {
      remote.delete(id);
      return await faults.after?.(request, current) ?? new Response(null, { status: 204 });
    }
    if (request.method !== "PATCH") throw new Error(`Unexpected ${request.method} ${url}`);
    for (const [field, value] of Object.entries(request.body!)) {
      if (value === null) delete current[field]; else current[field] = value;
    }
    current.etag = `v${++revision}`;
    return await faults.after?.(request, current) ?? Response.json(current);
  } };
  let service = new GoogleSyncService(store, oauth, platform);
  const namespace = kind === "task" ? "tasks" : "calendar";
  return {
    get store() { return store; }, get service() { return service; }, accountId, collection, item, remote, requests, faults, platform,
    titleField: kind === "task" ? "title" : "summary", notesField: kind === "task" ? "notes" : "description",
    edit: (changes: RecordValue, id = item.id) => store.dispatch(namespace, "update", { id, ...changes }),
    create: (title: string) => store.dispatch(namespace, "create", kind === "task" ? { listId: collection.id, title }
      : { calendarId: collection.id, title, startsAt: "2026-10-29T11:00:00Z", endsAt: "2026-10-29T12:00:00Z" }),
    local: (id = item.id) => kind === "task" ? store.googleTaskForSync(id)! : store.googleEventForSync(id)!,
    writes: () => requests.filter(request => request.method !== "GET"),
    pending: () => store.dispatch("diagnostics", "pendingMutations", {}).mutations as RecordValue[],
    // Isolate delivery from pulls so an incremental response omitting this
    // resource cannot accidentally mask an unsafe fallback or replay.
    deliver: () => (service as any).deliverOutbox(accountId) as Promise<void>,
    sql: (sql: string) => { const db = new Database(path); try { db.exec(sql); } finally { db.close(); } },
    restart: () => { store.close(); store = new CoreStore(path); service = new GoogleSyncService(store, oauth, platform); },
    advance: () => vi.setSystemTime(Date.now() + 60_000)
  };
}

afterEach(() => { vi.useRealTimers(); for (const dispose of cleanup.splice(0)) dispose(); });

describe.each<Kind>(["task", "event"])("%s delivery fault tolerance", kind => {
  it.each(["lost response", "invalid JSON", "server error", "rejected offline", "rate limit"])("preserves a newer undo across restart after %s", async failure => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const f = fixture(kind);
    f.edit({ title: "Submitted" });
    let once = true;
    const fail = (request: Request) => {
      if (request.method !== "PATCH" || !once) return;
      once = false;
      if (failure === "invalid JSON") return new Response("{truncated", { headers: { "content-type": "application/json" } });
      if (failure === "server error") return new Response(null, { status: 503 });
      if (failure === "rate limit") return new Response(null, { status: 429 });
      throw new TypeError(failure);
    };
    if (["rejected offline", "rate limit"].includes(failure)) f.faults.before = fail; else f.faults.after = fail;
    await f.deliver();
    expect(f.store.unresolvedSyncMutationCount(f.accountId)).toBe(1);
    f.store.dispatch("undo", "undo");
    f.restart(); f.advance();
    await f.service.runNow();
    expect(f.local().title).toBe("Original");
    expect(f.remote.get("item")![f.titleField]).toBe("Original");
    expect(f.store.unresolvedSyncMutationCount(f.accountId)).toBe(0);
    expect(f.remote.size).toBe(1);
    expect(f.writes().every(request => request.method === "PATCH" && request.etag)).toBe(true);
    f.store.dispatch("undo", "redo");
    await f.service.runNow();
    expect(f.remote.get("item")![f.titleField]).toBe("Submitted");
  });

  it.each(["same", "changed", "missing"])("discovers an unknown baseline with a %s original revision before writing", async revision => {
    const f = fixture(kind);
    f.edit({ title: "Local title" });
    f.sql("DELETE FROM google_sync_state");
    if (revision === "changed") Object.assign(f.remote.get("item")!, { [f.titleField]: "Phone title", etag: "phone" });
    if (revision === "missing") f.sql(`UPDATE ${kind === "task" ? "tasks" : "events"} SET google_etag=NULL`);
    await f.deliver();
    expect(f.local().title).toBe("Local title");
    if (revision === "same") {
      expect(f.requests[0].method).toBe("GET");
      expect(f.writes().map(request => request.body)).toEqual([{ [f.titleField]: "Local title" }]);
      expect(f.store.unresolvedSyncMutationCount(f.accountId)).toBe(0);
    } else {
      expect(f.writes()).toHaveLength(0);
      expect(f.store.unresolvedSyncMutationCount(f.accountId)).toBe(1);
      expect(f.pending()[0].status).toBe("failed");
    }
  });

  it("does not send legacy commands without snapshots until their current desired state has been reviewed", async () => {
    const f = fixture(kind);
    f.edit({ title: "First legacy title" }); f.edit({ title: "Latest legacy title" });
    f.sql("UPDATE outbox SET sync_intent_json=NULL");
    await f.deliver();
    expect(f.writes()).toHaveLength(0);
    expect(f.local().title).toBe("Latest legacy title");
    const id = f.pending()[0].id;
    const review = await f.service.previewMutationResolution({ id });
    await f.service.resolveMutation({ id, reviewId: review.reviewId, strategy: "local" });
    await f.deliver();
    expect(f.writes().map(request => request.body)).toEqual([{ [f.titleField]: "Latest legacy title" }]);
    expect(f.store.unresolvedSyncMutationCount(f.accountId)).toBe(0);
    f.store.dispatch("undo", "undo");
    expect(f.local().title).toBe("First legacy title");
  });

  it.each(["missing id", "wrong id", "missing revision"])("retains the submission and identity after a successful reply with %s", async fault => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const f = fixture(kind);
    f.edit({ title: "Submitted" });
    f.faults.after = (request, resource) => {
      if (request.method !== "PATCH") return;
      const receipt = { ...resource };
      if (fault === "missing id") delete receipt.id;
      if (fault === "wrong id") receipt.id = "unrelated";
      if (fault === "missing revision") delete receipt.etag;
      return Response.json(receipt);
    };
    await f.deliver();
    expect(f.local()).toMatchObject({ googleId: "item", title: "Submitted" });
    expect(f.store.unresolvedSyncMutationCount(f.accountId)).toBe(1);
    expect(f.store.googleSyncState(f.accountId, kind, f.item.id)?.baseline.etag).toBe("v1");
    expect(f.store.googleOperationRecord(f.accountId, `submission:${f.pending()[0].id}`)).not.toBeNull();
    f.restart(); delete f.faults.after; f.advance();
    await f.service.runNow();
    expect(f.local()).toMatchObject({ googleId: "item", title: "Submitted" });
    expect(f.store.unresolvedSyncMutationCount(f.accountId)).toBe(0);
    expect(f.writes()).toHaveLength(1);
  });

  it("retains an unsent legacy creation and its edits until reviewed, then creates it once", async () => {
    const f = fixture(kind);
    const created = f.create("Legacy creation");
    f.edit({ title: "Latest creation" }, created.id);
    f.sql("UPDATE outbox SET sync_intent_json=NULL");
    await f.deliver();
    expect(f.writes()).toHaveLength(0);
    const id = f.pending()[0].id;
    const review = await f.service.previewMutationResolution({ id });
    await f.service.resolveMutation({ id, reviewId: review.reviewId, strategy: "local" });
    await f.deliver();
    expect(f.writes()).toHaveLength(1);
    expect(f.writes()[0].body?.[f.titleField]).toBe("Latest creation");
    expect(f.remote.size).toBe(2);
    expect(f.store.unresolvedSyncMutationCount(f.accountId)).toBe(0);
  });

  it.each([false, true])("requires a known revision before deleting a present remote resource (absent=%s)", async absent => {
    const f = fixture(kind);
    f.sql(`UPDATE ${kind === "task" ? "tasks" : "events"} SET google_etag=NULL`);
    f.store.dispatch(kind === "task" ? "tasks" : "calendar", "delete", { id: f.item.id });
    if (absent) f.remote.delete("item");
    await f.deliver();
    expect(f.writes()).toHaveLength(0);
    expect(f.remote.has("item")).toBe(!absent);
    expect(f.store.unresolvedSyncMutationCount(f.accountId)).toBe(absent ? 0 : 1);
    if (!absent) {
      const id = f.pending()[0].id;
      const review = await f.service.previewMutationResolution({ id });
      await f.service.resolveMutation({ id, reviewId: review.reviewId, strategy: "local" });
      await f.deliver();
      expect(f.writes()).toHaveLength(1);
      expect(f.writes()[0]).toMatchObject({ method: "DELETE", etag: "v1" });
      expect(f.remote.has("item")).toBe(false);
    }
  });

  it("rolls back baseline and acknowledgement together when the local receipt transaction fails", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const f = fixture(kind);
    f.edit({ title: "Submitted" });
    f.sql("CREATE TRIGGER reject_receipt BEFORE UPDATE OF state ON outbox WHEN NEW.state='delivered' BEGIN SELECT RAISE(ABORT,'injected receipt failure'); END");
    await f.deliver();
    expect(f.remote.get("item")![f.titleField]).toBe("Submitted");
    expect(f.store.googleSyncState(f.accountId, kind, f.item.id)?.baseline.etag).toBe("v1");
    expect(f.store.unresolvedSyncMutationCount(f.accountId)).toBe(1);
    f.store.dispatch("undo", "undo");
    f.restart(); f.sql("DROP TRIGGER reject_receipt"); f.advance();
    await f.service.runNow();
    expect(f.local().title).toBe("Original");
    expect(f.remote.get("item")![f.titleField]).toBe("Original");
    expect(f.store.unresolvedSyncMutationCount(f.accountId)).toBe(0);
  });

  it("sends nothing when durable preparation fails and retains edits for a later restart", async () => {
    const f = fixture(kind);
    f.edit({ title: "Queued" });
    f.platform.checkpoint = async checkpoint => { if (checkpoint.stage === "before-remote-write") throw new SyncPersistenceError(checkpoint, new Error("disk full")); };
    await expect(f.deliver()).rejects.toThrow("before-remote-write");
    expect(f.writes()).toHaveLength(0);
    f.restart(); delete f.platform.checkpoint;
    await f.service.runNow();
    expect(f.remote.get("item")![f.titleField]).toBe("Queued");
    expect(f.store.unresolvedSyncMutationCount(f.accountId)).toBe(0);
  });
});

it("reviews an overlapping phone edit after a recovered Calendar POST instead of treating it as server normalization", async () => {
  const f = fixture("event");
  const event = f.store.dispatch("calendar", "create", { calendarId: f.collection.id, title: "Submitted", startsAt: "2026-10-29T11:00:00Z", endsAt: "2026-10-29T12:00:00Z" });
  f.faults.after = (request, resource) => {
    if (request.method !== "POST") return;
    f.edit({ title: "Newer local title" }, event.id);
    Object.assign(resource, { summary: "Phone title", etag: "phone" });
    return new Response(null, { status: 409 });
  };
  await f.deliver();
  expect(f.local(event.id).title).toBe("Newer local title");
  expect(f.pending().some(mutation => mutation.status === "failed")).toBe(true);
  expect(f.writes()).toHaveLength(1);
  expect(f.remote.size).toBe(2);
});

it("sends a meeting-link command as its own narrow patch and preserves a later title edit", async () => {
  const f = fixture("event");
  f.edit({ conferenceCreateRequest: true });
  f.edit({ title: "Later title" });
  await f.deliver();
  expect(f.writes()).toHaveLength(2);
  expect(Object.keys(f.writes()[0].body!)).toEqual(["conferenceData"]);
  expect(f.writes()[0].url.searchParams.get("conferenceDataVersion")).toBe("1");
  expect(f.writes()[1].body).toEqual({ summary: "Later title" });
  expect(f.store.unresolvedSyncMutationCount(f.accountId)).toBe(0);
});

it("does not mistake unchanged content for an accepted meeting-link command when its request never reached Google", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const f = fixture("event");
  f.edit({ conferenceCreateRequest: true });
  f.faults.before = request => { if (request.method === "PATCH") throw new TypeError("offline"); };
  await f.deliver();
  f.restart(); delete f.faults.before; f.advance();
  await f.service.runNow();
  expect(f.writes()).toHaveLength(2);
  expect(f.remote.get("item")!.conferenceData.createRequest.requestId).toBeTruthy();
  expect(f.store.unresolvedSyncMutationCount(f.accountId)).toBe(0);
});

function recurringFixture() {
  const f = fixture("event");
  const master = f.remote.get("item")!;
  Object.assign(master, { recurrence: ["RRULE:FREQ=DAILY;COUNT=5"], iCalUID: "series", start: { dateTime: "2026-10-29T09:00:00Z", timeZone: "UTC" }, end: { dateTime: "2026-10-29T10:00:00Z", timeZone: "UTC" } });
  f.store.upsertGoogleEvent(master, f.collection.id);
  const instance: RecordValue = { ...master, id: "instance", etag: "instance-v1", recurrence: undefined, recurringEventId: "item", originalStartTime: { dateTime: "2026-10-30T09:00:00Z" }, start: { dateTime: "2026-10-30T09:00:00Z", timeZone: "UTC" }, end: { dateTime: "2026-10-30T10:00:00Z", timeZone: "UTC" } };
  f.remote.set(instance.id, instance);
  f.faults.before = request => {
    if (request.url.pathname.endsWith("/instances")) return Response.json({ items: f.remote.has(instance.id) ? [instance] : [] });
    if (request.method === "GET" && request.url.searchParams.has("iCalUID")) return Response.json({ items: [master] });
  };
  const edit = (fields: RecordValue = { title: "Local occurrence" }) => f.store.dispatch("calendar", "update", { id: f.item.id, originalStartAt: "2026-10-30T09:00:00Z", scope: "occurrence", ...fields });
  const split = () => f.store.dispatch("calendar", "update", { id: f.item.id, originalStartAt: "2026-10-30T09:00:00Z", scope: "following", title: "Future series" });
  return { ...f, get store() { return f.store; }, get service() { return f.service; }, master, instance, editOccurrence: edit, split };
}

it("sends a generated occurrence's exact edit before a later edit without rewriting its master", async () => {
  const f = recurringFixture();
  const occurrence = f.editOccurrence();
  f.edit({ description: "Later notes" }, occurrence.id);
  await f.deliver();
  expect(f.writes().map(request => [request.url.pathname.split("/").at(-1), request.body])).toEqual([
    ["instance", { summary: "Local occurrence" }], ["instance", { description: "Later notes" }]
  ]);
  expect(f.master.recurrence).toEqual(["RRULE:FREQ=DAILY;COUNT=5"]);
  expect(f.instance).toMatchObject({ summary: "Local occurrence", description: "Later notes" });
  expect(f.store.unresolvedSyncMutationCount(f.accountId)).toBe(0);
});

it.each(["missing", "cancelled", "phone exception", "changed master"])("retains a generated occurrence for review after %s", async fault => {
  const f = recurringFixture(); const occurrence = f.editOccurrence();
  if (fault === "missing") f.remote.delete("instance");
  if (fault === "cancelled") f.instance.status = "cancelled";
  if (fault === "phone exception") Object.assign(f.instance, { description: "Phone exception", etag: "phone" });
  if (fault === "changed master") f.master.etag = "changed";
  await f.deliver();
  expect(f.writes()).toHaveLength(0);
  expect(f.local(occurrence.id).title).toBe("Local occurrence");
  expect(f.pending()[0].status).toBe("failed");
  if (fault === "phone exception" || fault === "changed master") {
    const id = f.pending()[0].id;
    const review = await f.service.previewMutationResolution({ id });
    await f.service.resolveMutation({ id, reviewId: review.reviewId, strategy: "local" });
    await f.deliver();
    expect(f.instance.summary).toBe("Local occurrence");
    expect(f.store.unresolvedSyncMutationCount(f.accountId)).toBe(0);
  }
});

it("does not duplicate a generated local occurrence when a phone exception arrives in a pull", () => {
  const f = recurringFixture(); const occurrence = f.editOccurrence();
  Object.assign(f.instance, { description: "Phone edit", etag: "phone" });
  f.store.upsertGoogleEvent(f.instance, f.collection.id);
  expect(f.local(occurrence.id)).toMatchObject({ googleId: "instance", title: "Local occurrence" });
  expect(f.store.dispatch("calendar", "listEvents", { start: "2026-10-30T00:00:00Z", end: "2026-10-31T00:00:00Z" }).items).toHaveLength(1);
  expect(f.pending()[0].status).toBe("failed");
});

it.each(["lost response", "server error", "invalid JSON"])("does not claim a series rollback after an accepted truncation with %s", async fault => {
  const f = recurringFixture();
  const successor = f.split();
  f.faults.after = request => {
    if (request.method !== "PATCH") return;
    if (fault === "lost response") throw new TypeError("accepted but lost");
    return fault === "server error" ? new Response(null, { status: 503 }) : new Response("{truncated");
  };
  await f.deliver();
  expect(f.writes()).toHaveLength(1);
  expect(Object.keys(f.writes()[0].body!)).toEqual(["recurrence"]);
  expect(f.local(successor.id).title).toBe("Future series");
  expect(f.pending()[0].status).toBe("failed");
  expect(f.pending()[0].lastErrorMessage).toContain("uncertain remote result");
  f.restart(); delete f.faults.after; await f.deliver();
  expect(f.writes()).toHaveLength(1);
});
