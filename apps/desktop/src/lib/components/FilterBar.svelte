<script lang="ts">
  import { tags } from '$lib/stores/tags';
  import { showCompletedTasks } from '$lib/stores/ui';
  import {
    currentSort,
    currentFilters,
    togglePriority,
    toggleTag,
    resetFilters,
    type SortMode,
  } from '$lib/stores/filters';

  const SORT_OPTIONS: { value: SortMode; label: string }[] = [
    { value: 'manual', label: 'Manual' },
    { value: 'priority', label: 'Priority' },
    { value: 'dueDate', label: 'Due Date' },
    { value: 'title', label: 'Title' },
    { value: 'created', label: 'Created' },
  ];

  const PRIORITY_LABELS: Record<number, string> = {
    1: 'Low',
    2: 'Medium',
    3: 'High',
  };

  const PRIORITY_COLORS: Record<number, string> = {
    1: 'var(--color-priority-low)',
    2: 'var(--color-priority-med)',
    3: 'var(--color-priority-high)',
  };

  function handleSortChange(e: Event) {
    const target = e.target as HTMLSelectElement;
    currentSort.set(target.value as SortMode);
  }

  function toggleCompleted() {
    showCompletedTasks.update((value) => !value);
  }

  function removePriority(p: number) {
    togglePriority(p);
  }

  function removeTag(tagId: string) {
    toggleTag(tagId);
  }

  let activePriorityPills = $derived(
    $currentFilters.priorities.map((p) => ({
      key: `priority-${p}`,
      label: `Priority: ${PRIORITY_LABELS[p] ?? p}`,
      remove: () => removePriority(p),
    }))
  );

  let activeTagPills = $derived(
    $currentFilters.tagIds.map((id) => {
      const tag = $tags.find((t) => t.id === id);
      return {
        key: `tag-${id}`,
        label: `Tag: ${tag?.name ?? id}`,
        remove: () => removeTag(id),
      };
    })
  );

  let hasActiveFilters = $derived(
    !$showCompletedTasks ||
    $currentFilters.priorities.length > 0 ||
    $currentFilters.tagIds.length > 0 ||
    $currentFilters.dueBefore !== null ||
    $currentFilters.dueAfter !== null
  );
</script>

<div class="filter-bar" role="toolbar" aria-label="Filter and sort tasks">
  <div class="filter-controls">
    <label class="sort-label">
      Sort:
      <select
        value={$currentSort}
        onchange={handleSortChange}
        aria-label="Sort tasks by"
      >
        {#each SORT_OPTIONS as opt (opt.value)}
          <option value={opt.value}>{opt.label}</option>
        {/each}
      </select>
    </label>

    <button
      class="toggle-btn"
      class:active={!$showCompletedTasks}
      onclick={toggleCompleted}
      aria-pressed={!$showCompletedTasks}
    >
      {$showCompletedTasks ? 'All Tasks' : 'Active Only'}
    </button>

    <div class="priority-chips" role="group" aria-label="Filter by priority">
      {#each [1, 2, 3] as p (p)}
        <button
          class="chip"
          class:active={$currentFilters.priorities.includes(p)}
          style:--chip-color={PRIORITY_COLORS[p]}
          onclick={() => togglePriority(p)}
          aria-pressed={$currentFilters.priorities.includes(p)}
        >
          {PRIORITY_LABELS[p]}
        </button>
      {/each}
    </div>

    {#if $tags.length > 0}
      <div class="tag-chips" role="group" aria-label="Filter by tag">
        {#each $tags as tag (tag.id)}
          <button
            class="chip"
            class:active={$currentFilters.tagIds.includes(tag.id)}
            style:--chip-color={tag.color ?? 'var(--color-tag-default)'}
            onclick={() => toggleTag(tag.id)}
            aria-pressed={$currentFilters.tagIds.includes(tag.id)}
          >
            {tag.name}
          </button>
        {/each}
      </div>
    {/if}
  </div>

  {#if hasActiveFilters}
    <div class="active-pills" role="list" aria-label="Active filters">
      {#if !$showCompletedTasks}
        <span class="pill" role="listitem">
          Active Only
          <button
            class="pill-remove"
            onclick={toggleCompleted}
            aria-label="Show completed tasks again"
          >&times;</button>
        </span>
      {/if}

      {#each activePriorityPills as pill (pill.key)}
        <span class="pill" role="listitem">
          {pill.label}
          <button
            class="pill-remove"
            onclick={pill.remove}
            aria-label="Remove {pill.label} filter"
          >&times;</button>
        </span>
      {/each}

      {#each activeTagPills as pill (pill.key)}
        <span class="pill" role="listitem">
          {pill.label}
          <button
            class="pill-remove"
            onclick={pill.remove}
            aria-label="Remove {pill.label} filter"
          >&times;</button>
        </span>
      {/each}

      <button
        class="clear-btn"
        onclick={resetFilters}
        aria-label="Clear all filters"
      >
        Clear all
      </button>
    </div>
  {/if}
</div>

<style>
  .filter-bar {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--color-border-subtle, #292c30);
  }

  .filter-controls {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }

  .sort-label {
    font-size: 12px;
    color: var(--color-text-secondary, #b6b6b2);
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .sort-label select {
    font-size: 12px;
    background: var(--color-input, #17181a);
    color: var(--color-text-primary, #d4d4d4);
    border: 1px solid var(--color-border, #32353a);
    border-radius: 8px;
    padding: 4px 8px;
    font-family: inherit;
  }

  .toggle-btn {
    font-size: 11px;
    padding: 5px 10px;
    border-radius: 999px;
    border: 1px solid var(--color-border, #32353a);
    background: transparent;
    color: var(--color-text-secondary, #b6b6b2);
    cursor: pointer;
    transition: all 150ms ease;
  }

  .toggle-btn.active {
    background: var(--color-accent-soft, rgba(108, 147, 199, 0.16));
    color: var(--color-accent, #6c93c7);
    border-color: color-mix(in srgb, var(--color-accent, #6c93c7) 35%, var(--color-border, #32353a));
  }

  .priority-chips,
  .tag-chips {
    display: flex;
    gap: 4px;
  }

  .chip {
    font-size: 11px;
    padding: 4px 9px;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--chip-color, var(--color-border, #32353a)) 40%, var(--color-border, #32353a));
    background: transparent;
    color: var(--chip-color, var(--color-text-secondary, #b6b6b2));
    cursor: pointer;
    transition: all 150ms ease;
  }

  .chip.active {
    background: color-mix(in srgb, var(--chip-color) 14%, transparent);
  }

  .active-pills {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }

  .pill {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 10px;
    background: var(--color-surface-0, #25282c);
    color: var(--color-text-primary, #d4d4d4);
  }

  .pill-remove {
    background: none;
    border: none;
    color: var(--color-text-muted, #90918d);
    cursor: pointer;
    font-size: 14px;
    line-height: 1;
    padding: 0 2px;
  }

  .pill-remove:hover {
    color: var(--color-danger, #cd4945);
  }

  .clear-btn {
    font-size: 11px;
    background: none;
    border: none;
    color: var(--color-accent, #6c93c7);
    cursor: pointer;
    padding: 2px 4px;
    text-decoration: underline;
  }
</style>
