<script lang="ts">
  import { lists, addList } from '$lib/stores/lists';
  import { tasks } from '$lib/stores/tasks';
  import { tags } from '$lib/stores/tags';
  import { currentView, selectedListId, type ViewMode } from '$lib/stores/ui';
  import { theme, cycleTheme } from '$lib/stores/theme';
  import type { List } from '$lib/types';
  import SyncSettings from './SyncSettings.svelte';

  let tagsExpanded = $state(true);
  let creatingList = $state(false);
  let newListName = $state('');
  let inputRef: HTMLInputElement | undefined = $state(undefined);
  let showSyncSettings = $state(false);
  const DEFAULT_LIST_COLOR = 'var(--color-list-default)';
  const DEFAULT_TAG_COLOR = 'var(--color-tag-default)';

  // Derived values from stores using Svelte 5 $-prefix auto-subscription
  let inboxList = $derived(($lists).find((l: List) => l.isInbox));
  let userLists = $derived(
    ($lists)
      .filter((l: List) => !l.isInbox)
      .sort((a: List, b: List) => a.sortOrder - b.sortOrder)
  );

  function taskCountForList(listId: string): number {
    return ($tasks).filter((t) => t.listId === listId && t.status === 0).length;
  }

  function selectView(view: ViewMode) {
    currentView.set(view);
  }

  function selectList(id: string) {
    selectedListId.set(id);
    currentView.set('list');
  }

  function startCreatingList() {
    creatingList = true;
    newListName = '';
    queueMicrotask(() => {
      inputRef?.focus();
    });
  }

  async function confirmNewList() {
    const name = newListName.trim();
    if (name) {
      try {
        const created = await addList(name);
        selectList(created.id);
      } catch (err) {
        console.error('Failed to create list:', err);
      }
    }
    creatingList = false;
    newListName = '';
  }

  function cancelNewList() {
    creatingList = false;
    newListName = '';
  }

  function handleNewListKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      confirmNewList();
    } else if (e.key === 'Escape') {
      cancelNewList();
    }
  }
</script>

<aside class="sidebar">
  <div class="sidebar-header">
    <h2>Cross 2</h2>
  </div>

  <nav class="sidebar-nav">
    <button
      class="nav-item"
      class:active={$currentView === 'today'}
      onclick={() => selectView('today')}
    >
      <span class="nav-icon" aria-hidden="true">
        <svg viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="8" r="2.5" stroke="currentColor" stroke-width="1.4" />
          <path d="M8 1.75V4M8 12V14.25M1.75 8H4M12 8h2.25M3.2 3.2l1.6 1.6M11.2 11.2l1.6 1.6M3.2 12.8l1.6-1.6M11.2 4.8l1.6-1.6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
        </svg>
      </span>
      <span class="nav-label">Today</span>
    </button>

    <button
      class="nav-item"
      class:active={$currentView === 'week'}
      onclick={() => selectView('week')}
    >
      <span class="nav-icon" aria-hidden="true">
        <svg viewBox="0 0 16 16" fill="none">
          <rect x="2" y="3" width="12" height="10.5" rx="2" stroke="currentColor" stroke-width="1.4" />
          <path d="M5 1.75V4.25M11 1.75V4.25M2 6h12" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
          <path d="M5 8.5h2M9 8.5h2M5 11h2M9 11h2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
        </svg>
      </span>
      <span class="nav-label">Week</span>
    </button>

    <button
      class="nav-item"
      class:active={$currentView === 'calendar'}
      onclick={() => selectView('calendar')}
    >
      <span class="nav-icon" aria-hidden="true">
        <svg viewBox="0 0 16 16" fill="none">
          <rect x="2" y="3" width="12" height="10.5" rx="2" stroke="currentColor" stroke-width="1.4" />
          <path d="M5 1.75V4.25M11 1.75V4.25M2 6h12" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
          <path d="M5.25 8.5h5.5M5.25 11h3.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
        </svg>
      </span>
      <span class="nav-label">Calendar</span>
    </button>
  </nav>

  <div class="sidebar-divider"></div>

  <div class="sidebar-section">
    <div class="section-header">
      <span class="section-title">Lists</span>
    </div>

    {#if inboxList}
      <button
        class="list-item"
        class:active={$currentView === 'list' && $selectedListId === inboxList.id}
        onclick={() => selectList(inboxList!.id)}
      >
        <span class="nav-icon" aria-hidden="true">
          <svg viewBox="0 0 16 16" fill="none">
            <path d="M2.5 4.25h11l-1 7.5a1.5 1.5 0 0 1-1.49 1.3H4.99A1.5 1.5 0 0 1 3.5 11.75l-1-7.5Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" />
            <path d="M2.75 8.5h3.1l1.05 1.4h2.2L10.15 8.5h3.1" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" />
          </svg>
        </span>
        <span class="list-name">Inbox</span>
        {#if taskCountForList(inboxList.id) > 0}
          <span class="task-count">{taskCountForList(inboxList.id)}</span>
        {/if}
      </button>
    {/if}

    {#each userLists as list (list.id)}
      <button
        class="list-item"
        class:active={$currentView === 'list' && $selectedListId === list.id}
        onclick={() => selectList(list.id)}
      >
        <span
          class="list-color-dot"
          style:background-color={list.color ?? DEFAULT_LIST_COLOR}
        ></span>
        <span class="list-name">{list.name}</span>
        {#if taskCountForList(list.id) > 0}
          <span class="task-count">{taskCountForList(list.id)}</span>
        {/if}
      </button>
    {/each}

    {#if creatingList}
      <div class="new-list-input-row">
        <input
          bind:this={inputRef}
          bind:value={newListName}
          class="new-list-input"
          type="text"
          placeholder="List name..."
          onkeydown={handleNewListKeydown}
          onblur={cancelNewList}
        />
      </div>
    {/if}

    <button class="new-list-btn" onclick={startCreatingList}>
      <span class="nav-icon" aria-hidden="true">
        <svg viewBox="0 0 16 16" fill="none">
          <path d="M8 3.25v9.5M3.25 8h9.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
        </svg>
      </span>
      <span class="nav-label">New List</span>
    </button>
  </div>

  <div class="sidebar-divider"></div>

  <div class="sidebar-section">
    <button
      class="section-header section-toggle"
      onclick={() => (tagsExpanded = !tagsExpanded)}
    >
      <span class="section-title">Tags</span>
      <svg class="toggle-arrow" class:expanded={tagsExpanded} viewBox="0 0 12 12" fill="none" aria-hidden="true">
        <path d="M4 2.5L7.5 6L4 9.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </button>

    {#if tagsExpanded}
      {#each $tags as tag (tag.id)}
        <div class="tag-item">
          <span
            class="tag-color-dot"
            style:background-color={tag.color ?? DEFAULT_TAG_COLOR}
          ></span>
          <span class="tag-name">{tag.name}</span>
        </div>
      {/each}
      {#if $tags.length === 0}
        <div class="empty-hint">No tags yet</div>
      {/if}
    {/if}
  </div>

  <div class="sidebar-spacer"></div>

  <div class="sidebar-footer">
    <button
      class="gear-btn"
      onclick={cycleTheme}
      aria-label="Toggle theme"
      title={$theme === 'system' ? 'Theme: System' : $theme === 'dark' ? 'Theme: Dark' : 'Theme: Light'}
    >
      {#if $theme === 'dark'}
        <!-- Moon icon -->
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <path d="M14.3 10.5A6.5 6.5 0 0 1 5.5 1.7a6.5 6.5 0 1 0 8.8 8.8Z" fill="currentColor"/>
        </svg>
      {:else if $theme === 'light'}
        <!-- Sun icon -->
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <circle cx="8" cy="8" r="3" fill="currentColor"/>
          <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
      {:else}
        <!-- Monitor icon (system) -->
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <rect x="1.5" y="2" width="13" height="9" rx="1.5" stroke="currentColor" stroke-width="1.5" fill="none"/>
          <path d="M5.5 14h5M8 11v3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
      {/if}
    </button>

    <button
      class="gear-btn"
      onclick={() => (showSyncSettings = true)}
      aria-label="Sync settings"
      title="Sync settings"
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <path
          d="M6.6 1.2A.6.6 0 0 1 7.2.6h1.6a.6.6 0 0 1 .6.6v.94a5.4 5.4 0 0 1 1.36.56l.66-.66a.6.6 0 0 1 .85 0l1.13 1.13a.6.6 0 0 1 0 .85l-.66.66c.24.42.42.88.56 1.36h.94a.6.6 0 0 1 .6.6v1.6a.6.6 0 0 1-.6.6h-.94a5.4 5.4 0 0 1-.56 1.36l.66.66a.6.6 0 0 1 0 .85l-1.13 1.13a.6.6 0 0 1-.85 0l-.66-.66c-.42.24-.88.42-1.36.56v.94a.6.6 0 0 1-.6.6H7.2a.6.6 0 0 1-.6-.6v-.94a5.4 5.4 0 0 1-1.36-.56l-.66.66a.6.6 0 0 1-.85 0L2.6 12.37a.6.6 0 0 1 0-.85l.66-.66A5.4 5.4 0 0 1 2.7 9.5h-.94a.6.6 0 0 1-.6-.6V7.3a.6.6 0 0 1 .6-.6h.94c.14-.48.32-.94.56-1.36l-.66-.66a.6.6 0 0 1 0-.85L3.73 2.7a.6.6 0 0 1 .85 0l.66.66c.42-.24.88-.42 1.36-.56V1.2ZM8 10.2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4Z"
          fill="currentColor"
        />
      </svg>
    </button>
  </div>
</aside>

<SyncSettings open={showSyncSettings} onclose={() => (showSyncSettings = false)} />

<style>
  .sidebar {
    width: 250px;
    background: var(--color-sidebar, #1d1f22);
    border-right: 1px solid var(--color-border-subtle, #292c30);
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    user-select: none;
  }

  .sidebar-header {
    padding: 18px 16px 14px;
    border-bottom: 1px solid var(--color-border-subtle, #292c30);
  }

  .sidebar-header h2 {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
    color: var(--color-text-primary, #d4d4d4);
    letter-spacing: -0.01em;
  }

  .sidebar-nav {
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .nav-item,
  .list-item,
  .new-list-btn {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 9px 12px;
    border-radius: 10px;
    cursor: pointer;
    font-size: 14px;
    color: var(--color-text-primary, #d4d4d4);
    background: none;
    border: none;
    width: 100%;
    text-align: left;
    font-family: inherit;
    transition: background 200ms ease;
  }

  .nav-item:hover,
  .list-item:hover,
  .new-list-btn:hover {
    background: var(--color-surface-hover, #2a2e33);
  }

  .nav-item.active,
  .list-item.active {
    background: var(--color-surface-active, #30353b);
    box-shadow: inset 0 0 0 1px var(--color-border-subtle, #292c30);
  }

  .nav-icon {
    flex-shrink: 0;
    width: 18px;
    height: 18px;
    color: var(--color-text-muted, #90918d);
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .nav-icon svg {
    width: 16px;
    height: 16px;
  }

  .nav-item.active .nav-icon,
  .list-item.active .nav-icon {
    color: var(--color-accent, #6c93c7);
  }

  .nav-label,
  .list-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .sidebar-divider {
    height: 1px;
    background: var(--color-border-subtle, #292c30);
    margin: 4px 12px;
  }

  .sidebar-section {
    padding: 4px 8px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .section-header {
    display: flex;
    align-items: center;
    padding: 6px 12px;
  }

  .section-title {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--color-text-muted, #90918d);
    flex: 1;
  }

  .section-toggle {
    cursor: pointer;
    background: none;
    border: none;
    border-radius: 6px;
    width: 100%;
    text-align: left;
    font-family: inherit;
    color: inherit;
    transition: background 200ms ease;
  }

  .section-toggle:hover {
    background: var(--color-surface-hover, #2a2e33);
  }

  .toggle-arrow {
    width: 12px;
    height: 12px;
    color: var(--color-text-muted, #90918d);
    transition: transform 180ms ease;
  }

  .toggle-arrow.expanded {
    transform: rotate(90deg);
  }

  .list-color-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
    margin-left: 5px;
    margin-right: 1px;
  }

  .task-count {
    font-size: 11px;
    color: var(--color-text-muted, #90918d);
    background: var(--color-surface-0, #25282c);
    padding: 2px 7px;
    border-radius: 999px;
    flex-shrink: 0;
  }

  .tag-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    border-radius: 6px;
    font-size: 13px;
    color: var(--color-text-secondary, #b6b6b2);
  }

  .tag-color-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .tag-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .new-list-btn {
    color: var(--color-text-muted, #90918d);
  }

  .new-list-btn:hover {
    color: var(--color-text-primary, #d4d4d4);
  }

  .new-list-input-row {
    padding: 4px 12px;
  }

  .new-list-input {
    width: 100%;
    padding: 6px 8px;
    border-radius: 8px;
    border: 1px solid var(--color-border, #32353a);
    background: var(--color-input, #17181a);
    color: var(--color-text-primary, #d4d4d4);
    font-size: 13px;
    font-family: inherit;
    outline: none;
    box-sizing: border-box;
  }

  .new-list-input:focus {
    border-color: var(--color-accent, #6c93c7);
  }

  .new-list-input::placeholder {
    color: var(--color-text-muted, #90918d);
  }

  .empty-hint {
    padding: 6px 12px;
    font-size: 12px;
    color: var(--color-text-muted, #90918d);
    font-style: italic;
  }

  .sidebar-spacer {
    flex: 1;
  }

  .sidebar-footer {
    padding: 8px 12px;
    border-top: 1px solid var(--color-border-subtle, #292c30);
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .gear-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: 8px;
    border: none;
    background: none;
    color: var(--color-text-muted, #90918d);
    cursor: pointer;
    transition: background 200ms ease, color 200ms ease;
  }

  .gear-btn:hover {
    background: var(--color-surface-hover, #2a2e33);
    color: var(--color-text-primary, #d4d4d4);
  }
</style>
