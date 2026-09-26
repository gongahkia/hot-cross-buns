import { describe, expect, it, vi } from "vitest";
import { GoogleSyncService } from "./googleSync";
import { googleTaskNotesMaxLength } from "./hcbTaskMetadata";

function createService(): {
  deliverOutbox: ReturnType<typeof vi.fn>;
  pullGoogleCalendars: ReturnType<typeof vi.fn>;
  pullGoogleTasks: ReturnType<typeof vi.fn>;
  service: GoogleSyncService;
} {
  const store = {
    googleAccounts: () => [{ accountId: "test-account", connectionState: "connected" }],
    pendingSyncMutations: () => [],
    setSyncRuntime: vi.fn()
  };
  const oauth = { onConnectionChange: vi.fn() };
  const service = new GoogleSyncService(store as never, oauth as never);
  const internals = service as unknown as {
    deliverOutbox: ReturnType<typeof vi.fn>;
    pullGoogleCalendars: ReturnType<typeof vi.fn>;
    pullGoogleTasks: ReturnType<typeof vi.fn>;
  };

  internals.pullGoogleTasks = vi.fn(async () => undefined);
  internals.pullGoogleCalendars = vi.fn(async () => undefined);
  internals.deliverOutbox = vi.fn(async () => undefined);
  return { ...internals, service };
}

describe("GoogleSyncService", () => {
  it("pulls without draining the outbox in read-only mode", async () => {
    const { deliverOutbox, pullGoogleCalendars, pullGoogleTasks, service } = createService();

    await service.runNow({ accountId: "test-account", readOnly: true });

    expect(pullGoogleTasks).toHaveBeenCalledTimes(1);
    expect(pullGoogleCalendars).toHaveBeenCalledTimes(1);
    expect(deliverOutbox).not.toHaveBeenCalled();
  });

  it("keeps the normal pull-deliver-pull cycle outside read-only mode", async () => {
    const { deliverOutbox, pullGoogleCalendars, pullGoogleTasks, service } = createService();

    await service.runNow({ accountId: "test-account" });

    expect(pullGoogleTasks).toHaveBeenCalledTimes(2);
    expect(pullGoogleCalendars).toHaveBeenCalledTimes(2);
    expect(deliverOutbox).toHaveBeenCalledWith("test-account");
  });

  it("paginates Tasks and Calendar pulls and persists the latest event sync token", async () => {
    const requests: URL[] = [];
    const store = {
      googleAccounts: () => [{ accountId: "test-account", connectionState: "connected" }],
      pendingSyncMutations: () => [],
      setSyncRuntime: vi.fn(),
      upsertGoogleTaskList: vi.fn(() => ({ id: "local-list" })),
      isSelectedTaskList: vi.fn(() => true),
      upsertGoogleTask: vi.fn(),
      upsertGoogleCalendar: vi.fn(() => ({ id: "local-calendar", googleId: "primary" })),
      isSelectedCalendar: vi.fn(() => true),
      googleSyncToken: vi.fn(() => "old-sync-token"),
      setGoogleSyncToken: vi.fn(),
      upsertGoogleEvent: vi.fn()
    };
    const oauth = {
      onConnectionChange: vi.fn(),
      googleFetch: vi.fn(async (_accountId: string, target: URL) => {
        requests.push(target);
        if (target.hostname === "tasks.googleapis.com" && target.pathname.endsWith("/lists")) {
          return Response.json(target.searchParams.get("pageToken") ? { items: [{ id: "list-2", title: "Second" }] } : { items: [{ id: "list-1", title: "First" }], nextPageToken: "next-lists" });
        }
        if (target.hostname === "tasks.googleapis.com") return Response.json({ items: [{ id: `task-${target.searchParams.get("pageToken") ?? "first"}`, title: "Task" }] });
        if (target.pathname.endsWith("/calendarList")) return Response.json({ items: [{ id: "primary", summary: "Primary" }] });
        if (target.pathname.endsWith("/events")) {
          return Response.json(target.searchParams.get("pageToken")
            ? { items: [{ id: "event-2", summary: "Second", start: { dateTime: "2027-01-01T10:00:00Z" }, end: { dateTime: "2027-01-01T11:00:00Z" } }], nextSyncToken: "new-sync-token" }
            : { items: [{ id: "event-1", summary: "First", start: { dateTime: "2027-01-01T08:00:00Z" }, end: { dateTime: "2027-01-01T09:00:00Z" } }], nextPageToken: "next-events" });
        }
        throw new Error(`Unexpected ${target}`);
      })
    };
    const service = new GoogleSyncService(store as never, oauth as never);

    await service.runNow({ accountId: "test-account", readOnly: true });

    expect(store.upsertGoogleTask).toHaveBeenCalledTimes(2);
    expect(store.upsertGoogleEvent).toHaveBeenCalledTimes(2);
    expect(store.setGoogleSyncToken).toHaveBeenCalledWith("test-account", "events:primary", "new-sync-token");
    const eventRequests = requests.filter((target) => target.pathname.endsWith("/events"));
    expect(eventRequests).toHaveLength(2);
    expect(eventRequests[0]?.searchParams.get("syncToken")).toBe("old-sync-token");
    expect(eventRequests[1]?.searchParams.get("pageToken")).toBe("next-events");
  });

  it("sends the Calendar flags and body required for Meet, Drive attachments, and status events", async () => {
    const googleFetch = vi.fn(async (_accountId: string, _target: URL, _init?: RequestInit) => Response.json({ id: "remote-event", etag: "etag" }));
    const store = {
      googleEventForSync: () => ({
        id: "event-local-id",
        calendarGoogleId: "primary",
        title: "Focus block",
        description: "",
        startsAt: "2027-01-01T08:00:00.000Z",
        endsAt: "2027-01-01T09:00:00.000Z",
        allDay: false,
        remindersUseDefault: true,
        reminders: [],
        attendees: [],
        transparency: "opaque",
        visibility: "private",
        eventType: "focusTime",
        focusTimeProperties: { autoDeclineMode: "declineNone", chatStatus: "doNotDisturb" },
        attachmentsManaged: true,
        attachments: [{ fileUrl: "https://drive.google.com/open?id=file-1", title: "Brief", mimeType: "application/pdf" }],
        conferenceCreateRequested: true,
        conference: null
      }),
      bindGoogleEvent: vi.fn()
    };
    const oauth = { onConnectionChange: vi.fn(), googleFetch };
    const service = new GoogleSyncService(store as never, oauth as never) as unknown as {
      pushEvent: (accountId: string, localId: string) => Promise<void>;
    };

    await service.pushEvent("test-account", "event-local-id");

    const target = googleFetch.mock.calls[0]?.[1] as URL;
    const init = googleFetch.mock.calls[0]?.[2] as RequestInit;
    expect(target.searchParams.get("conferenceDataVersion")).toBe("1");
    expect(target.searchParams.get("supportsAttachments")).toBe("true");
    const body = JSON.parse(String(init.body));
    expect(body.eventType).toBe("focusTime");
    expect(body.focusTimeProperties.chatStatus).toBe("doNotDisturb");
    expect(body.attachments).toEqual([{ fileUrl: "https://drive.google.com/open?id=file-1", title: "Brief", mimeType: "application/pdf" }]);
    expect(body.conferenceData.createRequest.conferenceSolutionKey.type).toBe("hangoutsMeet");
  });

  it("sends every supported Google recurrence line unchanged", async () => {
    const rawRecurrence = [
      "RRULE:FREQ=YEARLY;BYMONTH=1,7;BYDAY=MO;BYSETPOS=1;WKST=SU",
      "EXRULE:FREQ=YEARLY;BYMONTH=12",
      "EXDATE:20270105T010000Z,20270705T010000Z",
      "RDATE:20261231T010000Z"
    ];
    const googleFetch = vi.fn(async (_accountId: string, _target: URL, _init?: RequestInit) => Response.json({ id: "remote-event", etag: "etag-2" }));
    const store = {
      googleEventForSync: () => ({
        id: "event-local-id",
        googleId: "remote-event",
        googleEtag: "etag-1",
        calendarGoogleId: "primary",
        title: "Rename only",
        description: "",
        startsAt: "2027-01-01T08:00:00.000Z",
        endsAt: "2027-01-01T09:00:00.000Z",
        allDay: false,
        recurrence: { frequency: "yearly", interval: 1, byDay: ["MO"] },
        recurrenceLines: rawRecurrence,
        remindersUseDefault: true,
        reminders: [],
        attendees: [],
        transparency: "opaque",
        visibility: "default",
        attachmentsManaged: false,
        conferenceCreateRequested: false
      }),
      bindGoogleEvent: vi.fn()
    };
    const oauth = { onConnectionChange: vi.fn(), googleFetch };
    const service = new GoogleSyncService(store as never, oauth as never) as unknown as {
      pushEvent: (accountId: string, localId: string) => Promise<void>;
    };

    await service.pushEvent("test-account", "event-local-id");

    const target = googleFetch.mock.calls[0]?.[1] as URL;
    const init = googleFetch.mock.calls[0]?.[2] as RequestInit;
    expect(target.pathname).toContain("/events/remote-event");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body)).recurrence).toEqual(rawRecurrence);
  });

  it("sends Google Tasks a valid due timestamp and omits an absent due date", async () => {
    const googleFetch = vi.fn(async (_accountId: string, _target: URL, _init?: RequestInit) => Response.json({ id: "remote-task", etag: "etag" }));
    const task = {
      id: "task-local-id",
      listGoogleId: "remote-list",
      title: "Ship smoke coverage",
      notes: "",
      status: "active",
      dueAt: "2026-10-01" as string | null
    };
    const store = {
      googleTaskForSync: vi.fn(() => task),
      bindGoogleTask: vi.fn()
    };
    const oauth = { onConnectionChange: vi.fn(), googleFetch };
    const service = new GoogleSyncService(store as never, oauth as never) as unknown as {
      pushTask: (accountId: string, localId: string, payload: Record<string, unknown>) => Promise<void>;
    };

    await service.pushTask("test-account", "task-local-id", {});
    const datedBody = JSON.parse(String((googleFetch.mock.calls[0]?.[2] as RequestInit).body));
    expect(datedBody).toMatchObject({ due: "2026-10-01T00:00:00.000Z", status: "needsAction", title: "Ship smoke coverage" });

    task.dueAt = null;
    await service.pushTask("test-account", "task-local-id", {});
    const undatedBody = JSON.parse(String((googleFetch.mock.calls[1]?.[2] as RequestInit).body));
    expect(undatedBody).not.toHaveProperty("due");
  });

  it("does not truncate a task note when HCB metadata would exceed Google's limit", async () => {
    const googleFetch = vi.fn();
    const store = {
      googleTaskForSync: vi.fn(() => ({
        id: "task-local-id", listGoogleId: "remote-list", title: "Keep every character",
        notes: "x".repeat(googleTaskNotesMaxLength), status: "active", priority: "high"
      })),
      bindGoogleTask: vi.fn()
    };
    const oauth = { onConnectionChange: vi.fn(), googleFetch };
    const service = new GoogleSyncService(store as never, oauth as never) as unknown as {
      pushTask: (accountId: string, localId: string, payload: Record<string, unknown>) => Promise<void>;
    };

    await expect(service.pushTask("test-account", "task-local-id", {}))
      .rejects.toThrow(`Google Tasks notes, including HCB planning metadata, are limited to ${googleTaskNotesMaxLength} characters.`);
    expect(googleFetch).not.toHaveBeenCalled();
  });
});
