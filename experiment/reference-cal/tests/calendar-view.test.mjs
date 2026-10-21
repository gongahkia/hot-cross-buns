import assert from "node:assert/strict";
import test from "node:test";
import {
  filterCalendarEvents,
  getVisibleDates,
  getVisibleDayDifference,
  shiftVisibleDate,
  moveEventByCalendarDays,
} from "../src/lib/calendar-view.ts";

process.env.TZ = "America/New_York";
const key = (date) =>
  `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;

test("custom ranges and scroll buffers agree for every preset and custom limits", () => {
  const anchor = new Date(2026, 9, 18);
  for (const count of [1, 2, 3, 4, 5, 6, 7, 8, 9, 12, 31]) {
    for (const showWeekends of [true, false]) {
      const visible = getVisibleDates(anchor, count, showWeekends);
      const bufferStart = shiftVisibleDate(anchor, -count, showWeekends);
      const buffered = getVisibleDates(bufferStart, count * 3, showWeekends);
      assert.equal(visible.length, count);
      assert.deepEqual(
        buffered.slice(count, count * 2).map(key),
        visible.map(key),
      );
      assert.equal(new Set(visible.map(key)).size, count);
      if (!showWeekends)
        assert.ok(visible.every((day) => ![0, 6].includes(day.getDay())));
    }
  }
});

test("weekday-only navigation crosses a hidden weekend by one column", () => {
  const friday = new Date(2026, 9, 23);
  const monday = shiftVisibleDate(friday, 1, false);
  assert.equal(key(monday), "2026-10-26");
  assert.equal(key(shiftVisibleDate(monday, -1, false)), key(friday));
  assert.equal(getVisibleDayDifference(monday, friday, false), 1);
  assert.equal(getVisibleDayDifference(monday, friday, true), 3);
});

test("weekend anchors move forward to Monday without mutating the input", () => {
  for (const anchor of [new Date(2026, 9, 24, 14), new Date(2026, 9, 25, 14)]) {
    const original = anchor.getTime();
    assert.equal(key(getVisibleDates(anchor, 5, false)[0]), "2026-10-26");
    assert.equal(anchor.getTime(), original);
  }
});

for (const [name, anchor] of [
  ["spring DST", new Date(2026, 2, 6)],
  ["autumn DST", new Date(2026, 9, 30)],
  ["year boundary", new Date(2026, 11, 31)],
]) {
  test(`${name}: dates stay at local midnight and column navigation is reversible`, () => {
    for (const showWeekends of [true, false]) {
      const days = getVisibleDates(anchor, 12, showWeekends);
      assert.ok(days.every((date) => date.getHours() === 0));
      assert.equal(
        getVisibleDayDifference(days[11], days[0], showWeekends),
        11,
      );
      assert.equal(
        key(shiftVisibleDate(days[11], -11, showWeekends)),
        key(days[0]),
      );
    }
  });
}

test("declined invitations and hidden calendars filter independently", () => {
  const events = [
    {
      id: "accepted",
      calendarId: "Work",
      responseStatus: "accepted",
      status: "free",
    },
    {
      id: "declined",
      calendarId: "Work",
      responseStatus: "declined",
      status: "busy",
    },
    {
      id: "tentative",
      calendarId: "Work",
      responseStatus: "tentative",
      isAllDay: true,
    },
    { id: "hidden", calendarId: "Personal" },
    { id: "unassigned" },
  ];
  const before = structuredClone(events);
  const visible = new Set(["Work"]);
  assert.deepEqual(
    filterCalendarEvents(events, visible, false).map((event) => event.id),
    ["accepted", "tentative", "unassigned"],
  );
  assert.deepEqual(
    filterCalendarEvents(events, visible, true).map((event) => event.id),
    ["accepted", "declined", "tentative", "unassigned"],
  );
  assert.deepEqual(events, before);
});

test("moving a Friday–Sunday block past a hidden weekend preserves all three dates", () => {
  const event = {
    id: "trip",
    title: "Trip",
    start: new Date(2026, 9, 23),
    end: new Date(2026, 9, 25),
    isAllDay: true,
  };
  const moved = moveEventByCalendarDays(event, 3);
  assert.equal(key(moved.start), "2026-10-26");
  assert.equal(key(moved.end), "2026-10-28");
  assert.equal(moved.isAllDay, true);
  assert.equal(key(event.start), "2026-10-23");
});

test("moving a block across DST preserves its wall-clock times and calendar-day span", () => {
  const event = {
    id: "dst",
    title: "Trip",
    start: new Date(2026, 2, 6, 9),
    end: new Date(2026, 2, 8, 17),
  };
  const moved = moveEventByCalendarDays(event, 3);
  assert.equal(key(moved.start), "2026-3-9");
  assert.equal(key(moved.end), "2026-3-11");
  assert.equal(moved.start.getHours(), 9);
  assert.equal(moved.end.getHours(), 17);
});
