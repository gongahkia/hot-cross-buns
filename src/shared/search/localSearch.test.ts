import { describe, expect, it } from "vitest";
import {
  matchesLocalSearchItem,
  parseLocalSearchQuery,
  resolveLocalSearchDomains
} from "./localSearch";

const now = "2026-05-22T12:00:00.000Z";

describe("local search query DSL", () => {
  it("parses text with task filters and quoted values", () => {
    const parsed = parseLocalSearchQuery(
      'triage source:task status:open due:today priority:high list:"Inbox Planning" notes:yes',
      { now }
    );

    expect(parsed.errors).toEqual([]);
    expect(parsed.text).toBe("triage");
    expect(parsed.filters).toMatchObject({
      domains: ["tasks"],
      taskStatus: "active",
      priority: "high",
      listTitle: "Inbox Planning",
      hasBody: true
    });
    expect(parsed.filters.due).toMatchObject({
      from: "2026-05-22T00:00:00.000Z",
      to: "2026-05-23T00:00:00.000Z",
      label: "today"
    });
    expect(parsed.chips.map((chip) => `${chip.label}: ${chip.value}`)).toEqual([
      "Source: tasks",
      "Status: active",
      "Due: today",
      "Priority: high",
      "List: Inbox Planning",
      "Body: yes"
    ]);
    expect(parsed.explain).toEqual([
      "Text: triage",
      "Source: tasks",
      "Status: active",
      "Due: today",
      "Priority: high",
      "List: Inbox Planning",
      "Body: yes"
    ]);
  });

  it("parses calendar date ranges and source aliases", () => {
    const parsed = parseLocalSearchQuery(
      'source:calendar,notes start:2026-05-22..2026-05-24 calendar:Product body:no planning',
      { now }
    );

    expect(parsed.errors).toEqual([]);
    expect(parsed.text).toBe("planning");
    expect(parsed.filters.domains).toEqual(["calendar", "notes"]);
    expect(parsed.filters.start).toMatchObject({
      from: "2026-05-22T00:00:00.000Z",
      to: "2026-05-25T00:00:00.000Z",
      label: "2026-05-22 to 2026-05-24"
    });
    expect(resolveLocalSearchDomains(parsed)).toEqual(["calendar"]);
  });

  it("reports invalid structured syntax without throwing", () => {
    const parsed = parseLocalSearchQuery(
      'source:servers status:blocked due:friday priority:urgent list: notes:maybe owner:gong',
      { now }
    );

    expect(parsed.errors.map((error) => error.code)).toEqual([
      "invalid_domain",
      "invalid_status",
      "invalid_date_window",
      "invalid_priority",
      "missing_filter_value",
      "invalid_presence",
      "unknown_filter"
    ]);
  });

  it("matches task filters without fuzzy ranking or remote state", () => {
    const parsed = parseLocalSearchQuery(
      "triage source:tasks status:active due:2026-05-22 priority:high list:Inbox notes:yes",
      { now }
    );

    expect(
      matchesLocalSearchItem(parsed, {
        domain: "tasks",
        title: "Draft inbox triage rules",
        body: "Local-only notes",
        taskStatus: "active",
        dueAt: "2026-05-22T09:00:00.000Z",
        priority: "high",
        listTitle: "Inbox"
      })
    ).toBe(true);
    expect(
      matchesLocalSearchItem(parsed, {
        domain: "tasks",
        title: "Draft inbox triage rules",
        body: "Local-only notes",
        taskStatus: "completed",
        dueAt: "2026-05-22T09:00:00.000Z",
        priority: "high",
        listTitle: "Inbox"
      })
    ).toBe(false);
  });

  it("matches calendar and note body presence filters", () => {
    const calendar = parseLocalSearchQuery(
      "startup source:calendar start:before:2026-05-23 calendar:Product body:yes",
      { now }
    );
    const notes = parseLocalSearchQuery("source:notes body:no", { now });

    expect(
      matchesLocalSearchItem(calendar, {
        domain: "calendar",
        title: "Planner shell standup",
        body: "Review cache-first startup.",
        startAt: "2026-05-22T09:30:00.000Z",
        calendarTitle: "Product"
      })
    ).toBe(true);
    expect(
      matchesLocalSearchItem(notes, {
        domain: "notes",
        title: "Empty scratchpad",
        body: ""
      })
    ).toBe(true);
  });

  it("parses and matches tag, attendee, duration, relative date, and regex filters", () => {
    const parsed = parseLocalSearchQuery(
      "tag:focus duration:30m..90m due<+7d regex:^Draft",
      { now }
    );

    expect(parsed.errors).toEqual([]);
    expect(parsed.filters.duration).toEqual({
      fromMinutes: 30,
      toMinutes: 90,
      label: "30m to 90m"
    });
    expect(parsed.filters.due).toMatchObject({
      to: "2026-05-29T00:00:00.000Z",
      label: "before +7d"
    });
    expect(
      matchesLocalSearchItem(parsed, {
        domain: "tasks",
        title: "Draft roadmap",
        body: "ship",
        tags: ["focus"],
        durationMinutes: 45,
        dueAt: "2026-05-24T09:00:00.000Z"
      })
    ).toBe(true);
    expect(
      matchesLocalSearchItem(parsed, {
        domain: "tasks",
        title: "Review roadmap",
        tags: ["focus"],
        durationMinutes: 45,
        dueAt: "2026-05-24T09:00:00.000Z"
      })
    ).toBe(false);

    const event = parseLocalSearchQuery("attendee:ada start>today tag:launch", { now });
    expect(event.errors).toEqual([]);
    expect(resolveLocalSearchDomains(event)).toEqual(["calendar"]);
    expect(
      matchesLocalSearchItem(event, {
        domain: "calendar",
        title: "Launch review",
        attendeeEmails: ["ada@example.com"],
        tags: ["launch"],
        startAt: "2026-05-23T09:00:00.000Z"
      })
    ).toBe(true);
  });

  it("matches tags across tasks, events, and notes", () => {
    const parsed = parseLocalSearchQuery("tag:focus", { now });

    expect(parsed.errors).toEqual([]);
    expect(
      matchesLocalSearchItem(parsed, {
        domain: "tasks",
        title: "Task",
        tags: ["focus"]
      })
    ).toBe(true);
    expect(
      matchesLocalSearchItem(parsed, {
        domain: "calendar",
        title: "Event",
        tags: ["focus"]
      })
    ).toBe(true);
    expect(
      matchesLocalSearchItem(parsed, {
        domain: "notes",
        title: "Note",
        tags: ["focus"]
      })
    ).toBe(true);
  });

  it("parses and matches boolean operators", () => {
    const parsed = parseLocalSearchQuery("(source:tasks AND tag:focus) OR (source:notes AND NOT body:no)", { now });

    expect(parsed.errors).toEqual([]);
    expect(parsed.boolean).toBeDefined();
    expect(matchesLocalSearchItem(parsed, {
      domain: "tasks",
      title: "Task",
      tags: ["focus"]
    })).toBe(true);
    expect(matchesLocalSearchItem(parsed, {
      domain: "notes",
      title: "Note",
      body: "has body"
    })).toBe(true);
    expect(matchesLocalSearchItem(parsed, {
      domain: "calendar",
      title: "Focus",
      tags: ["focus"]
    })).toBe(false);
  });

  it("parses strict duration operators and inclusive ranges", () => {
    const greaterThan = parseLocalSearchQuery("duration>30m", { now });
    const lessThan = parseLocalSearchQuery("duration<2h", { now });
    const range = parseLocalSearchQuery("duration:30m..90m", { now });

    expect(greaterThan.filters.duration).toEqual({ fromMinutes: 31, label: "> 30m" });
    expect(lessThan.filters.duration).toEqual({ toMinutes: 119, label: "< 2h" });
    expect(range.filters.duration).toEqual({ fromMinutes: 30, toMinutes: 90, label: "30m to 90m" });
    expect(matchesLocalSearchItem(greaterThan, { domain: "tasks", title: "Task", durationMinutes: 30 })).toBe(false);
    expect(matchesLocalSearchItem(greaterThan, { domain: "tasks", title: "Task", durationMinutes: 31 })).toBe(true);
    expect(matchesLocalSearchItem(lessThan, { domain: "tasks", title: "Task", durationMinutes: 119 })).toBe(true);
    expect(matchesLocalSearchItem(lessThan, { domain: "tasks", title: "Task", durationMinutes: 120 })).toBe(false);
    expect(matchesLocalSearchItem(range, { domain: "tasks", title: "Task", durationMinutes: 30 })).toBe(true);
    expect(matchesLocalSearchItem(range, { domain: "tasks", title: "Task", durationMinutes: 90 })).toBe(true);
  });

  it("parses relative due and start comparison aliases", () => {
    const dueAfter = parseLocalSearchQuery("due>today", { now });
    const startBefore = parseLocalSearchQuery("start<+14d", { now });

    expect(dueAfter.filters.due).toMatchObject({
      from: "2026-05-22T00:00:00.000Z",
      label: "on/after today"
    });
    expect(startBefore.filters.start).toMatchObject({
      to: "2026-06-05T00:00:00.000Z",
      label: "before +14d"
    });
    expect(resolveLocalSearchDomains(dueAfter)).toEqual(["tasks"]);
    expect(resolveLocalSearchDomains(startBefore)).toEqual(["calendar"]);
  });

  it("reports invalid duration and regex syntax", () => {
    const parsed = parseLocalSearchQuery("duration:90m..30m regex:[", { now });

    expect(parsed.errors.map((error) => error.code)).toEqual([
      "invalid_duration",
      "invalid_regex"
    ]);
  });

  it("rejects malformed comparison operators instead of treating them as text", () => {
    const parsed = parseLocalSearchQuery("duration>=30m due<=+7d start=tomorrow", { now });

    expect(parsed.text).toBe("");
    expect(parsed.errors.map((error) => error.code)).toEqual([
      "invalid_filter_operator",
      "invalid_filter_operator",
      "invalid_filter_operator"
    ]);
  });

  it("rejects overlong and complex regex patterns", () => {
    const parsed = parseLocalSearchQuery(`regex:${"a".repeat(121)} regex:(a+)+$ regex:foo(?=bar)`, { now });

    expect(parsed.errors.map((error) => error.code)).toEqual([
      "invalid_regex",
      "invalid_regex",
      "invalid_regex"
    ]);
  });

  it("reports invalid duration units and bounds", () => {
    expect(parseLocalSearchQuery("duration:0m..30m", { now }).errors[0]?.code).toBe("invalid_duration");
    expect(parseLocalSearchQuery("duration:30x..2h", { now }).errors[0]?.code).toBe("invalid_duration");
    expect(parseLocalSearchQuery("duration:30m..25h", { now }).errors[0]?.code).toBe("invalid_duration");
  });
});
