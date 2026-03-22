import { writable, derived } from 'svelte/store';
import { invoke } from '@tauri-apps/api/core';
import type { Task } from '$lib/types';

const now = new Date();

export const currentMonth = writable<number>(now.getMonth()); // 0-indexed
export const currentYear = writable<number>(now.getFullYear());
export const calendarTasks = writable<Task[]>([]);
export const selectedDay = writable<number | null>(null);

/** Formatted label like "March 2026". */
export const monthLabel = derived(
  [currentMonth, currentYear],
  ([$month, $year]) => {
    const date = new Date($year, $month, 1);
    return date.toLocaleString('default', { month: 'long', year: 'numeric' });
  }
);

/** Navigate to the previous month. */
export function prevMonth(): void {
  currentMonth.update((m) => {
    if (m === 0) {
      currentYear.update((y) => y - 1);
      return 11;
    }
    return m - 1;
  });
}

/** Navigate to the next month. */
export function nextMonth(): void {
  currentMonth.update((m) => {
    if (m === 11) {
      currentYear.update((y) => y + 1);
      return 0;
    }
    return m + 1;
  });
}

/** Navigate to the current month. */
export function goToToday(): void {
  const today = new Date();
  currentMonth.set(today.getMonth());
  currentYear.set(today.getFullYear());
  selectedDay.set(today.getDate());
}

/**
 * Fetch tasks whose due_date falls within the displayed month range.
 * The range covers the full calendar grid (including overflow days from
 * adjacent months).
 */
export async function loadCalendarTasks(year: number, month: number): Promise<void> {
  // First day of the month
  const firstDay = new Date(year, month, 1);
  // Last day of the month
  const lastDay = new Date(year, month + 1, 0);

  // Extend to cover the full calendar grid.
  // ISO week starts on Monday (1). Get day-of-week for firstDay (0=Sun..6=Sat).
  const startDow = firstDay.getDay();
  // Days to subtract to reach previous Monday. Sunday(0)->6, Mon(1)->0, Tue(2)->1, etc.
  const offsetStart = startDow === 0 ? 6 : startDow - 1;
  const gridStart = new Date(firstDay);
  gridStart.setDate(gridStart.getDate() - offsetStart);

  const endDow = lastDay.getDay();
  // Days to add to reach next Sunday. Sunday(0)->0, Mon(1)->6, Tue(2)->5, etc.
  const offsetEnd = endDow === 0 ? 0 : 7 - endDow;
  const gridEnd = new Date(lastDay);
  gridEnd.setDate(gridEnd.getDate() + offsetEnd);

  const startDate = formatDate(gridStart);
  const endDate = formatDate(gridEnd);

  try {
    const result = await invoke<Task[]>('get_tasks_in_range', { startDate, endDate });
    calendarTasks.set(result);
  } catch (err) {
    console.error('Failed to load calendar tasks:', err);
    calendarTasks.set([]);
  }
}

/** Format a Date as "YYYY-MM-DD". */
function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
