import { shiftDate } from './dayWindow.ts';
import { nextRecurrenceDate } from './recurrence.ts';
import { projectItemsForDate, spanEnd } from './seriesView.ts';
import type { TodoDocument } from './todoText.ts';

/** Candidate dates include stored items, span continuations, and virtual scheduled occurrences. */
export function earlierUnfinishedDays(document: TodoDocument, today: string): { date: string; count: number }[] {
  const candidates = new Set<string>();
  const addOccurrence = (start: string, end: string) => {
    let date = start;
    while (date < today && date <= end) {
      candidates.add(date);
      const next = shiftDate(date, 1);
      if (next <= date) break;
      date = next;
    }
  };
  for (const day of document.days) for (const item of day.items) {
    if (day.date >= today) continue;
    const end = spanEnd(item, day.date);
    addOccurrence(day.date, end);
    const rule = item.repeat;
    if (!rule || rule.kind === 'after' || !rule.series) continue;
    const duration = Math.max(0, Math.round((Date.parse(`${end}T12:00:00Z`) - Date.parse(`${day.date}T12:00:00Z`)) / 86400000));
    let previous = day.date;
    let occurrence = rule.kind === 'scheduled' ? rule.occurrence : 1;
    while (previous < today) {
      const next = nextRecurrenceDate(rule.kind === 'scheduled' ? { ...rule, occurrence } : rule, previous);
      if (!next || next <= previous || next >= today) break;
      addOccurrence(next, shiftDate(next, duration));
      previous = next;
      occurrence++;
    }
  }
  return [...candidates].sort().map(date => ({
    date, count: projectItemsForDate(document, date).filter(item => !item.completed).length,
  })).filter(day => day.count > 0);
}
