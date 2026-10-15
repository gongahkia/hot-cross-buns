import { shiftDate } from './dayWindow.ts';
import type { RecurrenceRule } from './recurrence.ts';
import { nextScheduledDate } from './scheduledRecurrence.ts';
import type { TodoDocument, TodoItem } from './todoText.ts';

export type Projection = { kind: 'series' | 'span'; masterId: string; originalDate: string; series?: string; continuation?: boolean };
export type ViewItem = TodoItem & { projection?: Projection };

const dayName = (date: string) => ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][new Date(`${date}T12:00:00Z`).getUTCDay()];

/** A scheduled rule describes dates, independent of whether earlier occurrences were completed. */
export function occursOn(rule: RecurrenceRule, start: string, date: string): boolean {
  if (rule.kind === 'after' || date < start) return false;
  if (rule.kind !== 'scheduled' && rule.endsOn && date > rule.endsOn) return false;
  if (rule.kind === 'scheduled') {
    if (rule.end?.kind === 'on' && date > rule.end.date) return false;
    if (date === start) return true;
    if (rule.end?.kind === 'after') {
      let previous = start;
      for (let index = rule.occurrence; index < rule.end.count && previous < date; index++) {
        const next = nextScheduledDate({ ...rule, occurrence: index }, previous);
        if (!next || next <= previous) return false;
        previous = next;
      }
      return previous === date;
    }
    return nextScheduledDate(rule, shiftDate(date, -1)) === date;
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

/** Build one visible day. Virtual rows never enter IndexedDB or TODO.txt. */
export function projectItemsForDate(document: TodoDocument, date: string): ViewItem[] {
  const replaced = new Set(document.days.flatMap(day => day.items.filter(item => item.replaces).map(item => `${item.replaces!.series}:${item.replaces!.on}`)));
  const actual = document.days.find(day => day.date === date)?.items ?? [];
  const result: ViewItem[] = actual.filter(item => !item.repeat?.series || (!replaced.has(`${item.repeat.series}:${date}`) && !item.skips?.includes(date)));
  for (const day of document.days) for (const item of day.items) {
    if (item.span && date > day.date && date <= spanEnd(item, day.date) && !item.skips?.includes(day.date) && (!item.repeat?.series || !replaced.has(`${item.repeat.series}:${day.date}`))) {
      result.push({ ...item, id: `span:${item.id}:${date}`, projection: { kind: 'span', masterId: item.id, originalDate: day.date, continuation: true } });
    }
    const rule = item.repeat;
    if (!rule || rule.kind === 'after' || !rule.series) continue;
    const duration = item.span ? Math.max(0, Math.round((Date.parse(`${spanEnd(item, day.date)}T12:00:00Z`) - Date.parse(`${day.date}T12:00:00Z`)) / 86400000)) : 0;
    for (let offset = 0; offset <= duration; offset++) {
      const occurrence = shiftDate(date, -offset);
      if (occurrence === day.date || !occursOn(rule, day.date, occurrence) || item.skips?.includes(occurrence) || replaced.has(`${rule.series}:${occurrence}`)) continue;
      const delta = Math.round((Date.parse(`${occurrence}T12:00:00Z`) - Date.parse(`${day.date}T12:00:00Z`)) / 86400000);
      const span = item.span?.kind === 'all-day'
        ? { kind: 'all-day' as const, ...(item.span.through ? { through: shiftDate(item.span.through,delta) } : {}) }
        : item.span?.kind === 'time' ? { ...item.span, endDate: shiftDate(item.span.endDate,delta) } : undefined;
      result.push({ ...item, id: `series:${item.id}:${occurrence}:${date}`, completed: false, completedOn: undefined,
        span,
        details: item.details.map(detail => ({ text: detail.text, completed: false })),
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
