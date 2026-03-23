<script lang="ts">
  import type { Task } from '$lib/types';
  import FilterBar from './FilterBar.svelte';
  import { tasks, addTask, loadTasks, taskMutationVersion } from '$lib/stores/tasks';
  import { lists } from '$lib/stores/lists';
  import { selectedListId, showCompletedTasks } from '$lib/stores/ui';
  import { currentFilters, currentSort } from '$lib/stores/filters';
  import { matchesTaskFilters, sortTasks } from '$lib/utils/taskFilters';
  import TaskRow from './TaskRow.svelte';

  let newTaskTitle = $state('');
  let collapsedParents = $state<Set<string>>(new Set());

  let currentListId = $derived.by(() => {
    let value: string | null = null;
    const unsub = selectedListId.subscribe((v) => (value = v));
    unsub();
    return value;
  });

  let currentList = $derived.by(() => {
    let listArray: import('$lib/types').List[] = [];
    const unsub = lists.subscribe((v) => (listArray = v));
    unsub();
    return listArray.find((l) => l.id === currentListId) ?? null;
  });

  let allTasks = $derived.by(() => {
    let value: Task[] = [];
    const unsub = tasks.subscribe((v) => (value = v));
    unsub();
    return value;
  });

  let showCompleted = $derived.by(() => {
    let value = true;
    const unsub = showCompletedTasks.subscribe((v) => (value = v));
    unsub();
    return value;
  });

  $effect(() => {
    const listId = currentListId;
    const includeCompleted = showCompleted;
    const _taskMutationVersion = $taskMutationVersion;

    if (!listId) {
      tasks.set([]);
      return;
    }

    void loadTasks(listId, includeCompleted);
  });

  // WHY: Separate top-level tasks from subtasks for hierarchical rendering.
  // Subtasks are rendered indented below their parent.
  let topLevelTasks = $derived.by(() =>
    sortTasks(
      allTasks.filter(
        (task) => !task.parentTaskId && task.status === 0 && matchesTaskFilters(task, $currentFilters)
      ),
      $currentSort,
    ),
  );

  let completedTasks = $derived.by(() =>
    sortTasks(
      allTasks.filter(
        (task) => !task.parentTaskId && task.status === 1 && matchesTaskFilters(task, $currentFilters)
      ),
      $currentSort,
    ),
  );

  let taskCount = $derived(topLevelTasks.length);

  function getSubtasks(parentId: string): Task[] {
    return allTasks.filter((t) => t.parentTaskId === parentId);
  }

  function toggleCollapse(parentId: string) {
    collapsedParents = new Set(collapsedParents);
    if (collapsedParents.has(parentId)) {
      collapsedParents.delete(parentId);
    } else {
      collapsedParents.add(parentId);
    }
  }

  function toggleShowCompleted() {
    showCompletedTasks.update((v) => !v);
  }

  async function handleQuickAdd(e: KeyboardEvent) {
    if (e.key !== 'Enter') return;
    const title = newTaskTitle.trim();
    if (!title || !currentListId) return;
    try {
      await addTask({ listId: currentListId, title });
      newTaskTitle = '';
    } catch (err) {
      console.error('Failed to create task:', err);
    }
  }
</script>

{#if !currentListId}
  <div class="empty-state">
    <p>Select a list to view tasks</p>
  </div>
{:else}
  <div class="task-list">
    <div class="task-list-header">
      <h2 class="list-name">{currentList?.name ?? 'Tasks'}</h2>
      <span class="task-count">{taskCount}</span>
    </div>

    <div class="quick-add">
      <span class="quick-add-icon">+</span>
      <input
        type="text"
        class="quick-add-input"
        placeholder="Add a task..."
        bind:value={newTaskTitle}
        onkeydown={handleQuickAdd}
      />
    </div>

    <FilterBar />

    <div class="task-items">
      {#each topLevelTasks as task (task.id)}
        {@const subtasks = getSubtasks(task.id)}
        {@const hasSubtasks = subtasks.length > 0}
        {@const isCollapsed = collapsedParents.has(task.id)}

        <div class="task-group">
          <div class="task-row-wrapper">
            {#if hasSubtasks}
              <button
                class="chevron-btn"
                class:collapsed={isCollapsed}
                onclick={() => toggleCollapse(task.id)}
                aria-label={isCollapsed ? 'Expand subtasks' : 'Collapse subtasks'}
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M4 2L8 6L4 10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
              </button>
            {/if}
            <TaskRow {task} />
          </div>

          {#if hasSubtasks && !isCollapsed}
            {#each subtasks as subtask (subtask.id)}
              <TaskRow task={subtask} indent={true} />
            {/each}
          {/if}
        </div>
      {/each}

      {#if completedTasks.length > 0}
        <div class="completed-divider">
          <button class="completed-toggle" onclick={toggleShowCompleted}>
            <svg
              class="completed-chevron"
              class:collapsed={!showCompleted}
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
            >
              <path d="M4 2L8 6L4 10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
            <span>Completed ({completedTasks.length})</span>
          </button>
        </div>

        {#if showCompleted}
          {#each completedTasks as task (task.id)}
            <TaskRow {task} />
          {/each}
        {/if}
      {/if}
    </div>
  </div>
{/if}

<style>
  .empty-state {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: var(--color-text-muted, #a6adc8);
    font-size: 14px;
  }

  .task-list {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  .task-list-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 16px 16px 8px;
  }

  .list-name {
    margin: 0;
    font-size: 20px;
    font-weight: 700;
    line-height: 1.3;
    color: var(--color-text-primary, #cdd6f4);
  }

  .task-count {
    font-size: 12px;
    color: var(--color-text-muted, #a6adc8);
    background: var(--color-surface-0, #313244);
    padding: 2px 8px;
    border-radius: 8px;
  }

  .quick-add {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 8px 16px;
    padding: 8px 12px;
    background: var(--color-surface-0, #313244);
    border-radius: 8px;
    border: 1px solid transparent;
    transition: border-color 200ms cubic-bezier(0.4, 0, 0.2, 1);
  }

  .quick-add:focus-within {
    border-color: var(--color-accent, #89b4fa);
  }

  .quick-add-icon {
    color: var(--color-text-muted, #a6adc8);
    font-size: 16px;
    font-weight: 500;
    line-height: 1;
    flex-shrink: 0;
  }

  .quick-add-input {
    flex: 1;
    background: none;
    border: none;
    outline: none;
    font-size: 14px;
    font-weight: 500;
    color: var(--color-text-primary, #cdd6f4);
    font-family: inherit;
  }

  .quick-add-input::placeholder {
    color: var(--color-text-muted, #a6adc8);
  }

  .task-items {
    flex: 1;
    overflow-y: auto;
    padding: 0 4px;
  }

  .task-group {
    margin-bottom: 0;
  }

  .task-row-wrapper {
    display: flex;
    align-items: center;
  }

  .task-row-wrapper :global(.task-row) {
    flex: 1;
    min-width: 0;
  }

  .chevron-btn {
    width: 20px;
    height: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    color: var(--color-text-muted, #a6adc8);
    border-radius: 4px;
    transition: all 200ms cubic-bezier(0.4, 0, 0.2, 1);
    flex-shrink: 0;
    margin-left: 4px;
  }

  .chevron-btn:hover {
    color: var(--color-text-primary, #cdd6f4);
    background: var(--color-surface-0, #313244);
  }

  .chevron-btn:focus-visible {
    outline: 2px solid var(--color-accent, #89b4fa);
    outline-offset: 2px;
  }

  .chevron-btn svg {
    transition: transform 200ms cubic-bezier(0.4, 0, 0.2, 1);
    transform: rotate(90deg);
  }

  .chevron-btn.collapsed svg {
    transform: rotate(0deg);
  }

  .completed-divider {
    padding: 12px 12px 4px;
    border-top: 1px solid var(--color-border-subtle, #313244);
    margin-top: 8px;
  }

  .completed-toggle {
    display: flex;
    align-items: center;
    gap: 6px;
    background: none;
    border: none;
    padding: 4px 0;
    cursor: pointer;
    color: var(--color-text-muted, #a6adc8);
    font-size: 12px;
    font-family: inherit;
    transition: color 200ms cubic-bezier(0.4, 0, 0.2, 1);
  }

  .completed-toggle:hover {
    color: var(--color-text-secondary, #bac2de);
  }

  .completed-toggle:focus-visible {
    outline: 2px solid var(--color-accent, #89b4fa);
    outline-offset: 2px;
    border-radius: 4px;
  }

  .completed-chevron {
    transition: transform 200ms cubic-bezier(0.4, 0, 0.2, 1);
    transform: rotate(90deg);
  }

  .completed-chevron.collapsed {
    transform: rotate(0deg);
  }
</style>
