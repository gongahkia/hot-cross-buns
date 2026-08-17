import { describe, expect, it } from "vitest";

import { importLimits, parseImport } from "@/features/importParser";

describe("import parser", () => {
  it("previews escaped delimited task and event records without writing data", () => {
    const preview = parseImport("planner.txt", [
      'task title="Review roadmap" due=2026-08-20 notes="line one\\nline two" priority=high',
      'event title="Planning" start=2026-08-20T09:00:00Z end=2026-08-20T10:00:00Z all_day=false'
    ].join("\n"));
    expect(preview.errors).toEqual([]);
    expect(preview.rows.map((row) => row.record)).toEqual([
      expect.objectContaining({ kind: "task", title: "Review roadmap", priority: "high", notes: "line one\nline two" }),
      expect.objectContaining({ kind: "event", title: "Planning", allDay: false })
    ]);
  });

  it("requires the exact CSV contract header", () => {
    const preview = parseImport("planner.csv", "kind,title\ntask,Nope");
    expect(preview.errors).toEqual(["CSV must use the documented exact header"]);
    expect(importLimits.csvHeader).toHaveLength(19);
  });

  it("imports iCalendar duration and explicitly warns for skipped calendar-only fields", () => {
    const preview = parseImport("planner.ics", [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "SUMMARY:Focus block",
      "DTSTART:20260820T090000Z",
      "DURATION:PT90M",
      "ATTENDEE:mailto:person@example.test",
      "END:VEVENT",
      "END:VCALENDAR"
    ].join("\r\n"));
    expect(preview.errors).toEqual([]);
    expect(preview.rows[0]).toMatchObject({
      record: expect.objectContaining({ kind: "event", start: "2026-08-20T09:00:00Z", end: "2026-08-20T10:30:00.000Z" }),
      warnings: ["ATTENDEE is not imported"]
    });
  });
});
