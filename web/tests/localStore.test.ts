import { beforeEach, describe, expect, it } from "vitest";

import { LocalStore } from "@/data/localStore";

const subject = "google-subject-1";

describe("LocalStore", () => {
  let store: LocalStore;

  beforeEach(async () => {
    store = new LocalStore();
    await store.clearAll();
  });

  it("persists only browser-local workspace data partitioned by Google subject", async () => {
    await store.setClientId("1234567890-example.apps.googleusercontent.com");
    await store.setActiveSubject(subject);
    await store.saveSnapshot({
      identity: { subject, email: "person@example.test", name: "Person" },
      taskLists: [{ id: "list-1", title: "Inbox" }],
      tasks: [{ id: "task-1", listId: "list-1", title: "Local task", status: "needsAction" }],
      calendars: [{ id: "calendar-1", summary: "Primary", primary: true }],
      events: [{
        id: "event-1",
        calendarId: "calendar-1",
        summary: "Planning",
        start: { dateTime: "2026-08-16T09:00:00.000Z" },
        end: { dateTime: "2026-08-16T10:00:00.000Z" }
      }],
      updatedAt: "2026-08-16T00:00:00.000Z"
    });

    expect(await store.getClientId()).toContain("apps.googleusercontent.com");
    expect(await store.getActiveSubject()).toBe(subject);
    expect(await store.readSnapshot(subject)).toMatchObject({
      identity: { subject },
      tasks: [{ title: "Local task" }],
      events: [{ summary: "Planning" }]
    });
    expect(await store.readSnapshot("different-subject")).toBeUndefined();
  });

  it("clears the client configuration and all cached data", async () => {
    await store.setClientId("1234567890-example.apps.googleusercontent.com");
    await store.setActiveSubject(subject);
    await store.clearAll();

    expect(await store.getClientId()).toBeUndefined();
    expect(await store.getActiveSubject()).toBeUndefined();
    expect(await store.readSnapshot(subject)).toBeUndefined();
  });

  it("keeps cached Drive metadata partitioned by Google subject and retains prior local palette results", async () => {
    await store.saveDriveFiles(subject, [{
      id: "brief",
      name: "Launch brief",
      mimeType: "application/vnd.google-apps.document",
      webViewLink: "https://drive.example.test/brief"
    }]);
    await store.saveDriveFiles(subject, [{
      id: "roadmap",
      name: "Roadmap",
      mimeType: "application/vnd.google-apps.document",
      webViewLink: "https://drive.example.test/roadmap"
    }]);

    expect(await store.readDriveFiles(subject)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "brief", name: "Launch brief" }),
      expect.objectContaining({ id: "roadmap", name: "Roadmap" })
    ]));
    await expect(store.readDriveFiles("different-subject")).resolves.toEqual([]);
  });

  it("commits Calendar deltas and their token together while invalidating stale occurrences", async () => {
    await store.saveSnapshot({
      identity: { subject },
      taskLists: [],
      tasks: [],
      calendars: [{ id: "primary", summary: "Primary" }],
      events: [{
        id: "occurrence-1",
        calendarId: "primary",
        summary: "Old occurrence",
        start: { dateTime: "2026-08-16T09:00:00.000Z" },
        end: { dateTime: "2026-08-16T10:00:00.000Z" }
      }],
      updatedAt: "2026-08-16T00:00:00.000Z"
    });

    await store.applyCalendarEventChanges(subject, "primary", [{
      id: "series-1",
      calendarId: "primary",
      summary: "Updated series",
      start: { dateTime: "2026-08-16T09:00:00.000Z" },
      end: { dateTime: "2026-08-16T10:00:00.000Z" },
      recurrence: ["RRULE:FREQ=WEEKLY"]
    }], {
      resource: "calendar-events:primary",
      token: "next-token",
      updatedAt: "2026-08-16T01:00:00.000Z"
    });

    expect((await store.readSnapshot(subject))?.events).toEqual([]);
    await expect(store.readCheckpoint(subject, "calendar-events:primary")).resolves.toMatchObject({ token: "next-token" });
    await expect(store.readCanonicalEventSearchDocuments(subject)).resolves.toMatchObject([
      { id: "primary:series-1", title: "Updated series" }
    ]);
  });

  it("persists page-resume state while allowing occurrence cache recovery without discarding canonical events", async () => {
    await store.saveSnapshot({
      identity: { subject }, taskLists: [], tasks: [], calendars: [{ id: "primary", summary: "Primary" }],
      events: [{ id: "visible", calendarId: "primary", summary: "Visible", start: { dateTime: "2026-08-16T09:00:00.000Z" }, end: { dateTime: "2026-08-16T10:00:00.000Z" } }],
      updatedAt: "2026-08-16T00:00:00.000Z"
    });
    await store.applyCalendarEventPage(subject, "primary", [{ id: "series", calendarId: "primary", summary: "Canonical series", recurrence: ["RRULE:FREQ=DAILY"], start: { dateTime: "2020-08-16T09:00:00.000Z" }, end: { dateTime: "2020-08-16T10:00:00.000Z" } }], false);
    await store.saveCalendarSyncRun({
      subject, startedAt: "2026-08-16T00:00:00.000Z", phase: "calendar-events", calendarListReset: false,
      calendarIds: ["primary"], calendarIndex: 0, eventSyncToken: "sync-token", eventPageToken: "next-page", eventReset: false,
      changedCalendarIds: ["primary"], occurrenceCacheCleared: false, pagesSaved: 3, recordsSaved: 2500
    });

    await expect(store.readCalendarSyncRun(subject)).resolves.toMatchObject({ eventPageToken: "next-page", pagesSaved: 3 });
    await store.clearOccurrenceCache(subject);
    expect((await store.readSnapshot(subject))?.events).toEqual([]);
    await expect(store.readCanonicalEventSearchDocuments(subject)).resolves.toMatchObject([{ id: "primary:series" }]);
  });

  it("rebuilds the task mirror and restarts timestamp incrementality after a full refresh", async () => {
    await store.saveSnapshot({
      identity: { subject }, taskLists: [], tasks: [], calendars: [], events: [],
      updatedAt: "2026-08-16T00:00:00.000Z"
    });
    await store.replaceTaskMirror(
      subject,
      [{ id: "inbox", title: "Inbox" }],
      [{ id: "task-1", listId: "inbox", title: "Fresh task", status: "needsAction" }],
      "2026-08-16T02:00:00.000Z"
    );

    expect((await store.readSnapshot(subject))?.tasks).toMatchObject([{ id: "task-1", title: "Fresh task" }]);
    await expect(store.readCheckpoint(subject, "tasks:inbox")).resolves.toMatchObject({ updatedAt: "2026-08-16T02:00:00.000Z" });
  });
});
