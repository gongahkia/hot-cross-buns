/** Intl formatters retain native ICU state; reuse a bounded set instead of allocating per row. */
const formatters = new Map<string, Intl.DateTimeFormat>();
export function cachedDateTimeFormat(locale: string | undefined, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = JSON.stringify([locale, options]);
  const existing = formatters.get(key);
  if (existing) { formatters.delete(key); formatters.set(key, existing); return existing; }
  const formatter = new Intl.DateTimeFormat(locale, options);
  formatters.set(key, formatter);
  if (formatters.size > 64) formatters.delete(formatters.keys().next().value!);
  return formatter;
}

function point(date: Date, timeZone: string): { day: string; minutes: number } {
  const parts = Object.fromEntries(cachedDateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }).formatToParts(date).map((part) => [part.type, part.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

export function currentZonedDay(timeZone: string, now = new Date()): string { return point(now, timeZone).day; }

export function zonedDateTimeIso(day: string, hour: number, minute: number, timeZone: string): string {
  const civil = new Date(`${day}T00:00:00.000Z`);
  civil.setUTCDate(civil.getUTCDate() + Math.floor(hour / 24));
  const minutes = ((hour % 24) + 24) % 24 * 60 + Math.max(0, Math.min(59, minute));
  const target = civil.getTime() / 60000 + minutes;
  let instant = target * 60000;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const actual = point(new Date(instant), timeZone);
    const difference = target - (Date.parse(`${actual.day}T00:00:00.000Z`) / 60000 + actual.minutes);
    if (!difference) break;
    instant += difference * 60000;
  }
  return new Date(instant).toISOString();
}

export function zonedDayRange(day: string, timeZone: string): { start: string; end: string } {
  const next = new Date(`${day}T00:00:00.000Z`); next.setUTCDate(next.getUTCDate() + 1);
  return { start: zonedDateTimeIso(day, 0, 0, timeZone), end: zonedDateTimeIso(next.toISOString().slice(0, 10), 0, 0, timeZone) };
}
