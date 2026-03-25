<script lang="ts">
  import { tasks, editTask, removeTask, moveTask, addTask } from '$lib/stores/tasks';
  import { tags, tagTask, untagTask } from '$lib/stores/tags';
  import { lists } from '$lib/stores/lists';
  import { selectedTaskId } from '$lib/stores/ui';
  import { invoke } from '@tauri-apps/api/core';
  import type { Task, Tag, Attachment } from '$lib/types';
  import { convertFileSrc } from '@tauri-apps/api/core';
  import RecurrenceBuilder from './RecurrenceBuilder.svelte';

  let task: Task | null = $state(null);
  let titleValue = $state('');
  let contentValue = $state('');
  let startDateValue = $state('');
  let dueDateValue = $state('');
  let dueTimeValue = $state('');
  let estimatedMinutesValue: number | null = $state(null);
  let recurrenceValue = $state('');
  let newSubtaskTitle = $state('');
  let showTagDropdown = $state(false);
  let previewDates: string[] = $state([]);
  let visible = $state(false);
  let attachments: Attachment[] = $state([]);

  const durationPresets = [
    { label: '15m', minutes: 15 },
    { label: '30m', minutes: 30 },
    { label: '1h', minutes: 60 },
    { label: '2h', minutes: 120 },
    { label: '4h', minutes: 240 },
    { label: '8h', minutes: 480 },
  ] as const;

  let titleTimer: ReturnType<typeof setTimeout> | null = null;
  let contentTimer: ReturnType<typeof setTimeout> | null = null;

  const priorityLabels = ['None', 'Low', 'Med', 'High'] as const;
  const priorityColors = [
    'var(--color-text-faint)',
    'var(--color-priority-low)',
    'var(--color-priority-med)',
    'var(--color-priority-high)',
  ];
  const DEFAULT_TAG_COLOR = 'var(--color-tag-default)';


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
        startDateValue = found.startDate ? found.startDate.slice(0, 10) : '';
        dueDateValue = found.dueDate ? found.dueDate.slice(0, 10) : '';
        dueTimeValue = found.dueDate && found.dueDate.length > 10 ? found.dueDate.slice(11, 16) : '';
        estimatedMinutesValue = found.estimatedMinutes ?? null;
        recurrenceValue = found.recurrenceRule ?? '';
      }
      loadAttachments(id);
      requestAnimationFrame(() => {
        visible = true;
      });
    } else {
      visible = false;
      task = null;
      attachments = [];
    }
  });

  $effect(() => {
    const rule = recurrenceValue;
    const start = dueDateValue;
    if (rule && start) {
      invoke<string[]>('preview_recurrence', { rule, startDate: start, count: 5 })
        .then((dates) => { previewDates = dates; })
        .catch(() => { previewDates = []; });
    } else {
      previewDates = [];
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

  function onStartDateChange(e: Event) {
    const target = e.target as HTMLInputElement;
    startDateValue = target.value;
    saveStartDate();
  }

  function saveStartDate() {
    if (!task) return;
    if (!startDateValue) {
      editTask(task.id, { startDate: undefined });
      return;
    }
    editTask(task.id, { startDate: startDateValue });
  }

  function setEstimatedMinutes(minutes: number | null) {
    if (!task) return;
    estimatedMinutesValue = minutes;
    editTask(task.id, { estimatedMinutes: minutes ?? undefined });
  }

  function onCustomMinutesInput(e: Event) {
    const target = e.target as HTMLInputElement;
    const val = parseInt(target.value, 10);
    if (isNaN(val) || val <= 0) {
      setEstimatedMinutes(null);
    } else {
      setEstimatedMinutes(val);
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

  function handleRecurrenceBuilderChange(rule: string) {
    recurrenceValue = rule;
    if (task) {
      editTask(task.id, { recurrenceRule: rule || undefined });
    }
  }

  async function handleRemoveTag(tagId: string) {
    if (!task) return;
    await untagTask(task.id, tagId);
  }

  async function handleAddTag(tagId: string) {
    if (!task) return;
    await tagTask(task.id, tagId);
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

  async function loadAttachments(taskId: string) {
    try {
      attachments = await invoke<Attachment[]>('list_attachments', { taskId });
    } catch { attachments = []; }
  }

  async function handleAttachFile() {
    if (!task) return;
    const { open } = await import('@tauri-apps/plugin-dialog');
    const selected = await open({ multiple: true });
    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    for (const p of paths) {
      const sourcePath = typeof p === 'string' ? p : p.path;
      await invoke('add_attachment', { taskId: task.id, sourcePath });
    }
    await loadAttachments(task.id);
  }

  async function handleRemoveAttachment(attachmentId: string) {
    await invoke('remove_attachment', { attachmentId });
    if (task) await loadAttachments(task.id);
  }

  function isImage(mime: string | null): boolean {
    return !!mime && mime.startsWith('image/');
  }

  function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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

  function formatShortDate(iso: string): string {
    try {
      return new Date(iso).toLocaleDateString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      });
    } catch {
      return iso;
    }
  }

  let dateRangeBadge = $derived(
    startDateValue && dueDateValue
      ? `${formatShortDate(startDateValue)} → ${formatShortDate(dueDateValue)}`
      : null
  );

  let isPresetMatch = $derived(
    estimatedMinutesValue !== null && durationPresets.some((p) => p.minutes === estimatedMinutesValue)
  );

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

        <!-- Start Date -->
        <section class="field-group">
          <span class="field-label">Start Date</span>
          <input
            class="field-input date-input"
            type="date"
            value={startDateValue}
            onchange={onStartDateChange}
          />
        </section>

        <!-- Deadline (Due Date & Time) -->
        <section class="field-group">
          <span class="field-label">Deadline</span>
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
          {#if dateRangeBadge}
            <span class="date-range-badge">{dateRangeBadge}</span>
          {/if}
        </section>

        <!-- Estimated Duration -->
        <section class="field-group">
          <span class="field-label">Estimated Duration</span>
          <div class="duration-row">
            {#each durationPresets as preset}
              <button
                class="duration-btn"
                class:active={estimatedMinutesValue === preset.minutes}
                onclick={() => setEstimatedMinutes(estimatedMinutesValue === preset.minutes ? null : preset.minutes)}
              >
                {preset.label}
              </button>
            {/each}
          </div>
          {#if !isPresetMatch}
            <input
              class="field-input duration-custom-input"
              type="number"
              min="1"
              placeholder="Custom minutes"
              value={estimatedMinutesValue ?? ''}
              oninput={onCustomMinutesInput}
            />
          {/if}
        </section>

        <!-- Recurrence -->
        <section class="field-group">
          <span class="field-label">Recurrence</span>
          <RecurrenceBuilder value={recurrenceValue} onchange={handleRecurrenceBuilderChange} />
        </section>

        {#if previewDates.length > 0}
          <div class="recurrence-preview">
            <span class="preview-label">Upcoming</span>
            {#each previewDates as dateStr}
              <span class="preview-date">{formatDate(dateStr)}</span>
            {/each}
          </div>
        {/if}

        <!-- Tags -->
        <section class="field-group">
          <span class="field-label">Tags</span>
          <div class="tags-container">
            {#each task.tags as tag (tag.id)}
              <span class="tag-pill" style="--tag-color: {tag.color ?? DEFAULT_TAG_COLOR}">
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
                      <span class="tag-dot" style="background: {tag.color ?? DEFAULT_TAG_COLOR}"></span>
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

      <!-- Attachments -->
      <section class="detail-section">
        <div class="section-label">
          Attachments
          <button class="attach-btn" onclick={handleAttachFile}>+ Attach</button>
        </div>
        {#if attachments.length > 0}
          <div class="attachment-list">
            {#each attachments as att (att.id)}
              <div class="attachment-item">
                {#if isImage(att.mimeType)}
                  <img class="attachment-thumb" src={convertFileSrc(att.filePath)} alt={att.filename} />
                {/if}
                <div class="attachment-info">
                  <span class="attachment-name">{att.filename}</span>
                  <span class="attachment-size">{formatFileSize(att.size)}</span>
                </div>
                <button class="attachment-remove" onclick={() => handleRemoveAttachment(att.id)} title="Remove">&times;</button>
              </div>
            {/each}
          </div>
        {/if}
      </section>

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
    background: var(--color-overlay, rgba(8, 8, 8, 0.56));
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
    background: var(--color-panel, #202225);
    border-left: 1px solid var(--color-border-subtle, #292c30);
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
    border-bottom: 1px solid var(--color-border-subtle, #292c30);
    flex-shrink: 0;
  }

  .panel-title {
    font-size: 14px;
    font-weight: 600;
    color: var(--color-text-primary, #d4d4d4);
  }

  .close-btn {
    background: none;
    border: none;
    color: var(--color-text-muted, #90918d);
    font-size: 16px;
    cursor: pointer;
    padding: 4px 8px;
    border-radius: 6px;
    transition: background 200ms ease, color 200ms ease;
    line-height: 1;
  }

  .close-btn:hover {
    background: var(--color-surface-hover, #2a2e33);
    color: var(--color-text-primary, #d4d4d4);
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
    color: var(--color-text-muted, #90918d);
  }

  .field-input {
    background: var(--color-input, #17181a);
    border: 1px solid var(--color-border, #32353a);
    border-radius: 8px;
    padding: 8px 12px;
    color: var(--color-text-primary, #d4d4d4);
    font-size: 13px;
    font-family: inherit;
    outline: none;
    transition: border-color 200ms ease, box-shadow 200ms ease;
  }

  .field-input:focus {
    border-color: var(--color-accent, #6c93c7);
    box-shadow: 0 0 0 3px var(--color-accent-soft, rgba(108, 147, 199, 0.16));
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
    border: 1px solid var(--color-border, #32353a);
    border-radius: 8px;
    background: var(--color-input, #17181a);
    color: var(--color-text-muted, #90918d);
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
    background: color-mix(in srgb, var(--tag-color) 14%, transparent);
    border: 1px solid color-mix(in srgb, var(--tag-color) 20%, transparent);
    color: var(--tag-color);
  }

  .tag-remove-btn {
    background: none;
    border: none;
    color: color-mix(in srgb, var(--tag-color) 72%, var(--color-text-muted, #90918d));
    font-size: 10px;
    cursor: pointer;
    padding: 0 2px;
    line-height: 1;
    transition: color 200ms ease;
  }

  .tag-remove-btn:hover {
    color: var(--tag-color);
  }

  .tag-add-wrapper {
    position: relative;
  }

  .tag-add-btn {
    width: 26px;
    height: 26px;
    border-radius: 50%;
    border: 1px dashed var(--color-border, #32353a);
    background: none;
    color: var(--color-text-muted, #90918d);
    font-size: 14px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 200ms ease;
    padding: 0;
  }

  .tag-add-btn:hover {
    border-color: var(--color-accent, #6c93c7);
    color: var(--color-accent, #6c93c7);
  }

  .tag-dropdown {
    position: absolute;
    top: 100%;
    left: 0;
    margin-top: 4px;
    background: var(--color-panel, #202225);
    border: 1px solid var(--color-border-subtle, #292c30);
    border-radius: 8px;
    padding: 4px;
    min-width: 160px;
    z-index: 10;
    box-shadow: var(--shadow-overlay, 0 20px 56px rgba(0, 0, 0, 0.48));
  }

  .tag-dropdown-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px 10px;
    border: none;
    background: none;
    color: var(--color-text-primary, #d4d4d4);
    font-size: 12px;
    cursor: pointer;
    border-radius: 6px;
    transition: background 200ms ease;
    font-family: inherit;
    text-align: left;
  }

  .tag-dropdown-item:hover {
    background: var(--color-surface-hover, #2a2e33);
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
    accent-color: var(--color-accent, #6c93c7);
    width: 16px;
    height: 16px;
    cursor: pointer;
  }

  .subtask-title {
    font-size: 13px;
    color: var(--color-text-primary, #d4d4d4);
  }

  .subtask-title.completed {
    text-decoration: line-through;
    color: var(--color-text-muted, #90918d);
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
    border: 1px solid var(--color-border, #32353a);
    border-radius: 8px;
    background: var(--color-input, #17181a);
    color: var(--color-text-muted, #90918d);
    font-size: 12px;
    cursor: pointer;
    transition: all 200ms ease;
    font-family: inherit;
  }

  .subtask-add-btn:hover {
    border-color: var(--color-accent, #6c93c7);
    color: var(--color-accent, #6c93c7);
  }

  /* Footer */
  .panel-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 20px;
    border-top: 1px solid var(--color-border-subtle, #292c30);
    flex-shrink: 0;
  }

  .created-date {
    font-size: 11px;
    color: var(--color-text-faint, #70726f);
  }

  .delete-btn {
    padding: 6px 16px;
    border: 1px solid var(--color-danger, #cd4945);
    border-radius: 8px;
    background: transparent;
    color: var(--color-danger, #cd4945);
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: all 200ms ease;
    font-family: inherit;
  }

  .delete-btn:hover {
    background: color-mix(in srgb, var(--color-danger, #cd4945) 10%, transparent);
  }

  /* Attachments */
  .attach-btn {
    background: none; border: none; cursor: pointer;
    color: var(--color-accent, #6c93c7); font-size: 11px;
    padding: 2px 6px; border-radius: 4px; margin-left: 8px;
    font-family: inherit;
  }
  .attach-btn:hover { background: var(--color-surface-hover, #2a2e33); }
  .attachment-list { display: flex; flex-direction: column; gap: 6px; margin-top: 4px; }
  .attachment-item {
    display: flex; align-items: center; gap: 8px;
    padding: 4px 8px; border-radius: 6px;
    background: var(--color-surface-0, #25282c);
    border: 1px solid var(--color-border-subtle, #292c30);
  }
  .attachment-thumb {
    width: 40px; height: 40px; object-fit: cover;
    border-radius: 4px; flex-shrink: 0;
  }
  .attachment-info { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .attachment-name {
    font-size: 12px; color: var(--color-text-primary, #d4d4d4);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .attachment-size { font-size: 10px; color: var(--color-text-muted, #90918d); }
  .attachment-remove {
    background: none; border: none; cursor: pointer;
    color: var(--color-text-muted, #90918d); font-size: 16px;
    padding: 2px 6px; border-radius: 4px; flex-shrink: 0;
  }
  .attachment-remove:hover { color: var(--color-priority-high, #e06c60); }

  /* Recurrence preview */
  .recurrence-preview {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 8px;
    padding: 6px 0;
  }
  .preview-label {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--color-text-muted, #90918d);
    width: 100%;
  }
  .preview-date {
    font-size: 12px;
    color: var(--color-text-secondary, #b6b6b2);
    background: var(--color-surface-0, #25282c);
    padding: 2px 8px;
    border-radius: 6px;
  }

  /* Date range badge */
  .date-range-badge {
    display: inline-block;
    font-size: 12px;
    font-weight: 500;
    color: var(--color-accent, #6c93c7);
    background: color-mix(in srgb, var(--color-accent, #6c93c7) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-accent, #6c93c7) 20%, transparent);
    border-radius: 8px;
    padding: 4px 10px;
    margin-top: 2px;
    width: fit-content;
  }

  /* Duration */
  .duration-row {
    display: flex;
    gap: 6px;
  }

  .duration-btn {
    flex: 1;
    padding: 6px 0;
    border: 1px solid var(--color-border, #32353a);
    border-radius: 8px;
    background: var(--color-input, #17181a);
    color: var(--color-text-muted, #90918d);
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: all 200ms ease;
    font-family: inherit;
  }

  .duration-btn:hover {
    border-color: var(--color-accent, #6c93c7);
    color: var(--color-accent, #6c93c7);
  }

  .duration-btn.active {
    background: color-mix(in srgb, var(--color-accent, #6c93c7) 15%, transparent);
    border-color: var(--color-accent, #6c93c7);
    color: var(--color-accent, #6c93c7);
  }

  .duration-custom-input {
    width: 140px;
    margin-top: 4px;
  }

  /* Scrollbar styling */
  .panel-body::-webkit-scrollbar {
    width: 6px;
  }

  .panel-body::-webkit-scrollbar-track {
    background: transparent;
  }

  .panel-body::-webkit-scrollbar-thumb {
    background: var(--color-surface-1, #2d3136);
    border-radius: 3px;
  }

  .panel-body::-webkit-scrollbar-thumb:hover {
    background: var(--color-surface-2, #393e45);
  }
</style>
