import { TZDate, tzOffset } from "@date-fns/tz";
import { addDays, format } from "date-fns";
import type { CalendarEvent } from "../components/week-view-types";

export function systemTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

const resolvedZones = new Map<string, string>();

export function resolveTimeZone(value?: string): string {
  const zone = value === "GMT-3 Sao Paulo" ? "America/Sao_Paulo" : value;
  if (zone) {
    if (resolvedZones.has(zone)) return resolvedZones.get(zone)!;
    try {
      const resolved = new Intl.DateTimeFormat("en", {
        timeZone: zone,
      }).resolvedOptions().timeZone;
      resolvedZones.set(zone, resolved);
      return resolved;
    } catch {
      // Old sample labels are not time zone identifiers.
    }
  }
  return systemTimeZone();
}

export function eventTimeZone(
  event: Pick<CalendarEvent, "timezone" | "isAllDay">,
): string {
  return event.isAllDay ? systemTimeZone() : resolveTimeZone(event.timezone);
}

export function inTimeZone(date: Date, zone: string): TZDate {
  return new TZDate(date.getTime(), zone);
}

/** UTC fields carry wall-clock components; this is not an instant. */
export function wallDate(date: Date, zone: string): Date {
  const zoned = inTimeZone(date, zone);
  return new Date(
    Date.UTC(
      zoned.getFullYear(),
      zoned.getMonth(),
      zoned.getDate(),
      zoned.getHours(),
      zoned.getMinutes(),
      zoned.getSeconds(),
      zoned.getMilliseconds(),
    ),
  );
}

/** Reject nonexistent local times instead of silently shifting across a DST gap. */
export function fromWallDate(wall: Date, zone: string): Date | null {
  const date = new TZDate(
    wall.getUTCFullYear(),
    wall.getUTCMonth(),
    wall.getUTCDate(),
    wall.getUTCHours(),
    wall.getUTCMinutes(),
    wall.getUTCSeconds(),
    wall.getUTCMilliseconds(),
    zone,
  );
  const instant = new Date(date.getTime());
  return wallDate(instant, zone).getTime() === wall.getTime() ? instant : null;
}

export function applyZonedTime(
  date: Date,
  hours: number,
  minutes: number,
  zone: string,
): Date | null {
  const wall = wallDate(date, zone);
  if (wall.getUTCHours() === hours && wall.getUTCMinutes() === minutes)
    return new Date(date);
  wall.setUTCHours(hours, minutes, 0, 0);
  return fromWallDate(wall, zone);
}

export function shiftZonedDays(
  date: Date,
  days: number,
  zone: string,
): Date | null {
  const wall = wallDate(date, zone);
  wall.setUTCDate(wall.getUTCDate() + days);
  return fromWallDate(wall, zone);
}

export function zoneDateKey(date: Date, zone: string): string {
  return format(inTimeZone(date, zone), "yyyy-MM-dd");
}

export function timeZoneLabel(zone: string, date: Date): string {
  const offset = tzOffset(zone, date);
  const sign = offset < 0 ? "−" : "+";
  const magnitude = Math.abs(offset);
  const hours = Math.floor(magnitude / 60)
    .toString()
    .padStart(2, "0");
  const minutes = (magnitude % 60).toString().padStart(2, "0");
  const city =
    zone === "UTC"
      ? "UTC"
      : zone.split("/").slice(1).join(" / ").replaceAll("_", " ");
  return `GMT${sign}${hours}:${minutes} ${city || zone}`;
}

export function supportedTimeZones(): string[] {
  const zones =
    typeof Intl.supportedValuesOf === "function"
      ? Intl.supportedValuesOf("timeZone")
      : [
          "America/New_York",
          "America/Los_Angeles",
          "America/Sao_Paulo",
          "Europe/London",
          "Europe/Paris",
          "Asia/Singapore",
          "Asia/Tokyo",
          "Australia/Sydney",
        ];
  return [...new Set([systemTimeZone(), "UTC", ...zones])];
}

/** Preserve dates, rather than instants, when switching all-day/timed representations. */
export function allDayDates(
  event: CalendarEvent,
  allDay: boolean,
): { start: Date; end: Date } {
  if (allDay) {
    const zone = eventTimeZone(event);
    const start = inTimeZone(event.start, zone),
      end = inTimeZone(event.end, zone);
    return {
      start: new Date(start.getFullYear(), start.getMonth(), start.getDate()),
      end: new Date(end.getFullYear(), end.getMonth(), end.getDate()),
    };
  }
  const zone = resolveTimeZone(event.timezone);
  const start = new TZDate(
    event.start.getFullYear(),
    event.start.getMonth(),
    event.start.getDate(),
    9,
    0,
    0,
    0,
    zone,
  );
  let end = new TZDate(
    event.end.getFullYear(),
    event.end.getMonth(),
    event.end.getDate(),
    10,
    0,
    0,
    0,
    zone,
  );
  if (end.getTime() <= start.getTime()) end = addDays(start, 1);
  return { start: new Date(start), end: new Date(end) };
}
