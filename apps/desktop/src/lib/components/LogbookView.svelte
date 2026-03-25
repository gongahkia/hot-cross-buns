<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import type { Task, List } from '$lib/types';
  import { lists } from '$lib/stores/lists';
  import { taskMutationVersion } from '$lib/stores/tasks';
  import TaskRow from './TaskRow.svelte';

  let completedTasks: Task[] = $state([]);
  let listMap: Map<string, List> = $state(new Map());

  $effect(() => {
    const unsub = lists.subscribe((allLists) => {
      const m = new Map<string, List>();
      for (const l of allLists) m.set(l.id, l);
      listMap = m;
    });
    return unsub;
  });

  async function loadData() {
    try {
      completedTasks = await invoke<Task[]>('get_completed_tasks', { limit: 200 });
    } catch (err) {
      console.error('Failed to load logbook:', err);
    }
  }

  $effect(() => {
    const _v = $taskMutationVersion;
    loadData();
  });

  function getListName(listId: string): string {
    return listMap.get(listId)?.name ?? 'Unknown';
  }

  interface DateGroup { label: string; tasks: Task[] }

  let groups = $derived.by((): DateGroup[] => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today.getTime() - 86400000);
    const weekAgo = new Date(today.getTime() - 7 * 86400000);
    const monthAgo = new Date(today.getTime() - 30 * 86400000);
    const buckets: DateGroup[] = [
      { label: 'Today', tasks: [] },
      { label: 'Yesterday', tasks: [] },
      { label: 'This Week', tasks: [] },
      { label: 'This Month', tasks: [] },
      { label: 'Older', tasks: [] },
    ];
    for (const t of completedTasks) {
      const d = t.completedAt ? new Date(t.completedAt) : new Date(0);
      const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      if (day >= today) buckets[0].tasks.push(t);
      else if (day >= yesterday) buckets[1].tasks.push(t);
      else if (day >= weekAgo) buckets[2].tasks.push(t);
      else if (day >= monthAgo) buckets[3].tasks.push(t);
      else buckets[4].tasks.push(t);
    }
    return buckets.filter(b => b.tasks.length > 0);
  });
</script>

<div class="logbook-view">
  <div class="logbook-header">
    <h2 class="logbook-title">Logbook</h2>
    {#if completedTasks.length > 0}
      <span class="logbook-count">{completedTasks.length}</span>
    {/if}
  </div>
  <div class="logbook-content">
    {#each groups as group (group.label)}
      <div class="logbook-section">
        <div class="section-label">{group.label}</div>
        {#each group.tasks as task (task.id)}
          <TaskRow {task} listName={getListName(task.listId)} />
        {/each}
      </div>
    {/each}
    {#if completedTasks.length === 0}
      <div class="empty-state"><p>No completed tasks yet.</p></div>
    {/if}
  </div>
</div>

<style>
  .logbook-view { display: flex; flex-direction: column; height: 100%; overflow: hidden; }
  .logbook-header { display: flex; align-items: center; gap: 10px; padding: 16px 16px 8px; }
  .logbook-title { margin: 0; font-size: 20px; font-weight: 700; color: var(--color-text-primary, #cdd6f4); }
  .logbook-count {
    font-size: 12px; color: var(--color-text-muted, #a6adc8);
    background: var(--color-surface-0, #313244); padding: 2px 8px; border-radius: 8px;
  }
  .logbook-content { flex: 1; overflow-y: auto; padding: 0 4px 16px; }
  .logbook-section { margin-bottom: 4px; }
  .section-label {
    font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;
    padding: 12px 12px 4px; color: var(--color-text-muted, #a6adc8);
  }
  .empty-state { display: flex; align-items: center; justify-content: center; height: 100%; color: var(--color-text-muted, #a6adc8); font-size: 14px; }
  .empty-state p { margin: 0; }
</style>
