import { zonedDayRange } from "@shared/zonedTime";

export function calendarDayRange(day: string, timeZone = "UTC"): { start: string; end: string } { return zonedDayRange(day, timeZone); }

export function calendarDaysRange(days: readonly string[], timeZone = "UTC"): { start: string; end: string } {
  const sorted = [...days].sort();
  if (!sorted.length) throw new Error("Choose a calendar day before loading its range.");
  return { start: zonedDayRange(sorted[0], timeZone).start, end: zonedDayRange(sorted[sorted.length - 1], timeZone).end };
}

export function calendarMonthRange(day: string, timeZone = "UTC"): { start: string; end: string } {
  const first = new Date(`${day.slice(0, 7)}-01T00:00:00.000Z`);
  first.setUTCDate(first.getUTCDate() - first.getUTCDay());
  const last = new Date(first); last.setUTCDate(last.getUTCDate() + 41);
  return calendarDaysRange([first.toISOString().slice(0, 10), last.toISOString().slice(0, 10)], timeZone);
}
