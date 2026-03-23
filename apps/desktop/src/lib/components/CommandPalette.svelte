<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { invoke } from '@tauri-apps/api/core';
  import { currentView, selectedListId, selectedTaskId } from '$lib/stores/ui';
  import { lists } from '$lib/stores/lists';
  import { tags } from '$lib/stores/tags';
  import { areas } from '$lib/stores/areas';
  import type { Task } from '$lib/types';

  type PaletteResult = {
    type: 'view' | 'area' | 'list' | 'tag' | 'task';
    id: string;
    label: string;
    secondaryLabel?: string;
    color?: string;
  };

  type ResultGroup = {
    type: string;
    label: string;
    items: PaletteResult[];
  };

  const STATIC_VIEWS: PaletteResult[] = [
    { type: 'view', id: 'today', label: 'Today' },
    { type: 'view', id: 'upcoming', label: 'Upcoming' },
    { type: 'view', id: 'week', label: 'Week' },
    { type: 'view', id: 'calendar', label: 'Calendar' },
    { type: 'view', id: 'schedule', label: 'Schedule' },
    { type: 'view', id: 'timeline', label: 'Timeline' },
  ];

  let open = $state(false);
  let query = $state('');
  let selectedIndex = $state(0);
  let taskResults = $state<PaletteResult[]>([]);
  let inputEl: HTMLInputElement | undefined = $state(undefined);
  let listEl: HTMLDivElement | undefined = $state(undefined);
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  function matchesQuery(label: string, q: string): boolean {
    return label.toLowerCase().includes(q.toLowerCase());
  }

  let groups: ResultGroup[] = $derived.by(() => {
    const q = query.trim();
    const out: ResultGroup[] = [];
    const viewItems = q ? STATIC_VIEWS.filter(v => matchesQuery(v.label, q)) : STATIC_VIEWS;
    if (viewItems.length) out.push({ type: 'view', label: 'VIEWS', items: viewItems });
    const areaItems: PaletteResult[] = get(areas)
      .filter(a => !q || matchesQuery(a.name, q))
      .map(a => ({ type: 'area' as const, id: a.id, label: a.name, color: a.color ?? undefined }));
    if (areaItems.length) out.push({ type: 'area', label: 'AREAS', items: areaItems });
    const listItems: PaletteResult[] = get(lists)
      .filter(l => !q || matchesQuery(l.name, q))
      .map(l => ({ type: 'list' as const, id: l.id, label: l.name, color: l.color ?? undefined }));
    if (listItems.length) out.push({ type: 'list', label: 'LISTS', items: listItems });
    const tagItems: PaletteResult[] = get(tags)
      .filter(t => !q || matchesQuery(t.name, q))
      .map(t => ({ type: 'tag' as const, id: t.id, label: t.name, color: t.color ?? undefined }));
    if (tagItems.length) out.push({ type: 'tag', label: 'TAGS', items: tagItems });
    if (taskResults.length) out.push({ type: 'task', label: 'TASKS', items: taskResults });
    return out;
  });

  let flatResults: PaletteResult[] = $derived(groups.flatMap(g => g.items));

  function searchTasks(q: string) {
    if (debounceTimer) clearTimeout(debounceTimer);
    if (!q.trim()) {
      taskResults = [];
      return;
    }
    debounceTimer = setTimeout(async () => {
      try {
        const allLists = get(lists);
        const found = await invoke<Task[]>('search_tasks', { query: q.trim() });
        taskResults = found.map(t => {
          const parentList = allLists.find(l => l.id === t.listId);
          return {
            type: 'task' as const,
            id: t.id,
            label: t.title,
            secondaryLabel: parentList?.name,
          };
        });
      } catch {
        taskResults = [];
      }
    }, 300);
  }

  function openPalette(prefill = '') {
    open = true;
    query = prefill;
    selectedIndex = 0;
    taskResults = [];
    if (prefill) searchTasks(prefill);
    requestAnimationFrame(() => {
      inputEl?.focus();
    });
  }

  function closePalette() {
    open = false;
    query = '';
    selectedIndex = 0;
    taskResults = [];
    if (debounceTimer) clearTimeout(debounceTimer);
  }

  function selectResult(result: PaletteResult) {
    switch (result.type) {
      case 'view':
        currentView.set(result.id as any);
        break;
      case 'list':
        selectedListId.set(result.id);
        currentView.set('list');
        break;
      case 'task':
        selectedTaskId.set(result.id);
        break;
      case 'area':
      case 'tag':
        break; // no-op for now
    }
    closePalette();
  }

  function scrollToSelected() {
    if (!listEl) return;
    const el = listEl.querySelector(`[data-idx="${selectedIndex}"]`);
    if (el) el.scrollIntoView({ block: 'nearest' });
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      closePalette();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIndex = Math.min(selectedIndex + 1, flatResults.length - 1);
      scrollToSelected();
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIndex = Math.max(selectedIndex - 1, 0);
      scrollToSelected();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const result = flatResults[selectedIndex];
      if (result) selectResult(result);
      return;
    }
  }

  function onInput(e: Event) {
    const target = e.target as HTMLInputElement;
    query = target.value;
    selectedIndex = 0;
    searchTasks(query);
  }

  function handleOverlayClick(e: MouseEvent) {
    if (e.target === e.currentTarget) closePalette();
  }

  function isInputFocused(): boolean {
    const el = document.activeElement;
    if (!el) return false;
    const tag = el.tagName.toLowerCase();
    return tag === 'input' || tag === 'textarea' || (el as HTMLElement).isContentEditable;
  }

  onMount(() => {
    function globalKeydown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { // cmd+k / ctrl+k
        e.preventDefault();
        if (open) closePalette();
        else openPalette();
        return;
      }
      if (open) return; // handled by modal keydown
      if (isInputFocused()) return; // don't hijack text fields
      if (e.metaKey || e.ctrlKey || e.altKey) return; // skip modified keys
      if (e.key.length === 1 && /[a-zA-Z0-9]/.test(e.key)) { // type travel
        e.preventDefault();
        openPalette(e.key);
      }
    }
    window.addEventListener('keydown', globalKeydown);
    return () => window.removeEventListener('keydown', globalKeydown);
  });

  function categoryIcon(type: string): string {
    switch (type) {
      case 'view': return '&#xe0b0;'; // fallback
      default: return '';
    }
  }

  // track cumulative index for flat selection
  function cumulativeIndex(groups: ResultGroup[], groupIdx: number, itemIdx: number): number {
    let sum = 0;
    for (let i = 0; i < groupIdx; i++) sum += groups[i].items.length;
    return sum + itemIdx;
  }
</script>

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="palette-overlay" onclick={handleOverlayClick} onkeydown={onKeydown}>
    <div class="palette-modal" role="dialog" aria-label="Command palette">
      <div class="palette-input-wrapper">
        <svg class="palette-search-icon" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path
            d="M11.5 7a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0ZM10.7 11.4a6 6 0 1 1 .7-.7l3.15 3.15a.5.5 0 0 1-.7.7L10.7 11.4Z"
            fill="currentColor"
          />
        </svg>
        <input
          bind:this={inputEl}
          class="palette-input"
          type="text"
          placeholder="Search views, lists, tags, tasks..."
          value={query}
          oninput={onInput}
          onkeydown={onKeydown}
        />
        <kbd class="palette-hint-kbd">esc</kbd>
      </div>
      <div class="palette-results" bind:this={listEl}>
        {#if flatResults.length === 0 && query.trim()}
          <div class="palette-empty">No results for &ldquo;{query}&rdquo;</div>
        {/if}
        {#each groups as group, gi}
          <div class="palette-group">
            <div class="palette-group-header">
              <span class="palette-group-label">{group.label}</span>
              <span class="palette-group-count">{group.items.length}</span>
            </div>
            {#each group.items as item, ii}
              {@const idx = cumulativeIndex(groups, gi, ii)}
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div
                class="palette-result"
                class:selected={idx === selectedIndex}
                data-idx={idx}
                onclick={() => selectResult(item)}
                onmouseenter={() => (selectedIndex = idx)}
              >
                {#if item.color}
                  <span class="palette-color-dot" style="background: {item.color}"></span>
                {/if}
                <span class="palette-result-label">{item.label}</span>
                {#if item.secondaryLabel}
                  <span class="palette-result-secondary">{item.secondaryLabel}</span>
                {/if}
                <span class="palette-result-type">{item.type}</span>
              </div>
            {/each}
          </div>
        {/each}
      </div>
      <div class="palette-footer">
        <span class="palette-footer-hint">
          <kbd class="inline-kbd">&uarr;&darr;</kbd> navigate
          <kbd class="inline-kbd">&#x23ce;</kbd> select
          <kbd class="inline-kbd">esc</kbd> close
        </span>
      </div>
    </div>
  </div>
{/if}

<style>
  .palette-overlay {
    position: fixed;
    inset: 0;
    background: var(--color-overlay, rgba(8, 8, 8, 0.56));
    z-index: 300;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 15vh;
    animation: paletteFadeIn 150ms ease;
  }
  @keyframes paletteFadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  @keyframes paletteSlideUp {
    from { opacity: 0; transform: translateY(8px) scale(0.98); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }
  .palette-modal {
    background: var(--color-panel, #202225);
    border: 1px solid var(--color-border-subtle, #292c30);
    border-radius: 12px;
    width: 500px;
    max-width: 90vw;
    max-height: 60vh;
    display: flex;
    flex-direction: column;
    box-shadow: var(--shadow-overlay, 0 20px 56px rgba(0, 0, 0, 0.48));
    animation: paletteSlideUp 150ms cubic-bezier(0.4, 0, 0.2, 1);
    overflow: hidden;
  }
  .palette-input-wrapper {
    display: flex;
    align-items: center;
    padding: 12px 16px;
    border-bottom: 1px solid var(--color-border-subtle, #292c30);
    gap: 10px;
  }
  .palette-search-icon {
    width: 16px;
    height: 16px;
    color: var(--color-text-muted, #90918d);
    flex-shrink: 0;
  }
  .palette-input {
    flex: 1;
    background: none;
    border: none;
    outline: none;
    color: var(--color-text-primary, #d4d4d4);
    font-size: 16px;
    font-family: inherit;
    padding: 0;
  }
  .palette-input::placeholder {
    color: var(--color-text-faint, #70726f);
  }
  .palette-hint-kbd {
    padding: 2px 6px;
    background: var(--color-input, #17181a);
    border: 1px solid var(--color-border, #32353a);
    border-radius: 4px;
    font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
    font-size: 11px;
    color: var(--color-text-faint, #70726f);
    flex-shrink: 0;
  }
  .palette-results {
    flex: 1;
    overflow-y: auto;
    padding: 6px;
  }
  .palette-results::-webkit-scrollbar {
    width: 6px;
  }
  .palette-results::-webkit-scrollbar-track {
    background: transparent;
  }
  .palette-results::-webkit-scrollbar-thumb {
    background: var(--color-surface-1, #2d3136);
    border-radius: 3px;
  }
  .palette-empty {
    padding: 24px 16px;
    text-align: center;
    color: var(--color-text-muted, #90918d);
    font-size: 13px;
  }
  .palette-group {
    margin-bottom: 4px;
  }
  .palette-group-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 10px 4px;
  }
  .palette-group-label {
    font-size: 11px;
    font-weight: 600;
    color: var(--color-text-faint, #70726f);
    letter-spacing: 0.04em;
  }
  .palette-group-count {
    font-size: 10px;
    color: var(--color-text-faint, #70726f);
    background: var(--color-input, #17181a);
    border-radius: 8px;
    padding: 1px 6px;
  }
  .palette-result {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 40px;
    padding: 0 10px;
    border-radius: 8px;
    cursor: pointer;
    transition: background 80ms ease;
    font-size: 13px;
    color: var(--color-text-primary, #d4d4d4);
  }
  .palette-result:hover,
  .palette-result.selected {
    background: var(--color-surface-active, #2a2e33);
  }
  .palette-color-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .palette-result-label {
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-weight: 500;
  }
  .palette-result-secondary {
    font-size: 11px;
    color: var(--color-text-muted, #90918d);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 120px;
  }
  .palette-result-type {
    font-size: 10px;
    color: var(--color-text-faint, #70726f);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    flex-shrink: 0;
  }
  .palette-footer {
    padding: 8px 16px;
    border-top: 1px solid var(--color-border-subtle, #292c30);
    display: flex;
    justify-content: center;
  }
  .palette-footer-hint {
    font-size: 12px;
    color: var(--color-text-faint, #70726f);
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .inline-kbd {
    padding: 1px 5px;
    background: var(--color-input, #17181a);
    border: 1px solid var(--color-border, #32353a);
    border-radius: 4px;
    font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
    font-size: 11px;
    color: var(--color-text-muted, #90918d);
  }
</style>
