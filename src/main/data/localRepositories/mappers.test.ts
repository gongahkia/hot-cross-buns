import { describe, expect, it } from "vitest";
import {
  calendarEventDetailSchema,
  calendarEventSummarySchema,
  calendarListSummarySchema,
  taskSummarySchema
} from "@shared/ipc/contracts";
import { calendarEventDetail, calendarEventSummary, calendarListSummary, taskSummary } from "./mappers";
import type { CalendarEventRow, CalendarListRow, TaskRow } from "./types";

describe("local repository mappers", () => {
  it("passes Google calendar colors through list summaries", () => {
    const row: CalendarListRow = {
      id: "acct-1:calendar:primary",
      title: "Primary",
      selected: 1,
      timeZone: "Asia/Singapore",
      backgroundColor: "#34a853",
      foregroundColor: "#ffffff",
      updatedAt: "2026-05-22T00:00:00.000Z",
      eventCount: 12
    };

    const summary = calendarListSummary(row);

    expect(calendarListSummarySchema.safeParse(summary).success).toBe(true);
    expect(summary.backgroundColor).toBe("#34a853");
    expect(summary.foregroundColor).toBe("#ffffff");
  });

  it("maps hidden completed Google tasks as completed", () => {
    const row: TaskRow = {
      id: "acct-1:task-list-1:task-1",
      listId: "acct-1:task-list-1",
      listTitle: "My Tasks",
      title: "Done task",
      status: "completed",
      notes: null,
      dueAt: null,
      parentId: null,
      deletedAt: null,
      isHidden: 1,
      updatedAt: "2026-06-02T00:00:00.000Z"
    };

    const summary = taskSummary(row);

    expect(taskSummarySchema.safeParse(summary).success).toBe(true);
    expect(summary.status).toBe("completed");
  });

  it("keeps synced calendar event summaries inside IPC response limits", () => {
    const row: CalendarEventRow = {
      id: "acct-1:event-instance:event-1",
      eventId: "acct-1:event:event-1",
      accountId: "acct-1",
      calendarId: "acct-1:calendar:primary",
      calendarTitle: "Primary calendar ".repeat(40),
      title: "Long synced event ".repeat(40),
      startsAt: "2026-05-22T09:00:00.000Z",
      endsAt: "2026-05-22T09:30:00.000Z",
      allDay: 0,
      colorId: null,
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

    const detail = calendarEventDetail(row);
    expect(calendarEventDetailSchema.safeParse(detail).success).toBe(true);
    expect(detail.calendarTitle).toHaveLength(500);
  });
});
