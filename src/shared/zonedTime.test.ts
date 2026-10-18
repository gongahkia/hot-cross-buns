import { describe, expect, it } from "vitest";
import { currentZonedDay, zonedDayRange, zonedDateTimeIso } from "./zonedTime";

describe("calendar timezone boundaries", () => {
  it("loads the whole Singapore day and the whole Los Angeles day", () => {
    expect(zonedDayRange("2026-10-18", "Asia/Singapore")).toEqual({ start: "2026-10-17T16:00:00.000Z", end: "2026-10-18T16:00:00.000Z" });
    expect(zonedDayRange("2026-10-18", "America/Los_Angeles")).toEqual({ start: "2026-10-18T07:00:00.000Z", end: "2026-10-19T07:00:00.000Z" });
    expect(currentZonedDay("America/New_York", new Date("2026-10-18T02:00:00Z"))).toBe("2026-10-17");
  });
  it("uses 23 and 25 hour windows across daylight-saving changes", () => {
    const spring = zonedDayRange("2026-03-08", "America/New_York");
    const autumn = zonedDayRange("2026-11-01", "America/New_York");
    expect(Date.parse(spring.end) - Date.parse(spring.start)).toBe(23 * 3600000);
    expect(Date.parse(autumn.end) - Date.parse(autumn.start)).toBe(25 * 3600000);
    expect(zonedDateTimeIso("2026-10-18", 9, 30, "Asia/Singapore")).toBe("2026-10-18T01:30:00.000Z");
  });
});
