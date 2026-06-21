import { describe, expect, it } from "vitest";
import {
  googleCalendarSeriesId,
  isGoogleCalendarEventInstanceId,
  isPlausibleGuestEmail,
  normalizeGuestEmails
} from "./calendar";

describe("calendar domain helpers", () => {
  it("detects Google recurring instance ids and series roots", () => {
    expect(isGoogleCalendarEventInstanceId("abc123_20260420T090000Z")).toBe(true);
    expect(isGoogleCalendarEventInstanceId("abc123_20260420")).toBe(true);
    expect(isGoogleCalendarEventInstanceId("abc123")).toBe(false);
    expect(googleCalendarSeriesId("abc123_20260420T090000Z")).toBe("abc123");
    expect(googleCalendarSeriesId("abc123_20260420")).toBe("abc123");
    expect(googleCalendarSeriesId("abc123")).toBe("abc123");
  });

  it("validates and deduplicates guest emails", () => {
    expect(isPlausibleGuestEmail("first.last+team@example.co")).toBe(true);
    expect(isPlausibleGuestEmail("@channel")).toBe(false);
    expect(isPlausibleGuestEmail("no-at-sign.com")).toBe(false);
    expect(normalizeGuestEmails(["ADA@example.com", "ada@example.com", "bad paste"])).toEqual([
      "ada@example.com"
    ]);
  });
});
