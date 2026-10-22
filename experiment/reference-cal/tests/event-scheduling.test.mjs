import assert from "node:assert/strict";
import test from "node:test";
import { TZDate } from "@date-fns/tz";
import {
  applyZonedTime,
  eventTimeZone,
  fromWallDate,
  inTimeZone,
  shiftZonedDays,
  wallDate,
  timeZoneLabel,
} from "../src/lib/event-timezone.ts";
import {
  expandRecurringEvents,
  prepareSampleSeries,
  recurrenceSummary,
  updateCalendarEvents,
} from "../src/lib/event-recurrence.ts";
import { generateMockEvents } from "../src/lib/mock-events.ts";

process.env.TZ = "Asia/Singapore";
const instant = (
  year,
  month,
  day,
  hour = 9,
  minute = 0,
  zone = "America/New_York",
) => new Date(new TZDate(year, month - 1, day, hour, minute, 0, 0, zone));
const event = (overrides = {}) => ({
  id: "series",
  title: "A meeting",
  start: instant(2026, 3, 2),
  end: instant(2026, 3, 2, 10),
  timezone: "America/New_York",
  recurrenceRule: { frequency: "weekly", interval: 1, weekdays: [1] },
  ...overrides,
});
const expand = (
  master,
  start = new Date("2026-01-01Z"),
  end = new Date("2027-01-01Z"),
) => expandRecurringEvents([master], start, end);
const local = (date, zone = "America/New_York") => {
  const d = inTimeZone(date, zone);
  return [
    d.getFullYear(),
    d.getMonth() + 1,
    d.getDate(),
    d.getHours(),
    d.getMinutes(),
  ];
};

test("zone conversion preserves instants and handles date/year boundaries", () => {
  const date = new Date("2026-12-31T18:30:00Z");
  assert.deepEqual(local(date, "Asia/Singapore"), [2027, 1, 1, 2, 30]);
  assert.equal(inTimeZone(date, "Asia/Singapore").getTime(), date.getTime());
  assert.equal(
    eventTimeZone({ timezone: "GMT-3 Sao Paulo" }),
    "America/Sao_Paulo",
  );
});

test("editing time and date uses the event zone rather than the machine zone", () => {
  const date = instant(2026, 3, 7);
  const edited = applyZonedTime(date, 14, 30, "America/New_York");
  assert.deepEqual(local(edited), [2026, 3, 7, 14, 30]);
  const shifted = shiftZonedDays(edited, 2, "America/New_York");
  assert.deepEqual(local(shifted), [2026, 3, 9, 14, 30]);
  assert.equal(shifted.getTime() - edited.getTime(), 47 * 3600000);
});

test("nonexistent spring-forward time is rejected and an unchanged repeated hour keeps its instant", () => {
  assert.equal(
    applyZonedTime(instant(2026, 3, 8, 1), 2, 30, "America/New_York"),
    null,
  );
  const secondFold = new Date("2026-11-01T06:30:00Z");
  assert.equal(
    applyZonedTime(secondFold, 1, 30, "America/New_York").getTime(),
    secondFold.getTime(),
  );
  assert.equal(
    fromWallDate(new Date("2026-03-08T02:30:00Z"), "America/New_York"),
    null,
  );
});

test("offset labels follow the event date including half-hour zones", () => {
  assert.match(
    timeZoneLabel("America/New_York", instant(2026, 1, 1)),
    /GMT−05:00/,
  );
  assert.match(
    timeZoneLabel("America/New_York", instant(2026, 7, 1)),
    /GMT−04:00/,
  );
  assert.match(
    timeZoneLabel("Asia/Kolkata", instant(2026, 1, 1)),
    /GMT\+05:30/,
  );
});

test("weekly occurrences keep their wall time across both DST transitions", () => {
  const master = event({
    recurrenceRule: {
      frequency: "weekly",
      interval: 1,
      weekdays: [1],
      count: 40,
    },
  });
  const occurrences = expand(master);
  assert.equal(occurrences.length, 40);
  assert.ok(
    occurrences.every((o) => local(o.start)[3] === 9 && local(o.end)[3] === 10),
  );
  assert.equal(
    occurrences[1].start.getTime() - occurrences[0].start.getTime(),
    167 * 3600000,
  );
  assert.ok(
    occurrences.some(
      (o, i) =>
        i &&
        o.start.getTime() - occurrences[i - 1].start.getTime() ===
          169 * 3600000,
    ),
  );
  assert.equal(new Set(occurrences.map((o) => o.id)).size, occurrences.length);
});

test("weekday selections and two-week intervals use the selected weekdays", () => {
  const master = event({
    recurrenceRule: {
      frequency: "weekly",
      interval: 2,
      weekdays: [1, 3],
      count: 5,
    },
  });
  assert.deepEqual(
    expand(master).map((o) => local(o.start).slice(1, 3)),
    [
      [3, 2],
      [3, 4],
      [3, 16],
      [3, 18],
      [3, 30],
    ],
  );
});

test("monthly day schedules skip impossible dates, and monthly weekday schedules support last weekday", () => {
  const master = event({
    start: instant(2026, 1, 31),
    end: instant(2026, 1, 31, 10),
    recurrenceRule: { frequency: "monthly", interval: 1, count: 3 },
  });
  assert.deepEqual(
    expand(master).map((o) => local(o.start).slice(1, 3)),
    [
      [1, 31],
      [3, 31],
      [5, 31],
    ],
  );
  const weekday = event({
    start: instant(2026, 1, 30),
    end: instant(2026, 1, 30, 10),
    recurrenceRule: {
      frequency: "monthly",
      interval: 1,
      monthlyMode: "weekday",
      count: 3,
    },
  });
  assert.deepEqual(
    expand(weekday).map((o) => local(o.start).slice(1, 3)),
    [
      [1, 30],
      [2, 27],
      [3, 27],
    ],
  );
});

test("yearly leap-day schedules skip non-leap years", () => {
  const master = event({
    start: instant(2024, 2, 29),
    end: instant(2024, 2, 29, 10),
    recurrenceRule: { frequency: "yearly", interval: 1, count: 3 },
  });
  assert.deepEqual(
    expand(master, new Date("2024-01-01Z"), new Date("2033-01-01Z")).map(
      (o) => local(o.start)[0],
    ),
    [2024, 2028, 2032],
  );
});

test("until is inclusive in the event zone, not in UTC", () => {
  const master = event({
    start: instant(2026, 3, 2, 23),
    end: instant(2026, 3, 3, 0),
    recurrenceRule: { frequency: "daily", interval: 1, until: "2026-03-03" },
  });
  assert.equal(expand(master).length, 2);
});

test("DST-gap dates do not spend the end-after count", () => {
  const master = event({
    start: instant(2026, 3, 7, 2, 30),
    end: instant(2026, 3, 7, 3, 30),
    recurrenceRule: { frequency: "daily", interval: 1, count: 3 },
  });
  assert.deepEqual(
    expand(master).map((o) => local(o.start).slice(1, 3)),
    [
      [3, 7],
      [3, 9],
      [3, 10],
    ],
  );
});

test("an occurrence edit changes only that occurrence and survives expansion/navigation", () => {
  const master = event({
    recurrenceRule: { frequency: "weekly", interval: 1, count: 3 },
  });
  const second = expand(master)[1];
  const sources = updateCalendarEvents([master], {
    ...second,
    location: "Room 42",
    title: "One revised meeting",
  });
  const rows = expand(sources[0]);
  assert.equal(rows[1].location, "Room 42");
  assert.equal(rows[1].id, second.id);
  assert.equal(rows[0].title, master.title);
  assert.equal(rows[2].location, undefined);
});

test("moving an occurrence into a later window keeps its original identity", () => {
  const master = event({
    recurrenceRule: { frequency: "weekly", interval: 1, count: 3 },
  });
  const second = expand(master)[1];
  const start = instant(2027, 1, 4),
    end = instant(2027, 1, 4, 10);
  const sources = updateCalendarEvents([master], { ...second, start, end });
  const moved = expand(sources[0], instant(2027, 1, 1), instant(2027, 1, 10));
  assert.equal(moved.length, 1);
  assert.equal(moved[0].id, second.id);
});

test("repeat changes apply to the series and stopping repeat retains the selected occurrence", () => {
  const master = event({
    recurrenceRule: { frequency: "weekly", interval: 1, count: 3 },
  });
  const second = expand(master)[1];
  const changed = updateCalendarEvents([master], {
    ...second,
    recurrenceRule: { frequency: "daily", interval: 1, count: 2 },
  });
  assert.equal(expand(changed[0]).length, 2);
  const stopped = updateCalendarEvents([master], {
    ...second,
    recurrenceRule: undefined,
  });
  assert.equal(stopped.length, 1);
  assert.equal(stopped[0].id, second.id);
  assert.equal(stopped[0].start.getTime(), second.start.getTime());
  assert.equal(stopped[0].seriesId, undefined);
});

test("converting pre-expanded sample routines preserves IDs, skipped dates and one-off variations", () => {
  const first = event({
    recurrenceRule: undefined,
    recurrence: "Every week on Mon",
    id: "first",
  });
  const last = {
    ...first,
    id: "last",
    start: instant(2026, 3, 16, 11),
    end: instant(2026, 3, 16, 12),
    location: "Different room",
  };
  const masters = prepareSampleSeries([first, last]);
  assert.equal(masters.length, 1);
  const occurrences = expand(
    masters[0],
    instant(2026, 3, 1),
    instant(2026, 3, 17),
  );
  assert.deepEqual(
    occurrences.map((o) => o.id),
    ["first", "last"],
  );
  assert.equal(occurrences[1].location, "Different room");
  assert.deepEqual(local(occurrences[1].start), [2026, 3, 16, 11, 0]);
});

test("repeat summaries distinguish weekday and day-of-month rules", () => {
  const master = event();
  assert.match(
    recurrenceSummary(
      { frequency: "monthly", interval: 1, monthlyMode: "weekday" },
      master.start,
      master.timezone,
    ),
    /first Mon/,
  );
  assert.equal(wallDate(master.start, master.timezone).getUTCHours(), 9);
});

test("shortening a series does not resurrect saved exceptions beyond the new end", () => {
  const master = event({
    recurrenceRule: { frequency: "weekly", interval: 1, count: 3 },
  });
  const third = expand(master)[2];
  const edited = updateCalendarEvents([master], {
    ...third,
    start: instant(2026, 3, 18),
    end: instant(2026, 3, 18, 10),
  });
  const first = expand(edited[0])[0];
  const shortened = updateCalendarEvents(edited, {
    ...first,
    recurrenceRule: { frequency: "weekly", interval: 1, count: 1 },
  });
  assert.equal(expand(shortened[0]).length, 1);
});

test("all-day repeats preserve calendar dates and span across daylight saving", () => {
  const master = event({
    start: new Date(2026, 2, 7),
    end: new Date(2026, 2, 9),
    isAllDay: true,
    recurrenceRule: { frequency: "weekly", interval: 1, count: 2 },
  });
  const rows = expand(master);
  assert.equal(rows.length, 2);
  assert.equal(rows[1].start.getDate(), 14);
  assert.equal(rows[1].end.getDate(), 16);
  assert.equal(rows[1].start.getHours(), 0);
});

test("sample-series conversion retains every original event's identity, dates and content", () => {
  const original = generateMockEvents(new Date(2026, 9, 21));
  const starts = original.map((row) => row.start.getTime()),
    ends = original.map((row) => row.end.getTime());
  const rows = expandRecurringEvents(
    prepareSampleSeries(original),
    new Date(Math.min(...starts) - 86400000),
    new Date(Math.max(...ends) + 86400000),
  );
  const byId = new Map(rows.map((row) => [row.id, row]));
  for (const row of original) {
    const converted = byId.get(row.id);
    assert.ok(converted, `Missing sample ${row.id}`);
    for (const key of ["title", "location", "description", "color"])
      assert.equal(converted[key], row[key], `${row.id} ${key}`);
    assert.equal(converted.start.getTime(), row.start.getTime(), row.id);
    assert.equal(converted.end.getTime(), row.end.getTime(), row.id);
  }
});
