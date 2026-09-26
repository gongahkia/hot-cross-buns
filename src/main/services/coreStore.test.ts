import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CoreStore } from "./coreStore";
import { withHcbTaskMetadata } from "./hcbTaskMetadata";

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

  it("uses Google recurrence lines as the canonical Calendar recurrence model", () => {
    const store = createStore();
    const account = store.upsertGoogleAccount({ id: "google-a", email: "a@example.test", connectionState: "connected" });
    const calendar = store.upsertGoogleCalendar({ id: "primary", summary: "Primary", timeZone: "Asia/Singapore" }, account.accountId);
    const rawRecurrence = [
      "RRULE:FREQ=YEARLY;BYMONTH=1,7;BYDAY=MO;BYSETPOS=1;WKST=SU",
      "EXDATE:20270105T010000Z,20270705T010000Z",
      "RDATE:20261231T010000Z"
    ];
    const event = store.upsertGoogleEvent({
      id: "complex-series",
      summary: "Complex remote series",
      start: { dateTime: "2026-09-26T09:00:00+08:00", timeZone: "Asia/Singapore" },
      end: { dateTime: "2026-09-26T10:00:00+08:00", timeZone: "Asia/Singapore" },
      recurrence: rawRecurrence
    }, calendar.id)!;

    expect(store.googleEventForSync(event.id)?.googleRecurrence).toEqual(rawRecurrence);
    expect(store.dispatch("calendar", "get", { id: event.id }).recurrenceLines).toEqual(rawRecurrence);
    store.dispatch("calendar", "update", { id: event.id, title: "Renamed in HCB" });
    expect(store.googleEventForSync(event.id)?.googleRecurrence).toEqual(rawRecurrence);

    const editedLines = [
      "RRULE:FREQ=MONTHLY;BYMONTHDAY=1,-1;BYSETPOS=1;WKST=MO",
      "EXRULE:FREQ=YEARLY;BYMONTH=12",
      "EXDATE;TZID=Asia/Singapore:20270101T090000",
      "RDATE;TZID=Asia/Singapore:20270102T090000"
    ];
    store.dispatch("calendar", "update", { id: event.id, recurrenceLines: editedLines });
    expect(store.googleEventForSync(event.id)?.recurrenceLines).toEqual(editedLines);
    expect(store.dispatch("calendar", "get", { id: event.id }).recurrenceLines).toEqual(editedLines);

    expect(() => store.dispatch("calendar", "update", {
      id: event.id,
      recurrenceLines: ["DTSTART:20270101T090000Z", "RRULE:FREQ=DAILY"]
    })).toThrow("Google recurrence lines must be RRULE, EXRULE, RDATE, or EXDATE properties");
  });

  it("queues one coordinated future-series split and partitions advanced recurrence lines locally", () => {
    const store = createStore();
    const account = store.upsertGoogleAccount({ id: "google-a", email: "a@example.test", connectionState: "connected" });
    const calendar = store.upsertGoogleCalendar({ id: "primary", summary: "Primary", timeZone: "Asia/Singapore" }, account.accountId);
    const master = store.upsertGoogleEvent({
      id: "remote-master",
      etag: "master-etag",
      summary: "Daily planning",
      start: { dateTime: "2026-03-01T09:00:00+08:00", timeZone: "Asia/Singapore" },
      end: { dateTime: "2026-03-01T10:00:00+08:00", timeZone: "Asia/Singapore" },
      recurrence: [
        "RRULE:FREQ=DAILY;COUNT=5",
        "RDATE;TZID=Asia/Singapore:20260302T090000,20260306T090000",
        "EXDATE;TZID=Asia/Singapore:20260302T090000,20260305T090000"
      ]
    }, calendar.id)!;
    const exception = store.upsertGoogleEvent({
      id: "remote-exception",
      etag: "exception-etag",
      recurringEventId: "remote-master",
      originalStartTime: { dateTime: "2026-03-03T09:00:00+08:00", timeZone: "Asia/Singapore" },
      summary: "Moved planning",
      start: { dateTime: "2026-03-03T11:00:00+08:00", timeZone: "Asia/Singapore" },
      end: { dateTime: "2026-03-03T12:00:00+08:00", timeZone: "Asia/Singapore" }
    }, calendar.id)!;

    const successor = store.dispatch("calendar", "update", {
      id: exception.id,
      scope: "following",
      title: "Future planning"
    });

    expect(store.dispatch("calendar", "get", { id: master.id }).recurrenceLines).toEqual([
      "RRULE:FREQ=DAILY;UNTIL=20260303T005959Z",
      "RDATE;TZID=Asia/Singapore:20260302T090000",
      "EXDATE;TZID=Asia/Singapore:20260302T090000"
    ]);
    expect(successor).toMatchObject({
      title: "Future planning",
      startsAt: "2026-03-03T03:00:00.000Z",
      recurrenceLines: [
        "RRULE:FREQ=DAILY;COUNT=3",
        "RDATE;TZID=Asia/Singapore:20260306T090000",
        "EXDATE;TZID=Asia/Singapore:20260305T090000"
      ]
    });
    const mutations = store.pendingSyncMutations();
    expect(mutations.filter((mutation) => mutation.kind === "event.splitSeries")).toEqual([
      expect.objectContaining({
        entityId: master.id,
        payload: expect.objectContaining({
          parentEventId: master.id,
          successorEventId: successor.id,
          futureExceptionIds: [exception.id]
        })
      })
    ]);
    expect(mutations.some((mutation) => mutation.kind === "event.create" || mutation.kind === "event.update")).toBe(false);
  });

  it("projects Google recurrence masters into the requested window and edits a generated instance as an exception", () => {
    const store = createStore();
    const account = store.upsertGoogleAccount({ id: "google-a", email: "a@example.test", connectionState: "connected" });
    const calendar = store.upsertGoogleCalendar({ id: "primary", summary: "Primary", timeZone: "Asia/Singapore" }, account.accountId);
    const master = store.upsertGoogleEvent({
      id: "weekly-master",
      summary: "Weekly planning",
      start: { dateTime: "2026-03-01T09:00:00+08:00", timeZone: "Asia/Singapore" },
      end: { dateTime: "2026-03-01T10:00:00+08:00", timeZone: "Asia/Singapore" },
      recurrence: ["RRULE:FREQ=DAILY;COUNT=5"]
    }, calendar.id)!;

    const projected = store.dispatch("calendar", "listEvents", {
      start: "2026-03-03T00:00:00.000Z", end: "2026-03-05T00:00:00.000Z", limit: 20
    }).items;
    expect(projected).toHaveLength(2);
    expect(projected).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: `recurrence:${master.id}:2026-03-03T01:00:00.000Z`,
        eventId: master.id,
        recurringEventId: "weekly-master",
        originalStartAt: "2026-03-03T01:00:00.000Z"
      })
    ]));

    const edited = store.dispatch("calendar", "update", {
      id: master.id,
      originalStartAt: "2026-03-03T01:00:00.000Z",
      scope: "occurrence",
      title: "Moved one planning session",
      startsAt: "2026-03-03T03:00:00.000Z",
      endsAt: "2026-03-03T04:00:00.000Z"
    });
    expect(edited).toMatchObject({
      title: "Moved one planning session",
      googleRecurringEventId: "weekly-master",
      googleOriginalStartTime: "2026-03-03T01:00:00.000Z"
    });
    expect(store.pendingSyncMutations()).toEqual([
      expect.objectContaining({
        kind: "event.updateOccurrence",
        entityId: edited.id,
        payload: { parentEventId: master.id, originalStartAt: "2026-03-03T01:00:00.000Z" }
      })
    ]);

    store.dispatch("calendar", "delete", {
      id: master.id,
      originalStartAt: "2026-03-04T01:00:00.000Z",
      scope: "occurrence"
    });
    expect(store.dispatch("calendar", "get", { id: master.id }).recurrenceLines)
      .toContain("EXDATE;TZID=Asia/Singapore:20260304T090000");
  });

  it("restores HCB-only task planning metadata from Google notes and keeps it across ordinary pulls", () => {
    const store = createStore();
    const account = store.upsertGoogleAccount({ id: "google-a", email: "a@example.test", connectionState: "connected" });
    const list = store.upsertGoogleTaskList({ id: "remote-list", title: "Tasks" }, account.accountId);
    const planning = {
      priority: "high",
      tags: ["release", "writing"],
      plannedStart: "2026-10-05T01:00:00.000Z",
      plannedEnd: "2026-10-05T02:30:00.000Z",
      durationMinutes: 90,
      lockedSchedule: true,
      snoozeUntil: "2026-10-04T01:00:00.000Z"
    };
    const task = store.upsertGoogleTask({
      id: "remote-task",
      title: "Draft release notes",
      notes: withHcbTaskMetadata("Visible Google note", planning),
      status: "needsAction"
    }, list.id)!;

    expect(task).toMatchObject({ notes: "Visible Google note", ...planning });
    const refreshed = store.upsertGoogleTask({
      id: "remote-task",
      title: "Draft release notes (renamed in Google)",
      notes: "Edited in Google without touching HCB metadata",
      status: "needsAction"
    }, list.id)!;
    expect(refreshed).toMatchObject({
      title: "Draft release notes (renamed in Google)",
      notes: "Edited in Google without touching HCB metadata",
      ...planning
    });
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
    expect(store.dispatch("notes", "entityLinks", { entityId: task.id, entityKind: "task" })).toEqual({
      outgoing: [], backlinks: [], broken: []
    });
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
    // Binding represents a create that Google already accepted. Mark the
    // queued create as delivered first, as the sync service would do.
    const createMutation = store.pendingSyncMutations(20, first.accountId).find((mutation) => mutation.entityId === event.id);
    if (!createMutation) throw new Error("Expected local event create mutation.");
    store.completeSyncMutation(createMutation.id);
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
