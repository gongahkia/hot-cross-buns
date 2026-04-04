<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { invoke } from '@tauri-apps/api/core';
  import { currentView, selectedListId, selectedTaskId, calendarSubView, showSyncSettings, showShortcutsModal, showCompletedTasks, type CalendarSubView } from '$lib/stores/ui';
  import { lists } from '$lib/stores/lists';
  import { tags } from '$lib/stores/tags';
  import { areas } from '$lib/stores/areas';
  import { addList } from '$lib/stores/lists';
  import { addTag } from '$lib/stores/tags';
  import { addArea } from '$lib/stores/areas';
  import { editTask, removeTask } from '$lib/stores/tasks';
  import { cycleTheme, theme } from '$lib/stores/theme';
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

  type Command = {
    id: string;
    label: string;
    category: string;
    shortcut?: string;
    action: () => void | Promise<void>;
  };

  type CommandGroup = {
    category: string;
    items: Command[];
  };

  type PaletteMode = 'search' | 'command';
  type SubPrompt = { label: string; onSubmit: (value: string) => void | Promise<void> } | null;

  const CALENDAR_SUB_VIEWS: CalendarSubView[] = ['week', 'next7days', 'upcoming', 'schedule', 'timeline'];

  const STATIC_VIEWS: PaletteResult[] = [
    { type: 'view', id: 'today', label: 'Today' },
    { type: 'view', id: 'calendar', label: 'Calendar' },
    { type: 'view', id: 'calendar:week', label: 'Calendar \u2014 Week' },
    { type: 'view', id: 'calendar:next7days', label: 'Calendar \u2014 Next 7 Days' },
    { type: 'view', id: 'calendar:upcoming', label: 'Calendar \u2014 Upcoming' },
    { type: 'view', id: 'calendar:schedule', label: 'Calendar \u2014 Schedule' },
    { type: 'view', id: 'calendar:timeline', label: 'Calendar \u2014 Timeline' },
    { type: 'view', id: 'logbook', label: 'Logbook' },
  ];

  const commands: Command[] = [
    // navigation
    { id: 'nav:today', label: 'Go to Today', category: 'Navigation', shortcut: 'T', action: () => currentView.set('today') },
    { id: 'nav:calendar', label: 'Go to Calendar', category: 'Navigation', shortcut: 'C', action: () => currentView.set('calendar') },
    { id: 'nav:logbook', label: 'Go to Logbook', category: 'Navigation', action: () => currentView.set('logbook') },
    { id: 'nav:week', label: 'Go to Week View', category: 'Navigation', action: () => { currentView.set('calendar'); calendarSubView.set('week'); } },
    { id: 'nav:next7', label: 'Go to Next 7 Days', category: 'Navigation', action: () => { currentView.set('calendar'); calendarSubView.set('next7days'); } },
    { id: 'nav:upcoming', label: 'Go to Upcoming', category: 'Navigation', action: () => { currentView.set('calendar'); calendarSubView.set('upcoming'); } },
    { id: 'nav:schedule', label: 'Go to Schedule', category: 'Navigation', action: () => { currentView.set('calendar'); calendarSubView.set('schedule'); } },
    { id: 'nav:timeline', label: 'Go to Timeline', category: 'Navigation', action: () => { currentView.set('calendar'); calendarSubView.set('timeline'); } },
    // tasks
    { id: 'task:add', label: 'Add New Task', category: 'Tasks', shortcut: 'N', action: () => { requestAnimationFrame(() => document.querySelector<HTMLInputElement>('.quick-add-input')?.focus()); } },
    { id: 'task:toggle-completed', label: 'Toggle Completed Tasks', category: 'Tasks', action: () => showCompletedTasks.update(v => !v) },
    { id: 'task:delete', label: 'Delete Selected Task', category: 'Tasks', shortcut: 'Del', action: () => {
      const taskId = get(selectedTaskId);
      if (taskId) { selectedTaskId.set(null); removeTask(taskId); }
    }},
    { id: 'task:priority-high', label: 'Set Priority: High', category: 'Tasks', shortcut: '3', action: () => {
      const taskId = get(selectedTaskId);
      if (taskId) editTask(taskId, { priority: 3 });
    }},
    { id: 'task:priority-med', label: 'Set Priority: Medium', category: 'Tasks', shortcut: '2', action: () => {
      const taskId = get(selectedTaskId);
      if (taskId) editTask(taskId, { priority: 2 });
    }},
    { id: 'task:priority-low', label: 'Set Priority: Low', category: 'Tasks', shortcut: '1', action: () => {
      const taskId = get(selectedTaskId);
      if (taskId) editTask(taskId, { priority: 1 });
    }},
    { id: 'task:priority-none', label: 'Clear Priority', category: 'Tasks', shortcut: '0', action: () => {
      const taskId = get(selectedTaskId);
      if (taskId) editTask(taskId, { priority: 0 });
    }},
    // create
    { id: 'create:list', label: 'Create New List', category: 'Create', action: () => enterSubPrompt('List name', async (name) => {
      const created = await addList(name);
      selectedListId.set(created.id);
      currentView.set('list');
    })},
    { id: 'create:tag', label: 'Create New Tag', category: 'Create', action: () => enterSubPrompt('Tag name', async (name) => { await addTag(name); })},
    { id: 'create:area', label: 'Create New Area', category: 'Create', action: () => enterSubPrompt('Area name', async (name) => { await addArea(name); })},
    // appearance
    { id: 'theme:toggle', label: 'Toggle Theme', category: 'Appearance', action: () => cycleTheme() },
    { id: 'theme:dark', label: 'Set Dark Theme', category: 'Appearance', action: () => theme.set('dark') },
    { id: 'theme:light', label: 'Set Light Theme', category: 'Appearance', action: () => theme.set('light') },
    { id: 'theme:system', label: 'Set System Theme', category: 'Appearance', action: () => theme.set('system') },
    // general
    { id: 'ui:shortcuts', label: 'Show Keyboard Shortcuts', category: 'General', shortcut: '?', action: () => showShortcutsModal.set(true) },
    { id: 'ui:sync', label: 'Open Sync Settings', category: 'General', action: () => showSyncSettings.set(true) },
    { id: 'ui:search', label: 'Search', category: 'General', shortcut: '\u2318K', action: () => { mode = 'search'; query = ''; selectedIndex = 0; } },
  ];

  let open = $state(false);
  let mode = $state<PaletteMode>('search');
  let query = $state('');
  let selectedIndex = $state(0);
  let taskResults = $state<PaletteResult[]>([]);
  let inputEl: HTMLInputElement | undefined = $state(undefined);
  let listEl: HTMLDivElement | undefined = $state(undefined);
  let subPrompt = $state<SubPrompt>(null);
  let subPromptValue = $state('');
  let subPromptInputEl: HTMLInputElement | undefined = $state(undefined);
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  function matchesQuery(label: string, q: string): boolean {
    return label.toLowerCase().includes(q.toLowerCase());
  }

  // search mode groups
  let searchGroups: ResultGroup[] = $derived.by(() => {
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

  let flatSearchResults: PaletteResult[] = $derived(searchGroups.flatMap(g => g.items));

  // command mode groups
  let commandGroups: CommandGroup[] = $derived.by(() => {
    const q = query.trim();
    const cats = new Map<string, Command[]>();
    for (const cmd of commands) {
      if (q && !matchesQuery(cmd.label, q) && !matchesQuery(cmd.category, q)) continue;
      if (!cats.has(cmd.category)) cats.set(cmd.category, []);
      cats.get(cmd.category)!.push(cmd);
    }
    return Array.from(cats.entries()).map(([category, items]) => ({ category, items }));
  });

  let flatCommands: Command[] = $derived(commandGroups.flatMap(g => g.items));

  function searchTasks(q: string) {
    if (debounceTimer) clearTimeout(debounceTimer);
    if (!q.trim()) { taskResults = []; return; }
    debounceTimer = setTimeout(async () => {
      try {
        const allLists = get(lists);
        const found = await invoke<Task[]>('search_tasks', { query: q.trim() });
        taskResults = found.map(t => {
          const parentList = allLists.find(l => l.id === t.listId);
          return { type: 'task' as const, id: t.id, label: t.title, secondaryLabel: parentList?.name };
        });
      } catch { taskResults = []; }
    }, 300);
  }

  function openPalette(prefill = '', openMode: PaletteMode = 'search') {
    open = true;
    mode = openMode;
    query = prefill;
    selectedIndex = 0;
    taskResults = [];
    subPrompt = null;
    subPromptValue = '';
    if (prefill && openMode === 'search') searchTasks(prefill);
    requestAnimationFrame(() => inputEl?.focus());
  }

  function closePalette() {
    open = false;
    query = '';
    selectedIndex = 0;
    taskResults = [];
    subPrompt = null;
    subPromptValue = '';
    if (debounceTimer) clearTimeout(debounceTimer);
  }

  function enterSubPrompt(label: string, onSubmit: (value: string) => void | Promise<void>) {
    subPrompt = { label, onSubmit };
    subPromptValue = '';
    requestAnimationFrame(() => subPromptInputEl?.focus());
  }

  async function submitSubPrompt() {
    if (!subPrompt || !subPromptValue.trim()) return;
    try { await subPrompt.onSubmit(subPromptValue.trim()); } catch {}
    closePalette();
  }

  function selectSearchResult(result: PaletteResult) {
    switch (result.type) {
      case 'view':
        if (result.id.startsWith('calendar:')) {
          currentView.set('calendar');
          calendarSubView.set(result.id.split(':')[1] as CalendarSubView);
        } else {
          currentView.set(result.id as any);
        }
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
        break;
    }
    closePalette();
  }

  function selectCommand(cmd: Command) {
    const needsSubPrompt = cmd.id.startsWith('create:');
    cmd.action();
    if (!needsSubPrompt) closePalette();
  }

  function scrollToSelected() {
    if (!listEl) return;
    const el = listEl.querySelector(`[data-idx="${selectedIndex}"]`);
    if (el) el.scrollIntoView({ block: 'nearest' });
  }

  function totalItems(): number {
    return mode === 'search' ? flatSearchResults.length : flatCommands.length;
  }

  function onKeydown(e: KeyboardEvent) {
    if (subPrompt) {
      if (e.key === 'Escape') { subPrompt = null; subPromptValue = ''; requestAnimationFrame(() => inputEl?.focus()); return; }
      if (e.key === 'Enter') { e.preventDefault(); submitSubPrompt(); return; }
      return;
    }
    if (e.key === 'Escape') { closePalette(); return; }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIndex = Math.min(selectedIndex + 1, totalItems() - 1);
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
      if (mode === 'search') {
        const result = flatSearchResults[selectedIndex];
        if (result) selectSearchResult(result);
      } else {
        const cmd = flatCommands[selectedIndex];
        if (cmd) selectCommand(cmd);
      }
      return;
    }
  }

  function onInput(e: Event) {
    const target = e.target as HTMLInputElement;
    query = target.value;
    selectedIndex = 0;
    if (mode === 'search') searchTasks(query);
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
      // cmd+shift+p / ctrl+shift+p — command mode
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        if (open && mode === 'command') closePalette();
        else openPalette('', 'command');
        return;
      }
      // cmd+p / ctrl+p — also command mode
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        if (open && mode === 'command') closePalette();
        else openPalette('', 'command');
        return;
      }
      // cmd+k / ctrl+k — search mode
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        if (open && mode === 'search') closePalette();
        else openPalette('', 'search');
        return;
      }
      if (open) return;
      if (isInputFocused()) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key.length === 1 && /[a-zA-Z0-9]/.test(e.key)) { // type travel
        e.preventDefault();
        openPalette(e.key, 'search');
      }
    }
    window.addEventListener('keydown', globalKeydown);
    return () => window.removeEventListener('keydown', globalKeydown);
  });

  function cumulativeIndex(groups: { items: any[] }[], groupIdx: number, itemIdx: number): number {
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
      {#if subPrompt}
        <div class="palette-input-wrapper">
          <span class="palette-sub-label">{subPrompt.label}</span>
          <input
            bind:this={subPromptInputEl}
            class="palette-input"
            type="text"
            placeholder="Enter name..."
            bind:value={subPromptValue}
          />
          <kbd class="palette-hint-kbd">esc</kbd>
        </div>
        <div class="palette-footer">
          <span class="palette-footer-hint">
            <kbd class="inline-kbd">&#x23ce;</kbd> confirm
            <kbd class="inline-kbd">esc</kbd> back
          </span>
        </div>
      {:else}
        <div class="palette-input-wrapper">
          {#if mode === 'search'}
            <svg class="palette-search-icon" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M11.5 7a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0ZM10.7 11.4a6 6 0 1 1 .7-.7l3.15 3.15a.5.5 0 0 1-.7.7L10.7 11.4Z" fill="currentColor"/>
            </svg>
          {:else}
            <span class="palette-mode-indicator">&gt;</span>
          {/if}
          <input
            bind:this={inputEl}
            class="palette-input"
            type="text"
            placeholder={mode === 'search' ? 'Search views, lists, tags, tasks...' : 'Type a command...'}
            value={query}
            oninput={onInput}
            onkeydown={onKeydown}
          />
          <button class="palette-mode-toggle" onclick={() => { mode = mode === 'search' ? 'command' : 'search'; query = ''; selectedIndex = 0; requestAnimationFrame(() => inputEl?.focus()); }}>
            {mode === 'search' ? 'Commands' : 'Search'}
          </button>
          <kbd class="palette-hint-kbd">esc</kbd>
        </div>
        <div class="palette-results" bind:this={listEl}>
          {#if mode === 'search'}
            {#if flatSearchResults.length === 0 && query.trim()}
              <div class="palette-empty">No results for &ldquo;{query}&rdquo;</div>
            {/if}
            {#each searchGroups as group, gi}
              <div class="palette-group">
                <div class="palette-group-header">
                  <span class="palette-group-label">{group.label}</span>
                  <span class="palette-group-count">{group.items.length}</span>
                </div>
                {#each group.items as item, ii}
                  {@const idx = cumulativeIndex(searchGroups, gi, ii)}
                  <!-- svelte-ignore a11y_click_events_have_key_events -->
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <div
                    class="palette-result"
                    class:selected={idx === selectedIndex}
                    data-idx={idx}
                    onclick={() => selectSearchResult(item)}
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
          {:else}
            {#if flatCommands.length === 0 && query.trim()}
              <div class="palette-empty">No commands for &ldquo;{query}&rdquo;</div>
            {/if}
            {#each commandGroups as group, gi}
              <div class="palette-group">
                <div class="palette-group-header">
                  <span class="palette-group-label">{group.category.toUpperCase()}</span>
                  <span class="palette-group-count">{group.items.length}</span>
                </div>
                {#each group.items as cmd, ii}
                  {@const idx = cumulativeIndex(commandGroups, gi, ii)}
                  <!-- svelte-ignore a11y_click_events_have_key_events -->
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <div
                    class="palette-result"
                    class:selected={idx === selectedIndex}
                    data-idx={idx}
                    onclick={() => selectCommand(cmd)}
                    onmouseenter={() => (selectedIndex = idx)}
                  >
                    <span class="palette-result-label">{cmd.label}</span>
                    {#if cmd.shortcut}
                      <kbd class="palette-cmd-shortcut">{cmd.shortcut}</kbd>
                    {/if}
                  </div>
                {/each}
              </div>
            {/each}
          {/if}
        </div>
        <div class="palette-footer">
          <span class="palette-footer-hint">
            <kbd class="inline-kbd">&uarr;&darr;</kbd> navigate
            <kbd class="inline-kbd">&#x23ce;</kbd> select
            <kbd class="inline-kbd">esc</kbd> close
          </span>
        </div>
      {/if}
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
    width: 520px;
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
  .palette-mode-indicator {
    font-size: 16px;
    font-weight: 700;
    color: var(--color-accent, #6c93c7);
    flex-shrink: 0;
    font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
  }
  .palette-sub-label {
    font-size: 13px;
    font-weight: 600;
    color: var(--color-accent, #6c93c7);
    white-space: nowrap;
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
  .palette-mode-toggle {
    padding: 3px 8px;
    background: var(--color-surface-0, #25282c);
    border: 1px solid var(--color-border, #32353a);
    border-radius: 5px;
    font-size: 11px;
    font-weight: 500;
    color: var(--color-text-muted, #90918d);
    cursor: pointer;
    flex-shrink: 0;
    transition: background 80ms ease, color 80ms ease;
  }
  .palette-mode-toggle:hover {
    background: var(--color-surface-1, #2d3136);
    color: var(--color-text-secondary, #b6b6b2);
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
  .palette-cmd-shortcut {
    padding: 2px 6px;
    background: var(--color-input, #17181a);
    border: 1px solid var(--color-border, #32353a);
    border-radius: 4px;
    font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
    font-size: 11px;
    color: var(--color-text-faint, #70726f);
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
