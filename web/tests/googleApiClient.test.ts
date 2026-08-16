import { describe, expect, it, vi } from "vitest";

import { GoogleApiClient, GoogleAuthorizationRequiredError } from "@/api/googleApiClient";

describe("GoogleApiClient", () => {
  it("requires a current in-memory token", async () => {
    const client = new GoogleApiClient(() => undefined);
    await expect(client.listTaskLists()).rejects.toBeInstanceOf(GoogleAuthorizationRequiredError);
  });

  it("paginates direct Google Tasks requests and sends the bearer token", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [{ id: "list-1", title: "Inbox" }], nextPageToken: "next" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [{ id: "list-2", title: "Later" }] })));
    vi.stubGlobal("fetch", fetchMock);
    const client = new GoogleApiClient(() => "memory-only-token");

    await expect(client.listTaskLists()).resolves.toEqual([
      { id: "list-1", title: "Inbox", updated: undefined },
      { id: "list-2", title: "Later", updated: undefined }
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1][0])).toContain("pageToken=next");
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get("Authorization")).toBe("Bearer memory-only-token");
    vi.unstubAllGlobals();
  });

  it("moves a task to a new list and preserves Google ordering parameters", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: "task-1",
      title: "Plan launch",
      status: "needsAction"
    })));
    vi.stubGlobal("fetch", fetchMock);
    const client = new GoogleApiClient(() => "memory-only-token");

    await expect(client.moveTask("inbox", "task-1", {
      destinationListId: "later",
      previous: "task-0"
    })).resolves.toMatchObject({ id: "task-1", listId: "later" });

    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("/tasks/v1/lists/inbox/tasks/task-1/move?");
    expect(url).toContain("destinationTasklist=later");
    expect(url).toContain("previous=task-0");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "POST" });
    vi.unstubAllGlobals();
  });

  it("uses the cached Calendar ETag for conditional event changes", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: "event-1",
      summary: "Planning",
      start: { dateTime: "2026-08-16T09:00:00.000Z" },
      end: { dateTime: "2026-08-16T10:00:00.000Z" }
    })));
    vi.stubGlobal("fetch", fetchMock);
    const client = new GoogleApiClient(() => "memory-only-token");

    await client.updateEvent("primary", "event-1", {
      summary: "Planning",
      start: { dateTime: "2026-08-16T09:00:00.000Z", timeZone: "Asia/Singapore" },
      end: { dateTime: "2026-08-16T10:00:00.000Z", timeZone: "Asia/Singapore" }
    }, '"version-1"');

    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "PATCH" });
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get("If-Match")).toBe('"version-1"');
    vi.unstubAllGlobals();
  });

  it("creates calendars, adds existing calendars, and sends free-busy requests directly to Google", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "planning", summary: "Planning", timeZone: "Asia/Singapore" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "team", summary: "Team", accessRole: "reader" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        timeMin: "2026-08-16T09:00:00.000Z",
        timeMax: "2026-08-16T10:00:00.000Z",
        calendars: { planning: { busy: [] } }
      })));
    vi.stubGlobal("fetch", fetchMock);
    const client = new GoogleApiClient(() => "memory-only-token");

    await expect(client.createCalendar({ summary: "Planning", timeZone: "Asia/Singapore" })).resolves.toMatchObject({ id: "planning" });
    await expect(client.subscribeCalendar("team")).resolves.toMatchObject({ id: "team", accessRole: "reader" });
    await expect(client.queryFreeBusy(["planning"], "2026-08-16T09:00:00.000Z", "2026-08-16T10:00:00.000Z", "Asia/Singapore")).resolves.toMatchObject({ calendars: { planning: { busy: [] } } });

    expect(String(fetchMock.mock.calls[0][0])).toContain("/calendar/v3/calendars");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "POST" });
    expect(String(fetchMock.mock.calls[1][0])).toContain("/calendar/v3/users/me/calendarList");
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({ id: "team" });
    expect(JSON.parse(String(fetchMock.mock.calls[2][1]?.body))).toMatchObject({
      timeZone: "Asia/Singapore",
      items: [{ id: "planning" }]
    });
    vi.unstubAllGlobals();
  });
});
