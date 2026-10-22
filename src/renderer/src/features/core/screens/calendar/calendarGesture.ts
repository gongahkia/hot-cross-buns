import type { CalendarEventViewModel } from "../../coreViewModels";
import { calendarAddUtcDays, calendarLocalPoint, calendarUtcDayOffset, zonedDateTimeIso } from "./calendarDateUtils";

export type CalendarGestureKind = "move" | "start" | "end";
export interface CalendarGesturePoint { day: string; minutes?: number; allDay?: boolean }
export interface CalendarEventRange { startsAt: string; endsAt: string; allDay: boolean }

/** Calendar-day arithmetic belongs in the display zone; all-day ends stay exclusive. */
export function calendarGestureRange(event: CalendarEventViewModel, kind: CalendarGestureKind, origin: CalendarGesturePoint, target: CalendarGesturePoint): CalendarEventRange {
  const zone = event.displayTimeZone || event.timeZone || "UTC";
  const start = event.allDay ? { dayKey: event.startsAt.slice(0, 10), minutes: 0 } : calendarLocalPoint(event.startsAt, zone);
  const end = event.allDay ? { dayKey: event.endsAt.slice(0, 10), minutes: 0 } : calendarLocalPoint(event.endsAt, zone);
  const dayDelta = calendarUtcDayOffset(origin.day, target.day);
  if (kind === "move") {
    if (event.allDay && target.minutes === undefined) return {
      startsAt: `${calendarAddUtcDays(start.dayKey, dayDelta)}T00:00:00.000Z`,
      endsAt: `${calendarAddUtcDays(end.dayKey, dayDelta)}T00:00:00.000Z`, allDay: true
    };
    if (target.allDay && !event.allDay) return {
      startsAt: `${target.day}T00:00:00.000Z`,
      endsAt: `${calendarAddUtcDays(target.day, Math.max(1, Math.ceil((Date.parse(event.endsAt) - Date.parse(event.startsAt)) / 86400000)))}T00:00:00.000Z`, allDay: true
    };
    const minutes = target.minutes === undefined ? start.minutes : start.minutes + target.minutes - (origin.minutes ?? start.minutes);
    const day = calendarAddUtcDays(start.dayKey, dayDelta + Math.floor(minutes / 1440));
    const normalized = ((minutes % 1440) + 1440) % 1440;
    const startsAt = zonedDateTimeIso(day, Math.floor(normalized / 60), normalized % 60, zone);
    const duration = event.allDay ? 60 * 60000 : Date.parse(event.endsAt) - Date.parse(event.startsAt);
    return { startsAt, endsAt: new Date(Date.parse(startsAt) + duration).toISOString(), allDay: false };
  }
  const original = kind === "start" ? start : end;
  const day = target.minutes === undefined
    ? (event.allDay && kind === "end" ? calendarAddUtcDays(target.day, 1) : target.day)
    : target.day;
  const minutes = target.minutes ?? original.minutes;
  const normalizedMinutes = ((minutes % 1440) + 1440) % 1440;
  const value = event.allDay
    ? `${day}T00:00:00.000Z`
    : zonedDateTimeIso(calendarAddUtcDays(day, Math.floor(minutes / 1440)), Math.floor(normalizedMinutes / 60), normalizedMinutes % 60, zone);
  const minimum = event.allDay ? 86400000 : 15 * 60000;
  return {
    startsAt: kind === "start" ? new Date(Math.min(Date.parse(value), Date.parse(event.endsAt) - minimum)).toISOString() : event.startsAt,
    endsAt: kind === "end" ? new Date(Math.max(Date.parse(value), Date.parse(event.startsAt) + minimum)).toISOString() : event.endsAt,
    allDay: event.allDay
  };
}

export function calendarRangeChanged(event: CalendarEventRange, next: CalendarEventRange): boolean {
  return Date.parse(event.startsAt) !== Date.parse(next.startsAt) || Date.parse(event.endsAt) !== Date.parse(next.endsAt) || event.allDay !== next.allDay;
}
