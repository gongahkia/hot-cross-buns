import { describe, expect, it } from "vitest";
import type { CalendarEventViewModel } from "../../coreViewModels";
import {
  buildCalendarEventDayIndex,
  calendarEventRangeDayKeys,
  calendarEventsForDay
} from "./calendarEventIndex";

function event(overrides: Partial<CalendarEventViewModel>): CalendarEventViewModel {
  return {
    allDay: false,
    attendees: [],
    attachments: [],
    calendar: "Personal",
    calendarId: "primary",
    conference: null,
    description: undefined,
    endsAt: "2026-10-01T01:00:00.000Z",
    eventId: "event",
    eventType: "default",
    focusTimeProperties: null,
    guestEmails: [],
    id: "event",
    location: "",
    notes: "",
    originalStartAt: null,
    rangeLabel: "",
    recurrenceLines: [],
    recurrenceRule: null,
    reminderMinutes: [],
    reminders: [],
    remindersUseDefault: true,
    selfResponseStatus: null,
    startsAt: "2026-10-01T00:00:00.000Z",
    timeLabel: "",
    timeZone: "UTC",
    title: "Test event",
    transparency: "opaque",
    visibility: "default",
    workingLocationProperties: null,
    outOfOfficeProperties: null,
    ...overrides
  } as CalendarEventViewModel;
}

describe("calendar event day index", () => {
  it("keeps an Agenda day isolated from events on other dates", () => {
    const october = event({ id: "october", eventId: "october", startsAt: "2026-10-01T01:00:00.000Z", endsAt: "2026-10-01T02:00:00.000Z" });
    const august = event({ id: "august", eventId: "august", startsAt: "2026-08-11T01:00:00.000Z", endsAt: "2026-08-11T02:00:00.000Z" });
    const index = buildCalendarEventDayIndex([october, august]);

    expect(calendarEventsForDay(index, "2026-10-01").map((item) => item.id)).toEqual(["october"]);
    expect(calendarEventsForDay(index, "2026-08-11").map((item) => item.id)).toEqual(["august"]);
  });

  it("uses a timed event's calendar timezone at an Asia/Singapore date boundary", () => {
    const overnight = event({
      id: "singapore-boundary",
      eventId: "singapore-boundary",
      startsAt: "2026-09-30T16:30:00.000Z",
      endsAt: "2026-09-30T17:30:00.000Z",
      timeZone: "Asia/Singapore"
    });

    expect(calendarEventRangeDayKeys(overnight)).toEqual(["2026-10-01"]);
  });

  it("treats all-day end dates as exclusive and includes every multi-day date", () => {
    const allDay = event({
      id: "all-day",
      eventId: "all-day",
      allDay: true,
      startsAt: "2026-10-01T00:00:00.000Z",
      endsAt: "2026-10-03T00:00:00.000Z"
    });

    expect(calendarEventRangeDayKeys(allDay)).toEqual(["2026-10-01", "2026-10-02"]);
  });
});
