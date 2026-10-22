import { describe, expect, it } from "vitest";
import {
  calendarAvailabilityHoldDrafts,
  calendarAvailabilityRange,
  calendarAvailabilitySlotsInRange,
  calendarAvailabilitySnippet,
  calendarLocalPoint,
  calendarTimeBlockLabel
} from "./calendarGrid";
import type { CalendarTimeBlock } from "./types";

const singaporeSlot: CalendarTimeBlock = {
  dayKey: "2026-10-02",
  endsAt: "2026-10-02T09:00:00.000Z",
  id: "singapore-13-17",
  startsAt: "2026-10-02T05:00:00.000Z"
};

describe("Share Availability time model", () => {
  it("formats canonical Singapore instants in the selected timezone for slots and snippets", () => {
    const selectedSlot = calendarTimeBlockLabel(singaporeSlot, "Asia/Singapore");
    const utcSlot = calendarTimeBlockLabel(singaporeSlot, "UTC");
    const snippet = calendarAvailabilitySnippet({
      durationMinutes: 30,
      slots: [singaporeSlot],
      timeZone: "Asia/Singapore",
      title: "Pairing"
    });

    expect(calendarLocalPoint(singaporeSlot.startsAt, "Asia/Singapore")).toEqual({
      dayKey: "2026-10-02",
      minutes: 13 * 60
    });
    expect(calendarLocalPoint(singaporeSlot.endsAt, "Asia/Singapore")).toEqual({
      dayKey: "2026-10-02",
      minutes: 17 * 60
    });
    expect(selectedSlot).toMatch(/\b2\b/);
    expect(selectedSlot).toContain("Oct");
    expect(selectedSlot).not.toEqual(utcSlot);
    expect(snippet).toContain(selectedSlot);
    expect(snippet).not.toContain(utcSlot);
  });

  it("uses the selected timezone's local date bounds, including a UTC date-boundary crossing", () => {
    const range = calendarAvailabilityRange("2026-10-02", "2026-10-02", "Asia/Singapore");

    expect(range).toEqual({
      start: "2026-10-01T16:00:00.000Z",
      end: "2026-10-02T16:00:00.000Z"
    });
    expect(calendarAvailabilitySlotsInRange([singaporeSlot], range!)).toEqual([singaporeSlot]);
    expect(calendarAvailabilitySlotsInRange([
      singaporeSlot,
      {
        dayKey: "2026-10-01",
        endsAt: "2026-10-01T16:15:00.000Z",
        id: "outside-before-start",
        startsAt: "2026-10-01T15:45:00.000Z"
      }
    ], range!)).toEqual([singaporeSlot]);
  });

  it("keeps local New York dates correct across the autumn DST transition", () => {
    const range = calendarAvailabilityRange("2026-11-01", "2026-11-01", "America/New_York");

    expect(range).toEqual({
      start: "2026-11-01T04:00:00.000Z",
      end: "2026-11-02T05:00:00.000Z"
    });
    expect(calendarLocalPoint(range!.start, "America/New_York").dayKey).toBe("2026-11-01");
    expect(calendarLocalPoint(range!.end, "America/New_York").dayKey).toBe("2026-11-02");
  });

  it("builds Create Holds drafts from the same canonical instants and selected timezone", () => {
    const [draft] = calendarAvailabilityHoldDrafts({
      calendarId: "primary",
      slots: [singaporeSlot],
      timeZone: "Asia/Singapore",
      title: "Team pairing"
    });

    expect(draft).toMatchObject({
      calendarId: "primary",
      endsAt: "2026-10-02T09:00:00.000Z",
      startsAt: "2026-10-02T05:00:00.000Z",
      timeZone: "Asia/Singapore",
      title: "Team pairing"
    });
    expect(calendarLocalPoint(draft.startsAt, draft.timeZone)).toEqual({
      dayKey: "2026-10-02",
      minutes: 13 * 60
    });
  });
});
