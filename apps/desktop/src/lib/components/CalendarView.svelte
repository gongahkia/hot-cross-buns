<script lang="ts">
  import {
    currentMonth,
    currentYear,
    calendarTasks,
    selectedDay,
    monthLabel,
    prevMonth,
    nextMonth,
    goToToday,
    loadCalendarTasks,
  } from '$lib/stores/calendar';
  import { lists } from '$lib/stores/lists';
  import { addTask, taskMutationVersion } from '$lib/stores/tasks';
  import { selectedTaskId } from '$lib/stores/ui';
  import type { Task } from '$lib/types';

  const MAX_VISIBLE_TASKS = 3;
  const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  // Reactive reload whenever month/year changes
  $effect(() => {
    const m = $currentMonth;
    const y = $currentYear;
    const _taskMutationVersion = $taskMutationVersion;
    loadCalendarTasks(y, m);
  });

  // Build the calendar grid
  let calendarWeeks = $derived.by(() => {
    const year = $currentYear;
    const month = $currentMonth;

    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();

    // ISO weekday: Mon=0 .. Sun=6
    const startDow = firstDay.getDay();
    const offsetStart = startDow === 0 ? 6 : startDow - 1;

    const cells: DayCell[] = [];

    // Previous month overflow
    const prevMonthLastDay = new Date(year, month, 0).getDate();
    for (let i = offsetStart - 1; i >= 0; i--) {
      cells.push({
        day: prevMonthLastDay - i,
        isCurrentMonth: false,
        date: formatDateParts(year, month - 1, prevMonthLastDay - i),
      });
    }

    // Current month days
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push({
        day: d,
        isCurrentMonth: true,
        date: formatDateParts(year, month, d),
      });
    }

    // Next month overflow to fill remaining cells (complete weeks)
    const remaining = 7 - (cells.length % 7);
    if (remaining < 7) {
      for (let d = 1; d <= remaining; d++) {
        cells.push({
          day: d,
          isCurrentMonth: false,
          date: formatDateParts(year, month + 1, d),
        });
      }
    }

    // Split into weeks
    const weeks: DayCell[][] = [];
    for (let i = 0; i < cells.length; i += 7) {
      weeks.push(cells.slice(i, i + 7));
    }
    return weeks;
  });

  interface DayCell {
    day: number;
    isCurrentMonth: boolean;
    date: string; // "YYYY-MM-DD"
  }

  // Map tasks by date for quick lookup
  let tasksByDate = $derived.by(() => {
    const map: Record<string, Task[]> = {};
    for (const task of $calendarTasks) {
      if (!task.dueDate) continue;
      // due_date may be ISO datetime or date-only; extract date portion
      const dateKey = task.dueDate.substring(0, 10);
      if (!map[dateKey]) map[dateKey] = [];
      map[dateKey].push(task);
    }
    return map;
  });

  let today = $derived.by(() => {
    const now = new Date();
    return formatDateParts(now.getFullYear(), now.getMonth(), now.getDate());
  });

  let quickAddListId = $derived(($lists.find((list) => list.isInbox) ?? $lists[0])?.id ?? null);

  function formatDateParts(year: number, month: number, day: number): string {
    // Handle month overflow/underflow
    const d = new Date(year, month, day);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  }

  function priorityColor(priority: number): string {
    switch (priority) {
      case 3: return 'var(--color-priority-high)';
      case 2: return 'var(--color-priority-med)';
      case 1: return 'var(--color-priority-low)';
      default: return 'var(--color-text-muted)';
    }
  }

  function handleDayClick(cell: DayCell) {
    if (cell.isCurrentMonth) {
      selectedDay.set(cell.day);
    }
  }

  function handleTaskClick(e: MouseEvent, task: Task) {
    e.stopPropagation();
    selectedTaskId.set(task.id);
  }

  function handleDayKeydown(e: KeyboardEvent, cell: DayCell) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleDayClick(cell);
      handleQuickAdd(e as unknown as MouseEvent, cell);
    }
  }

  async function handleQuickAdd(e: Event, cell: DayCell) {
    // Only trigger on direct click on empty area (not on a task chip)
    const target = e.target as HTMLElement;
    if (target.closest('.cal-task-chip') || target.closest('.cal-more-badge')) return;

    if (!quickAddListId) return;

    const title = prompt('New task title:');
    if (!title?.trim()) return;

    await addTask({
      listId: quickAddListId,
      title: title.trim(),
      dueDate: cell.date,
    });
  }
</script>

<div class="calendar-view">
  <header class="cal-header">
    <button class="cal-nav-btn" onclick={prevMonth} aria-label="Previous month">
      <svg viewBox="0 0 12 12" fill="none" aria-hidden="true">
        <path d="M7.5 2.25L3.75 6L7.5 9.75" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </button>
    <h2 class="cal-month-label">{$monthLabel}</h2>
    <button class="cal-nav-btn" onclick={nextMonth} aria-label="Next month">
      <svg viewBox="0 0 12 12" fill="none" aria-hidden="true">
        <path d="M4.5 2.25L8.25 6L4.5 9.75" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </button>
    <button class="cal-today-btn" onclick={goToToday}>Today</button>
  </header>

  <div class="cal-grid">
    <div class="cal-weekday-row">
      {#each DAY_LABELS as label}
        <div class="cal-weekday">{label}</div>
      {/each}
    </div>

    {#each calendarWeeks as week}
      <div class="cal-week-row">
        {#each week as cell}
          {@const dayTasks = tasksByDate[cell.date] ?? []}
          <div
            class="cal-day-cell"
            class:other-month={!cell.isCurrentMonth}
            class:is-today={cell.date === today}
            class:is-selected={cell.isCurrentMonth && cell.day === $selectedDay}
            role="button"
            tabindex={cell.isCurrentMonth ? 0 : -1}
            onclick={(e) => { handleDayClick(cell); handleQuickAdd(e, cell); }}
            onkeydown={(e) => handleDayKeydown(e, cell)}
          >
            <span class="cal-day-number">{cell.day}</span>
            <div class="cal-day-tasks">
              {#each dayTasks.slice(0, MAX_VISIBLE_TASKS) as task (task.id)}
                <button
                  class="cal-task-chip"
                  style:border-left-color={priorityColor(task.priority)}
                  onclick={(e) => handleTaskClick(e, task)}
                  title={task.title}
                >
                  {task.title}
                </button>
              {/each}
              {#if dayTasks.length > MAX_VISIBLE_TASKS}
                <span class="cal-more-badge">+{dayTasks.length - MAX_VISIBLE_TASKS} more</span>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    {/each}
  </div>
</div>

<style>
  .calendar-view {
    display: flex;
    flex-direction: column;
    height: 100%;
    padding: 16px;
    box-sizing: border-box;
    overflow: hidden;
  }

  .cal-header {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 16px;
    flex-shrink: 0;
  }

  .cal-month-label {
    font-size: 18px;
    font-weight: 600;
    color: var(--color-text-primary, #d4d4d4);
    margin: 0;
    min-width: 180px;
    text-align: center;
  }

  .cal-nav-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    background: var(--color-panel, #202225);
    border: 1px solid var(--color-border, #32353a);
    border-radius: 8px;
    color: var(--color-text-primary, #d4d4d4);
    cursor: pointer;
    padding: 0;
    transition: background 150ms ease;
    font-family: inherit;
  }

  .cal-nav-btn:hover {
    background: var(--color-surface-hover, #2a2e33);
  }

  .cal-today-btn {
    background: var(--color-panel, #202225);
    border: 1px solid var(--color-border, #32353a);
    border-radius: 8px;
    color: var(--color-text-primary, #d4d4d4);
    cursor: pointer;
    padding: 6px 12px;
    font-size: 12px;
    font-family: inherit;
    margin-left: auto;
    transition: background 150ms ease;
  }

  .cal-today-btn:hover {
    background: var(--color-surface-hover, #2a2e33);
  }

  .cal-grid {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .cal-weekday-row {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    flex-shrink: 0;
  }

  .cal-weekday {
    text-align: center;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--color-text-muted, #90918d);
    padding: 6px 0;
  }

  .cal-week-row {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    flex: 1;
    min-height: 0;
  }

  .cal-day-cell {
    display: flex;
    flex-direction: column;
    border: 1px solid var(--color-border-subtle, #292c30);
    margin: -0.5px;
    padding: 4px;
    min-height: 0;
    overflow: hidden;
    cursor: pointer;
    background: var(--color-panel, #202225);
    text-align: left;
    font-family: inherit;
    color: inherit;
    transition: background 150ms ease;
  }

  .cal-day-cell:hover {
    background: var(--color-surface-hover, #2a2e33);
  }

  .cal-day-cell.other-month {
    opacity: 0.35;
  }

  .cal-day-cell.is-today .cal-day-number {
    background: var(--color-accent, #6c93c7);
    color: var(--color-on-accent, #f7f7f5);
    border-radius: 50%;
    width: 22px;
    height: 22px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-weight: 700;
  }

  .cal-day-cell.is-selected {
    background: var(--color-surface-active, #30353b);
    box-shadow: inset 0 0 0 2px var(--color-accent, #6c93c7);
  }

  .cal-day-number {
    font-size: 12px;
    font-weight: 500;
    color: var(--color-text-primary, #d4d4d4);
    margin-bottom: 2px;
    flex-shrink: 0;
  }

  .cal-day-tasks {
    display: flex;
    flex-direction: column;
    gap: 1px;
    overflow: hidden;
    flex: 1;
    min-height: 0;
  }

  .cal-task-chip {
    font-size: 10px;
    line-height: 1.3;
    padding: 1px 4px;
    border-radius: 3px;
    background: var(--color-surface-0, #25282c);
    color: var(--color-text-primary, #d4d4d4);
    border: 1px solid var(--color-border-subtle, #292c30);
    border-left: 3px solid var(--color-text-muted, #90918d);
    cursor: pointer;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    text-align: left;
    font-family: inherit;
    transition: background 100ms ease;
    flex-shrink: 0;
  }

  .cal-task-chip:hover {
    background: var(--color-surface-hover, #2a2e33);
  }

  .cal-more-badge {
    font-size: 9px;
    color: var(--color-text-muted, #90918d);
    padding: 0 4px;
    flex-shrink: 0;
  }
</style>
