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
        startAt: "2026-05-22T01:00:00.000Z",
        endAt: "2026-05-22T02:00:00.000Z",
        isAllDay: false,
        attendeeEmails: ["ada@example.com"],
        reminderMinutes: [10, 30]
      }),
      expect.objectContaining({
        id: "all-day-1",
        startAt: "2026-05-23T00:00:00.000Z",
        endAt: "2026-05-24T00:00:00.000Z",
        isAllDay: true
      })
    ]);
    expect(JSON.stringify(page.events)).not.toContain("<br>");
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
});
