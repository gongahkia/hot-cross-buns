import { describe, expect, it } from "vitest";
import { inCalendarRanges, maximumCalendarRanges, retainCalendarRange } from "./calendarRangeCache";

describe("Calendar cache", () => {
  it("evicts old months even when every requested month is adjacent", () => {
    let ranges: Array<{ start: string; end: string }> = [];
    const events: Array<{ startsAt: string; endsAt: string }> = [];
    for (let month = 0; month < 24; month += 1) {
      const range = { start: new Date(Date.UTC(2026, month, 1)).toISOString(), end: new Date(Date.UTC(2026, month + 1, 1)).toISOString() };
      ranges = retainCalendarRange(ranges, range);
      events.push({ startsAt: range.start, endsAt: new Date(Date.parse(range.start) + 3600_000).toISOString() });
    }
    expect(ranges).toHaveLength(maximumCalendarRanges);
    expect(events.filter((event) => inCalendarRanges(event, ranges))).toHaveLength(maximumCalendarRanges);
    expect(inCalendarRanges(events[0], ranges)).toBe(false);
    expect(inCalendarRanges(events.at(-1)!, ranges)).toBe(true);
  });
});
