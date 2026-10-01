import { describe, expect, it } from "vitest";
import type { CalendarEventViewModel } from "../../coreViewModels";
import { calendarTimelineEventLayouts } from "./calendarTimelineLayout";

function timedEvent(id: string, startsAt: string, endsAt: string): CalendarEventViewModel {
  return {
    allDay: false,
    attendees: [],
    attachments: [],
    calendar: "Personal",
    calendarId: "primary",
    conference: null,
    endsAt,
    eventId: id,
    eventType: "default",
    focusTimeProperties: null,
    guestEmails: [],
    id,
    location: "",
    notes: "",
    originalStartAt: null,
    outOfOfficeProperties: null,
    rangeLabel: "",
    recurrenceLines: [],
    recurrenceRule: null,
    reminderMinutes: [],
    reminders: [],
    remindersUseDefault: true,
    selfResponseStatus: null,
    startsAt,
    timeLabel: "",
    timeZone: "UTC",
    title: id,
    transparency: "opaque",
    visibility: "default",
    workingLocationProperties: null
  } as CalendarEventViewModel;
}

describe("calendar timed-event collision layout", () => {
  it("allows a continuing event to reclaim width after peak concurrency drops", () => {
    const events = [
      timedEvent("A", "2026-10-01T09:00:00.000Z", "2026-10-01T09:30:00.000Z"),
      timedEvent("B", "2026-10-01T09:00:00.000Z", "2026-10-01T09:30:00.000Z"),
      timedEvent("C", "2026-10-01T09:00:00.000Z", "2026-10-01T09:30:00.000Z"),
      timedEvent("D", "2026-10-01T09:00:00.000Z", "2026-10-01T10:00:00.000Z"),
      timedEvent("E", "2026-10-01T09:45:00.000Z", "2026-10-01T10:30:00.000Z")
    ];

    const layout = calendarTimelineEventLayouts(events, "2026-10-01", 64);
    const continuing = layout.find((item) => item.event.id === "D");
    const later = layout.find((item) => item.event.id === "E");

    expect(continuing?.segments).toEqual(expect.arrayContaining([
      expect.objectContaining({ startMinute: 540, laneCount: 4 }),
      expect.objectContaining({ startMinute: 570, laneCount: 1 }),
      expect.objectContaining({ startMinute: 585, laneCount: 2 })
    ]));
    expect(later?.segments).toEqual(expect.arrayContaining([
      expect.objectContaining({ startMinute: 600, laneCount: 1, laneIndex: 0 })
    ]));
  });
});
