<script lang="ts">
  import { lists, addList } from '$lib/stores/lists';
  import { tasks } from '$lib/stores/tasks';
  import { tags } from '$lib/stores/tags';
  import { currentView, selectedListId, type ViewMode } from '$lib/stores/ui';
  import type { List } from '$lib/types';
  import SyncSettings from './SyncSettings.svelte';

  let tagsExpanded = $state(true);
  let creatingList = $state(false);
  let newListName = $state('');
  let inputRef: HTMLInputElement | undefined = $state(undefined);
  let showSyncSettings = $state(false);

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

  function confirmNewList() {
    const name = newListName.trim();
    if (name) {
      addList(name);
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
    <h2>TickClone</h2>
  </div>

  <nav class="sidebar-nav">
    <button
      class="nav-item"
      class:active={$currentView === 'today'}
      onclick={() => selectView('today')}
    >
      <span class="nav-icon">{@html '&#9728;'}</span>
      <span class="nav-label">Today</span>
    </button>

    <button
      class="nav-item"
      class:active={$currentView === 'calendar'}
      onclick={() => selectView('calendar')}
    >
      <span class="nav-icon">{@html '&#128197;'}</span>
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
        <span class="nav-icon">{@html '&#128229;'}</span>
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
          style:background-color={list.color ?? '#cba6f7'}
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
      <span class="nav-icon">+</span>
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
      <span class="toggle-arrow">{tagsExpanded ? '\u25BE' : '\u25B8'}</span>
    </button>

    {#if tagsExpanded}
      {#each $tags as tag (tag.id)}
        <div class="tag-item">
          <span
            class="tag-color-dot"
            style:background-color={tag.color ?? '#f5c2e7'}
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
    background: var(--color-bg-secondary, #181825);
    border-right: 1px solid var(--color-border-subtle, #313244);
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    user-select: none;
  }

  .sidebar-header {
    padding: 16px;
    border-bottom: 1px solid var(--color-border-subtle, #313244);
  }

  .sidebar-header h2 {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
    color: var(--color-text-primary, #cdd6f4);
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
    gap: 8px;
    padding: 8px 12px;
    border-radius: 8px;
    cursor: pointer;
    font-size: 14px;
    color: var(--color-text-primary, #cdd6f4);
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
    background: var(--color-surface-0, #313244);
  }

  .nav-item.active,
  .list-item.active {
    background: var(--color-surface-0, #313244);
  }

  .nav-icon {
    flex-shrink: 0;
    width: 20px;
    text-align: center;
    font-size: 14px;
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
    background: var(--color-border-subtle, #313244);
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
    letter-spacing: 0.5px;
    color: var(--color-text-muted, #a6adc8);
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
    background: var(--color-surface-0, #313244);
  }

  .toggle-arrow {
    font-size: 10px;
    color: var(--color-text-muted, #a6adc8);
  }

  .list-color-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
    margin-left: 7px;
    margin-right: -1px;
  }

  .task-count {
    font-size: 11px;
    color: var(--color-text-muted, #a6adc8);
    background: var(--color-surface-1, #45475a);
    padding: 1px 6px;
    border-radius: 10px;
    flex-shrink: 0;
  }

  .tag-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    border-radius: 6px;
    font-size: 13px;
    color: var(--color-text-primary, #cdd6f4);
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
    color: var(--color-text-muted, #a6adc8);
  }

  .new-list-btn:hover {
    color: var(--color-text-primary, #cdd6f4);
  }

  .new-list-input-row {
    padding: 4px 12px;
  }

  .new-list-input {
    width: 100%;
    padding: 6px 8px;
    border-radius: 6px;
    border: 1px solid var(--color-border-subtle, #313244);
    background: var(--color-surface-0, #313244);
    color: var(--color-text-primary, #cdd6f4);
    font-size: 13px;
    font-family: inherit;
    outline: none;
    box-sizing: border-box;
  }

  .new-list-input:focus {
    border-color: var(--color-accent, #89b4fa);
  }

  .new-list-input::placeholder {
    color: var(--color-text-muted, #a6adc8);
  }

  .empty-hint {
    padding: 6px 12px;
    font-size: 12px;
    color: var(--color-text-muted, #a6adc8);
    font-style: italic;
  }

  .sidebar-spacer {
    flex: 1;
  }

  .sidebar-footer {
    padding: 8px 12px;
    border-top: 1px solid var(--color-border-subtle, #313244);
    display: flex;
    align-items: center;
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
    color: var(--color-text-muted, #a6adc8);
    cursor: pointer;
    transition: background 200ms ease, color 200ms ease;
  }

  .gear-btn:hover {
    background: var(--color-surface-0, #313244);
    color: var(--color-text-primary, #cdd6f4);
  }
</style>
