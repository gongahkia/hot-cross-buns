import { validDate, type TodoDocument } from './todoText.ts';
import { describeScheduled, formatScheduled, newSeriesId, nextScheduledDate, parseScheduled, validSeriesId, type ScheduledRule } from './scheduledRecurrence.ts';
export { newSeriesId } from './scheduledRecurrence.ts';
export type { ScheduledRule, ScheduledPattern, ScheduleEnd, Ordinal, Weekday } from './scheduledRecurrence.ts';

const weekdays = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
type Weekday = typeof weekdays[number];
type IntervalUnit = 'days' | 'weeks' | 'months' | 'years';
type Identity = { series?: string; occurrence?: number; endsOn?: string };

export type RecurrenceRule =
  | ({ kind: 'daily' } & Identity)
  | ({ kind: 'weekdays' } & Identity)
  | ({ kind: 'weekly'; days: Weekday[] } & Identity)
  | ({ kind: 'monthly'; day: number } & Identity)
  | ({ kind: 'yearly'; month: number; day: number } & Identity)
  | ({ kind: 'after'; every: number; unit: IntervalUnit } & Identity)
  | ScheduledRule;

export function parseRecurrence(raw: string): RecurrenceRule | null {
  const value = raw.trim().toLowerCase();
  const scheduled = parseScheduled(value);
  if (scheduled) return scheduled;
  const [base, ...clauses] = value.split(/\s*;\s*/);
  let identity: Identity = {};
  if (clauses.length) {
    const values = new Map<string, string>();
    for (const clause of clauses) {
      const match = /^(series|occurrence|ends on) (.+)$/.exec(clause);
      if (!match || values.has(match[1])) return null;
      values.set(match[1], match[2]);
    }
    const series = values.get('series');
    const occurrenceRaw = values.get('occurrence');
    const endsOn = values.get('ends on');
    const occurrence = occurrenceRaw === undefined ? undefined : Number(occurrenceRaw);
    if ((series && !validSeriesId(series)) || (occurrence && !series) || (occurrence !== undefined && (!Number.isSafeInteger(occurrence) || occurrence < 1 || occurrence > 9999)) || (endsOn && !validDate(endsOn))) return null;
    identity = { ...(series ? { series } : {}), ...(occurrence ? { occurrence } : {}), ...(endsOn ? { endsOn } : {}) };
  }
  if (base === 'daily') return { kind: 'daily', ...identity };
  if (base === 'weekdays') return { kind: 'weekdays', ...identity };
  const weekly = /^weekly on (mon|tue|wed|thu|fri|sat|sun)(?:\s*,\s*(?:mon|tue|wed|thu|fri|sat|sun))*$/.exec(base);
  if (weekly) {
    const days = [...new Set(base.slice(10).split(/\s*,\s*/) as Weekday[])];
    return { kind: 'weekly', days: weekdays.filter(day => days.includes(day)), ...identity };
  }
  const monthly = /^monthly on (\d{1,2})$/.exec(base);
  if (monthly && Number(monthly[1]) >= 1 && Number(monthly[1]) <= 31) return { kind: 'monthly', day: Number(monthly[1]), ...identity };
  const yearly = /^yearly on (\d{2})-(\d{2})$/.exec(base);
  if (yearly) {
    const month = Number(yearly[1]);
    const day = Number(yearly[2]);
    if (month >= 1 && month <= 12 && new Date(Date.UTC(2024, month - 1, day)).getUTCMonth() === month - 1 && day >= 1) return { kind: 'yearly', month, day, ...identity };
  }
  const after = /^every ([1-9]\d*) (days?|weeks?|months?|years?) after completion$/.exec(base);
  if (after && Number(after[1]) <= 999) return { kind: 'after', every: Number(after[1]), unit: `${after[2].replace(/s$/, '')}s` as IntervalUnit, ...identity };
  return null;
}

export function formatRecurrence(rule: RecurrenceRule): string {
  if (rule.kind === 'scheduled') return formatScheduled(rule);
  const identity = (rule.series ? `; series ${rule.series}` : '') + (rule.occurrence ? `; occurrence ${rule.occurrence}` : '') + (rule.endsOn ? `; ends on ${rule.endsOn}` : '');
  switch (rule.kind) {
    case 'daily': return 'daily' + identity;
    case 'weekdays': return 'weekdays' + identity;
    case 'weekly': return `weekly on ${rule.days.join(', ')}` + identity;
    case 'monthly': return `monthly on ${rule.day}` + identity;
    case 'yearly': return `yearly on ${String(rule.month).padStart(2, '0')}-${String(rule.day).padStart(2, '0')}` + identity;
    case 'after': return `every ${rule.every} ${rule.every === 1 ? rule.unit.slice(0, -1) : rule.unit} after completion` + identity;
  }
}

export function describeRecurrence(rule: RecurrenceRule): string {
  if (rule.kind === 'scheduled') return describeScheduled(rule);
  const { series: _series, occurrence: _occurrence, endsOn: _endsOn, ...plain } = rule;
  return formatRecurrence(plain as RecurrenceRule);
}

const fromDate = (date: string) => new Date(`${date}T12:00:00Z`);
const toDate = (date: Date) => date.toISOString().slice(0, 10);
const addDays = (date: string, days: number) => { const next = fromDate(date); next.setUTCDate(next.getUTCDate() + days); return toDate(next); };
const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

export function nextRecurrenceDate(rule: RecurrenceRule, afterDate: string): string | null {
  if (rule.kind === 'scheduled') return nextScheduledDate(rule, afterDate);
  if (rule.endsOn && afterDate >= rule.endsOn) return null;
  const withinEnd = (date: string) => !rule.endsOn || date <= rule.endsOn ? date : null;
  if (rule.kind === 'daily') return withinEnd(addDays(afterDate, 1));
  if (rule.kind === 'weekdays' || rule.kind === 'weekly') {
    for (let offset = 1; offset <= 7; offset++) {
      const candidate = addDays(afterDate, offset);
      const day = weekdays[(fromDate(candidate).getUTCDay() + 6) % 7];
      if (rule.kind === 'weekdays' ? day !== 'sat' && day !== 'sun' : rule.days.includes(day)) return withinEnd(candidate);
    }
  }
  if (rule.kind === 'monthly') {
    const current = fromDate(afterDate);
    for (let offset = 0; offset <= 12; offset++) {
      const monthIndex = current.getUTCMonth() + offset;
      const year = current.getUTCFullYear() + Math.floor(monthIndex / 12);
      const month = monthIndex % 12 + 1;
      if (rule.day > daysInMonth(year, month)) continue;
      const candidate = `${year}-${String(month).padStart(2, '0')}-${String(rule.day).padStart(2, '0')}`;
      if (candidate > afterDate) return withinEnd(candidate);
    }
  }
  if (rule.kind === 'yearly') {
    const year = fromDate(afterDate).getUTCFullYear();
    for (let offset = 0; offset <= 8; offset++) {
      if (rule.day > daysInMonth(year + offset, rule.month)) continue;
      const candidate = `${year + offset}-${String(rule.month).padStart(2, '0')}-${String(rule.day).padStart(2, '0')}`;
      if (candidate > afterDate) return withinEnd(candidate);
    }
  }
  if (rule.kind === 'after') {
    if (rule.unit === 'days') return withinEnd(addDays(afterDate, rule.every));
    if (rule.unit === 'weeks') return withinEnd(addDays(afterDate, rule.every * 7));
    const current = fromDate(afterDate);
    const months = rule.every * (rule.unit === 'years' ? 12 : 1);
    const targetMonth = current.getUTCMonth() + months;
    const year = current.getUTCFullYear() + Math.floor(targetMonth / 12);
    const month = targetMonth % 12 + 1;
    return withinEnd(`${year}-${String(month).padStart(2, '0')}-${String(Math.min(current.getUTCDate(), daysInMonth(year, month))).padStart(2, '0')}`);
  }
  throw new Error(`Cannot calculate recurrence after ${afterDate}`);
}

/** Stamp fresh completions; imports can also recover older missing successors. */
export function advanceRecurrences(before: TodoDocument, after: TodoDocument, completedOn: string, recoverImported = false, baseline: TodoDocument | null = null): void {
  const prior = new Map(before.days.flatMap(day => day.items.map(item => [item.id, item] as const)));
  const completedKeys = new Set<string>();
  for (const day of after.days) for (const item of day.items) {
    const previous = prior.get(item.id);
    if (previous?.completed && !item.completed) delete item.completedOn;
    if (!item.completed || item.repeat?.kind !== 'after' || previous?.completed !== false) continue;
    item.completedOn ??= completedOn;
    if (!item.repeat.series || !item.repeat.occurrence) item.repeat = { ...item.repeat, series: newSeriesId(item.text, day.date), occurrence: 1 };
    completedKeys.add(`${item.repeat.series}:${item.repeat.occurrence}`);
  }
  if (recoverImported) {
    const present = new Set(after.days.flatMap(day => day.items.filter(item => item.repeat?.series && item.repeat.occurrence).map(item => `${item.repeat!.series}:${item.repeat!.occurrence}`)));
    const removed = new Set(baseline?.days.flatMap(day => day.items.filter(item => item.repeat?.series && item.repeat.occurrence)
      .map(item => `${item.repeat!.series}:${item.repeat!.occurrence}`).filter(key => !present.has(key))) ?? []);
    reconcileRecurrences(after, undefined, removed);
  }
  else if (completedKeys.size) reconcileRecurrences(after, completedKeys);
}

/** Reading the same completed series repeatedly creates at most its one missing next item. */
export function reconcileRecurrences(document: TodoDocument, onlyKeys?: Set<string>, removedKeys?: Set<string>): void {
  const occurrences = document.days.flatMap(day => day.items.map(item => ({ date: day.date, item })));
  const seen = new Set(occurrences.filter(({item}) => item.repeat?.series && item.repeat.occurrence).map(({item}) => `${item.repeat!.series}:${item.repeat!.occurrence}`));
  for (const { date, item } of occurrences) {
    const rule = item.repeat;
    if (!item.completed || !item.completedOn || rule?.kind !== 'after' || !rule.series || !rule.occurrence || rule.occurrence >= 9999) continue;
    if (onlyKeys && !onlyKeys.has(`${rule.series}:${rule.occurrence}`)) continue;
    const nextKey = `${rule.series}:${rule.occurrence + 1}`;
    if (seen.has(nextKey) || removedKeys?.has(nextKey)) continue;
    const nextDate = nextRecurrenceDate(rule, item.completedOn > date ? item.completedOn : date);
    if (!nextDate) continue;
    const nextRule: RecurrenceRule = { ...rule, occurrence: rule.occurrence + 1 };
    let nextDay = document.days.find(candidate => candidate.date === nextDate);
    if (!nextDay) { nextDay = { date: nextDate, items: [] }; document.days.push(nextDay); }
    nextDay.items.push({ id: crypto.randomUUID(), text: item.text, completed: false, repeat: nextRule, details: item.details.map(detail => ({ text: detail.text, completed: false })) });
    seen.add(nextKey);
  }
  document.days.sort((a, b) => a.date.localeCompare(b.date));
}
