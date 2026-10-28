import { cachedDateTimeFormat, zonedDateTimeIso } from "@shared/zonedTime";

interface BoundaryRange { startsAt: string; endsAt: string; allDay: boolean }

function civilTime(value: string, allDay: boolean, timeZone: string): number {
  if (allDay) return Date.parse(`${value.slice(0, 10)}T00:00:00Z`);
  const parts = Object.fromEntries(cachedDateTimeFormat("en-CA", {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", timeZone
  }).formatToParts(new Date(value)).map((part) => [part.type, part.value]));
  return Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`);
}

/** A gesture on a later occurrence shifts the series anchor by the same civil
 * delta; it must not replace DTSTART with the later occurrence's absolute date. */
export function shiftSeriesTime(master: BoundaryRange, origin: BoundaryRange, target: BoundaryRange, timeZone: string): BoundaryRange {
  const shift = (key: "startsAt" | "endsAt") => {
    const shifted = new Date(civilTime(master[key], master.allDay, timeZone) + civilTime(target[key], target.allDay, timeZone) - civilTime(origin[key], origin.allDay, timeZone));
    if (target.allDay) return `${shifted.toISOString().slice(0, 10)}T00:00:00.000Z`;
    return new Date(Date.parse(zonedDateTimeIso(shifted.toISOString().slice(0, 10), shifted.getUTCHours(), shifted.getUTCMinutes(), timeZone)) + shifted.getUTCSeconds() * 1000).toISOString();
  };
  return { startsAt: shift("startsAt"), endsAt: shift("endsAt"), allDay: target.allDay };
}
