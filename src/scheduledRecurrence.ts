export const weekdays = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type Weekday = typeof weekdays[number];
export type Ordinal = 1 | 2 | 3 | 4 | 5 | -1;
export type ScheduledPattern =
  | { unit: 'days' }
  | { unit: 'weeks'; days: Weekday[] }
  | { unit: 'months'; on: { kind: 'day'; day: number } | { kind: 'weekday'; ordinal: Ordinal; weekday: Weekday } }
  | { unit: 'years'; on: { kind: 'date'; month: number; day: number } | { kind: 'weekday'; month: number; ordinal: Ordinal; weekday: Weekday } };
export type ScheduleEnd = { kind: 'on'; date: string } | { kind: 'after'; count: number };
export type ScheduledRule = {
  kind: 'scheduled';
  every: number;
  pattern: ScheduledPattern;
  from: string;
  series: string;
  occurrence: number;
  end?: ScheduleEnd;
};

const monthNames = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const ordinals: Record<string, Ordinal> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, last: -1 };
const ordinalNames: Record<Ordinal, string> = { 1: 'first', 2: 'second', 3: 'third', 4: 'fourth', 5: 'fifth', '-1': 'last' };
const fromDate = (date: string) => new Date(date + 'T12:00:00Z');
const toDate = (date: Date) => date.toISOString().slice(0, 10);
const addDays = (date: string, days: number) => { const next = fromDate(date); next.setUTCDate(next.getUTCDate() + days); return toDate(next); };
const daysBetween = (from: string, to: string) => Math.round((fromDate(to).getTime() - fromDate(from).getTime()) / 86400000);
const mondayOf = (date: string) => addDays(date, -((fromDate(date).getUTCDay() + 6) % 7));
const monthIndex = (date: string) => Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;
const monthParts = (index: number) => ({ year: Math.floor(index / 12), month: index % 12 + 1 });
const calendarDate = (year: number, month: number, day: number) => { const date = new Date(0); date.setUTCFullYear(year, month - 1, day); return date; };
const daysInMonth = (year: number, month: number) => calendarDate(year, month + 1, 0).getUTCDate();
const iso = (year: number, month: number, day: number) => String(year).padStart(4, '0') + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
const weekdayIndex = (weekday: Weekday) => weekdays.indexOf(weekday);
export const validScheduleDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(fromDate(value).getTime()) && toDate(fromDate(value)) === value;
const validMonthDay = (month: number, day: number) => month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(2024, month);

function parseDays(value: string): Weekday[] | null {
  if (!/^(?:mon|tue|wed|thu|fri|sat|sun)(?:\s*,\s*(?:mon|tue|wed|thu|fri|sat|sun))*$/.test(value)) return null;
  const selected = value.split(/\s*,\s*/) as Weekday[];
  return weekdays.filter(day => selected.includes(day));
}

export function parseScheduled(raw: string): ScheduledRule | null {
  const parts = raw.split(/\s*;\s*/);
  if (parts.length < 4 || parts.length > 5) return null;
  const first = /^every ([1-9]\d*) (days?|weeks?|months?|years?)(?: on (.+))?$/.exec(parts[0]);
  if (!first || Number(first[1]) > 999) return null;
  const every = Number(first[1]);
  const unit = first[2].replace(/s$/, '') + 's';
  const on = first[3];
  let pattern: ScheduledPattern;
  if (unit === 'days') {
    if (on) return null;
    pattern = { unit };
  } else if (unit === 'weeks') {
    const days = on ? parseDays(on) : null;
    if (!days?.length) return null;
    pattern = { unit, days };
  } else if (unit === 'months') {
    const day = on && /^(\d{1,2})$/.exec(on);
    const ordinal = on && /^(first|second|third|fourth|fifth|last) (mon|tue|wed|thu|fri|sat|sun)$/.exec(on);
    if (day && Number(day[1]) >= 1 && Number(day[1]) <= 31) pattern = { unit, on: { kind: 'day', day: Number(day[1]) } };
    else if (ordinal) pattern = { unit, on: { kind: 'weekday', ordinal: ordinals[ordinal[1]], weekday: ordinal[2] as Weekday } };
    else return null;
  } else {
    const date = on && /^(\d{2})-(\d{2})$/.exec(on);
    const ordinal = on && /^(first|second|third|fourth|fifth|last) (mon|tue|wed|thu|fri|sat|sun) of ([a-z]+)$/.exec(on);
    if (date && validMonthDay(Number(date[1]), Number(date[2]))) pattern = { unit: 'years', on: { kind: 'date', month: Number(date[1]), day: Number(date[2]) } };
    else if (ordinal && monthNames.includes(ordinal[3])) pattern = { unit: 'years', on: { kind: 'weekday', month: monthNames.indexOf(ordinal[3]) + 1, ordinal: ordinals[ordinal[1]], weekday: ordinal[2] as Weekday } };
    else return null;
  }
  const clauses = new Map<string, string>();
  for (const clause of parts.slice(1)) {
    const match = /^(from|series|occurrence|ends) (.+)$/.exec(clause);
    if (!match || clauses.has(match[1])) return null;
    clauses.set(match[1], match[2]);
  }
  const from = clauses.get('from') ?? '';
  const series = clauses.get('series') ?? '';
  const occurrence = Number(clauses.get('occurrence'));
  if (!validScheduleDate(from) || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(series) || !Number.isSafeInteger(occurrence) || occurrence < 1 || occurrence > 9999) return null;
  let end: ScheduleEnd | undefined;
  const ends = clauses.get('ends');
  if (ends) {
    const count = /^after ([1-9]\d*)$/.exec(ends);
    const date = /^on (\d{4}-\d{2}-\d{2})$/.exec(ends);
    if (count && Number(count[1]) <= 9999 && occurrence <= Number(count[1])) end = { kind: 'after', count: Number(count[1]) };
    else if (date && validScheduleDate(date[1])) end = { kind: 'on', date: date[1] };
    else return null;
  }
  return { kind: 'scheduled', every, pattern, from, series, occurrence, ...(end ? { end } : {}) };
}

function patternText(rule: ScheduledRule): string {
  const { pattern } = rule;
  let suffix = '';
  if (pattern.unit === 'weeks') suffix = ' on ' + pattern.days.join(', ');
  if (pattern.unit === 'months') suffix = pattern.on.kind === 'day' ? ' on ' + pattern.on.day : ' on ' + ordinalNames[pattern.on.ordinal] + ' ' + pattern.on.weekday;
  if (pattern.unit === 'years') suffix = pattern.on.kind === 'date'
    ? ' on ' + String(pattern.on.month).padStart(2, '0') + '-' + String(pattern.on.day).padStart(2, '0')
    : ' on ' + ordinalNames[pattern.on.ordinal] + ' ' + pattern.on.weekday + ' of ' + monthNames[pattern.on.month - 1];
  return 'every ' + rule.every + ' ' + (rule.every === 1 ? pattern.unit.slice(0, -1) : pattern.unit) + suffix;
}

export function formatScheduled(rule: ScheduledRule): string {
  return patternText(rule) + '; from ' + rule.from + '; series ' + rule.series + '; occurrence ' + rule.occurrence
    + (rule.end ? '; ends ' + (rule.end.kind === 'on' ? 'on ' + rule.end.date : 'after ' + rule.end.count) : '');
}

export function describeScheduled(rule: ScheduledRule): string {
  const end = rule.end?.kind === 'on' ? ' until ' + rule.end.date : rule.end?.kind === 'after' ? ' (' + rule.occurrence + '/' + rule.end.count + ')' : '';
  return patternText(rule) + end;
}

export function newSeriesId(title: string, from: string): string {
  const slug = title.replace(/^\d{2}:\d{2}-\d{2}:\d{2} /, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'item';
  return slug + '-' + from.replaceAll('-', '') + '-' + crypto.randomUUID().replaceAll('-', '').slice(0, 10);
}

function ordinalDay(year: number, month: number, ordinal: Ordinal, weekday: Weekday): number | null {
  const last = daysInMonth(year, month);
  if (ordinal === -1) {
    const lastWeekday = (calendarDate(year, month, last).getUTCDay() + 6) % 7;
    return last - ((lastWeekday - weekdayIndex(weekday) + 7) % 7);
  }
  const firstWeekday = (calendarDate(year, month, 1).getUTCDay() + 6) % 7;
  const day = 1 + ((weekdayIndex(weekday) - firstWeekday + 7) % 7) + (ordinal - 1) * 7;
  return day <= last ? day : null;
}

function candidateInMonth(pattern: Extract<ScheduledPattern, { unit: 'months' | 'years' }>, year: number, month: number): string | null {
  if (pattern.unit === 'months') {
    const on = pattern.on;
    const day = on.kind === 'day' ? on.day : ordinalDay(year, month, on.ordinal, on.weekday);
    return day && day <= daysInMonth(year, month) ? iso(year, month, day) : null;
  }
  const on = pattern.on;
  if (on.month !== month) return null;
  const day = on.kind === 'date' ? on.day : ordinalDay(year, month, on.ordinal, on.weekday);
  return day && day <= daysInMonth(year, month) ? iso(year, month, day) : null;
}

export function nextScheduledDate(rule: ScheduledRule, afterDate: string): string | null {
  if (rule.end?.kind === 'after' && rule.occurrence >= rule.end.count) return null;
  if (rule.end?.kind === 'on' && afterDate >= rule.end.date) return null;
  const { pattern, from, every } = rule;
  let candidate: string | null = null;
  if (pattern.unit === 'days') {
    const steps = Math.max(0, Math.floor(daysBetween(from, afterDate) / every) + 1);
    candidate = addDays(from, steps * every);
  } else if (pattern.unit === 'weeks') {
    const firstWeek = mondayOf(from);
    const currentWeek = mondayOf(afterDate);
    const elapsed = Math.max(0, Math.floor(daysBetween(firstWeek, currentWeek) / 7));
    const start = Math.floor(elapsed / every) * every;
    for (let week = start; week <= start + every * 2; week += every) {
      for (const day of pattern.days) {
        const option = addDays(firstWeek, week * 7 + weekdayIndex(day));
        if (option > afterDate && option >= from) { candidate = option; break; }
      }
      if (candidate) break;
    }
  } else if (pattern.unit === 'months') {
    const first = monthIndex(from);
    const elapsed = Math.max(0, Math.floor((monthIndex(afterDate) - first) / every));
    for (let step = elapsed; step < elapsed + 4800; step++) {
      const { year, month } = monthParts(first + step * every);
      if (year > 9999) break;
      const option = candidateInMonth(pattern, year, month);
      if (option && option > afterDate && option >= from) { candidate = option; break; }
    }
  } else {
    const firstYear = Number(from.slice(0, 4));
    const elapsed = Math.max(0, Math.floor((Number(afterDate.slice(0, 4)) - firstYear) / every));
    for (let step = elapsed; step < elapsed + 400; step++) {
      const year = firstYear + step * every;
      if (year > 9999) break;
      const option = candidateInMonth(pattern, year, pattern.on.month);
      if (option && option > afterDate && option >= from) { candidate = option; break; }
    }
  }
  if (!candidate || !validScheduleDate(candidate)) return null;
  if (rule.end?.kind === 'on' && candidate > rule.end.date) return null;
  if (rule.end?.kind === 'after' && rule.occurrence >= rule.end.count) return null;
  return candidate;
}
