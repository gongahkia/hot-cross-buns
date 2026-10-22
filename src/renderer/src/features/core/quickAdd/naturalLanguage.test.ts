import { describe, expect, it } from "vitest";
import {
  firstHashHint,
  parseQuickAddEvent,
  parseQuickAddTask,
  stripHashToken
} from "./naturalLanguage";

function localDate(value: Date | null): string | null {
  if (!value) {
    return null;
  }

  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

describe("Quick Add natural-language parser", () => {
  it("uses day/month for numeric dates while retaining ISO dates", () => {
    const now = new Date(2026, 0, 2, 9, 0);
    const task = parseQuickAddTask("Book venue 04/03", now);
    const event = parseQuickAddEvent("Planning 2026-03-05 09:30", now);

    expect(task.dueDate).toBe("2026-03-04");
    expect(task.title).toBe("Book venue");
    expect(localDate(event.startDate)).toBe("2026-03-05");
    expect(event.startDate?.getHours()).toBe(9);
    expect(event.startDate?.getMinutes()).toBe(30);
  });

  it("extracts a complete event draft without putting metadata in the title", () => {
    const parsed = parseQuickAddEvent(
      "Lunch tomorrow 1pm-2:30pm for 90m at \"Philz Coffee\" with Alice@example.com, BOB@example.com tz America/Los_Angeles #Product every Tue until 01/12",
      new Date(2026, 8, 22, 9, 0)
    );

    expect(parsed.summary).toBe("Lunch #Product");
    expect(localDate(parsed.startDate)).toBe("2026-09-23");
    expect(parsed.startDate?.getHours()).toBe(13);
    expect(parsed.endDate?.getHours()).toBe(14);
    expect(parsed.endDate?.getMinutes()).toBe(30);
    expect(parsed.location).toBe("Philz Coffee");
    expect(parsed.guestEmails).toEqual(["alice@example.com", "bob@example.com"]);
    expect(parsed.timeZone).toBe("America/Los_Angeles");
    expect(parsed.recurrence).toMatchObject({
      frequency: "weekly",
      interval: 1,
      byDay: ["TU"],
      endsOn: "2026-12-01"
    });
    expect(parsed.matchedTokens.map((token) => token.kind)).toEqual(
      expect.arrayContaining(["duration", "recurrence", "timeZone", "guests", "time", "location"])
    );
  });

  it("maps supported abbreviations to IANA zones and preserves ordinary 'with' titles", () => {
    const parsed = parseQuickAddEvent("Lunch with Bob 26/09 1pm PST", new Date(2026, 8, 22, 9, 0));

    expect(parsed.summary).toBe("Lunch with Bob");
    expect(parsed.guestEmails).toEqual([]);
    expect(parsed.timeZone).toBe("America/Los_Angeles");
    expect(localDate(parsed.startDate)).toBe("2026-09-26");
  });

  it("supports quoted calendar and list destinations", () => {
    const task = parseQuickAddTask('Send brief tomorrow #"Client Work"', new Date(2026, 8, 22, 9, 0));
    const hint = firstHashHint('Lunch tomorrow #"Client Work"');

    expect(task.taskListHint).toBe("Client Work");
    expect(task.title).toBe("Send brief");
    expect(hint).toBe("Client Work");
    expect(stripHashToken('Lunch #"Client Work"', hint)).toBe("Lunch");
  });
});
