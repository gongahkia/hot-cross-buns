import { describe, expect, it } from "vitest";
import { dueLabel } from "./dateFormat";

describe("dueLabel", () => {
  const now = new Date("2026-10-01T10:00:00.000Z");

  it("uses contextual, human-facing labels instead of storage dates", () => {
    expect(dueLabel("2026-10-01", now)).toBe("Today");
    expect(dueLabel("2026-10-02", now)).toBe("Tomorrow");
    expect(dueLabel("2026-09-29", now)).toMatch(/^Overdue · (?:.*Sep.*29|.*29.*Sep)$/);
    expect(dueLabel("2026-10-17", now)).toMatch(/(?:Oct.*17|17.*Oct)/);
  });
});
