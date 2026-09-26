import { describe, expect, it } from "vitest";
import { googleTaskNotesMaxLength, splitHcbTaskMetadata, withHcbTaskMetadata } from "./hcbTaskMetadata";

describe("HCB task metadata", () => {
  it("round-trips planning fields without changing the user-visible note", () => {
    const notes = "Send the draft to the team.\nKeep the decision log here.";
    const stored = withHcbTaskMetadata(notes, {
      priority: "high",
      tags: ["release", "writing"],
      plannedStart: "2026-10-05T01:00:00.000Z",
      plannedEnd: "2026-10-05T02:30:00.000Z",
      durationMinutes: 90,
      lockedSchedule: true,
      snoozeUntil: "2026-10-04T01:00:00.000Z"
    });

    expect(stored).toContain("[HCB task metadata v1:");
    expect(splitHcbTaskMetadata(stored)).toEqual({
      notes,
      metadata: {
        priority: "high",
        tags: ["release", "writing"],
        plannedStart: "2026-10-05T01:00:00.000Z",
        plannedEnd: "2026-10-05T02:30:00.000Z",
        durationMinutes: 90,
        lockedSchedule: true,
        snoozeUntil: "2026-10-04T01:00:00.000Z"
      }
    });
  });

  it("does not mistake an invalid or absent marker for metadata", () => {
    expect(splitHcbTaskMetadata("A normal task note")).toEqual({ notes: "A normal task note", metadata: null });
    expect(splitHcbTaskMetadata("Keep [HCB task metadata v1:not json] as text")).toEqual({
      notes: "Keep [HCB task metadata v1:not json] as text",
      metadata: null
    });
  });

  it("does not add a footer when every HCB-only field is at its default", () => {
    expect(withHcbTaskMetadata("Plain note", {
      priority: "none", tags: [], plannedStart: null, plannedEnd: null,
      durationMinutes: null, lockedSchedule: false, snoozeUntil: null
    })).toBe("Plain note");
  });

  it("lets the caller detect a Google-notes overflow without truncating user text", () => {
    const note = "x".repeat(googleTaskNotesMaxLength);
    const stored = withHcbTaskMetadata(note, { priority: "high" });

    expect(stored.slice(0, note.length)).toBe(note);
    expect(stored.length).toBeGreaterThan(googleTaskNotesMaxLength);
  });
});
