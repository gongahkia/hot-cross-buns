import { describe, expect, it } from "vitest";

import {
  parseTaskRecurrenceNotes,
  serializeTaskRecurrenceNotes,
  taskRecurrenceDate,
  taskRecurrenceSuccessor
} from "@/features/taskRecurrence";

const seriesId = "3a21dc8d-2cb4-4b9a-980f-7aaf75ae2f43";

describe("task recurrence marker", () => {
  const marker = {
    seriesId,
    occurrenceId: `${seriesId}:0`,
    ordinal: 0,
    frequency: "weekly" as const,
    interval: 1,
    anchorDate: "2026-08-17",
    timeZone: "Asia/Singapore",
    end: { kind: "count" as const, count: 3 },
    recurrenceRule: "FREQ=WEEKLY;INTERVAL=1;BYDAY=MO",
    exclusionDates: ["2026-08-24"],
    additionDates: ["2026-08-25"],
    templateTitle: "Review roadmap",
    templateDueDate: "2026-08-17",
    templatePriority: "high" as const
  };

  it("round-trips the v2 portable marker and preserves the user note", () => {
    const serialized = serializeTaskRecurrenceNotes("Personal context", marker);
    expect(serialized.error).toBeUndefined();
    expect(parseTaskRecurrenceNotes(serialized.notes)).toEqual({
      state: "managed",
      userNotes: "Personal context",
      marker
    });
  });

  it("uses recurrence exceptions when deriving a single idempotent successor", () => {
    expect(taskRecurrenceDate(marker, 1)).toBe("2026-08-25");
    expect(taskRecurrenceSuccessor(marker)).toMatchObject({
      occurrenceId: `${seriesId}:1`,
      ordinal: 1,
      templateDueDate: "2026-08-25"
    });
  });

  it("keeps unknown marker versions recoverable instead of treating them as user notes", () => {
    const serialized = serializeTaskRecurrenceNotes("Do not lose me", marker).notes!;
    const futureMarker = serialized.replace("[HCB-RECURRENCE v2]", "[HCB-RECURRENCE v3]");
    expect(parseTaskRecurrenceNotes(futureMarker)).toMatchObject({
      state: "unsupported-version",
      userNotes: futureMarker
    });
  });
});
