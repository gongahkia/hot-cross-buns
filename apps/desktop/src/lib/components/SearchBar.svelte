<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import { selectedTaskId } from '$lib/stores/ui';
  import type { Task } from '$lib/types';

  let query = $state('');
  let results: Task[] = $state([]);
  let open = $state(false);
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let inputEl: HTMLInputElement | undefined = $state(undefined);

  function onInput(e: Event) {
    const target = e.target as HTMLInputElement;
    query = target.value;

    if (debounceTimer) clearTimeout(debounceTimer);

    if (!query.trim()) {
      results = [];
      open = false;
      return;
    }

    debounceTimer = setTimeout(async () => {
      try {
        results = await invoke<Task[]>('search_tasks', { query: query.trim() });
        open = results.length > 0;
      } catch {
        results = [];
        open = false;
      }
    }, 300);
  }

  function selectTask(taskId: string) {
    selectedTaskId.set(taskId);
    query = '';
    results = [];
    open = false;
    if (inputEl) inputEl.blur();
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      query = '';
      results = [];
      open = false;
      if (inputEl) inputEl.blur();
    }
  }

  function onFocusOut(e: FocusEvent) {
    const related = e.relatedTarget as HTMLElement | null;
    // Keep dropdown open if focus moves within the search container
    if (related && (e.currentTarget as HTMLElement)?.contains(related)) return;
    // Delay close so click handler on results can fire
    setTimeout(() => {
      open = false;
    }, 150);
  }

  const priorityColors = [
    'var(--color-text-faint)',
    'var(--color-priority-low)',
    'var(--color-priority-med)',
    'var(--color-priority-high)',
  ];
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="search-container" onfocusout={onFocusOut}>
  <div class="search-input-wrapper">
    <svg class="search-icon" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M11.5 7a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0ZM10.7 11.4a6 6 0 1 1 .7-.7l3.15 3.15a.5.5 0 0 1-.7.7L10.7 11.4Z"
        fill="currentColor"
      />
    </svg>
    <input
      bind:this={inputEl}
      class="search-input"
      type="text"
      placeholder="Search tasks..."
      value={query}
      oninput={onInput}
      onkeydown={onKeydown}
    />
  </div>

  {#if open}
    <div class="search-dropdown">
      {#each results as task (task.id)}
        <button class="search-result" onclick={() => selectTask(task.id)}>
          <span class="result-priority-dot" style="background: {priorityColors[task.priority]}"></span>
          <div class="result-text">
            <span class="result-title">{task.title}</span>
            {#if task.content}
              <span class="result-content">{task.content.slice(0, 80)}{task.content.length > 80 ? '...' : ''}</span>
            {/if}
          </div>
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .search-container {
    position: relative;
    flex: 1;
    max-width: 320px;
    margin-left: auto;
  }

  .search-input-wrapper {
    display: flex;
    align-items: center;
    background: var(--color-input, #17181a);
    border: 1px solid var(--color-border-subtle, #292c30);
    border-radius: 10px;
    padding: 0 10px;
    transition: border-color 200ms ease, box-shadow 200ms ease;
  }

  .search-input-wrapper:focus-within {
    border-color: var(--color-accent, #6c93c7);
    box-shadow: 0 0 0 3px var(--color-accent-soft, rgba(108, 147, 199, 0.16));
  }

  .search-icon {
    width: 14px;
    height: 14px;
    color: var(--color-text-muted, #90918d);
    flex-shrink: 0;
  }

  .search-input {
    flex: 1;
    background: none;
    border: none;
    outline: none;
    color: var(--color-text-primary, #d4d4d4);
    font-size: 13px;
    font-family: inherit;
    padding: 8px;
  }

  .search-input::placeholder {
    color: var(--color-text-muted, #90918d);
  }

  .search-dropdown {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    right: 0;
    background: var(--color-panel, #202225);
    border: 1px solid var(--color-border-subtle, #292c30);
    border-radius: 12px;
    box-shadow: var(--shadow-overlay, 0 20px 56px rgba(0, 0, 0, 0.48));
    max-height: 320px;
    overflow-y: auto;
    z-index: 200;
    padding: 6px;
  }

  .search-dropdown::-webkit-scrollbar {
    width: 6px;
  }

  .search-dropdown::-webkit-scrollbar-track {
    background: transparent;
  }

  .search-dropdown::-webkit-scrollbar-thumb {
    background: var(--color-surface-1, #2d3136);
    border-radius: 3px;
  }

  .search-result {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    width: 100%;
    padding: 8px 10px;
    border: none;
    background: none;
    color: var(--color-text-primary, #d4d4d4);
    font-size: 13px;
    cursor: pointer;
    border-radius: 8px;
    transition: background 200ms ease;
    font-family: inherit;
    text-align: left;
  }

  .search-result:hover {
    background: var(--color-surface-hover, #2a2e33);
  }

  .result-priority-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
    margin-top: 5px;
  }

  .result-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .result-title {
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .result-content {
    font-size: 11px;
    color: var(--color-text-muted, #90918d);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
