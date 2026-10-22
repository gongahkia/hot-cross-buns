import { describe, expect, it } from "vitest";
import { calendarNavigationLimit } from "./calendarNavigationLimits";
import { calendarDayRange } from "./calendarViewportRange";

describe("calendar navigation bounds", () => {
  const settings = { eventRetentionDaysBack: 1, monthScrollFutureMonths: 1, defaultTimeZone: "America/Los_Angeles" };
  it("uses local midnight across DST and allows windows overlapping retained history", () => {
    const limit = (end: string) => calendarNavigationLimit({ start: "2026-03-07T08:00:00.000Z", end }, "2026-03-07", "week", settings, "2026-03-09");
    expect(limit("2026-03-08T08:00:00.000Z")?.direction).toBe(-1);
    expect(limit("2026-03-08T08:01:00.000Z")).toBeNull();
  });
  it("keeps the future limit specific to Month and supports unlimited history", () => {
    expect(calendarNavigationLimit(calendarDayRange("2026-05-01"), "2026-05-01", "month", settings, "2026-03-09")?.direction).toBe(1);
    expect(calendarNavigationLimit(calendarDayRange("2026-05-01"), "2026-05-01", "day", settings, "2026-03-09")).toBeNull();
    expect(calendarNavigationLimit(calendarDayRange("2025-01-01"), "2025-01-01", "day", { ...settings, eventRetentionDaysBack: 0 }, "2026-03-09")).toBeNull();
  });
});
