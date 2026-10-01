import { describe, expect, it } from "vitest";
import { calendarDraftRangeLabel, calendarEventPayload, editCalendarDraft, newCalendarDraft } from "./drafts";
import type { CalendarEventViewModel } from "../../coreViewModels";

describe("Calendar recurrence drafts", () => {
  it("keeps an imported Google RFC 5545 line set exact in the save payload", () => {
    const lines = [
      "RRULE:FREQ=YEARLY;BYMONTH=1,7;BYDAY=MO;BYSETPOS=1;WKST=SU",
      "EXRULE:FREQ=YEARLY;BYMONTH=12",
      "EXDATE;TZID=Asia/Singapore:20270105T090000",
      "RDATE;TZID=Asia/Singapore:20270106T090000"
    ];
    const event = {
      id: "event-1",
      eventId: "event-1",
      title: "Imported series",
      calendar: "Smoke calendar",
      calendarId: "calendar-1",
      colorId: null,
      startsAt: "2027-01-01T01:00:00.000Z",
      endsAt: "2027-01-01T02:00:00.000Z",
      timeLabel: "9:00 AM",
      rangeLabel: "9:00-10:00 AM",
      timeZone: "Asia/Singapore",
      allDay: false,
      location: "",
      notes: "",
      tags: [],
      guestEmails: [],
      reminderMinutes: [],
      attendees: [],
      reminders: [],
      remindersUseDefault: true,
      transparency: "opaque",
      visibility: "default",
      eventType: "default",
      focusTimeProperties: null,
      outOfOfficeProperties: null,
      workingLocationProperties: null,
      selfResponseStatus: null,
      attachments: [],
      conference: null,
      recurrenceLines: lines,
      recurrenceRule: lines[0]
    } satisfies CalendarEventViewModel;

    const draft = editCalendarDraft(event);

    expect(draft.recurrenceEditor).toBe("google");
    expect(calendarEventPayload(draft).recurrenceLines).toEqual(lines);
  });

  it("generates a canonical RRULE only when the user chooses simple controls", () => {
    const draft = newCalendarDraft({
      calendarSources: [{ id: "calendar-1", selected: true }]
    } as never);
    draft.repeatFrequency = "custom";
    draft.repeatCustomFrequency = "weekly";
    draft.repeatWeekdays = ["MO", "WE"];

    expect(calendarEventPayload(draft).recurrenceLines).toEqual([
      "RRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,WE"
    ]);
  });

  it("uses locale-facing dates rather than storage-date strings in event detail labels", () => {
    const draft = newCalendarDraft({
      calendarSources: [{ id: "calendar-1", selected: true }]
    } as never);
    draft.startsAt = "2026-10-01T07:00:00.000Z";
    draft.endsAt = "2026-10-01T08:30:00.000Z";

    expect(calendarDraftRangeLabel(draft, "UTC")).toContain("07:00–08:30");
    expect(calendarDraftRangeLabel(draft, "UTC")).not.toMatch(/2026-10-01/);
  });
});
