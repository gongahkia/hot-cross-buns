<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import type { Task, List } from '$lib/types';
  import { selectedSmartFilter, type SmartFilterType } from '$lib/stores/ui';
  import { taskMutationVersion } from '$lib/stores/tasks';
  import { lists } from '$lib/stores/lists';
  import TaskRow from './TaskRow.svelte';

  let tasks: Task[] = $state([]);
  let loading = $state(false);
  let listMap: Map<string, List> = $state(new Map());
  $effect(() => {
    const unsub = lists.subscribe((all) => { const m = new Map<string, List>(); for (const l of all) m.set(l.id, l); listMap = m; });
    return unsub;
  });
  function getListName(id: string): string { return listMap.get(id)?.name ?? ''; }

  const FILTER_CONFIG: Record<SmartFilterType, { title: string; command: string }> = {
    'overdue': { title: 'Overdue', command: 'get_overdue_tasks' },
    'due-this-week': { title: 'Due This Week', command: 'get_tasks_due_this_week' },
    'high-priority': { title: 'High Priority', command: 'get_high_priority_tasks' },
    'untagged': { title: 'Untagged', command: 'get_untagged_tasks' },
  };

  let config = $derived(FILTER_CONFIG[$selectedSmartFilter]);

  $effect(() => {
    const _filter = $selectedSmartFilter;
    const _v = $taskMutationVersion;
    loading = true;
    invoke<Task[]>(FILTER_CONFIG[_filter].command)
      .then((result) => { tasks = result; })
      .catch((err) => { console.error('Smart filter failed:', err); tasks = []; })
      .finally(() => { loading = false; });
  });
</script>

<div class="smart-filter-view">
  <div class="filter-header">
    <h2 class="filter-title">{config.title}</h2>
    <span class="filter-count">{tasks.length}</span>
  </div>
  <div class="filter-content">
    {#if tasks.length > 0}
      {#each tasks as task (task.id)}
        <TaskRow {task} listName={getListName(task.listId)} />
        {#if task.subtasks}
          {#each task.subtasks as subtask (subtask.id)}
            <TaskRow task={subtask} indent={true} listName={getListName(subtask.listId)} />
          {/each}
        {/if}
      {/each}
    {:else if !loading}
      <div class="empty-state">
        <p>No tasks match this filter.</p>
      </div>
    {/if}
  </div>
</div>

<style>
  .smart-filter-view { display: flex; flex-direction: column; height: 100%; overflow: hidden; }
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
  .empty-state {
    display: flex; align-items: center; justify-content: center;
    height: 100%; color: var(--color-text-muted, #90918d); font-size: 14px;
  }
  .empty-state p { margin: 0; }
</style>
