<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import type { Task, List } from '$lib/types';
  import { lists } from '$lib/stores/lists';
  import { taskMutationVersion } from '$lib/stores/tasks';
  import TaskRow from './TaskRow.svelte';

  let todayTasks: Task[] = $state([]);
  let overdueTasks: Task[] = $state([]);
  let listMap: Map<string, List> = $state(new Map());

  let dateString = $derived.by(() => {
    const now = new Date();
    return now.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
    });
  });

  // Build a lookup map from list ID to list object.
  $effect(() => {
    const unsub = lists.subscribe((allLists) => {
      const m = new Map<string, List>();
      for (const l of allLists) {
        m.set(l.id, l);
      }
      listMap = m;
    });
    return unsub;
  });

  async function loadData() {
    try {
      const [today, overdue] = await Promise.all([
        invoke<Task[]>('get_tasks_due_today'),
        invoke<Task[]>('get_overdue_tasks'),
      ]);
      todayTasks = today;
      overdueTasks = overdue;
    } catch (err) {
      console.error('Failed to load today view:', err);
    }
  }

  // Fetch data on mount.
  $effect(() => {
    const _taskMutationVersion = $taskMutationVersion;
    loadData();
  });

  // Group tasks by list_id, preserving order.
  function groupByList(taskList: Task[]): { listId: string; tasks: Task[] }[] {
    const map = new Map<string, Task[]>();
    const order: string[] = [];
    for (const t of taskList) {
      if (!map.has(t.listId)) {
        map.set(t.listId, []);
        order.push(t.listId);
      }
      map.get(t.listId)!.push(t);
    }
    return order.map((listId) => ({ listId, tasks: map.get(listId)! }));
  }

  let overdueGroups = $derived(groupByList(overdueTasks));
  let todayGroups = $derived(groupByList(todayTasks));
  let totalCount = $derived(todayTasks.length + overdueTasks.length);

  let completedToday = $state(0);
  let streak = $state(0);

  $effect(() => {
    const _v = $taskMutationVersion;
    invoke<{ today: number; streak: number }>('get_completion_stats')
      .then((s) => { completedToday = s.today; streak = s.streak; })
      .catch(() => {});
  });

  function getListName(listId: string): string {
    return listMap.get(listId)?.name ?? 'Unknown';
  }

  function getListColor(listId: string): string {
    return listMap.get(listId)?.color ?? 'var(--color-list-default)';
  }
</script>

<div class="today-view">
  <div class="today-header">
    <h2 class="today-title">Today</h2>
    <span class="today-date">{dateString}</span>
    {#if totalCount > 0}
      <span class="today-count">{totalCount}</span>
    {/if}
    {#if completedToday > 0}
      <span class="stat-badge completed-badge">{completedToday} done</span>
    {/if}
    {#if streak > 1}
      <span class="stat-badge streak-badge">{streak}d streak</span>
    {/if}
  </div>

  <div class="today-content">
    {#if overdueGroups.length > 0}
      <div class="overdue-section">
        <div class="section-label overdue-label">Overdue</div>
        {#each overdueGroups as group (group.listId)}
          <div class="list-group">
            <div class="list-sub-header">
              <span class="list-dot" style:background-color={getListColor(group.listId)}></span>
              <span class="list-name">{getListName(group.listId)}</span>
            </div>
            {#each group.tasks as task (task.id)}
              <TaskRow {task} />
              {#each task.subtasks as subtask (subtask.id)}
                <TaskRow task={subtask} indent={true} />
              {/each}
            {/each}
          </div>
        {/each}
      </div>
    {/if}

    {#if todayGroups.length > 0}
      <div class="today-section">
        {#if overdueGroups.length > 0}
          <div class="section-label today-label">Due Today</div>
        {/if}
        {#each todayGroups as group (group.listId)}
          <div class="list-group">
            <div class="list-sub-header">
              <span class="list-dot" style:background-color={getListColor(group.listId)}></span>
              <span class="list-name">{getListName(group.listId)}</span>
            </div>
            {#each group.tasks as task (task.id)}
              <TaskRow {task} />
              {#each task.subtasks as subtask (subtask.id)}
                <TaskRow task={subtask} indent={true} />
              {/each}
            {/each}
          </div>
        {/each}
      </div>
    {/if}

    {#if totalCount === 0}
      <div class="empty-state">
        <p>No tasks due today. Enjoy your day!</p>
      </div>
    {/if}
  </div>
</div>

<style>
  .today-view {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  .today-header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 16px 16px 8px;
  }

  .today-title {
    margin: 0;
    font-size: 20px;
    font-weight: 700;
    line-height: 1.3;
    color: var(--color-text-primary, #cdd6f4);
  }

  .today-date {
    font-size: 14px;
    color: var(--color-text-muted, #a6adc8);
    font-weight: 400;
  }

  .today-count {
    font-size: 12px;
    color: var(--color-text-muted, #a6adc8);
    background: var(--color-surface-0, #313244);
    padding: 2px 8px;
    border-radius: 8px;
    margin-left: auto;
  }

  .stat-badge {
    font-size: 11px;
    font-weight: 600;
    padding: 2px 8px;
    border-radius: 8px;
    flex-shrink: 0;
  }
  .completed-badge {
    background: color-mix(in srgb, var(--color-success, #2d9964) 14%, transparent);
    color: var(--color-success, #2d9964);
  }
  .streak-badge {
    background: color-mix(in srgb, var(--color-warning, #ca8e1b) 14%, transparent);
    color: var(--color-warning, #ca8e1b);
  }

  .today-content {
    flex: 1;
    overflow-y: auto;
    padding: 0 4px 16px;
  }

  .overdue-section {
    margin-bottom: 8px;
    border-left: 3px solid var(--color-danger, #f38ba8);
    margin-left: 12px;
    padding-left: 0;
  }

  .section-label {
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    padding: 12px 12px 4px;
  }

  .overdue-label {
    color: var(--color-danger, #f38ba8);
  }

  .today-label {
    color: var(--color-text-muted, #a6adc8);
    padding-left: 12px;
  }

  .today-section {
    margin-left: 12px;
  }

  .list-group {
    margin-bottom: 4px;
  }

  .list-sub-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px 2px;
  }

  .list-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .list-name {
    font-size: 12px;
    font-weight: 600;
    color: var(--color-text-secondary, #bac2de);
    text-transform: uppercase;
    letter-spacing: 0.3px;
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
