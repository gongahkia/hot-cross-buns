import type { TodoDocument, TodoItem } from './todoText.ts';
import { describeScheduled, formatScheduled, nextScheduledDate, parseScheduled, type ScheduledRule } from './scheduledRecurrence.ts';
export { newSeriesId } from './scheduledRecurrence.ts';
export type { ScheduledRule, ScheduledPattern, ScheduleEnd, Ordinal, Weekday } from './scheduledRecurrence.ts';

const weekdays = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
type Weekday = typeof weekdays[number];
type IntervalUnit = 'days' | 'weeks' | 'months' | 'years';

export type RecurrenceRule =
  | { kind: 'daily' }
  | { kind: 'weekdays' }
  | { kind: 'weekly'; days: Weekday[] }
  | { kind: 'monthly'; day: number }
  | { kind: 'yearly'; month: number; day: number }
  | { kind: 'after'; every: number; unit: IntervalUnit }
  | ScheduledRule;

export function parseRecurrence(raw: string): RecurrenceRule | null {
  const value = raw.trim().toLowerCase();
  if (value === 'daily') return { kind: 'daily' };
  if (value === 'weekdays') return { kind: 'weekdays' };
  const weekly = /^weekly on (mon|tue|wed|thu|fri|sat|sun)(?:\s*,\s*(?:mon|tue|wed|thu|fri|sat|sun))*$/.exec(value);
  if (weekly) {
    const days = [...new Set(value.slice(10).split(/\s*,\s*/) as Weekday[])];
    return { kind: 'weekly', days: weekdays.filter(day => days.includes(day)) };
  }
  const monthly = /^monthly on (\d{1,2})$/.exec(value);
  if (monthly && Number(monthly[1]) >= 1 && Number(monthly[1]) <= 31) return { kind: 'monthly', day: Number(monthly[1]) };
  const yearly = /^yearly on (\d{2})-(\d{2})$/.exec(value);
  if (yearly) {
    const month = Number(yearly[1]);
    const day = Number(yearly[2]);
    if (month >= 1 && month <= 12 && new Date(Date.UTC(2024, month - 1, day)).getUTCMonth() === month - 1 && day >= 1) return { kind: 'yearly', month, day };
  }
  const after = /^every ([1-9]\d*) (days?|weeks?|months?|years?) after completion$/.exec(value);
  if (after && Number(after[1]) <= 999) return { kind: 'after', every: Number(after[1]), unit: `${after[2].replace(/s$/, '')}s` as IntervalUnit };
  return parseScheduled(value);
}

export function formatRecurrence(rule: RecurrenceRule): string {
  switch (rule.kind) {
    case 'daily': return 'daily';
    case 'weekdays': return 'weekdays';
    case 'weekly': return `weekly on ${rule.days.join(', ')}`;
    case 'monthly': return `monthly on ${rule.day}`;
    case 'yearly': return `yearly on ${String(rule.month).padStart(2, '0')}-${String(rule.day).padStart(2, '0')}`;
    case 'after': return `every ${rule.every} ${rule.every === 1 ? rule.unit.slice(0, -1) : rule.unit} after completion`;
    case 'scheduled': return formatScheduled(rule);
  }
}

export function describeRecurrence(rule: RecurrenceRule): string {
  return rule.kind === 'scheduled' ? describeScheduled(rule) : formatRecurrence(rule);
}

const fromDate = (date: string) => new Date(`${date}T12:00:00Z`);
const toDate = (date: Date) => date.toISOString().slice(0, 10);
const addDays = (date: string, days: number) => { const next = fromDate(date); next.setUTCDate(next.getUTCDate() + days); return toDate(next); };
const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

export function nextRecurrenceDate(rule: RecurrenceRule, afterDate: string): string | null {
  if (rule.kind === 'scheduled') return nextScheduledDate(rule, afterDate);
  if (rule.kind === 'daily') return addDays(afterDate, 1);
  if (rule.kind === 'weekdays' || rule.kind === 'weekly') {
    for (let offset = 1; offset <= 7; offset++) {
      const candidate = addDays(afterDate, offset);
      const day = weekdays[(fromDate(candidate).getUTCDay() + 6) % 7];
      if (rule.kind === 'weekdays' ? day !== 'sat' && day !== 'sun' : rule.days.includes(day)) return candidate;
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
      if (candidate > afterDate) return candidate;
    }
  }
  if (rule.kind === 'yearly') {
    const year = fromDate(afterDate).getUTCFullYear();
    for (let offset = 0; offset <= 8; offset++) {
      if (rule.day > daysInMonth(year + offset, rule.month)) continue;
      const candidate = `${year + offset}-${String(rule.month).padStart(2, '0')}-${String(rule.day).padStart(2, '0')}`;
      if (candidate > afterDate) return candidate;
    }
  }
  if (rule.kind === 'after') {
    if (rule.unit === 'days') return addDays(afterDate, rule.every);
    if (rule.unit === 'weeks') return addDays(afterDate, rule.every * 7);
    const current = fromDate(afterDate);
    const months = rule.every * (rule.unit === 'years' ? 12 : 1);
    const targetMonth = current.getUTCMonth() + months;
    const year = current.getUTCFullYear() + Math.floor(targetMonth / 12);
    const month = targetMonth % 12 + 1;
    return `${year}-${String(month).padStart(2, '0')}-${String(Math.min(current.getUTCDate(), daysInMonth(year, month))).padStart(2, '0')}`;
  }
  throw new Error(`Cannot calculate recurrence after ${afterDate}`);
}

/** Generate one next occurrence for an item that just became complete. Never scan old completed items. */
export function advanceRecurrences(before: TodoDocument, after: TodoDocument, completedOn: string): void {
  const prior = new Map(before.days.flatMap(day => day.items.map(item => [item.id, item] as const)));
  const newlyCompleted = after.days.flatMap(day => day.items.filter(item => item.completed && item.repeat && prior.get(item.id)?.completed === false).map(item => ({ date: day.date, item })));
  for (const { date, item } of newlyCompleted) {
    const rule = item.repeat!;
    const nextDate = nextRecurrenceDate(rule, completedOn > date ? completedOn : date);
    if (!nextDate) continue;
    const nextRule: RecurrenceRule = rule.kind === 'scheduled' ? { ...rule, occurrence: rule.occurrence + 1 } : structuredClone(rule);
    if (rule.kind === 'scheduled' && after.days.some(day => day.items.some(candidate => candidate.repeat?.kind === 'scheduled'
      && candidate.repeat.series === rule.series && candidate.repeat.occurrence === rule.occurrence + 1))) continue;
    let day = after.days.find(candidate => candidate.date === nextDate);
    if (!day) { day = { date: nextDate, items: [] }; after.days.push(day); }
    const sameNext = (candidate: TodoItem) => !candidate.completed && candidate.text === item.text && JSON.stringify(candidate.repeat) === JSON.stringify(nextRule);
    if (!day.items.some(sameNext)) day.items.push({ id: crypto.randomUUID(), text: item.text, completed: false, repeat: nextRule, details: item.details.map(detail => ({ text: detail.text, completed: false })) });
  }
  if (newlyCompleted.length) after.days.sort((a, b) => a.date.localeCompare(b.date));
}
