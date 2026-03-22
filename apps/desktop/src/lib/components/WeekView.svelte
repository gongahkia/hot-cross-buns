<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import type { Task } from '$lib/types';
  import { selectedTaskId } from '$lib/stores/ui';
  import TaskRow from './TaskRow.svelte';

  const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  /** The Monday of the currently displayed week. */
  let weekStart = $state(getMonday(new Date()));
  let weekTasks: Task[] = $state([]);

  /** Returns the Monday of the week containing `date`. */
  function getMonday(date: Date): Date {
    const d = new Date(date);
    const day = d.getDay(); // 0=Sun .. 6=Sat
    const diff = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + diff);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  /** Format a Date as "YYYY-MM-DD" (local). */
  function fmt(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  }

  /** Build an array of 7 Date objects starting from weekStart. */
  let weekDays = $derived.by(() => {
    const days: Date[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      days.push(d);
    }
    return days;
  });

  /** Map tasks by date string for quick lookup. */
  let tasksByDate = $derived.by(() => {
    const map: Record<string, Task[]> = {};
    for (const task of weekTasks) {
      if (!task.dueDate) continue;
      const dateKey = task.dueDate.substring(0, 10);
      if (!map[dateKey]) map[dateKey] = [];
      map[dateKey].push(task);
    }
    // Sort each day's tasks by priority descending (highest first)
    for (const key of Object.keys(map)) {
      map[key].sort((a, b) => b.priority - a.priority);
    }
    return map;
  });

  let today = $derived.by(() => fmt(new Date()));

  let weekLabel = $derived.by(() => {
    const start = weekDays[0];
    const end = weekDays[6];
    const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
    const startStr = start.toLocaleDateString('en-US', opts);
    const endStr = end.toLocaleDateString('en-US', opts);
    const year = end.getFullYear();
    return `${startStr} \u2013 ${endStr}, ${year}`;
  });

  /** Load tasks for the current week range. */
  async function loadWeekTasks() {
    const endDate = new Date(weekStart);
    endDate.setDate(endDate.getDate() + 6);
    try {
      weekTasks = await invoke<Task[]>('get_tasks_in_range', {
        startDate: fmt(weekStart),
        endDate: fmt(endDate),
      });
    } catch (err) {
      console.error('Failed to load week tasks:', err);
      weekTasks = [];
    }
  }

  // Reload whenever weekStart changes
  $effect(() => {
    // Access weekStart to create a dependency
    const _start = weekStart;
    loadWeekTasks();
  });

  function prevWeek() {
    const d = new Date(weekStart);
    d.setDate(d.getDate() - 7);
    weekStart = d;
  }

  function nextWeek() {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + 7);
    weekStart = d;
  }

  function goToThisWeek() {
    weekStart = getMonday(new Date());
  }

  function columnHeader(day: Date): string {
    const label = DAY_LABELS[day.getDay() === 0 ? 6 : day.getDay() - 1];
    return `${label} ${day.getDate()}`;
  }
</script>

<div class="week-view">
  <header class="week-header">
    <button class="week-nav-btn" onclick={prevWeek} aria-label="Previous week">
      &#9664;
    </button>
    <h2 class="week-label">{weekLabel}</h2>
    <button class="week-nav-btn" onclick={nextWeek} aria-label="Next week">
      &#9654;
    </button>
    <button class="week-today-btn" onclick={goToThisWeek}>This Week</button>
  </header>

  <div class="week-grid">
    {#each weekDays as day, i}
      {@const dateStr = fmt(day)}
      {@const dayTasks = tasksByDate[dateStr] ?? []}
      <div class="week-column" class:is-today={dateStr === today}>
        <div class="column-header" class:is-today={dateStr === today}>
          {columnHeader(day)}
        </div>
        <div class="column-tasks">
          {#if dayTasks.length > 0}
            {#each dayTasks as task (task.id)}
              <TaskRow {task} />
            {/each}
          {:else}
            <div class="column-empty">No tasks</div>
          {/if}
        </div>
      </div>
    {/each}
  </div>
</div>

<style>
  .week-view {
    display: flex;
    flex-direction: column;
    height: 100%;
    padding: 16px;
    box-sizing: border-box;
    overflow: hidden;
  }

  .week-header {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 16px;
    flex-shrink: 0;
  }

  .week-label {
    font-size: 18px;
    font-weight: 600;
    color: var(--color-text-primary, #cdd6f4);
    margin: 0;
    min-width: 220px;
    text-align: center;
  }

  .week-nav-btn {
    background: none;
    border: 1px solid var(--color-border-subtle, #313244);
    border-radius: 6px;
    color: var(--color-text-primary, #cdd6f4);
    cursor: pointer;
    padding: 4px 10px;
    font-size: 12px;
    transition: background 150ms ease;
    font-family: inherit;
  }

  .week-nav-btn:hover {
    background: var(--color-surface-0, #313244);
  }

  .week-today-btn {
    background: var(--color-surface-0, #313244);
    border: 1px solid var(--color-border-subtle, #313244);
    border-radius: 6px;
    color: var(--color-text-primary, #cdd6f4);
    cursor: pointer;
    padding: 4px 12px;
    font-size: 12px;
    font-family: inherit;
    margin-left: auto;
    transition: background 150ms ease;
  }

  .week-today-btn:hover {
    background: var(--color-surface-1, #45475a);
  }

  .week-grid {
    flex: 1;
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 1px;
    background: var(--color-border-subtle, #313244);
    border: 1px solid var(--color-border-subtle, #313244);
    border-radius: 8px;
    overflow: hidden;
    min-height: 0;
  }

  .week-column {
    display: flex;
    flex-direction: column;
    background: var(--color-bg-primary, #1e1e2e);
    min-height: 0;
    overflow: hidden;
  }

  .week-column.is-today {
    background: color-mix(in srgb, var(--color-accent, #89b4fa) 5%, var(--color-bg-primary, #1e1e2e));
  }

  .column-header {
    padding: 8px 8px;
    font-size: 12px;
    font-weight: 600;
    text-align: center;
    color: var(--color-text-muted, #a6adc8);
    border-bottom: 1px solid var(--color-border-subtle, #313244);
    flex-shrink: 0;
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }

  .column-header.is-today {
    color: var(--color-accent, #89b4fa);
    background: color-mix(in srgb, var(--color-accent, #89b4fa) 10%, transparent);
  }

  .column-tasks {
    flex: 1;
    overflow-y: auto;
    padding: 4px 0;
  }

  .column-empty {
    padding: 12px 8px;
    font-size: 11px;
    color: var(--color-text-faint, #6c7086);
    text-align: center;
    font-style: italic;
  }
</style>
