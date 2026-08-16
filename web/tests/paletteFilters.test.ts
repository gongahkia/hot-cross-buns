import { describe, expect, it } from "vitest";

import {
  matchesEventFilters,
  matchesTaskFilters,
  parsePaletteQuery
} from "@/features/paletteFilters";

describe("paletteFilters", () => {
  it("parses typed filters while keeping a quoted source-calendar query and free text", () => {
    expect(parsePaletteQuery('type:event in:"Team Calendar" date:2026-08-01..2026-08-31 launch')).toEqual({
      text: "launch",
      filters: {
        types: ["event"],
        calendarQuery: "Team Calendar",
        date: { kind: "range", start: "2026-08-01", end: "2026-08-31" },
        due: undefined,
        completed: undefined
      },
      hasFilters: true
    });
  });

  it("keeps overdue results to incomplete tasks and combines due and completed state", () => {
    const filters = parsePaletteQuery("due:past completed:false").filters;
    expect(matchesTaskFilters({ id: "open", listId: "inbox", title: "Open", status: "needsAction", due: "2026-08-15T00:00:00.000Z" }, filters, "2026-08-16")).toBe(true);
    expect(matchesTaskFilters({ id: "done", listId: "inbox", title: "Done", status: "completed", due: "2026-08-15T00:00:00.000Z" }, filters, "2026-08-16")).toBe(false);
  });

  it("matches canonical events by local calendar context and a date window without expanding recurrences", () => {
    const filters = parsePaletteQuery('event:standup in:"Team Calendar" date:2026-08-01..2026-08-31').filters;
    expect(matchesEventFilters({
      id: "standup",
      calendarId: "team",
      summary: "Daily standup",
      recurrence: ["RRULE:FREQ=DAILY"],
      start: { date: "2026-08-16" },
      end: { date: "2026-08-17" }
    }, filters, "Team Calendar")).toBe(true);
  });
});
