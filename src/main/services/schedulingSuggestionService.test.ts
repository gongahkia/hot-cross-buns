import { describe, expect, it } from "vitest";
import type { CalendarEventSummary, TaskSummary } from "@shared/ipc/contracts";
import { buildDaySchedule } from "./schedulingSuggestionService";

const date = "2026-05-23";
const updatedAt = "2026-05-22T00:00:00.000Z";

describe("scheduling suggestion service", () => {
  it("packs duration tasks around locked events within working hours and capacity", () => {
    const schedule = buildDaySchedule({
      date,
      events: [
        event("event-standup", "2026-05-23T09:00:00.000Z", "2026-05-23T09:30:00.000Z")
      ],
      tasks: [
        task("task-a", { durationMinutes: 30, priority: "high" }),
        task("task-b", { durationMinutes: 60 }),
        task("task-c", { durationMinutes: 60 })
      ],
      capacityMinutes: 90,
      workingHours: { start: 8, end: 11 }
    });

    expect(schedule.slots).toEqual([
      expect.objectContaining({
        startsAt: "2026-05-23T08:00:00.000Z",
        endsAt: "2026-05-23T08:30:00.000Z",
        taskId: "task-a",
        locked: false
      }),
      expect.objectContaining({
        eventId: "event-standup",
        locked: true
      }),
      expect.objectContaining({
        startsAt: "2026-05-23T09:30:00.000Z",
        endsAt: "2026-05-23T10:30:00.000Z",
        taskId: "task-b"
      })
    ]);
    expect(schedule.unscheduled.map((item) => item.id)).toEqual(["task-c"]);
    expect(schedule.overloadMinutes).toBe(60);
  });

  it("marks overlapping non-locked planned tasks as conflicts", () => {
    const schedule = buildDaySchedule({
      date,
      events: [],
      tasks: [
        task("task-a", {
          plannedStart: "2026-05-23T10:00:00.000Z",
          plannedEnd: "2026-05-23T11:00:00.000Z",
          durationMinutes: 60,
          lockedSchedule: false
        }),
        task("task-b", {
          plannedStart: "2026-05-23T10:30:00.000Z",
          plannedEnd: "2026-05-23T11:15:00.000Z",
          durationMinutes: 45,
          lockedSchedule: false
        })
      ],
      capacityMinutes: 240,
      workingHours: { start: 8, end: 17 }
    });

    expect(schedule.slots.filter((slot) => slot.conflict).map((slot) => slot.taskId)).toEqual([
      "task-a",
      "task-b"
    ]);
  });
});

function task(id: string, overrides: Partial<TaskSummary> = {}): TaskSummary {
  return {
    id,
    listId: "list-inbox",
    title: id,
    status: "active",
    dueAt: null,
    updatedAt,
    priority: "none",
    ...overrides
  };
}

function event(id: string, startsAt: string, endsAt: string): CalendarEventSummary {
  return {
    id,
    calendarId: "cal-product",
    title: id,
    startsAt,
    endsAt,
    allDay: false,
    updatedAt
  };
}
