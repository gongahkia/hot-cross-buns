import { describe, expect, it } from "vitest";
import { dueLabel } from "./dateFormat";
import { scheduledTaskBlockViewModel } from "./calendarViewModels";
import { taskScheduleLabel } from "../coreScreenShared";
import type { TaskViewModel } from "../coreViewModels";

describe("dueLabel", () => {
  const now = new Date("2026-10-01T10:00:00.000Z");

  it("uses contextual, human-facing labels instead of storage dates", () => {
    expect(dueLabel("2026-10-01", now)).toBe("Today");
    expect(dueLabel("2026-10-02", now)).toBe("Tomorrow");
    expect(dueLabel("2026-09-29", now)).toMatch(/^Overdue · (?:.*Sep.*29|.*29.*Sep)$/);
    expect(dueLabel("2026-10-17", now)).toMatch(/(?:Oct.*17|17.*Oct)/);
  });

  it("shows scheduled and planned task times in the displayed timezone", () => {
    const startsAt = "2026-10-18T06:00:00.000Z", endsAt = "2026-10-18T07:00:00.000Z";
    const block = scheduledTaskBlockViewModel({ id: "block", taskId: "task", calendarId: "primary", startsAt, endsAt, durationMinutes: 60, status: "scheduled" }, "Work", [], "Asia/Singapore");
    expect(block.rangeLabel).toBe("14:00-15:00");
    expect(taskScheduleLabel({ plannedStart: startsAt, plannedEnd: endsAt } as TaskViewModel, undefined, "Asia/Singapore")).toBe("Planned 14:00-15:00");
  });
});
