<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import type { Task, List } from '$lib/types';
  import { taskMutationVersion } from '$lib/stores/tasks';
  import { selectedTaskId } from '$lib/stores/ui';
  import { lists } from '$lib/stores/lists';
  import TaskRow from './TaskRow.svelte';

  let overdueTasks: Task[] = $state([]);
  let rangeTasks: Task[] = $state([]);
  let listMap: Map<string, List> = $state(new Map());
  $effect(() => {
    const unsub = lists.subscribe((all) => { const m = new Map<string, List>(); for (const l of all) m.set(l.id, l); listMap = m; });
    return unsub;
  });
  function getListName(id: string): string { return listMap.get(id)?.name ?? ''; }

  /** Format Date as "YYYY-MM-DD" (local). */
  function fmt(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  }

  function startOfDay(d: Date): Date {
    const r = new Date(d);
    r.setHours(0, 0, 0, 0);
    return r;
  }

  function addDays(d: Date, n: number): Date {
    const r = new Date(d);
    r.setDate(r.getDate() + n);
    return r;
  }

  /** Effective date for grouping: startDate if set, else dueDate. */
  function effectiveDate(t: Task): string | null {
    return t.startDate?.substring(0, 10) ?? t.dueDate?.substring(0, 10) ?? null;
  }

  /** Get Monday of the week containing d. */
  function getMonday(d: Date): Date {
    const r = new Date(d);
    const day = r.getDay(); // 0=Sun..6=Sat
    const diff = day === 0 ? -6 : 1 - day;
    r.setDate(r.getDate() + diff);
    r.setHours(0, 0, 0, 0);
    return r;
  }

  interface Section {
    key: string;
    label: string;
    type: 'overdue' | 'day' | 'week' | 'month';
    tasks: Task[];
  }

  let sections = $derived.by(() => {
    const today = startOfDay(new Date());
    const todayStr = fmt(today);
    const result: Section[] = [];

    // overdue section
    if (overdueTasks.length > 0) {
      result.push({
        key: 'overdue',
        label: 'Overdue',
        type: 'overdue',
        tasks: [...overdueTasks].sort((a, b) => b.priority - a.priority),
      });
    }

    // group all range tasks by effective date
    const byDate = new Map<string, Task[]>();
    for (const t of rangeTasks) {
      const d = effectiveDate(t);
      if (!d) continue;
      if (d < todayStr) continue; // already in overdue
      if (!byDate.has(d)) byDate.set(d, []);
      byDate.get(d)!.push(t);
    }

    // sort each date bucket by priority desc
    for (const tasks of byDate.values()) {
      tasks.sort((a, b) => b.priority - a.priority);
    }

    // next 7 individual days (today + 6)
    const dayOpts: Intl.DateTimeFormatOptions = { weekday: 'long', month: 'short', day: 'numeric' };
    for (let i = 0; i < 7; i++) {
      const d = addDays(today, i);
      const ds = fmt(d);
      const dayTasks = byDate.get(ds) ?? [];
      const label = i === 0 ? `Today \u2013 ${d.toLocaleDateString('en-US', dayOpts)}`
        : i === 1 ? `Tomorrow \u2013 ${d.toLocaleDateString('en-US', dayOpts)}`
        : d.toLocaleDateString('en-US', dayOpts);
      result.push({ key: `day-${ds}`, label, type: 'day', tasks: dayTasks });
      byDate.delete(ds);
    }

    // weeks 2-4: group remaining tasks by week-start Monday
    const day7 = addDays(today, 7);
    const day28 = addDays(today, 28);
    const weekBuckets = new Map<string, Task[]>(); // keyed by Monday date string
    const weekOrder: string[] = [];

    for (const [ds, tasks] of byDate) {
      const d = new Date(ds + 'T00:00:00');
      if (d >= day7 && d < day28) {
        const mon = fmt(getMonday(d));
        if (!weekBuckets.has(mon)) {
          weekBuckets.set(mon, []);
          weekOrder.push(mon);
        }
        weekBuckets.get(mon)!.push(...tasks);
        byDate.delete(ds);
      }
    }
    weekOrder.sort();
    for (const mon of weekOrder) {
      const monDate = new Date(mon + 'T00:00:00');
      const label = `Week of ${monDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
      const tasks = weekBuckets.get(mon)!;
      tasks.sort((a, b) => b.priority - a.priority);
      result.push({ key: `week-${mon}`, label, type: 'week', tasks });
    }

    // beyond 4 weeks: group by month
    const monthBuckets = new Map<string, Task[]>(); // keyed by "YYYY-MM"
    const monthOrder: string[] = [];
    for (const [ds, tasks] of byDate) {
      const monthKey = ds.substring(0, 7);
      if (!monthBuckets.has(monthKey)) {
        monthBuckets.set(monthKey, []);
        monthOrder.push(monthKey);
      }
      monthBuckets.get(monthKey)!.push(...tasks);
    }
    monthOrder.sort();
    for (const mk of monthOrder) {
      const [y, m] = mk.split('-');
      const d = new Date(Number(y), Number(m) - 1, 1);
      const label = d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      const tasks = monthBuckets.get(mk)!;
      tasks.sort((a, b) => b.priority - a.priority);
      result.push({ key: `month-${mk}`, label, type: 'month', tasks });
    }

    return result;
  });

  let totalCount = $derived(sections.reduce((s, sec) => s + sec.tasks.length, 0));

  async function loadData() {
    const today = startOfDay(new Date());
    const startDate = fmt(addDays(today, -30));
    const endDate = fmt(addDays(today, 90));
    try {
      const [range, overdue] = await Promise.all([
        invoke<Task[]>('get_tasks_in_range', { startDate: fmt(today), endDate }),
        invoke<Task[]>('get_overdue_tasks'),
      ]);
      rangeTasks = range;
      overdueTasks = overdue;
    } catch (err) {
      console.error('Failed to load upcoming view:', err);
    }
  }

  $effect(() => {
    const _v = $taskMutationVersion;
    loadData();
  });
</script>

<div class="upcoming-view">
  <div class="upcoming-header">
    <h2 class="upcoming-title">Upcoming</h2>
    {#if totalCount > 0}
      <span class="upcoming-count">{totalCount}</span>
    {/if}
  </div>

  <div class="upcoming-content">
    {#each sections as section (section.key)}
      <div class="upcoming-section" class:overdue-section={section.type === 'overdue'}>
        <div class="section-label" class:overdue-label={section.type === 'overdue'}>
          {section.label}
          {#if section.tasks.length > 0}
            <span class="section-count">{section.tasks.length}</span>
          {/if}
        </div>
        {#if section.tasks.length > 0}
          {#each section.tasks as task (task.id)}
            <TaskRow {task} listName={getListName(task.listId)} />
            {#each task.subtasks as subtask (subtask.id)}
              <TaskRow task={subtask} indent={true} listName={getListName(subtask.listId)} />
            {/each}
          {/each}
        {:else if section.type === 'day'}
          <div class="empty-day">No tasks</div>
        {/if}
      </div>
    {/each}

    {#if totalCount === 0}
      <div class="empty-state">
        <p>Nothing upcoming. You're all clear!</p>
      </div>
    {/if}
  </div>
</div>

<style>
  .upcoming-view {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }
  .upcoming-header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 16px 16px 8px;
  }
  .upcoming-title {
    margin: 0;
    font-size: 20px;
    font-weight: 700;
    line-height: 1.3;
    color: var(--color-text-primary, #cdd6f4);
  }
  .upcoming-count {
    font-size: 12px;
    color: var(--color-text-muted, #a6adc8);
    background: var(--color-surface-0, #313244);
    padding: 2px 8px;
    border-radius: 8px;
    margin-left: auto;
  }
  .upcoming-content {
    flex: 1;
    overflow-y: auto;
    padding: 0 4px 16px;
  }
  .upcoming-section {
    margin-left: 12px;
    margin-bottom: 4px;
  }
  .upcoming-section.overdue-section {
    border-left: 3px solid var(--color-danger, #f38ba8);
    margin-left: 12px;
    padding-left: 0;
    margin-bottom: 8px;
  }
  .section-label {
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    padding: 12px 12px 4px;
    color: var(--color-text-muted, #a6adc8);
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .overdue-label {
    color: var(--color-danger, #f38ba8);
  }
  .section-count {
    font-size: 11px;
    font-weight: 500;
    color: var(--color-text-muted, #a6adc8);
    background: var(--color-surface-0, #313244);
    padding: 1px 6px;
    border-radius: 6px;
  }
  .empty-day {
    padding: 4px 12px 4px 24px;
    font-size: 11px;
    color: var(--color-text-faint, #70726f);
    font-style: italic;
  }
  .empty-state {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: var(--color-text-muted, #a6adc8);
    font-size: 14px;
  }
  .empty-state p {
    margin: 0;
  }
</style>
