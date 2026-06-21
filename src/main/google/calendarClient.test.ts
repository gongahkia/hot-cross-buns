import { describe, expect, it, vi } from "vitest";
import { GoogleCalendarHttpAdapter } from "./calendarClient";
import type { GoogleApiTransport } from "./transport";

function transportWithEvents(items: unknown[]): GoogleApiTransport {
  const getJson = async <T,>(request: Parameters<GoogleApiTransport["getJson"]>[0]): Promise<T> => {
    if (request.path === "/calendar/v3/users/me/calendarList") {
      return {
        items: [
          {
            id: "primary",
            summary: "Primary",
            timeZone: "UTC",
            selected: true,
            primary: true
          }
        ]
      } as T;
    }

    return {
      items,
      nextSyncToken: "sync-token"
    } as T;
  };

  return {
    getJson,
    getJsonWithMetadata: vi.fn(),
    send: vi.fn()
  };
}

describe("Google Calendar mapping", () => {
  it("uses CalendarList fields accepted by the Google Calendar API", async () => {
    const getJsonCalls: Parameters<GoogleApiTransport["getJson"]>[0][] = [];
    const getJson = async <T,>(request: Parameters<GoogleApiTransport["getJson"]>[0]): Promise<T> => {
      getJsonCalls.push(request);

      return { items: [] } as T;
    };
    const adapter = new GoogleCalendarHttpAdapter({
      getJson,
      getJsonWithMetadata: vi.fn(),
      send: vi.fn()
    });

    await adapter.listCalendarLists();

    expect(getJsonCalls[0]).toMatchObject({
      path: "/calendar/v3/users/me/calendarList",
      query: {
        fields:
          "items(id,summary,description,timeZone,backgroundColor,foregroundColor,selected,hidden,primary,accessRole,etag)"
      }
    });
    expect(String(getJsonCalls[0]?.query?.fields)).not.toContain("updated");
  });

  it("maps timed and all-day events without exposing raw payloads", async () => {
    const adapter = new GoogleCalendarHttpAdapter(
      transportWithEvents([
        {
          id: "timed-1",
          summary: "Timed review",
          description: "Line one<br>Line two",
          location: "Room 2",
          colorId: "9",
          status: "confirmed",
          start: { dateTime: "2026-05-22T09:00:00+08:00", timeZone: "Asia/Singapore" },
          end: { dateTime: "2026-05-22T10:00:00+08:00", timeZone: "Asia/Singapore" },
          attendees: [{ email: "ADA@example.com" }, { email: "ada@example.com" }],
          reminders: {
            overrides: [
              { method: "popup", minutes: 10 },
              { method: "email", minutes: 30 },
              { method: "sms", minutes: 5 }
            ]
          },
          updated: "2026-05-22T00:00:00.000Z"
        },
        {
          id: "all-day-1",
          summary: "All-day freeze",
          eventType: "birthday",
          start: { date: "2026-05-23" },
          end: { date: "2026-05-24" },
          updated: "2026-05-22T00:00:00.000Z"
        }
      ])
    );

    const page = await adapter.listEvents({
      calendarId: "primary",
      defaultTimeZone: "UTC"
    });

    expect(page.events).toEqual([
      expect.objectContaining({
        id: "timed-1",
        summary: "Timed review",
        description: "Line one\nLine two",
        colorId: "9",
        startAt: "2026-05-22T01:00:00.000Z",
        endAt: "2026-05-22T02:00:00.000Z",
        isAllDay: false,
        attendeeEmails: ["ada@example.com"],
        reminderMinutes: [10, 30]
      }),
      expect.objectContaining({
        id: "all-day-1",
        hcbKind: "birthday",
        startAt: "2026-05-23T00:00:00.000Z",
        endAt: "2026-05-24T00:00:00.000Z",
        isAllDay: true
      })
    ]);
    expect(JSON.stringify(page.events)).not.toContain("<br>");
  });

  it("requests Google birthday event metadata", async () => {
    const getJsonCalls: Parameters<GoogleApiTransport["getJson"]>[0][] = [];
    const getJson = async <T,>(request: Parameters<GoogleApiTransport["getJson"]>[0]): Promise<T> => {
      getJsonCalls.push(request);

      return { items: [], nextSyncToken: "sync-token" } as T;
    };
    const adapter = new GoogleCalendarHttpAdapter({
      getJson,
      getJsonWithMetadata: vi.fn(),
      send: vi.fn()
    });

    await adapter.listEvents({ calendarId: "primary", defaultTimeZone: "UTC" });

    expect(String(getJsonCalls[0]?.query?.fields)).toContain("eventType");
    expect(String(getJsonCalls[0]?.query?.fields)).toContain("birthdayProperties");
  });

  it("preserves Google HTML description blocks and lists as markdown", async () => {
    const adapter = new GoogleCalendarHttpAdapter(
      transportWithEvents([
        {
          id: "formatted-1",
          summary: "Formatted notes",
          description:
            "<p>If I can do either of the below</p><ol><li><b>Full-time</b> @ MHA from 17 Aug</li><li><b>Part-time</b> @ MHA 3-4 days</li></ol><p>See <a href=\"https://example.com/a?x=1&amp;y=2\">docs</a></p>",
          start: { date: "2026-05-23" },
          end: { date: "2026-05-24" },
          updated: "2026-05-22T00:00:00.000Z"
        }
      ])
    );

    const page = await adapter.listEvents({
      calendarId: "primary",
      defaultTimeZone: "UTC"
    });

    expect(page.events[0]).toMatchObject({
      description:
        "If I can do either of the below\n\n1. **Full-time** @ MHA from 17 Aug\n2. **Part-time** @ MHA 3-4 days\n\nSee [docs](https://example.com/a?x=1&y=2)"
    });
    expect(JSON.stringify(page.events)).not.toContain("<ol>");
  });

  it("preserves recurring instance metadata from Google mirrors", async () => {
    const adapter = new GoogleCalendarHttpAdapter(
      transportWithEvents([
        {
          id: "series_20260522T010000Z",
          recurringEventId: "series",
          originalStartTime: { dateTime: "2026-05-22T01:00:00Z" },
          summary: "Daily sync",
          start: { dateTime: "2026-05-22T01:00:00Z" },
          end: { dateTime: "2026-05-22T01:30:00Z" }
        }
      ])
    );

    await expect(
      adapter.listEvents({
        calendarId: "primary",
        defaultTimeZone: "UTC"
      })
    ).resolves.toMatchObject({
      events: [
        {
          id: "series_20260522T010000Z",
          recurringEventId: "series",
          originalStartAt: "2026-05-22T01:00:00.000Z"
        }
      ]
    });
  });

  it("writes event color ids to Google mutations", async () => {
    const getJsonCalls: Parameters<GoogleApiTransport["getJson"]>[0][] = [];
    const getJson: GoogleApiTransport["getJson"] = async <T,>(
      request: Parameters<GoogleApiTransport["getJson"]>[0]
    ): Promise<T> => {
      getJsonCalls.push(request);

      return {
        id: "event-1",
        summary: "Design review",
        colorId: "9",
        start: { dateTime: "2026-05-22T09:00:00.000Z" },
        end: { dateTime: "2026-05-22T10:00:00.000Z" }
      } as T;
    };
    const adapter = new GoogleCalendarHttpAdapter({
      getJson,
      getJsonWithMetadata: vi.fn(),
      send: vi.fn()
    });

    await expect(
      adapter.insertEvent("primary", {
        summary: "Design review",
        startAt: "2026-05-22T09:00:00.000Z",
        endAt: "2026-05-22T10:00:00.000Z",
        isAllDay: false,
        colorId: "9"
      })
    ).resolves.toMatchObject({ colorId: "9" });

    expect(getJsonCalls[0]).toMatchObject({
      method: "POST",
      body: expect.objectContaining({ colorId: "9" })
    });
    expect(String(getJsonCalls[0]?.query?.fields)).toContain("colorId");
  });

  it("keeps normal event updates on the default event payload", async () => {
    const getJsonCalls: Parameters<GoogleApiTransport["getJson"]>[0][] = [];
    const getJson: GoogleApiTransport["getJson"] = async <T,>(
      request: Parameters<GoogleApiTransport["getJson"]>[0]
    ): Promise<T> => {
      getJsonCalls.push(request);

      return {
        id: "event-1",
        summary: "Design review",
        start: { dateTime: "2026-05-22T09:00:00.000Z" },
        end: { dateTime: "2026-05-22T10:00:00.000Z" }
      } as T;
    };
    const adapter = new GoogleCalendarHttpAdapter({
      getJson,
      getJsonWithMetadata: vi.fn(),
      send: vi.fn()
    });

    await adapter.updateEvent({
      calendarId: "primary",
      eventId: "event-1",
      summary: "Design review",
      startAt: "2026-05-22T09:00:00.000Z",
      endAt: "2026-05-22T10:00:00.000Z",
      isAllDay: false,
      location: "Room 3",
      attendeeEmails: ["ada@example.com"]
    });

    expect(getJsonCalls[0]).toMatchObject({
      method: "PATCH",
      body: expect.objectContaining({
        summary: "Design review",
        location: "Room 3",
        attendees: [{ email: "ada@example.com" }]
      })
    });
    expect(JSON.stringify(getJsonCalls[0]?.body)).not.toContain("eventType");
  });

  it("writes birthday creates with a strict Google birthday payload", async () => {
    const getJsonCalls: Parameters<GoogleApiTransport["getJson"]>[0][] = [];
    const getJson: GoogleApiTransport["getJson"] = async <T,>(
      request: Parameters<GoogleApiTransport["getJson"]>[0]
    ): Promise<T> => {
      getJsonCalls.push(request);

      return {
        id: "birthday-1",
        eventType: "birthday",
        summary: "Alex",
        colorId: "5",
        start: { date: "2026-06-01" },
        end: { date: "2026-06-02" },
        recurrence: ["RRULE:FREQ=YEARLY"]
      } as T;
    };
    const adapter = new GoogleCalendarHttpAdapter({
      getJson,
      getJsonWithMetadata: vi.fn(),
      send: vi.fn()
    });

    await adapter.insertEvent("primary", {
      hcbKind: "birthday",
      summary: "Alex",
      description: "task-backed note bodies must not leak",
      location: "local-only location",
      startAt: "2026-06-01T00:00:00.000Z",
      endAt: "2026-06-02T00:00:00.000Z",
      isAllDay: true,
      recurrenceRule: "RRULE:FREQ=YEARLY",
      colorId: "5",
      attendeeEmails: ["ada@example.com"],
      reminderMinutes: [15]
    });

    expect(getJsonCalls[0]).toMatchObject({
      method: "POST",
      body: {
        eventType: "birthday",
        summary: "Alex",
        start: { date: "2026-06-01" },
        end: { date: "2026-06-02" },
        recurrence: ["RRULE:FREQ=YEARLY"],
        transparency: "transparent",
        visibility: "private",
        colorId: "5",
        reminders: {
          useDefault: false,
          overrides: [{ method: "popup", minutes: 15 }]
        }
      }
    });
    expect(JSON.stringify(getJsonCalls[0]?.body)).not.toContain("birthdayProperties");
    expect(JSON.stringify(getJsonCalls[0]?.body)).not.toContain("local-only");
    expect(JSON.stringify(getJsonCalls[0]?.body)).not.toContain("ada@example.com");
  });

  it("writes birthday updates without immutable or unsupported fields", async () => {
    const getJsonCalls: Parameters<GoogleApiTransport["getJson"]>[0][] = [];
    const getJson: GoogleApiTransport["getJson"] = async <T,>(
      request: Parameters<GoogleApiTransport["getJson"]>[0]
    ): Promise<T> => {
      getJsonCalls.push(request);

      return {
        id: "birthday-1",
        eventType: "birthday",
        summary: "Alex",
        start: { date: "2026-06-03" },
        end: { date: "2026-06-04" },
        recurrence: ["RRULE:FREQ=YEARLY"]
      } as T;
    };
    const adapter = new GoogleCalendarHttpAdapter({
      getJson,
      getJsonWithMetadata: vi.fn(),
      send: vi.fn()
    });

    await adapter.updateEvent({
      hcbKind: "birthday",
      calendarId: "primary",
      eventId: "birthday-1",
      summary: "Alex",
      description: "task-backed note bodies must not leak",
      location: "local-only location",
      startAt: "2026-06-03T00:00:00.000Z",
      endAt: "2026-06-04T00:00:00.000Z",
      isAllDay: true,
      attendeeEmails: ["ada@example.com"],
      reminderMinutes: []
    });

    expect(getJsonCalls[0]).toMatchObject({
      method: "PATCH",
      body: {
        summary: "Alex",
        start: { date: "2026-06-03" },
        end: { date: "2026-06-04" },
        recurrence: ["RRULE:FREQ=YEARLY"],
        transparency: "transparent",
        visibility: "private",
        reminders: {
          useDefault: false,
          overrides: []
        }
      }
    });
    expect(JSON.stringify(getJsonCalls[0]?.body)).not.toContain("eventType");
    expect(JSON.stringify(getJsonCalls[0]?.body)).not.toContain("birthdayProperties");
    expect(JSON.stringify(getJsonCalls[0]?.body)).not.toContain("local-only");
    expect(JSON.stringify(getJsonCalls[0]?.body)).not.toContain("ada@example.com");
  });
});
