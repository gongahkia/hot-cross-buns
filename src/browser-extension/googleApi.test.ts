import { describe, expect, it } from "vitest";
import { mapCalendar, mapEvent, mapTask, mapTaskList } from "./googleApi";

describe("browser extension Google API mappers", () => {
  it("maps Google Tasks list and task payloads", () => {
    const [list] = mapTaskList({ id: "list-1", title: "Inbox", updated: "2026-07-05T00:00:00.000Z" });
    const [task] = mapTask({
      id: "task-1",
      title: "Ship extension",
      notes: "read-only v1",
      due: "2026-07-06T00:00:00.000Z"
    }, list);

    expect(task).toMatchObject({
      id: "task-1",
      listId: "list-1",
      listTitle: "Inbox",
      title: "Ship extension",
      sourceUrl: "https://tasks.google.com/"
    });
  });

  it("maps selected calendars and timed events", () => {
    const [calendar] = mapCalendar({
      id: "primary",
      summary: "Calendar",
      primary: true,
      selected: true
    });
    const [event] = mapEvent({
      id: "event-1",
      summary: "Planning",
      start: { dateTime: "2026-07-05T09:00:00+08:00" },
      end: { dateTime: "2026-07-05T09:30:00+08:00" },
      htmlLink: "https://calendar.google.com/event?eid=1"
    }, calendar);

    expect(event).toMatchObject({
      id: "event-1",
      calendarId: "primary",
      title: "Planning",
      allDay: false,
      sourceUrl: "https://calendar.google.com/event?eid=1"
    });
  });

  it("drops cancelled events", () => {
    const [calendar] = mapCalendar({ id: "primary", summary: "Calendar" });
    expect(mapEvent({ id: "event-1", status: "cancelled" }, calendar)).toEqual([]);
  });
});
