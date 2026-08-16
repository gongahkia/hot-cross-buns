import { describe, expect, it } from "vitest";

import {
  calendarResultKind,
  calendarSearchDocument,
  searchCalendarHistory
} from "@/features/calendarSearch";
import { parsePaletteQuery } from "@/features/paletteFilters";

describe("calendarSearch", () => {
  const planning = calendarSearchDocument({
    id: "planning",
    calendarId: "primary",
    summary: "Launch planning",
    description: "Review the roadmap",
    start: { dateTime: "2023-08-16T09:00:00.000Z" },
    end: { dateTime: "2023-08-16T10:00:00.000Z" }
  });
  const series = calendarSearchDocument({
    id: "standup",
    calendarId: "primary",
    summary: "Daily standup",
    start: { dateTime: "2020-08-16T09:00:00.000Z" },
    end: { dateTime: "2020-08-16T10:00:00.000Z" },
    recurrence: ["RRULE:FREQ=DAILY"]
  });

  it("ranks title matches before explicit body matches and excludes cancelled events", () => {
    const cancelled = calendarSearchDocument({
      id: "cancelled",
      calendarId: "primary",
      summary: "Roadmap review",
      status: "cancelled",
      start: { dateTime: "2022-08-16T09:00:00.000Z" },
      end: { dateTime: "2022-08-16T10:00:00.000Z" }
    });
    expect(planning).toBeDefined();
    expect(series).toBeDefined();
    expect(cancelled).toBeUndefined();

    expect(searchCalendarHistory([planning!, series!], "launch", false)).toMatchObject([
      { document: { id: "primary:planning" } }
    ]);
    expect(searchCalendarHistory([planning!, series!], "roadmap", false)).toEqual([]);
    expect(searchCalendarHistory([planning!, series!], "roadmap", true)).toMatchObject([
      { document: { id: "primary:planning" } }
    ]);
  });

  it("labels recurring series without choosing an arbitrary occurrence", () => {
    expect(calendarResultKind(series!.event)).toBe("Recurring series");
  });

  it("filters the canonical index before ranking rather than materializing recurring occurrences", () => {
    const filters = parsePaletteQuery("type:event date:2020-08-16").filters;
    expect(searchCalendarHistory([planning!, series!], "", false, 24, filters, { primary: "Primary" })).toMatchObject([
      { document: { id: "primary:standup" } }
    ]);
  });
});
