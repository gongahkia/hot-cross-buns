<script lang="ts">
  import type { Task } from '$lib/types';
  import { completeTask } from '$lib/stores/tasks';
  import { selectedTaskId } from '$lib/stores/ui';
  import { selectedTaskIds, toggleSelect, clearSelection } from '$lib/stores/selection';

  let { task, indent = false }: { task: Task; indent?: boolean } = $props();

  const PRIORITY_COLORS: Record<number, string> = {
    0: 'transparent',
    1: 'var(--color-priority-low)',
    2: 'var(--color-priority-med)',
    3: 'var(--color-priority-high)',
  };

  function formatDueDate(dueDate: string | null): { label: string; overdue: boolean } | null {
    if (!dueDate) return null;
    const due = new Date(dueDate);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());
    const diffMs = dueDay.getTime() - today.getTime();
    const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays < 0) return { label: 'Overdue', overdue: true };
    if (diffDays === 0) return { label: 'Today', overdue: false };
    if (diffDays === 1) return { label: 'Tomorrow', overdue: false };
    const month = due.toLocaleDateString('en-US', { month: 'short' });
    const day = due.getDate();
    return { label: `${month} ${day}`, overdue: false };
  }

  function handleComplete() {
    completeTask(task.id);
  }

  function handleSelectTask() {
    selectedTaskId.set(task.id);
  }

  function handleClick(e: MouseEvent) {
    if (e.metaKey || e.ctrlKey) {
      e.preventDefault();
      toggleSelect(task.id);
      return;
    }
    if ($selectedTaskIds.size > 0) clearSelection();
    handleSelectTask();
  }

  let isCompleted = $derived(task.status === 1);
  let isSelected = $derived($selectedTaskIds.has(task.id));
  let borderColor = $derived(PRIORITY_COLORS[task.priority] ?? 'transparent');
  let dueBadge = $derived(formatDueDate(task.dueDate));
</script>

<div
  class="task-row"
  class:indent
  class:completed={isCompleted}
  class:selected={isSelected}
  style:border-left-color={borderColor}
  role="listitem"
>
  <button
    class="checkbox"
    class:checked={isCompleted}
    onclick={handleComplete}
    role="checkbox"
    aria-checked={isCompleted}
    aria-label={isCompleted ? 'Mark as incomplete' : 'Mark as complete'}
  >
    {#if isCompleted}
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
        <path d="M2 6L5 9L10 3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    {/if}
  </button>

  <button class="task-title" onclick={handleClick} aria-label="Select task: {task.title}">
    {task.title}
  </button>

  {#if dueBadge}
    <span class="due-badge" class:overdue={dueBadge.overdue}>
      {dueBadge.label}
    </span>
  {/if}

  {#if task.tags && task.tags.length > 0}
    <div class="tag-pills">
      {#each task.tags as tag (tag.id)}
        <span
          class="tag-pill"
          style:--tag-color={tag.color ?? 'var(--color-tag-default)'}
        >
          {tag.name}
        </span>
      {/each}
    </div>
  {/if}
</div>

<style>
  .task-row {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 40px;
    padding: 4px 12px;
    border-left: 3px solid transparent;
    border-radius: 0;
    transition: background 200ms cubic-bezier(0.4, 0, 0.2, 1);
    cursor: default;
  }

  .task-row:hover {
    background: var(--color-surface-hover, #2a2e33);
  }

  .task-row.selected {
    background: var(--color-accent-soft, rgba(108, 147, 199, 0.16));
  }

  .task-row.indent {
    margin-left: 24px;
  }

  .checkbox {
    width: 18px;
    height: 18px;
    min-width: 18px;
    border-radius: 4px;
    border: 2px solid var(--color-border, #32353a);
    background: transparent;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    padding: 0;
    color: var(--color-on-accent, #f7f7f5);
    transition: all 150ms cubic-bezier(0.34, 1.56, 0.64, 1);
  }

  .checkbox:hover {
    border-color: var(--color-accent, #6c93c7);
  }

  .checkbox:focus-visible {
    outline: 2px solid var(--color-accent, #6c93c7);
    outline-offset: 2px;
  }

  .checkbox.checked {
    background: var(--color-accent, #6c93c7);
    border-color: var(--color-accent, #6c93c7);
    animation: check-pop 300ms cubic-bezier(0.34, 1.56, 0.64, 1);
  }

  @keyframes check-pop {
    0% { transform: scale(0.8); opacity: 0.6; }
    50% { transform: scale(1.15); }
    100% { transform: scale(1); opacity: 1; }
  }

  .task-title {
    flex: 1;
    font-size: 14px;
    font-weight: 500;
    line-height: 1.5;
    color: var(--color-text-primary, #d4d4d4);
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    text-align: left;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .task-title:hover {
    color: var(--color-accent, #6c93c7);
  }

  .task-title:focus-visible {
    outline: 2px solid var(--color-accent, #6c93c7);
    outline-offset: 2px;
    border-radius: 4px;
  }

  .completed .task-title {
    text-decoration: line-through;
    color: var(--color-text-muted, #90918d);
  }

  .due-badge {
    font-size: 11px;
    line-height: 1.4;
    padding: 2px 8px;
    border-radius: 8px;
    background: var(--color-surface-0, #25282c);
    color: var(--color-text-secondary, #b6b6b2);
    white-space: nowrap;
    flex-shrink: 0;
  }

  .due-badge.overdue {
    background: color-mix(in srgb, var(--color-danger, #cd4945) 14%, transparent);
    color: var(--color-danger, #cd4945);
  }

  .tag-pills {
    display: flex;
    gap: 4px;
    flex-shrink: 0;
  }

  .tag-pill {
    font-size: 11px;
    line-height: 1.4;
    padding: 2px 8px;
    border-radius: 8px;
    background: color-mix(in srgb, var(--tag-color) 14%, transparent);
    border: 1px solid color-mix(in srgb, var(--tag-color) 20%, transparent);
    color: var(--tag-color);
    white-space: nowrap;
  }
</style>
