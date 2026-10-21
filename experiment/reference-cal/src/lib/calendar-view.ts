import {
  addBusinessDays,
  addDays,
  differenceInBusinessDays,
  differenceInCalendarDays,
  isWeekend,
  startOfDay,
} from "date-fns";
import type { CalendarEvent } from "@/components/week-view-types";

/** Weekday-only ranges start on the next weekday when the anchor is a weekend. */
export function normalizeVisibleDate(date: Date, showWeekends = true): Date {
  let result = startOfDay(date);
  while (!showWeekends && isWeekend(result)) result = addDays(result, 1);
  return result;
}

/** Move in visible columns, including across a hidden weekend or DST boundary. */
export function shiftVisibleDate(
  date: Date,
  columns: number,
  showWeekends = true,
): Date {
  const start = normalizeVisibleDate(date, showWeekends);
  return showWeekends
    ? addDays(start, columns)
    : addBusinessDays(start, columns);
}

export function getVisibleDates(
  date: Date,
  count: number,
  showWeekends = true,
): Date[] {
  const start = normalizeVisibleDate(date, showWeekends);
  return Array.from({ length: count }, (_, index) =>
    shiftVisibleDate(start, index, showWeekends),
  );
}

export function getVisibleDayDifference(
  next: Date,
  previous: Date,
  showWeekends = true,
): number {
  const end = normalizeVisibleDate(next, showWeekends);
  const start = normalizeVisibleDate(previous, showWeekends);
  return showWeekends
    ? differenceInCalendarDays(end, start)
    : differenceInBusinessDays(end, start);
}

export function filterCalendarEvents(
  events: CalendarEvent[],
  visibleCalendarIds: Set<string>,
  showDeclinedEvents: boolean,
): CalendarEvent[] {
  return events.filter(
    (event) =>
      (!event.calendarId || visibleCalendarIds.has(event.calendarId)) &&
      (showDeclinedEvents || event.responseStatus !== "declined"),
  );
}

/** Moving an all-day block keeps its calendar-day span across hidden days and DST. */
export function moveEventByCalendarDays(
  event: CalendarEvent,
  delta: number,
): CalendarEvent {
  return {
    ...event,
    start: addDays(event.start, delta),
    end: addDays(event.end, delta),
  };
}
