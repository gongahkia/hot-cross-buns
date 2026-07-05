import { describe, expect, it } from "vitest";
import { searchPlannerCache, summarizeCache } from "./search";
import type { PlannerCache } from "./types";

const cache: PlannerCache = {
  fetchedAt: "2026-07-05T00:00:00.000Z",
  windowStart: "2026-06-05T00:00:00.000Z",
  windowEnd: "2027-01-01T00:00:00.000Z",
  taskLists: [{ id: "list-1", title: "Inbox" }],
  calendars: [{ id: "cal-1", title: "Work", primary: true, selected: true }],
  tasks: [{
    id: "task-1",
    listId: "list-1",
    listTitle: "Inbox",
    title: "Ship browser extension",
    notes: "OAuth PKCE",
    dueAt: "2026-07-05T00:00:00.000Z",
    sourceUrl: "https://tasks.google.com/"
  }],
  events: [{
    id: "event-1",
    calendarId: "cal-1",
    calendarTitle: "Work",
    title: "Calendar review",
    location: "Zoom",
    startsAt: "2026-07-06T02:00:00.000Z",
    endsAt: "2026-07-06T03:00:00.000Z",
    allDay: false
  }]
};

describe("browser extension search", () => {
  it("summarizes cached task and event counts", () => {
    expect(summarizeCache(cache)).toMatchObject({
      taskCount: 1,
      eventCount: 1
    });
  });

  it("searches across tasks and events", () => {
    const results = searchPlannerCache(cache, {
      query: "calendar",
      filter: "all",
      now: new Date("2026-07-05T00:00:00.000Z")
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ kind: "event", title: "Calendar review" });
  });

  it("filters today results", () => {
    const results = searchPlannerCache(cache, {
      query: "",
      filter: "today",
      now: new Date("2026-07-05T12:00:00.000Z")
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ kind: "task" });
  });
});
