import { isCanonicalJournal, journalModel } from './journalDocument.ts';
import type { PlannerEntry } from './markdownPlanner.ts';
import { createProjectionBudget, type ProjectionBudget } from './projectionBudget.ts';
import { projectItemsForDate, type ViewItem } from './seriesView.ts';
import { parseTimeBlock } from './timeBlock.ts';
import { validDate, type TodoDocument } from './todoText.ts';

export type CalendarMode = 'day' | 'week' | 'month';
export type CalendarEntry = { item: ViewItem; title: string; kind: 'timed' | 'all-day' | 'untimed'; start?: number; end?: number; continuation: boolean; continues: boolean };
export type CalendarTimeGroup = { start: number; end: number; entries: CalendarEntry[] };
export type CalendarDay = { date: string; entries: CalendarEntry[]; allDay: CalendarEntry[]; untimed: CalendarEntry[]; timed: CalendarTimeGroup[] };

function day(value: string): Date {
  if (!validDate(value)) throw new Error('Choose a valid calendar date.');
  return new Date(`${value}T12:00:00Z`);
}

function dateString(value: Date): string | null {
  const year = value.getUTCFullYear();
  return year >= 0 && year <= 9999 ? `${String(year).padStart(4, '0')}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${String(value.getUTCDate()).padStart(2, '0')}` : null;
}

function shift(value: string, amount: number): string | null {
  const date = day(value);
  date.setUTCDate(date.getUTCDate() + amount);
  return dateString(date);
}

/** floating calendar dates use UTC arithmetic without converting written wall times. */
export function calendarDates(selected: string, mode: CalendarMode, weekStart = 1): string[] {
  const current = day(selected);
  if (!Number.isInteger(weekStart) || weekStart < 0 || weekStart > 6) throw new Error('Choose a valid first weekday.');
  if (mode === 'day') return [selected];
  if (mode === 'week') {
    const offset = (current.getUTCDay() - weekStart + 7) % 7;
    return Array.from({ length: 7 }, (_, index) => shift(selected, index - offset)).filter((date): date is string => date !== null);
  }
  if (mode !== 'month') throw new Error('Choose day, week or month for the calendar.');
  const first = `${selected.slice(0, 7)}-01`, offset = (day(first).getUTCDay() - weekStart + 7) % 7;
  return Array.from({ length: 42 }, (_, index) => shift(first, index - offset)).filter((date): date is string => date !== null);
}

export function navigateCalendar(selected: string, mode: CalendarMode, direction: -1 | 1): string | null {
  if (direction !== -1 && direction !== 1) throw new Error('Move one calendar period at a time.');
  if (mode === 'day' || mode === 'week') return shift(selected, direction * (mode === 'day' ? 1 : 7));
  if (mode !== 'month') throw new Error('Choose day, week or month for the calendar.');
  const value = day(selected), originalDay = value.getUTCDate();
  value.setUTCDate(1); value.setUTCMonth(value.getUTCMonth() + direction);
  const last = new Date(value); last.setUTCMonth(last.getUTCMonth() + 1); last.setUTCDate(0);
  value.setUTCDate(Math.min(originalDay, last.getUTCDate()));
  return dateString(value);
}

const minutes = (clock: string) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3));
export const calendarClock = (value: number) => `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;

const sourceEntries = new WeakMap<TodoDocument, Map<string, PlannerEntry>>();
function titles(document: TodoDocument) {
  let cached = sourceEntries.get(document);
  if (!cached) {
    cached = new Map();
    for (const group of journalModel(document).days) for (const entry of group.entries) cached.set(entry.id ?? `source:${entry.range.start}`, entry);
    if (isCanonicalJournal(document)) sourceEntries.set(document, cached);
  }
  return cached;
}

/** overlap groups keep all entries readable instead of squeezing them into narrow lanes. */
export function calendarTimeGroups(entries: CalendarEntry[]): CalendarTimeGroup[] {
  const groups: CalendarTimeGroup[] = [];
  for (const entry of entries.filter(entry => entry.kind === 'timed').sort((left, right) => left.start! - right.start!)) {
    const previous = groups.at(-1);
    if (previous && entry.start! < previous.end) { previous.entries.push(entry); previous.end = Math.max(previous.end, entry.end!); }
    else groups.push({ start: entry.start!, end: entry.end!, entries: [entry] });
  }
  return groups;
}

export function projectCalendarDays(document: TodoDocument, dates: string[], budget: ProjectionBudget = createProjectionBudget()): CalendarDay[] {
  if (dates.length > 42 || new Set(dates).size !== dates.length) throw new Error('Choose a calendar range of at most six distinct weeks.');
  const labels = titles(document);
  return dates.map(date => {
    day(date);
    const entries: CalendarEntry[] = [];
    for (const item of projectItemsForDate(document, date, budget)) {
      const source = labels.get(item.projection?.masterId ?? item.id);
      const block = source?.timeBlock ? parseTimeBlock(item.text.replace(/\r\n|\r|\n/g, ' ')) : null;
      const title = source?.text ?? item.text;
      const base = { item, title: source?.timeBlock ? parseTimeBlock(title)?.title ?? title : title, continuation: !!item.projection?.continuation, continues: false };
      if (item.span?.kind === 'all-day') entries.push({ ...base, kind: 'all-day', continues: !!item.span.through && item.span.through > date });
      else if (item.span?.kind === 'time') {
        const original = item.projection?.originalDate ?? date;
        const start = date === original ? minutes(item.span.start) : 0, end = date === item.span.endDate ? minutes(item.span.end) : 1440;
        if (end > start) entries.push({ ...base, kind: 'timed', start, end, continues: date < item.span.endDate });
      } else if (block) entries.push({ ...base, kind: 'timed', start: minutes(block.start), end: minutes(block.end) });
      else entries.push({ ...base, kind: 'untimed' });
    }
    return { date, entries, allDay: entries.filter(entry => entry.kind === 'all-day'), untimed: entries.filter(entry => entry.kind === 'untimed'), timed: calendarTimeGroups(entries) };
  });
}
