<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import type { Task } from '$lib/types';
  import { taskMutationVersion } from '$lib/stores/tasks';
  import TaskRow from './TaskRow.svelte';

  let overdueTasks: Task[] = $state([]);
  let rangeTasks: Task[] = $state([]);
  let loading = $state(false);

  function fmt(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  }

  function dayLabel(dateStr: string): string {
    const today = fmt(new Date());
    const tmr = new Date(); tmr.setDate(tmr.getDate() + 1);
    if (dateStr === today) return 'Today';
    if (dateStr === fmt(tmr)) return 'Tomorrow';
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  }

  let tasksByDay = $derived.by(() => {
    const map: Record<string, Task[]> = {};
    for (const task of rangeTasks) {
      if (!task.dueDate) continue;
      const key = task.dueDate.substring(0, 10);
      if (!map[key]) map[key] = [];
      map[key].push(task);
    }
    return map;
  });

  let dayKeys = $derived.by(() => {
    const days: string[] = [];
    const now = new Date();
    for (let i = 0; i < 7; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() + i);
      days.push(fmt(d));
    }
    return days;
  });

  let totalCount = $derived(overdueTasks.length + rangeTasks.length);

  $effect(() => {
    const _v = $taskMutationVersion;
    loading = true;
    const today = new Date();
    const end = new Date(today);
    end.setDate(end.getDate() + 6);
    Promise.all([
      invoke<Task[]>('get_overdue_tasks'),
      invoke<Task[]>('get_tasks_in_range', { startDate: fmt(today), endDate: fmt(end) }),
    ])
      .then(([od, rt]) => { overdueTasks = od; rangeTasks = rt; })
      .catch((err) => { console.error('Next 7 days load failed:', err); overdueTasks = []; rangeTasks = []; })
      .finally(() => { loading = false; });
  });
</script>

<div class="next7-view">
  <div class="filter-header">
    <h2 class="filter-title">Next 7 Days</h2>
    <span class="filter-count">{totalCount}</span>
  </div>
  <div class="filter-content">
    {#if overdueTasks.length > 0}
      <div class="day-group">
        <div class="day-header overdue">Overdue <span class="day-count">{overdueTasks.length}</span></div>
        {#each overdueTasks as task (task.id)}
          <TaskRow {task} />
        {/each}
      </div>
    {/if}
    {#each dayKeys as day}
      {@const dayTasks = tasksByDay[day] ?? []}
      {#if dayTasks.length > 0}
        <div class="day-group">
          <div class="day-header">{dayLabel(day)} <span class="day-count">{dayTasks.length}</span></div>
          {#each dayTasks as task (task.id)}
            <TaskRow {task} />
          {/each}
        </div>
      {/if}
    {/each}
    {#if !loading && totalCount === 0}
      <div class="empty-state"><p>No tasks in the next 7 days.</p></div>
    {/if}
  </div>
</div>

<style>
  .next7-view { display: flex; flex-direction: column; height: 100%; overflow: hidden; }
  .filter-header {
    display: flex; align-items: center; gap: 10px;
    padding: 16px 16px 8px;
  }
  .filter-title {
    margin: 0; font-size: 20px; font-weight: 700;
    color: var(--color-text-primary, #d4d4d4);
  }
  .filter-count {
    font-size: 12px;
    color: var(--color-text-muted, #90918d);
    background: var(--color-surface-0, #25282c);
    padding: 2px 8px; border-radius: 8px;
  }
  .filter-content { flex: 1; overflow-y: auto; padding: 0 4px 16px; }
  .day-group { margin-bottom: 8px; }
  .day-header {
    font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;
    color: var(--color-text-muted, #90918d);
    padding: 8px 12px 4px;
    display: flex; align-items: center; gap: 8px;
  }
  .day-header.overdue { color: var(--color-priority-high, #e06c60); }
  .day-count {
    font-size: 10px; background: var(--color-surface-0, #25282c);
    padding: 1px 6px; border-radius: 999px;
  }
  .empty-state {
    display: flex; align-items: center; justify-content: center;
    height: 100%; color: var(--color-text-muted, #90918d); font-size: 14px;
  }
  .empty-state p { margin: 0; }
</style>
