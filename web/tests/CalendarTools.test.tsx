import { describe, expect, it } from "vitest";

import { findFreeSlots } from "@/components/CalendarTools";

describe("findFreeSlots", () => {
  it("merges busy windows across calendars and returns usable openings", () => {
    const slots = findFreeSlots({
      timeMin: "2026-08-17T09:00:00.000Z",
      timeMax: "2026-08-17T13:00:00.000Z",
      calendars: {
        primary: { busy: [{ start: "2026-08-17T10:00:00.000Z", end: "2026-08-17T11:00:00.000Z" }] },
        team: { busy: [{ start: "2026-08-17T11:00:00.000Z", end: "2026-08-17T12:00:00.000Z" }] }
      }
    }, ["primary", "team"], 60);

    expect(slots).toEqual([
      { start: "2026-08-17T09:00:00.000Z", end: "2026-08-17T10:00:00.000Z" },
      { start: "2026-08-17T12:00:00.000Z", end: "2026-08-17T13:00:00.000Z" }
    ]);
  });
});
