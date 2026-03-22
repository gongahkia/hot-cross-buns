<script lang="ts">
  import { tasks, editTask, removeTask, moveTask, addTask } from '$lib/stores/tasks';
  import { tags, tagTask, untagTask } from '$lib/stores/tags';
  import { lists } from '$lib/stores/lists';
  import { selectedTaskId } from '$lib/stores/ui';
  import type { Task, Tag } from '$lib/types';

  let task: Task | null = $state(null);
  let titleValue = $state('');
  let contentValue = $state('');
  let dueDateValue = $state('');
  let dueTimeValue = $state('');
  let recurrenceValue = $state('');
  let newSubtaskTitle = $state('');
  let showTagDropdown = $state(false);
  let visible = $state(false);

  let titleTimer: ReturnType<typeof setTimeout> | null = null;
  let contentTimer: ReturnType<typeof setTimeout> | null = null;

  const priorityLabels = ['None', 'Low', 'Med', 'High'] as const;
  const priorityColors = ['#6c7086', '#94e2d5', '#f9e2af', '#f38ba8'];

  const recurrencePresets = [
    { value: '', label: 'None' },
    { value: 'RRULE:FREQ=DAILY', label: 'Daily' },
    { value: 'RRULE:FREQ=WEEKLY', label: 'Weekly' },
    { value: 'RRULE:FREQ=MONTHLY', label: 'Monthly' },
    { value: 'RRULE:FREQ=YEARLY', label: 'Yearly' },
  ];

  let allTasks: Task[] = $state([]);
  let allTags: Tag[] = $state([]);
  let allLists: { id: string; name: string; color: string | null; sortOrder: number; isInbox: boolean; createdAt: string; updatedAt: string; deletedAt: string | null }[] = $state([]);

  tasks.subscribe((v) => (allTasks = v));
  tags.subscribe((v) => (allTags = v));
  lists.subscribe((v) => (allLists = v));

  let currentTaskId: string | null = $state(null);

  selectedTaskId.subscribe((id) => {
    currentTaskId = id;
    if (id) {
      const found = allTasks.find((t) => t.id === id) ?? null;
      task = found;
      if (found) {
        titleValue = found.title;
        contentValue = found.content ?? '';
        dueDateValue = found.dueDate ? found.dueDate.slice(0, 10) : '';
        dueTimeValue = found.dueDate && found.dueDate.length > 10 ? found.dueDate.slice(11, 16) : '';
        recurrenceValue = found.recurrenceRule ?? '';
      }
      requestAnimationFrame(() => {
        visible = true;
      });
    } else {
      visible = false;
      task = null;
    }
  });

  // Keep task in sync when allTasks changes
  $effect(() => {
    if (currentTaskId) {
      const found = allTasks.find((t) => t.id === currentTaskId) ?? null;
      task = found;
    }
  });

  let subtasks = $derived(
    task ? allTasks.filter((t) => t.parentTaskId === task!.id) : []
  );

  let availableTags = $derived(
    task ? allTags.filter((at) => !task!.tags.some((tt) => tt.id === at.id)) : []
  );

  function close() {
    visible = false;
    setTimeout(() => {
      selectedTaskId.set(null);
    }, 350);
  }

  function debouncedEditTitle(value: string) {
    if (titleTimer) clearTimeout(titleTimer);
    titleTimer = setTimeout(() => {
      if (task && value !== task.title) {
        editTask(task.id, { title: value });
      }
    }, 300);
  }

  function debouncedEditContent(value: string) {
    if (contentTimer) clearTimeout(contentTimer);
    contentTimer = setTimeout(() => {
      if (task) {
        editTask(task.id, { content: value });
      }
    }, 300);
  }

  function onTitleInput(e: Event) {
    const target = e.target as HTMLInputElement;
    titleValue = target.value;
    debouncedEditTitle(titleValue);
  }

  function onContentInput(e: Event) {
    const target = e.target as HTMLTextAreaElement;
    contentValue = target.value;
    debouncedEditContent(contentValue);
  }

  function setPriority(level: number) {
    if (task) {
      editTask(task.id, { priority: level });
    }
  }

  function onDueDateChange(e: Event) {
    const target = e.target as HTMLInputElement;
    dueDateValue = target.value;
    saveDueDate();
  }

  function onDueTimeChange(e: Event) {
    const target = e.target as HTMLInputElement;
    dueTimeValue = target.value;
    saveDueDate();
  }

  function saveDueDate() {
    if (!task) return;
    if (!dueDateValue) {
      editTask(task.id, { dueDate: undefined });
      return;
    }
    const combined = dueTimeValue
      ? `${dueDateValue}T${dueTimeValue}:00`
      : dueDateValue;
    editTask(task.id, { dueDate: combined });
  }

  function onRecurrenceChange(e: Event) {
    const target = e.target as HTMLSelectElement;
    recurrenceValue = target.value;
    if (task) {
      editTask(task.id, { recurrenceRule: recurrenceValue || undefined });
    }
  }

  async function handleRemoveTag(tagId: string) {
    if (!task) return;
    await untagTask(task.id, tagId);
    // Optimistically update the local task tags
    if (task) {
      task = { ...task, tags: task.tags.filter((t) => t.id !== tagId) };
    }
  }

  async function handleAddTag(tagId: string) {
    if (!task) return;
    await tagTask(task.id, tagId);
    const tagObj = allTags.find((t) => t.id === tagId);
    if (task && tagObj) {
      task = { ...task, tags: [...task.tags, tagObj] };
    }
    showTagDropdown = false;
  }

  async function handleToggleSubtask(subtaskId: string) {
    const sub = allTasks.find((t) => t.id === subtaskId);
    if (!sub) return;
    const newStatus = sub.status === 0 ? 1 : 0;
    await editTask(subtaskId, { status: newStatus });
  }

  async function handleAddSubtask() {
    if (!task || !newSubtaskTitle.trim()) return;
    await addTask({
      listId: task.listId,
      title: newSubtaskTitle.trim(),
      parentTaskId: task.id,
    });
    newSubtaskTitle = '';
  }

  async function handleMoveTask(e: Event) {
    const target = e.target as HTMLSelectElement;
    if (!task) return;
    const newListId = target.value;
    if (newListId !== task.listId) {
      await moveTask(task.id, newListId, task.sortOrder);
    }
  }

  async function handleDelete() {
    if (!task) return;
    const id = task.id;
    close();
    await removeTask(id);
  }

  function formatDate(iso: string): string {
    try {
      return new Date(iso).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    } catch {
      return iso;
    }
  }

  function onSubtaskKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      handleAddSubtask();
    }
  }
</script>

{#if currentTaskId}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="task-detail-overlay" class:visible onclick={close}></div>
  <aside class="task-detail-panel" class:visible>
    {#if task}
      <div class="panel-header">
        <span class="panel-title">Task Details</span>
        <button class="close-btn" onclick={close} aria-label="Close panel">
          &#x2715;
        </button>
      </div>

      <div class="panel-body">
        <!-- Title -->
        <section class="field-group">
          <label class="field-label" for="task-title">Title</label>
          <input
            id="task-title"
            class="field-input title-input"
            type="text"
            value={titleValue}
            oninput={onTitleInput}
          />
        </section>

        <!-- Content / Notes -->
        <section class="field-group">
          <label class="field-label" for="task-content">Notes</label>
          <textarea
            id="task-content"
            class="field-input content-textarea"
            value={contentValue}
            oninput={onContentInput}
            rows="4"
            placeholder="Add notes..."
          ></textarea>
        </section>

        <!-- Priority -->
        <section class="field-group">
          <span class="field-label">Priority</span>
          <div class="priority-row">
            {#each priorityLabels as label, i}
              <button
                class="priority-btn"
                class:active={task.priority === i}
                style="--priority-color: {priorityColors[i]}"
                onclick={() => setPriority(i)}
              >
                {label}
              </button>
            {/each}
          </div>
        </section>

        <!-- Due Date & Time -->
        <section class="field-group">
          <span class="field-label">Due Date</span>
          <div class="date-row">
            <input
              class="field-input date-input"
              type="date"
              value={dueDateValue}
              onchange={onDueDateChange}
            />
            <input
              class="field-input time-input"
              type="time"
              value={dueTimeValue}
              onchange={onDueTimeChange}
            />
          </div>
        </section>

        <!-- Recurrence -->
        <section class="field-group">
          <label class="field-label" for="task-recurrence">Recurrence</label>
          <select
            id="task-recurrence"
            class="field-input"
            value={recurrenceValue}
            onchange={onRecurrenceChange}
          >
            {#each recurrencePresets as preset}
              <option value={preset.value}>{preset.label}</option>
            {/each}
          </select>
        </section>

        <!-- Tags -->
        <section class="field-group">
          <span class="field-label">Tags</span>
          <div class="tags-container">
            {#each task.tags as tag (tag.id)}
              <span class="tag-pill" style="background: {tag.color ?? '#cba6f7'}">
                {tag.name}
                <button
                  class="tag-remove-btn"
                  onclick={() => handleRemoveTag(tag.id)}
                  aria-label="Remove tag {tag.name}"
                >
                  &#x2715;
                </button>
              </span>
            {/each}
            <div class="tag-add-wrapper">
              <button
                class="tag-add-btn"
                onclick={() => (showTagDropdown = !showTagDropdown)}
                aria-label="Add tag"
              >
                +
              </button>
              {#if showTagDropdown && availableTags.length > 0}
                <div class="tag-dropdown">
                  {#each availableTags as tag (tag.id)}
                    <button
                      class="tag-dropdown-item"
                      onclick={() => handleAddTag(tag.id)}
                    >
                      <span class="tag-dot" style="background: {tag.color ?? '#cba6f7'}"></span>
                      {tag.name}
                    </button>
                  {/each}
                </div>
              {/if}
            </div>
          </div>
        </section>

        <!-- Subtasks -->
        <section class="field-group">
          <span class="field-label">Subtasks</span>
          <div class="subtasks-list">
            {#each subtasks as sub (sub.id)}
              <div class="subtask-item">
                <input
                  type="checkbox"
                  checked={sub.status === 1}
                  onchange={() => handleToggleSubtask(sub.id)}
                />
                <span class="subtask-title" class:completed={sub.status === 1}>
                  {sub.title}
                </span>
              </div>
            {/each}
            <div class="subtask-add-row">
              <input
                class="field-input subtask-input"
                type="text"
                placeholder="Add subtask..."
                bind:value={newSubtaskTitle}
                onkeydown={onSubtaskKeydown}
              />
              <button class="subtask-add-btn" onclick={handleAddSubtask}>
                Add
              </button>
            </div>
          </div>
        </section>

        <!-- List Assignment -->
        <section class="field-group">
          <label class="field-label" for="task-list">List</label>
          <select
            id="task-list"
            class="field-input"
            value={task.listId}
            onchange={handleMoveTask}
          >
            {#each allLists as list (list.id)}
              <option value={list.id}>{list.name}</option>
            {/each}
          </select>
        </section>
      </div>

      <!-- Footer -->
      <div class="panel-footer">
        <span class="created-date">Created {formatDate(task.createdAt)}</span>
        <button class="delete-btn" onclick={handleDelete}>
          Delete task
        </button>
      </div>
    {/if}
  </aside>
{/if}

<style>
  .task-detail-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.3);
    z-index: 99;
    opacity: 0;
    transition: opacity 350ms ease;
    pointer-events: none;
  }

  .task-detail-overlay.visible {
    opacity: 1;
    pointer-events: auto;
  }

  .task-detail-panel {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    width: 400px;
    max-width: 100vw;
    background: #1e1e2e;
    border-left: 1px solid #313244;
    z-index: 100;
    display: flex;
    flex-direction: column;
    transform: translateX(100%);
    transition: transform 350ms cubic-bezier(0.4, 0, 0.2, 1);
    overflow: hidden;
  }

  .task-detail-panel.visible {
    transform: translateX(0);
  }

  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid #313244;
    flex-shrink: 0;
  }

  .panel-title {
    font-size: 14px;
    font-weight: 600;
    color: #cdd6f4;
  }

  .close-btn {
    background: none;
    border: none;
    color: #a6adc8;
    font-size: 16px;
    cursor: pointer;
    padding: 4px 8px;
    border-radius: 6px;
    transition: background 200ms ease, color 200ms ease;
    line-height: 1;
  }

  .close-btn:hover {
    background: #313244;
    color: #cdd6f4;
  }

  .panel-body {
    flex: 1;
    overflow-y: auto;
    padding: 16px 20px;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .field-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .field-label {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #a6adc8;
  }

  .field-input {
    background: #181825;
    border: 1px solid #313244;
    border-radius: 8px;
    padding: 8px 12px;
    color: #cdd6f4;
    font-size: 13px;
    font-family: inherit;
    outline: none;
    transition: border-color 200ms ease;
  }

  .field-input:focus {
    border-color: #89b4fa;
  }

  .title-input {
    font-size: 16px;
    font-weight: 500;
    padding: 10px 12px;
  }

  .content-textarea {
    resize: vertical;
    min-height: 80px;
    line-height: 1.5;
  }

  /* Priority */
  .priority-row {
    display: flex;
    gap: 6px;
  }

  .priority-btn {
    flex: 1;
    padding: 6px 0;
    border: 1px solid #313244;
    border-radius: 8px;
    background: #181825;
    color: #a6adc8;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: all 200ms ease;
    font-family: inherit;
  }

  .priority-btn:hover {
    border-color: var(--priority-color);
    color: var(--priority-color);
  }

  .priority-btn.active {
    background: color-mix(in srgb, var(--priority-color) 15%, transparent);
    border-color: var(--priority-color);
    color: var(--priority-color);
  }

  /* Date */
  .date-row {
    display: flex;
    gap: 8px;
  }

  .date-input {
    flex: 1;
  }

  .time-input {
    width: 120px;
  }

  /* Tags */
  .tags-container {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
  }

  .tag-pill {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px 10px;
    border-radius: 12px;
    font-size: 12px;
    font-weight: 500;
    color: #1e1e2e;
  }

  .tag-remove-btn {
    background: none;
    border: none;
    color: rgba(30, 30, 46, 0.6);
    font-size: 10px;
    cursor: pointer;
    padding: 0 2px;
    line-height: 1;
    transition: color 200ms ease;
  }

  .tag-remove-btn:hover {
    color: #1e1e2e;
  }

  .tag-add-wrapper {
    position: relative;
  }

  .tag-add-btn {
    width: 26px;
    height: 26px;
    border-radius: 50%;
    border: 1px dashed #585b70;
    background: none;
    color: #a6adc8;
    font-size: 14px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 200ms ease;
    padding: 0;
  }

  .tag-add-btn:hover {
    border-color: #89b4fa;
    color: #89b4fa;
  }

  .tag-dropdown {
    position: absolute;
    top: 100%;
    left: 0;
    margin-top: 4px;
    background: #181825;
    border: 1px solid #313244;
    border-radius: 8px;
    padding: 4px;
    min-width: 160px;
    z-index: 10;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  }

  .tag-dropdown-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px 10px;
    border: none;
    background: none;
    color: #cdd6f4;
    font-size: 12px;
    cursor: pointer;
    border-radius: 6px;
    transition: background 200ms ease;
    font-family: inherit;
    text-align: left;
  }

  .tag-dropdown-item:hover {
    background: #313244;
  }

  .tag-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  /* Subtasks */
  .subtasks-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .subtask-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 0;
  }

  .subtask-item input[type='checkbox'] {
    accent-color: #89b4fa;
    width: 16px;
    height: 16px;
    cursor: pointer;
  }

  .subtask-title {
    font-size: 13px;
    color: #cdd6f4;
  }

  .subtask-title.completed {
    text-decoration: line-through;
    color: #6c7086;
  }

  .subtask-add-row {
    display: flex;
    gap: 6px;
    margin-top: 4px;
  }

  .subtask-input {
    flex: 1;
    padding: 6px 10px;
    font-size: 12px;
  }

  .subtask-add-btn {
    padding: 6px 14px;
    border: 1px solid #313244;
    border-radius: 8px;
    background: #181825;
    color: #a6adc8;
    font-size: 12px;
    cursor: pointer;
    transition: all 200ms ease;
    font-family: inherit;
  }

  .subtask-add-btn:hover {
    border-color: #89b4fa;
    color: #89b4fa;
  }

  /* Footer */
  .panel-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 20px;
    border-top: 1px solid #313244;
    flex-shrink: 0;
  }

  .created-date {
    font-size: 11px;
    color: #6c7086;
  }

  .delete-btn {
    padding: 6px 16px;
    border: 1px solid #f38ba8;
    border-radius: 8px;
    background: transparent;
    color: #f38ba8;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: all 200ms ease;
    font-family: inherit;
  }

  .delete-btn:hover {
    background: rgba(243, 139, 168, 0.1);
  }

  /* Scrollbar styling */
  .panel-body::-webkit-scrollbar {
    width: 6px;
  }

  .panel-body::-webkit-scrollbar-track {
    background: transparent;
  }

  .panel-body::-webkit-scrollbar-thumb {
    background: #313244;
    border-radius: 3px;
  }

  .panel-body::-webkit-scrollbar-thumb:hover {
    background: #45475a;
  }
</style>
