import { createProjectionBudget, type ProjectionBudget } from './projectionBudget.ts';
import { shiftDate } from './dayWindow.ts';
import type { RecurrenceRule } from './recurrence.ts';
import { nextScheduledDate } from './scheduledRecurrence.ts';
import type { TodoDocument, TodoItem } from './todoText.ts';

export type Projection = { kind: 'series' | 'span'; masterId: string; originalDate: string; series?: string; continuation?: boolean };
export type ViewItem = TodoItem & { projection?: Projection };

const dayName = (date: string) => ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][new Date(`${date}T12:00:00Z`).getUTCDay()];

/** A scheduled rule describes dates, independent of whether earlier occurrences were completed. */
export function occursOn(rule: RecurrenceRule, start: string, date: string, budget: ProjectionBudget = createProjectionBudget()): boolean {
  budget.work();
  if (rule.kind === 'after' || date < start) return false;
  if (rule.kind !== 'scheduled' && rule.endsOn && date > rule.endsOn) return false;
  if (rule.kind === 'scheduled') {
    if (rule.end?.kind === 'on' && date > rule.end.date) return false;
    if (date === start) return true;
    if (rule.end?.kind === 'after') {
      let previous = start;
      for (let index = rule.occurrence; index < rule.end.count && previous < date; index++) {
        budget.work();
        const next = nextScheduledDate({ ...rule, occurrence: index }, previous, budget.work);
        if (!next || next <= previous) return false;
        previous = next;
      }
      return previous === date;
    }
    return nextScheduledDate(rule, shiftDate(date, -1), budget.work) === date;
  }
  if (date === start) return true;
  if (rule.kind === 'daily') return true;
  if (rule.kind === 'weekdays') return !['sat', 'sun'].includes(dayName(date));
  if (rule.kind === 'weekly') return rule.days.includes(dayName(date) as typeof rule.days[number]);
  if (rule.kind === 'monthly') return Number(date.slice(8)) === rule.day;
  if (rule.kind === 'yearly') return Number(date.slice(5, 7)) === rule.month && Number(date.slice(8)) === rule.day;
  return false;
}

export function spanEnd(item: TodoItem, date: string) {
  return item.span?.kind === 'all-day' ? item.span.through ?? date : item.span?.endDate ?? date;
}

/** Build one visible day. Virtual rows never enter IndexedDB or Planner.md. */
export function projectItemsForDate(document: TodoDocument, date: string, budget: ProjectionBudget = createProjectionBudget()): ViewItem[] {
  const replaced = new Set<string>();
  const skipped = new Map<TodoItem, Set<string>>();
  for (const day of document.days) {
    budget.work();
    for (const item of day.items) {
      budget.work();
      if (item.replaces) replaced.add(item.replaces.series + ':' + item.replaces.on);
      const dates = new Set<string>();
      for (const skip of item.skips ?? []) { budget.work(); dates.add(skip); }
      skipped.set(item, dates);
    }
  }
  budget.work(document.days.length);
  const actual = document.days.find(day => day.date === date)?.items ?? [];
  const result: ViewItem[] = [];
  for (const item of actual) {
    budget.work();
    if (item.repeat?.series && (replaced.has(item.repeat.series + ':' + date) || skipped.get(item)?.has(date))) continue;
    budget.rows(1 + item.details.length);
    result.push(item);
  }
  for (const day of document.days) for (const item of day.items) {
    budget.work();
    const skips = skipped.get(item)!;
    if (item.span && date > day.date && date <= spanEnd(item, day.date) && !skips.has(day.date) && (!item.repeat?.series || !replaced.has(item.repeat.series + ':' + day.date))) {
      budget.rows(1 + item.details.length);
      result.push({ ...item, id: 'span:' + item.id + ':' + date, projection: { kind: 'span', masterId: item.id, originalDate: day.date, continuation: true } });
    }
    const rule = item.repeat;
    if (!rule || rule.kind === 'after' || !rule.series || date < day.date) continue;
    const duration = item.span ? Math.max(0, Math.round((Date.parse(spanEnd(item, day.date) + 'T12:00:00Z') - Date.parse(day.date + 'T12:00:00Z')) / 86400000)) : 0;
    const elapsed = Math.round((Date.parse(date + 'T12:00:00Z') - Date.parse(day.date + 'T12:00:00Z')) / 86400000);
    for (let offset = 0; offset <= Math.min(duration, elapsed); offset++) {
      budget.work();
      const occurrence = shiftDate(date, -offset);
      if (occurrence === day.date || !occursOn(rule, day.date, occurrence, budget) || skips.has(occurrence) || replaced.has(rule.series + ':' + occurrence)) continue;
      budget.rows(1 + item.details.length);
      const delta = Math.round((Date.parse(occurrence + 'T12:00:00Z') - Date.parse(day.date + 'T12:00:00Z')) / 86400000);
      const span = item.span?.kind === 'all-day'
        ? { kind: 'all-day' as const, ...(item.span.through ? { through: shiftDate(item.span.through, delta) } : {}) }
        : item.span?.kind === 'time' ? { ...item.span, endDate: shiftDate(item.span.endDate, delta) } : undefined;
      result.push({ ...item, id: 'series:' + item.id + ':' + occurrence + ':' + date, completed: false, completedOn: undefined,
        span,
        details: item.details.map(detail => ({ ...detail, completed: false })),
        projection: { kind: 'series', masterId: item.id, originalDate: occurrence, series: rule.series, continuation: offset > 0 } });
    }
  }
  return result;
}

export function materializeOccurrence(item: ViewItem): TodoItem {
  const { projection: _projection, ...source } = item;
  if (!item.projection || item.projection.kind !== 'series' || !item.projection.series) return { ...source };
  return { ...source, id: crypto.randomUUID(), repeat: undefined, skips: undefined,
    replaces: { series: item.projection.series, on: item.projection.originalDate } };
}
