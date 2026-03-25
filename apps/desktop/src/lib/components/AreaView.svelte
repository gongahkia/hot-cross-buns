<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import type { Task } from '$lib/types';
  import { selectedAreaId } from '$lib/stores/ui';
  import { taskMutationVersion } from '$lib/stores/tasks';
  import { areas } from '$lib/stores/areas';
  import { lists } from '$lib/stores/lists';
  import TaskRow from './TaskRow.svelte';

  let tasks: Task[] = $state([]);
  let loading = $state(false);

  let areaName = $derived(($areas).find(a => a.id === $selectedAreaId)?.name ?? 'Area');

  let tasksByList = $derived.by(() => {
    const map: Record<string, { name: string; tasks: Task[] }> = {};
    for (const task of tasks) {
      if (!map[task.listId]) {
        const list = ($lists).find(l => l.id === task.listId);
        map[task.listId] = { name: list?.name ?? 'Unknown', tasks: [] };
      }
      map[task.listId].tasks.push(task);
    }
    return Object.values(map);
  });

  $effect(() => {
    const areaId = $selectedAreaId;
    const _v = $taskMutationVersion;
    if (!areaId) { tasks = []; return; }
    loading = true;
    invoke<Task[]>('get_tasks_by_area', { areaId })
      .then((result) => { tasks = result; })
      .catch((err) => { console.error('Area view failed:', err); tasks = []; })
      .finally(() => { loading = false; });
  });
</script>

<div class="area-view">
  <div class="filter-header">
    <h2 class="filter-title">{areaName}</h2>
    <span class="filter-count">{tasks.length}</span>
  </div>
  <div class="filter-content">
    {#if tasksByList.length > 0}
      {#each tasksByList as group}
        <div class="list-group">
          <div class="list-group-header">{group.name} <span class="list-group-count">{group.tasks.length}</span></div>
          {#each group.tasks as task (task.id)}
            <TaskRow {task} />
          {/each}
        </div>
      {/each}
    {:else if !loading}
      <div class="empty-state"><p>No tasks in this area.</p></div>
    {/if}
  </div>
</div>

<style>
  .area-view { display: flex; flex-direction: column; height: 100%; overflow: hidden; }
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
  .list-group { margin-bottom: 8px; }
  .list-group-header {
    font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;
    color: var(--color-text-muted, #90918d);
    padding: 8px 12px 4px;
    display: flex; align-items: center; gap: 8px;
  }
  .list-group-count {
    font-size: 10px; background: var(--color-surface-0, #25282c);
    padding: 1px 6px; border-radius: 999px;
  }
  .empty-state {
    display: flex; align-items: center; justify-content: center;
    height: 100%; color: var(--color-text-muted, #90918d); font-size: 14px;
  }
  .empty-state p { margin: 0; }
</style>
