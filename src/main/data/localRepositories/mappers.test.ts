import { describe, expect, it } from "vitest";
import { calendarEventSummarySchema } from "@shared/ipc/contracts";
import { calendarEventSummary } from "./mappers";
import type { CalendarEventRow } from "./types";

describe("local repository mappers", () => {
  it("keeps synced calendar event summaries inside IPC response limits", () => {
    const row: CalendarEventRow = {
      id: "acct-1:event-instance:event-1",
      eventId: "acct-1:event:event-1",
      accountId: "acct-1",
      calendarId: "acct-1:calendar:primary",
      calendarTitle: "Primary",
      title: "Long synced event ".repeat(40),
      startsAt: "2026-05-22T09:00:00.000Z",
      endsAt: "2026-05-22T09:30:00.000Z",
      allDay: 0,
      updatedAt: "2026-05-22T00:00:00.000Z",
      location: "Location ".repeat(200),
      notes: "Notes ".repeat(4_000),
      guestEmailsJson: JSON.stringify(
        Array.from({ length: 60 }, (_, index) => `guest-${index}@example.com`)
      ),
      reminderMinutesJson: JSON.stringify([-1, 0, 15, 40_320, 40_321]),
      pendingMutationStatus: null,
      timeZone: "UTC",
      recurrenceRule: "RRULE:FREQ=DAILY;".repeat(80),
      recurringEventId: null,
      originalStartAt: null
    };

    const summary = calendarEventSummary(row);
    const parsed = calendarEventSummarySchema.safeParse(summary);

    expect(parsed.success).toBe(true);
    expect(summary.title).toHaveLength(500);
    expect(summary.title.endsWith("...")).toBe(true);
    expect(summary.location).toHaveLength(1_000);
    expect(summary.notes).toHaveLength(20_000);
    expect(summary.guestEmails).toHaveLength(50);
    expect(summary.reminderMinutes).toEqual([0, 15, 40_320]);
    expect(summary.recurrenceRule).toHaveLength(1_000);
  });
});
