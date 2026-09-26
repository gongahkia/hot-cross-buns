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

  it("upserts a Google Calendar event into the local cache", () => {
    const store = createStore();
    const account = store.upsertGoogleAccount({ id: "google-a", email: "a@example.test", connectionState: "connected" });
    const calendar = store.upsertGoogleCalendar({ id: "primary", summary: "Primary", timeZone: "Asia/Singapore" }, account.accountId);

    const event = store.upsertGoogleEvent({
      id: "remote-event",
      summary: "Remote planning",
      description: "Pulled from Google",
      start: { dateTime: "2026-09-26T09:00:00+08:00", timeZone: "Asia/Singapore" },
      end: { dateTime: "2026-09-26T10:00:00+08:00", timeZone: "Asia/Singapore" },
      etag: "remote-etag"
    }, calendar.id);

    expect(event).toMatchObject({
      title: "Remote planning",
      calendarId: calendar.id,
      description: "Pulled from Google"
    });
    expect(store.googleEventForSync(event!.id)).toMatchObject({ googleId: "remote-event" });
  });

  it("retires only the starter workspace after Google connects and defaults new writes to Google", () => {
    const store = createStore();
    const localTask = store.dispatch("tasks", "create", { listId: "inbox", title: "Starter task" });
    const localEvent = store.dispatch("calendar", "create", {
      calendarId: "primary", title: "Starter event", startsAt: "2027-01-02T08:00:00.000Z", endsAt: "2027-01-02T09:00:00.000Z"
    });
    const note = store.dispatch("notes", "create", { title: "Keep this note", listId: "inbox" });
    const account = store.upsertGoogleAccount({ id: "google-a", email: "a@example.test", connectionState: "connected" });
    const googleList = store.upsertGoogleTaskList({ id: "google-inbox", title: "Google Inbox" }, account.accountId);
    const googleCalendar = store.upsertGoogleCalendar({ id: "primary", summary: "Google Primary" }, account.accountId);
    const googleTask = store.dispatch("tasks", "create", { listId: googleList.id, title: "Google task" });
    const googleEvent = store.dispatch("calendar", "create", {
      calendarId: googleCalendar.id, title: "Google event", startsAt: "2027-01-02T10:00:00.000Z", endsAt: "2027-01-02T11:00:00.000Z"
    });
    store.dispatch("settings", "update", {
      selectedTaskListIds: ["inbox"],
      selectedCalendarIds: ["primary"],
      perTabListFilters: { tasks: { useCustomFilter: true, selectedTaskListIds: ["inbox"] } }
    });

    store.retireLocalFallback();

    expect(store.googleAccounts().map((item) => item.accountId)).not.toContain("local");
    expect(store.dispatch("tasks", "list", { status: "all", limit: 20 }).items.map((item: { id: string }) => item.id))
      .toEqual([googleTask.id]);
    expect(store.dispatch("calendar", "listEvents", { start: "2027-01-02T00:00:00.000Z", end: "2027-01-03T00:00:00.000Z", limit: 20 }).items.map((item: { id: string }) => item.id))
      .toEqual([googleEvent.id]);
    expect(store.dispatch("notes", "get", { id: note.id }).listId).toBeNull();
    expect(store.dispatch("settings", "get", {})).toMatchObject({
      selectedTaskListIds: [],
      selectedCalendarIds: [],
      perTabListFilters: { tasks: { selectedTaskListIds: [] } }
    });

    expect(store.dispatch("tasks", "create", { title: "New Google task" }).listId).toBe(googleList.id);
    expect(store.dispatch("calendar", "create", {
      title: "New Google event", startsAt: "2027-01-02T12:00:00.000Z", endsAt: "2027-01-02T13:00:00.000Z"
    }).calendarId).toBe(googleCalendar.id);
    expect(() => store.dispatch("tasks", "get", { id: localTask.id })).toThrow("Task no longer exists");
    expect(() => store.dispatch("calendar", "get", { id: localEvent.id })).toThrow("Calendar event no longer exists");
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

  it("defaults loading indicators to Blocks and persists per-surface choices", () => {
    const store = createStore();

    expect(store.dispatch("settings", "get", {}).loadingIndicators).toEqual({
      general: "blocks",
      preview: "blocks",
      search: "blocks"
    });

    const updated = store.dispatch("settings", "update", {
      loadingIndicators: {
        general: "orbit",
        preview: "wave",
        search: "linear-dots"
      }
    });

    expect(updated.loadingIndicators).toEqual({
      general: "orbit",
      preview: "wave",
      search: "linear-dots"
    });
    expect(store.dispatch("settings", "get", {}).loadingIndicators).toEqual(updated.loadingIndicators);
  });

  it("returns a renderer-compatible diagnostics summary", () => {
    const store = createStore();
    const summary = store.dispatch("diagnostics", "summary", {});
    const logs = store.dispatch("diagnostics", "logs", {});

    expect(summary).toMatchObject({
      cache: {
        taskListCount: expect.any(Number),
        calendarCount: expect.any(Number)
      },
      native: {
        capabilities: expect.any(Array),
        paths: expect.any(Array)
      },
      redaction: {
        credentials: "redacted"
      }
    });
    expect(logs).toEqual({ entries: [], persistedText: "" });
  });

  it("keeps setup skip distinct from completion and restores pending setup safely", () => {
    const store = createStore();

    expect(store.dispatch("settings", "get", {})).toMatchObject({
      onboardingStatus: "pending",
      setupCompletedAt: null,
      uiFontName: null,
      uiMonoFontName: null
    });

    store.dispatch("settings", "update", { onboardingStatus: "skipped" });
    expect(store.dispatch("settings", "get", {}).onboardingStatus).toBe("skipped");

    store.dispatch("settings", "recoveryAction", { action: "resetOnboarding" });
    expect(store.dispatch("settings", "get", {})).toMatchObject({
      onboardingStatus: "pending",
      setupCompletedAt: null
    });
  });

  it("round-trips Calendar conferencing, Drive attachment metadata, RSVP, and status-event data", () => {
    const store = createStore();
    const account = store.upsertGoogleAccount({ id: "google-a", email: "a@example.test", connectionState: "connected" });
    const calendar = store.upsertGoogleCalendar({ id: "primary", summary: "Primary" }, account.accountId);
    const event = store.dispatch("calendar", "create", {
      calendarId: calendar.id,
      title: "Focus work",
      startsAt: "2027-01-02T09:00:00.000Z",
      endsAt: "2027-01-02T10:00:00.000Z",
      eventType: "focusTime",
      focusTimeProperties: { autoDeclineMode: "declineNone", chatStatus: "doNotDisturb" },
      conferenceCreateRequest: { type: "hangoutsMeet" },
      attachments: [{ fileUrl: "https://drive.google.com/open?id=brief", title: "Brief" }],
      attendees: [{ email: "a@example.test", self: true, responseStatus: "accepted" }],
      selfResponseStatus: "tentative"
    });
    const local = store.googleEventForSync(event.id);
    expect(local).toMatchObject({
      eventType: "focusTime",
      conferenceCreateRequested: true,
      attachmentsManaged: true,
      attachments: [{ fileUrl: "https://drive.google.com/open?id=brief", title: "Brief" }],
      selfResponseStatus: "tentative"
    });

    store.bindGoogleEvent(event.id, {
      id: "remote-event", etag: "etag", eventType: "focusTime",
      conferenceData: { conferenceSolution: { name: "Google Meet" }, entryPoints: [{ entryPointType: "video", uri: "https://meet.google.com/abc-defg-hij" }] },
      attachments: [{ fileUrl: "https://drive.google.com/open?id=brief", title: "Brief", mimeType: "application/pdf" }],
      attendees: [{ email: "a@example.test", self: true, responseStatus: "tentative" }]
    });
    const bound = store.dispatch("calendar", "get", { id: event.id });
    expect(bound.conference.videoUri).toBe("https://meet.google.com/abc-defg-hij");
    expect(bound.attachments).toHaveLength(1);
    expect(bound.selfResponseStatus).toBe("tentative");
  });

  it("makes a non-destructive cross-account copy and excludes guests and conferencing", () => {
    const store = createStore();
    const source = store.upsertGoogleAccount({ id: "source", email: "source@example.test", connectionState: "connected" });
    const destination = store.upsertGoogleAccount({ id: "destination", email: "destination@example.test", connectionState: "connected" });
    const sourceList = store.upsertGoogleTaskList({ id: "source-list", title: "Source list" }, source.accountId);
    const destinationCalendar = store.upsertGoogleCalendar({ id: "primary", summary: "Destination" }, destination.accountId);
    store.dispatch("tasks", "create", { listId: sourceList.id, title: "Copy task" });
    store.dispatch("calendar", "create", {
      calendarId: store.upsertGoogleCalendar({ id: "source-calendar", summary: "Source" }, source.accountId).id,
      title: "Copy event", startsAt: "2027-01-02T09:00:00.000Z", endsAt: "2027-01-02T10:00:00.000Z",
      guestEmails: ["guest@example.test"], conferenceCreateRequest: { type: "hangoutsMeet" }, attachments: [{ fileUrl: "https://drive.google.com/open?id=brief", title: "Brief" }]
    });
    const preview = store.previewCrossAccountCopy({ sourceAccountId: source.accountId, destinationAccountId: destination.accountId, destinationCalendarId: destinationCalendar.id });
    expect(preview).toMatchObject({ tasks: 1, events: 1 });
    const copied = store.copyCrossAccountData({ sourceAccountId: source.accountId, destinationAccountId: destination.accountId, destinationCalendarId: destinationCalendar.id, confirmation: "COPY" });
    expect(copied.copied).toMatchObject({ tasks: 1, events: 1 });
    const destinationEvent = store.dispatch("calendar", "listEvents", { start: "2027-01-02T00:00:00.000Z", end: "2027-01-03T00:00:00.000Z", limit: 20 }).items
      .find((item: { accountId: string; title: string }) => item.accountId === destination.accountId && item.title === "Copy event");
    expect(destinationEvent.attendees).toEqual([]);
    expect(destinationEvent.conference).toBeNull();
    expect(destinationEvent.attachments).toEqual([]);
  });
});
