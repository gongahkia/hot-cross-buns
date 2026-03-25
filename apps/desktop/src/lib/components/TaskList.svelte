<script lang="ts">
  import type { Task, Heading } from '$lib/types';
  import FilterBar from './FilterBar.svelte';
  import ContextMenu from './ContextMenu.svelte';
  import { tasks, addTask, loadTasks, editTask, taskMutationVersion } from '$lib/stores/tasks';
  import { lists, editList } from '$lib/stores/lists';
  import { headings, loadHeadings, addHeading, editHeading, removeHeading } from '$lib/stores/headings';
  import { selectedListId, showCompletedTasks } from '$lib/stores/ui';
  import { currentFilters, currentSort } from '$lib/stores/filters';
  import { matchesTaskFilters, sortTasks } from '$lib/utils/taskFilters';
  import TaskRow from './TaskRow.svelte';
  import BulkActionBar from './BulkActionBar.svelte';
  import { parseTaskInput } from '$lib/services/nlp-parse';
  import { tags, tagTask, addTag } from '$lib/stores/tags';

  let newTaskTitle = $state('');
  let collapsedParents = $state<Set<string>>(new Set());

  // description editing
  let editingDescription = $state(false);
  let descriptionValue = $state('');
  let descriptionInputRef: HTMLTextAreaElement | undefined = $state(undefined);

  function startEditDescription() {
    descriptionValue = currentList?.description ?? '';
    editingDescription = true;
    queueMicrotask(() => { descriptionInputRef?.focus(); });
  }

  async function saveDescription() {
    editingDescription = false;
    if (!currentList) return;
    const val = descriptionValue.trim();
    if (val !== (currentList.description ?? '')) {
      await editList(currentList.id, { description: val || '' });
    }
  }
  let quickAddPreview = $derived.by(() => newTaskTitle.trim() ? parseTaskInput(newTaskTitle) : null);
  let currentListId = $derived($selectedListId);
  let currentList = $derived($lists.find((l) => l.id === currentListId) ?? null);
  let allTasks = $derived($tasks);
  let allHeadings = $derived($headings);
  let showCompleted = $derived($showCompletedTasks);

  // heading UI state
  let renamingHeadingId: string | null = $state(null);
  let renameHeadingValue = $state('');
  let renameHeadingRef: HTMLInputElement | undefined = $state(undefined);
  let creatingHeading = $state(false);
  let newHeadingName = $state('');
  let newHeadingInputRef: HTMLInputElement | undefined = $state(undefined);
  let addingTaskToHeadingId: string | null = $state(null);
  let newHeadingTaskTitle = $state('');
  let newHeadingTaskRef: HTMLInputElement | undefined = $state(undefined);
  let collapsedHeadings = $state<Set<string>>(new Set());

  // heading context menu state
  let headingCtxOpen = $state(false);
  let headingCtxX = $state(0);
  let headingCtxY = $state(0);
  let headingCtxId: string | null = $state(null);

  // heading drag state
  let draggedHeadingId: string | null = $state(null);
  let dragOverHeadingId: string | null = $state(null);

  // task-to-heading drag state
  let dragOverDropHeadingId: string | null = $state(null); // heading id to drop task into
  let dragOverUngrouped = $state(false); // drop zone for ungrouped

  $effect(() => {
    const listId = currentListId;
    const includeCompleted = showCompleted;
    const _taskMutationVersion = $taskMutationVersion;
    if (!listId) {
      tasks.set([]);
      headings.set([]);
      return;
    }
    void loadTasks(listId, includeCompleted);
    void loadHeadings(listId);
  });

  let sortedHeadings = $derived.by(() =>
    [...allHeadings].sort((a, b) => a.sortOrder - b.sortOrder)
  );

  // tasks with no heading, active
  let ungroupedTasks = $derived.by(() =>
    sortTasks(
      allTasks.filter(
        (t) => !t.parentTaskId && t.status === 0 && !t.headingId && matchesTaskFilters(t, $currentFilters)
      ),
      $currentSort,
    ),
  );

  // tasks grouped by heading id, active
  function tasksForHeading(headingId: string): Task[] {
    return sortTasks(
      allTasks.filter(
        (t) => !t.parentTaskId && t.status === 0 && t.headingId === headingId && matchesTaskFilters(t, $currentFilters)
      ),
      $currentSort,
    );
  }

  let completedTasks = $derived.by(() =>
    sortTasks(
      allTasks.filter(
        (t) => !t.parentTaskId && t.status === 1 && matchesTaskFilters(t, $currentFilters)
      ),
      $currentSort,
    ),
  );

  let taskCount = $derived(
    allTasks.filter((t) => !t.parentTaskId && t.status === 0 && matchesTaskFilters(t, $currentFilters)).length
  );

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

  function toggleCollapseHeading(headingId: string) {
    collapsedHeadings = new Set(collapsedHeadings);
    if (collapsedHeadings.has(headingId)) {
      collapsedHeadings.delete(headingId);
    } else {
      collapsedHeadings.add(headingId);
    }
  }

  function toggleShowCompleted() {
    showCompletedTasks.update((v) => !v);
  }

  async function handleQuickAdd(e: KeyboardEvent, headingId: string | null = null) {
    if (e.key !== 'Enter') return;
    const title = headingId ? newHeadingTaskTitle : newTaskTitle;
    if (!title.trim() || !currentListId) return;
    const parsed = parseTaskInput(title);
    if (!parsed.title) return;
    try {
      const created = await addTask({
        listId: currentListId,
        title: parsed.title,
        dueDate: parsed.dueDate,
        startDate: parsed.startDate,
        priority: parsed.priority,
      });
      if (created && headingId) {
        await editTask(created.id, { headingId });
      }
      if (created && parsed.estimatedMinutes) {
        await editTask(created.id, { estimatedMinutes: parsed.estimatedMinutes });
      }
      if (created && parsed.tags.length > 0) {
        for (const tagName of parsed.tags) {
          let existing = ($tags).find((t) => t.name.toLowerCase() === tagName.toLowerCase());
          if (!existing) {
            try { existing = await addTag(tagName); } catch { continue; }
          }
          if (existing) {
            try { await tagTask(created.id, existing.id); } catch {} // best-effort
          }
        }
      }
      if (headingId) {
        newHeadingTaskTitle = '';
        addingTaskToHeadingId = null;
      } else {
        newTaskTitle = '';
      }
    } catch (err) {
      console.error('Failed to create task:', err);
    }
  }

  // heading CRUD
  function startCreatingHeading() {
    creatingHeading = true;
    newHeadingName = '';
    queueMicrotask(() => newHeadingInputRef?.focus());
  }

  async function confirmNewHeading() {
    const name = newHeadingName.trim();
    if (name && currentListId) {
      try {
        await addHeading(currentListId, name);
      } catch (err) {
        console.error('Failed to create heading:', err);
      }
    }
    creatingHeading = false;
    newHeadingName = '';
  }

  function cancelNewHeading() {
    creatingHeading = false;
    newHeadingName = '';
  }

  function handleNewHeadingKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') confirmNewHeading();
    else if (e.key === 'Escape') cancelNewHeading();
  }

  function startRenameHeading(headingId: string) {
    const h = allHeadings.find((h) => h.id === headingId);
    if (!h) return;
    renamingHeadingId = headingId;
    renameHeadingValue = h.name;
    headingCtxOpen = false;
    queueMicrotask(() => {
      renameHeadingRef?.focus();
      renameHeadingRef?.select();
    });
  }

  async function confirmRenameHeading() {
    if (renamingHeadingId && renameHeadingValue.trim()) {
      await editHeading(renamingHeadingId, { name: renameHeadingValue.trim() });
    }
    renamingHeadingId = null;
    renameHeadingValue = '';
  }

  function cancelRenameHeading() {
    renamingHeadingId = null;
    renameHeadingValue = '';
  }

  function handleRenameHeadingKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') confirmRenameHeading();
    else if (e.key === 'Escape') cancelRenameHeading();
  }

  function openHeadingContextMenu(e: MouseEvent, headingId: string) {
    e.preventDefault();
    headingCtxX = e.clientX;
    headingCtxY = e.clientY;
    headingCtxId = headingId;
    headingCtxOpen = true;
  }

  async function deleteContextHeading() {
    if (!headingCtxId) return;
    headingCtxOpen = false;
    await removeHeading(headingCtxId);
  }

  function startAddTaskToHeading(headingId: string) {
    addingTaskToHeadingId = headingId;
    newHeadingTaskTitle = '';
    queueMicrotask(() => newHeadingTaskRef?.focus());
  }

  let headingCtxMenuItems = $derived(headingCtxId ? [
    { label: 'Rename', action: () => startRenameHeading(headingCtxId!) },
    { label: '', separator: true },
    { label: 'Delete', action: deleteContextHeading, danger: true },
  ] : []);

  // heading drag reorder
  function handleHeadingDragStart(e: DragEvent, heading: Heading) {
    draggedHeadingId = heading.id;
    e.dataTransfer!.effectAllowed = 'move';
    e.dataTransfer!.setData('text/x-heading-id', heading.id);
  }

  function handleHeadingDragOver(e: DragEvent, headingId: string) {
    if (!draggedHeadingId) return; // only for heading reorder
    e.preventDefault();
    e.dataTransfer!.dropEffect = 'move';
    dragOverHeadingId = headingId;
  }

  async function handleHeadingDrop(e: DragEvent, targetHeading: Heading) {
    e.preventDefault();
    if (!draggedHeadingId || draggedHeadingId === targetHeading.id) {
      draggedHeadingId = null;
      dragOverHeadingId = null;
      return;
    }
    const currentList = [...sortedHeadings];
    const dragIdx = currentList.findIndex(h => h.id === draggedHeadingId);
    const targetIdx = currentList.findIndex(h => h.id === targetHeading.id);
    if (dragIdx < 0 || targetIdx < 0) return;
    const [moved] = currentList.splice(dragIdx, 1);
    currentList.splice(targetIdx, 0, moved);
    for (let i = 0; i < currentList.length; i++) {
      if (currentList[i].sortOrder !== i) {
        await editHeading(currentList[i].id, { sortOrder: i });
      }
    }
    draggedHeadingId = null;
    dragOverHeadingId = null;
  }

  function handleHeadingDragEnd() {
    draggedHeadingId = null;
    dragOverHeadingId = null;
  }

  // task drag into heading drop zones
  function handleTaskDropOnHeading(e: DragEvent, headingId: string) {
    e.preventDefault();
    dragOverDropHeadingId = null;
    const taskId = e.dataTransfer?.getData('text/x-task-id');
    if (taskId) {
      editTask(taskId, { headingId });
    }
  }

  function handleTaskDropOnUngrouped(e: DragEvent) {
    e.preventDefault();
    dragOverUngrouped = false;
    const taskId = e.dataTransfer?.getData('text/x-task-id');
    if (taskId) {
      editTask(taskId, { headingId: '' }); // empty string => null on backend
    }
  }

  function handleTaskDragOverHeading(e: DragEvent, headingId: string) {
    if (draggedHeadingId) return; // don't interfere with heading reorder
    e.preventDefault();
    e.dataTransfer!.dropEffect = 'move';
    dragOverDropHeadingId = headingId;
  }

  function handleTaskDragOverUngrouped(e: DragEvent) {
    if (draggedHeadingId) return;
    e.preventDefault();
    e.dataTransfer!.dropEffect = 'move';
    dragOverUngrouped = true;
  }

  function handleTaskDragStartOnRow(e: DragEvent, task: Task) {
    e.dataTransfer!.effectAllowed = 'move';
    e.dataTransfer!.setData('text/x-task-id', task.id);
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

    {#if currentList}
      {#if editingDescription}
        <textarea
          class="list-description-edit"
          bind:value={descriptionValue}
          onblur={saveDescription}
          onkeydown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveDescription(); } if (e.key === 'Escape') { editingDescription = false; } }}
          bind:this={descriptionInputRef}
          placeholder="Add a description..."
          rows="2"
        ></textarea>
      {:else if currentList.description}
        <button class="list-description" onclick={startEditDescription}>{currentList.description}</button>
      {:else}
        <button class="list-description list-description-placeholder" onclick={startEditDescription}>Add a description...</button>
      {/if}
    {/if}

    <div class="quick-add">
      <span class="quick-add-icon">+</span>
      <input
        type="text"
        class="quick-add-input"
        placeholder="Add a task..."
        bind:value={newTaskTitle}
        onkeydown={(e) => handleQuickAdd(e)}
      />
    </div>

    {#if quickAddPreview && (quickAddPreview.dueDate || quickAddPreview.startDate || quickAddPreview.priority !== undefined || quickAddPreview.tags.length > 0 || quickAddPreview.estimatedMinutes)}
      <div class="quick-add-preview">
        {#if quickAddPreview.startDate && quickAddPreview.dueDate}
          <span class="preview-chip date-chip">{quickAddPreview.startDate} - {quickAddPreview.dueDate}</span>
        {:else if quickAddPreview.dueDate}
          <span class="preview-chip date-chip">{quickAddPreview.dueDate}</span>
        {/if}
        {#if quickAddPreview.priority}
          <span class="preview-chip priority-chip" class:p1={quickAddPreview.priority === 1} class:p2={quickAddPreview.priority === 2} class:p3={quickAddPreview.priority === 3}>
            {['', 'Low', 'Med', 'High'][quickAddPreview.priority]}
          </span>
        {/if}
        {#if quickAddPreview.estimatedMinutes}
          <span class="preview-chip duration-chip">{quickAddPreview.estimatedMinutes}m</span>
        {/if}
        {#each quickAddPreview.tags as tag}
          <span class="preview-chip tag-chip">#{tag}</span>
        {/each}
      </div>
    {/if}

    <FilterBar />

    <div class="task-items">
      <!-- ungrouped tasks (headingId = null) -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="heading-drop-zone"
        class:drag-over-heading={dragOverUngrouped}
        ondragover={handleTaskDragOverUngrouped}
        ondragleave={() => { dragOverUngrouped = false; }}
        ondrop={handleTaskDropOnUngrouped}
      >
        {#each ungroupedTasks as task (task.id)}
          {@const subtasks = getSubtasks(task.id)}
          {@const hasSubtasks = subtasks.length > 0}
          {@const isCollapsed = collapsedParents.has(task.id)}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="task-group"
            draggable="true"
            ondragstart={(e) => handleTaskDragStartOnRow(e, task)}
          >
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
      </div>

      <!-- headings + grouped tasks -->
      {#each sortedHeadings as heading (heading.id)}
        {@const hTasks = tasksForHeading(heading.id)}
        {@const isHeadingCollapsed = collapsedHeadings.has(heading.id)}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="heading-section"
          class:drag-over-heading={dragOverDropHeadingId === heading.id}
          ondragover={(e) => handleTaskDragOverHeading(e, heading.id)}
          ondragleave={() => { if (dragOverDropHeadingId === heading.id) dragOverDropHeadingId = null; }}
          ondrop={(e) => handleTaskDropOnHeading(e, heading.id)}
        >
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="heading-divider"
            class:heading-dragging={draggedHeadingId === heading.id}
            class:heading-drag-over={dragOverHeadingId === heading.id}
            draggable="true"
            ondragstart={(e) => handleHeadingDragStart(e, heading)}
            ondragover={(e) => handleHeadingDragOver(e, heading.id)}
            ondrop={(e) => { e.stopPropagation(); handleHeadingDrop(e, heading); }}
            ondragend={handleHeadingDragEnd}
            ondragleave={() => { if (dragOverHeadingId === heading.id) dragOverHeadingId = null; }}
            oncontextmenu={(e) => openHeadingContextMenu(e, heading.id)}
            ondblclick={() => startRenameHeading(heading.id)}
          >
            <button
              class="heading-collapse-btn"
              class:collapsed={isHeadingCollapsed}
              onclick={() => toggleCollapseHeading(heading.id)}
              aria-label={isHeadingCollapsed ? 'Expand heading' : 'Collapse heading'}
            >
              <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                <path d="M4 2L8 6L4 10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </button>
            <span class="heading-drag-handle" aria-hidden="true">
              <svg width="8" height="14" viewBox="0 0 8 14" fill="none">
                <circle cx="2" cy="2" r="1" fill="currentColor"/><circle cx="6" cy="2" r="1" fill="currentColor"/>
                <circle cx="2" cy="7" r="1" fill="currentColor"/><circle cx="6" cy="7" r="1" fill="currentColor"/>
                <circle cx="2" cy="12" r="1" fill="currentColor"/><circle cx="6" cy="12" r="1" fill="currentColor"/>
              </svg>
            </span>
            {#if renamingHeadingId === heading.id}
              <!-- svelte-ignore a11y_autofocus -->
              <input
                bind:this={renameHeadingRef}
                bind:value={renameHeadingValue}
                class="heading-rename-input"
                type="text"
                onkeydown={handleRenameHeadingKeydown}
                onblur={confirmRenameHeading}
                onclick={(e) => e.stopPropagation()}
              />
            {:else}
              <span class="heading-label">{heading.name}</span>
            {/if}
            <span class="heading-task-count">{hTasks.length}</span>
            <button
              class="heading-add-btn"
              onclick={(e) => { e.stopPropagation(); startAddTaskToHeading(heading.id); }}
              aria-label="Add task to {heading.name}"
            >+</button>
          </div>

          {#if !isHeadingCollapsed}
            {#each hTasks as task (task.id)}
              {@const subtasks = getSubtasks(task.id)}
              {@const hasSubtasks = subtasks.length > 0}
              {@const isCollapsed = collapsedParents.has(task.id)}
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div
                class="task-group"
                draggable="true"
                ondragstart={(e) => handleTaskDragStartOnRow(e, task)}
              >
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

            {#if addingTaskToHeadingId === heading.id}
              <div class="heading-quick-add">
                <span class="quick-add-icon">+</span>
                <input
                  bind:this={newHeadingTaskRef}
                  bind:value={newHeadingTaskTitle}
                  class="quick-add-input"
                  type="text"
                  placeholder="Add a task..."
                  onkeydown={(e) => handleQuickAdd(e, heading.id)}
                  onblur={() => { addingTaskToHeadingId = null; newHeadingTaskTitle = ''; }}
                />
              </div>
            {/if}
          {/if}
        </div>
      {/each}

      <!-- add heading button -->
      {#if creatingHeading}
        <div class="new-heading-input-row">
          <input
            bind:this={newHeadingInputRef}
            bind:value={newHeadingName}
            class="new-heading-input"
            type="text"
            placeholder="Heading name..."
            onkeydown={handleNewHeadingKeydown}
            onblur={cancelNewHeading}
          />
        </div>
      {:else}
        <button class="add-heading-btn" onclick={startCreatingHeading}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M6 1.5v9M1.5 6h9" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
          </svg>
          <span>Add Heading</span>
        </button>
      {/if}

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
    <BulkActionBar />
  </div>
{/if}

<ContextMenu open={headingCtxOpen} x={headingCtxX} y={headingCtxY} items={headingCtxMenuItems} onclose={() => (headingCtxOpen = false)} />

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
    padding: 16px 16px 4px;
  }
  .list-description {
    display: block;
    width: 100%;
    padding: 0 16px 8px;
    background: none;
    border: none;
    text-align: left;
    font-size: 13px;
    color: var(--color-text-secondary, #b6b6b2);
    cursor: pointer;
    line-height: 1.4;
  }
  .list-description:hover { color: var(--color-text-primary, #d4d4d4); }
  .list-description-placeholder { color: var(--color-text-muted, #90918d); font-style: italic; }
  .list-description-edit {
    display: block;
    width: calc(100% - 32px);
    margin: 0 16px 8px;
    padding: 4px 6px;
    background: var(--color-surface-0, #25282c);
    border: 1px solid var(--color-border, #32353a);
    border-radius: 4px;
    font-size: 13px;
    color: var(--color-text-primary, #d4d4d4);
    resize: vertical;
    outline: none;
    font-family: inherit;
    line-height: 1.4;
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
  .quick-add-preview {
    display: flex; flex-wrap: wrap; gap: 4px;
    padding: 2px 12px 6px;
  }
  .preview-chip {
    font-size: 11px; padding: 1px 8px; border-radius: 6px;
    background: var(--color-surface-0, #25282c);
    color: var(--color-text-secondary, #b6b6b2);
  }
  .date-chip { background: color-mix(in srgb, var(--color-accent, #6c93c7) 14%, transparent); color: var(--color-accent, #6c93c7); }
  .priority-chip.p1 { background: color-mix(in srgb, var(--color-priority-low) 14%, transparent); color: var(--color-priority-low); }
  .priority-chip.p2 { background: color-mix(in srgb, var(--color-priority-med) 14%, transparent); color: var(--color-priority-med); }
  .priority-chip.p3 { background: color-mix(in srgb, var(--color-priority-high) 14%, transparent); color: var(--color-priority-high); }
  .tag-chip { background: color-mix(in srgb, var(--color-info, #2e7cd1) 14%, transparent); color: var(--color-info, #2e7cd1); }

  /* heading styles */
  .heading-section {
    border-radius: 4px;
    transition: background 150ms ease;
  }
  .heading-section.drag-over-heading {
    background: color-mix(in srgb, var(--color-accent, #89b4fa) 8%, transparent);
  }
  .heading-drop-zone {
    border-radius: 4px;
    transition: background 150ms ease;
    min-height: 4px;
  }
  .heading-drop-zone.drag-over-heading {
    background: color-mix(in srgb, var(--color-accent, #89b4fa) 8%, transparent);
  }
  .heading-divider {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 12px 4px;
    margin-top: 8px;
    border-top: 1px solid var(--color-border-subtle, #313244);
    cursor: default;
    user-select: none;
  }
  .heading-divider.heading-dragging {
    opacity: 0.4;
  }
  .heading-divider.heading-drag-over {
    border-top: 2px solid var(--color-accent, #89b4fa);
    margin-top: 7px;
  }
  .heading-collapse-btn {
    width: 16px;
    height: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    color: var(--color-text-muted, #a6adc8);
    border-radius: 3px;
    flex-shrink: 0;
    transition: all 150ms ease;
  }
  .heading-collapse-btn:hover {
    color: var(--color-text-primary, #cdd6f4);
    background: var(--color-surface-0, #313244);
  }
  .heading-collapse-btn svg {
    transition: transform 150ms ease;
    transform: rotate(90deg);
  }
  .heading-collapse-btn.collapsed svg {
    transform: rotate(0deg);
  }
  .heading-drag-handle {
    color: var(--color-text-muted, #a6adc8);
    opacity: 0;
    cursor: grab;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    transition: opacity 150ms ease;
  }
  .heading-divider:hover .heading-drag-handle {
    opacity: 0.5;
  }
  .heading-drag-handle:hover {
    opacity: 1 !important;
  }
  .heading-label {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--color-text-muted, #a6adc8);
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .heading-rename-input {
    flex: 1;
    padding: 1px 6px;
    border-radius: 4px;
    border: 1px solid var(--color-accent, #89b4fa);
    background: var(--color-input, #17181a);
    color: var(--color-text-primary, #cdd6f4);
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-family: inherit;
    outline: none;
    min-width: 0;
  }
  .heading-task-count {
    font-size: 10px;
    color: var(--color-text-muted, #a6adc8);
    background: var(--color-surface-0, #313244);
    padding: 1px 6px;
    border-radius: 6px;
    flex-shrink: 0;
  }
  .heading-add-btn {
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
    font-size: 14px;
    font-weight: 500;
    opacity: 0;
    transition: all 150ms ease;
    flex-shrink: 0;
  }
  .heading-divider:hover .heading-add-btn {
    opacity: 1;
  }
  .heading-add-btn:hover {
    color: var(--color-text-primary, #cdd6f4);
    background: var(--color-surface-0, #313244);
  }
  .heading-quick-add {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 4px 12px 4px 24px;
    padding: 6px 10px;
    background: var(--color-surface-0, #313244);
    border-radius: 6px;
    border: 1px solid transparent;
    transition: border-color 200ms ease;
  }
  .heading-quick-add:focus-within {
    border-color: var(--color-accent, #89b4fa);
  }
  .add-heading-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    margin-top: 4px;
    background: none;
    border: none;
    cursor: pointer;
    color: var(--color-text-muted, #a6adc8);
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-family: inherit;
    border-radius: 6px;
    transition: all 150ms ease;
  }
  .add-heading-btn:hover {
    color: var(--color-text-secondary, #bac2de);
    background: var(--color-surface-hover, #2a2e33);
  }
  .new-heading-input-row {
    padding: 6px 12px;
    margin-top: 4px;
  }
  .new-heading-input {
    width: 100%;
    padding: 4px 8px;
    border-radius: 6px;
    border: 1px solid var(--color-accent, #89b4fa);
    background: var(--color-input, #17181a);
    color: var(--color-text-primary, #cdd6f4);
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-family: inherit;
    outline: none;
    box-sizing: border-box;
  }
  .new-heading-input::placeholder {
    color: var(--color-text-muted, #a6adc8);
    text-transform: none;
    font-weight: 500;
  }
</style>
