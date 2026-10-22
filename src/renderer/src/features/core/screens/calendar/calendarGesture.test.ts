import { describe, expect, it } from "vitest";
import type { CalendarEventViewModel } from "../../coreViewModels";
import { calendarGestureRange } from "./calendarGesture";

const event = (overrides: Partial<CalendarEventViewModel> = {}) => ({
  startsAt: "2027-03-13T14:00:00.000Z", endsAt: "2027-03-13T15:00:00.000Z", allDay: false,
  timeZone: "America/New_York", displayTimeZone: "America/New_York", ...overrides
} as CalendarEventViewModel);

describe("calendar gesture date arithmetic", () => {
  it("keeps the displayed wall clock and elapsed duration when moving across DST", () => {
    expect(calendarGestureRange(event(), "move", { day: "2027-03-13" }, { day: "2027-03-14" })).toEqual({
      startsAt: "2027-03-14T13:00:00.000Z", endsAt: "2027-03-14T14:00:00.000Z", allDay: false
    });
  });
  it("uses the display zone rather than the event's original timezone", () => {
    const result = calendarGestureRange(event({ displayTimeZone: "Asia/Singapore" }), "move", { day: "2027-03-13" }, { day: "2027-03-14" });
    expect(result.startsAt).toBe("2027-03-14T14:00:00.000Z");
  });
  it("moves a multi-day all-day bar by the grabbed date, preserving its exclusive end", () => {
    const result = calendarGestureRange(event({ allDay: true, startsAt: "2027-03-12T00:00:00Z", endsAt: "2027-03-16T00:00:00Z" }), "move", { day: "2027-03-14" }, { day: "2027-03-17" });
    expect(result).toEqual({ startsAt: "2027-03-15T00:00:00.000Z", endsAt: "2027-03-19T00:00:00.000Z", allDay: true });
  });
  it("resizes either end of an all-day bar and clamps to one day", () => {
    const item = event({ allDay: true, startsAt: "2027-03-12T00:00:00.000Z", endsAt: "2027-03-16T00:00:00.000Z" });
    expect(calendarGestureRange(item, "end", { day: "2027-03-15" }, { day: "2027-03-18" }).endsAt).toBe("2027-03-19T00:00:00.000Z");
    expect(calendarGestureRange(item, "start", { day: "2027-03-12" }, { day: "2027-03-20" }).startsAt).toBe("2027-03-15T00:00:00.000Z");
  });
  it("preserves the grab offset when moving a timed event across midnight", () => {
    const result = calendarGestureRange(event(), "move", { day: "2027-03-13", minutes: 570 }, { day: "2027-03-14", minutes: 15 });
    expect(result.startsAt).toBe("2027-03-14T04:45:00.000Z");
    expect(Date.parse(result.endsAt) - Date.parse(result.startsAt)).toBe(3600000);
  });
  it("normalizes keyboard resizing through midnight", () => {
    const item = event({ startsAt: "2027-03-13T00:00:00Z", endsAt: "2027-03-13T01:00:00Z", displayTimeZone: "UTC" });
    expect(calendarGestureRange(item, "start", { day: "2027-03-13", minutes: 0 }, { day: "2027-03-13", minutes: -15 }).startsAt).toBe("2027-03-12T23:45:00.000Z");
  });
  it("resizes the start without moving the end, with a minimum timed duration", () => {
    const result = calendarGestureRange(event(), "start", { day: "2027-03-13", minutes: 540 }, { day: "2027-03-13", minutes: 615 });
    expect(result.startsAt).toBe("2027-03-13T14:45:00.000Z");
    expect(result.endsAt).toBe(event().endsAt);
  });
});
