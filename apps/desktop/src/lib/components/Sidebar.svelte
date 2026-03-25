<script lang="ts">
  import { lists, addList, editList, removeList } from '$lib/stores/lists';
  import { areas, loadAreas, addArea, editArea, removeArea } from '$lib/stores/areas';
  import ContextMenu from './ContextMenu.svelte';
  import ColorPicker from './ColorPicker.svelte';
  import { tasks, taskMutationVersion } from '$lib/stores/tasks';
  import { invoke } from '@tauri-apps/api/core';
  import { tags } from '$lib/stores/tags';
  import { currentView, selectedListId, selectedSmartFilter, selectedTagId, selectedAreaId, selectedSavedFilterId, type ViewMode, type SmartFilterType } from '$lib/stores/ui';
  import { theme, cycleTheme } from '$lib/stores/theme';
  import type { List, Area, SavedFilter } from '$lib/types';
  import { savedFilters, loadSavedFilters, addSavedFilter, removeSavedFilter } from '$lib/stores/savedFilters';
  import { currentFilters } from '$lib/stores/filters';
  import SyncSettings from './SyncSettings.svelte';
  import { onMount } from 'svelte';

  let tagsExpanded = $state(true);
  let creatingList = $state(false);
  let newListName = $state('');
  let inputRef: HTMLInputElement | undefined = $state(undefined);
  let showSyncSettings = $state(false);
  let contextMenuOpen = $state(false);
  let contextMenuX = $state(0);
  let contextMenuY = $state(0);
  let contextListId: string | null = $state(null);
  let renamingListId: string | null = $state(null);
  let renameValue = $state('');
  let renameInputRef: HTMLInputElement | undefined = $state(undefined);
  let colorPickerListId: string | null = $state(null);
  let colorPickerX = $state(0);
  let colorPickerY = $state(0);
  let draggedListId: string | null = $state(null);
  let dragOverListId: string | null = $state(null);
  const DEFAULT_LIST_COLOR = 'var(--color-list-default)';
  const DEFAULT_TAG_COLOR = 'var(--color-tag-default)';
  const DEFAULT_AREA_COLOR = 'var(--color-accent, #6c93c7)';

  // area state
  let collapsedAreas: Record<string, boolean> = $state({});
  let creatingArea = $state(false);
  let newAreaName = $state('');
  let areaInputRef: HTMLInputElement | undefined = $state(undefined);
  let areaContextMenuOpen = $state(false);
  let areaContextMenuX = $state(0);
  let areaContextMenuY = $state(0);
  let contextAreaId: string | null = $state(null);
  let renamingAreaId: string | null = $state(null);
  let areaRenameValue = $state('');
  let areaRenameInputRef: HTMLInputElement | undefined = $state(undefined);
  let areaColorPickerId: string | null = $state(null);
  let areaColorPickerX = $state(0);
  let areaColorPickerY = $state(0);
  let draggedAreaId: string | null = $state(null);
  let dragOverAreaId: string | null = $state(null);

  onMount(() => { loadAreas(); loadSavedFilters(); });

  let overdueCount = $state(0);

  $effect(() => {
    const _v = $taskMutationVersion;
    invoke<any[]>('get_overdue_tasks')
      .then((tasks) => { overdueCount = tasks.length; })
      .catch(() => { overdueCount = 0; });
  });

  let tagCounts: Record<string, number> = $state({});

  $effect(() => {
    const _v = $taskMutationVersion;
    invoke<{tag_id: string; count: number}[]>('get_tag_task_counts')
      .then((counts) => {
        const m: Record<string, number> = {};
        for (const c of counts) m[c.tag_id] = c.count;
        tagCounts = m;
      })
      .catch(() => { tagCounts = {}; });
  });

  function selectTag(tagId: string) {
    selectedTagId.set(tagId);
    currentView.set('tag-filter');
  }

  function selectSavedFilter(filterId: string) {
    selectedSavedFilterId.set(filterId);
    currentView.set('saved-filter');
  }

  let savedFiltersExpanded = $state(true);

  async function handleSaveCurrentFilter() {
    const name = prompt('Filter name:');
    if (!name?.trim()) return;
    let f: any = {};
    const unsub = currentFilters.subscribe(v => { f = v; });
    unsub();
    const config = JSON.stringify(f);
    await addSavedFilter(name.trim(), config);
  }

  async function handleDeleteSavedFilter(e: MouseEvent, id: string) {
    e.stopPropagation();
    await removeSavedFilter(id);
  }

  // Derived values from stores using Svelte 5 $-prefix auto-subscription
  let inboxList = $derived(($lists).find((l: List) => l.isInbox));
  let userLists = $derived(
    ($lists)
      .filter((l: List) => !l.isInbox)
      .sort((a: List, b: List) => a.sortOrder - b.sortOrder)
  );
  let sortedAreas = $derived(($areas).sort((a: Area, b: Area) => a.sortOrder - b.sortOrder));
  let listsGroupedByArea = $derived.by(() => {
    const map = new Map<string, List[]>();
    for (const list of userLists) {
      const key = list.areaId ?? '__none__';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(list);
    }
    return map;
  });
  let uncategorizedLists = $derived(listsGroupedByArea.get('__none__') ?? []);
  function listsForArea(areaId: string): List[] {
    return listsGroupedByArea.get(areaId) ?? [];
  }

  function taskCountForList(listId: string): number {
    return ($tasks).filter((t) => t.listId === listId && t.status === 0).length;
  }

  function taskCountForArea(areaId: string): number {
    return listsForArea(areaId).reduce((sum, l) => sum + taskCountForList(l.id), 0);
  }

  function selectView(view: ViewMode) {
    currentView.set(view);
  }

  function selectArea(areaId: string) {
    selectedAreaId.set(areaId);
    currentView.set('area-view');
  }

  function selectList(id: string) {
    selectedListId.set(id);
    currentView.set('list');
  }

  function selectSmartFilter(filter: SmartFilterType) {
    selectedSmartFilter.set(filter);
    currentView.set('smart-filter');
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

  function openListContextMenu(e: MouseEvent, listId: string) {
    e.preventDefault();
    contextMenuX = e.clientX;
    contextMenuY = e.clientY;
    contextListId = listId;
    contextMenuOpen = true;
  }

  function startRenameList() {
    if (!contextListId) return;
    const list = ($lists).find((l: List) => l.id === contextListId);
    if (!list) return;
    renamingListId = contextListId;
    renameValue = list.name;
    contextMenuOpen = false;
    queueMicrotask(() => {
      renameInputRef?.focus();
      renameInputRef?.select();
    });
  }

  async function confirmRename() {
    if (renamingListId && renameValue.trim()) {
      await editList(renamingListId, { name: renameValue.trim() });
    }
    renamingListId = null;
    renameValue = '';
  }

  function cancelRename() {
    renamingListId = null;
    renameValue = '';
  }

  function handleRenameKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') confirmRename();
    else if (e.key === 'Escape') cancelRename();
  }

  function openColorPicker() {
    colorPickerListId = contextListId;
    const rect = document.querySelector(`.list-item[data-list-id="${contextListId}"]`)?.getBoundingClientRect();
    colorPickerX = rect ? rect.right + 8 : contextMenuX;
    colorPickerY = rect ? rect.top : contextMenuY;
    contextMenuOpen = false;
  }

  async function handleColorSelect(color: string) {
    if (colorPickerListId) {
      await editList(colorPickerListId, { color });
    }
    colorPickerListId = null;
  }

  async function deleteList() {
    if (!contextListId) return;
    contextMenuOpen = false;
    const confirmed = window.confirm('Delete this list? Tasks in it will be removed.');
    if (!confirmed) return;
    const deletingId = contextListId;
    if ($selectedListId === deletingId) {
      const inbox = ($lists).find((l: List) => l.isInbox);
      if (inbox) selectList(inbox.id);
    }
    await removeList(deletingId);
  }

  function handleListDragStart(e: DragEvent, list: List) {
    draggedListId = list.id;
    e.dataTransfer!.effectAllowed = 'move';
    e.dataTransfer!.setData('text/plain', list.id);
  }
  function handleListDragOver(e: DragEvent, listId: string) {
    e.preventDefault();
    e.dataTransfer!.dropEffect = 'move';
    dragOverListId = listId;
  }
  async function handleListDrop(e: DragEvent, targetList: List) {
    e.preventDefault();
    if (!draggedListId || draggedListId === targetList.id) {
      draggedListId = null;
      dragOverListId = null;
      return;
    }
    const draggedList = userLists.find(l => l.id === draggedListId);
    if (draggedList && draggedList.areaId !== targetList.areaId) {
      await editList(draggedListId, { areaId: targetList.areaId ?? null });
    }
    const currentLists = [...userLists];
    const dragIdx = currentLists.findIndex(l => l.id === draggedListId);
    const targetIdx = currentLists.findIndex(l => l.id === targetList.id);
    if (dragIdx < 0 || targetIdx < 0) return;
    const [moved] = currentLists.splice(dragIdx, 1);
    currentLists.splice(targetIdx, 0, moved);
    for (let i = 0; i < currentLists.length; i++) {
      if (currentLists[i].sortOrder !== i) {
        await editList(currentLists[i].id, { sortOrder: i });
      }
    }
    draggedListId = null;
    dragOverListId = null;
  }
  function handleDragEnd() {
    draggedListId = null;
    dragOverListId = null;
  }

  // area functions
  function toggleArea(areaId: string) {
    collapsedAreas[areaId] = !collapsedAreas[areaId];
  }
  function startCreatingArea() {
    creatingArea = true;
    newAreaName = '';
    queueMicrotask(() => { areaInputRef?.focus(); });
  }
  async function confirmNewArea() {
    const name = newAreaName.trim();
    if (name) {
      try { await addArea(name); } catch (err) { console.error('Failed to create area:', err); }
    }
    creatingArea = false;
    newAreaName = '';
  }
  function cancelNewArea() { creatingArea = false; newAreaName = ''; }
  function handleNewAreaKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') confirmNewArea();
    else if (e.key === 'Escape') cancelNewArea();
  }
  function openAreaContextMenu(e: MouseEvent, areaId: string) {
    e.preventDefault();
    areaContextMenuX = e.clientX;
    areaContextMenuY = e.clientY;
    contextAreaId = areaId;
    areaContextMenuOpen = true;
  }
  function startRenameArea() {
    if (!contextAreaId) return;
    const area = ($areas).find((a: Area) => a.id === contextAreaId);
    if (!area) return;
    renamingAreaId = contextAreaId;
    areaRenameValue = area.name;
    areaContextMenuOpen = false;
    queueMicrotask(() => { areaRenameInputRef?.focus(); areaRenameInputRef?.select(); });
  }
  async function confirmAreaRename() {
    if (renamingAreaId && areaRenameValue.trim()) {
      await editArea(renamingAreaId, { name: areaRenameValue.trim() });
    }
    renamingAreaId = null;
    areaRenameValue = '';
  }
  function cancelAreaRename() { renamingAreaId = null; areaRenameValue = ''; }
  function handleAreaRenameKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') confirmAreaRename();
    else if (e.key === 'Escape') cancelAreaRename();
  }
  function openAreaColorPicker() {
    areaColorPickerId = contextAreaId;
    const rect = document.querySelector(`.area-header[data-area-id="${contextAreaId}"]`)?.getBoundingClientRect();
    areaColorPickerX = rect ? rect.right + 8 : areaContextMenuX;
    areaColorPickerY = rect ? rect.top : areaContextMenuY;
    areaContextMenuOpen = false;
  }
  async function handleAreaColorSelect(color: string) {
    if (areaColorPickerId) { await editArea(areaColorPickerId, { color }); }
    areaColorPickerId = null;
  }
  async function deleteArea() {
    if (!contextAreaId) return;
    areaContextMenuOpen = false;
    const confirmed = window.confirm('Delete this area? Lists in it will become uncategorized.');
    if (!confirmed) return;
    await removeArea(contextAreaId);
  }
  function handleAreaDragStart(e: DragEvent, area: Area) {
    draggedAreaId = area.id;
    e.dataTransfer!.effectAllowed = 'move';
    e.dataTransfer!.setData('text/plain', area.id);
  }
  function handleAreaDragOver(e: DragEvent, areaId: string) {
    e.preventDefault();
    e.dataTransfer!.dropEffect = 'move';
    dragOverAreaId = areaId;
  }
  async function handleAreaDrop(e: DragEvent, targetArea: Area) {
    e.preventDefault();
    if (draggedListId) { // list dropped onto area header — move list into area
      await editList(draggedListId, { areaId: targetArea.id });
      draggedListId = null; dragOverListId = null; dragOverAreaId = null;
      return;
    }
    if (!draggedAreaId || draggedAreaId === targetArea.id) {
      draggedAreaId = null; dragOverAreaId = null; return;
    }
    const current = [...sortedAreas];
    const dragIdx = current.findIndex(a => a.id === draggedAreaId);
    const targetIdx = current.findIndex(a => a.id === targetArea.id);
    if (dragIdx < 0 || targetIdx < 0) return;
    const [moved] = current.splice(dragIdx, 1);
    current.splice(targetIdx, 0, moved);
    for (let i = 0; i < current.length; i++) {
      if (current[i].sortOrder !== i) await editArea(current[i].id, { sortOrder: i });
    }
    draggedAreaId = null; dragOverAreaId = null;
  }
  function handleAreaDragEnd() { draggedAreaId = null; dragOverAreaId = null; }

  // "Move to Area" submenu for list context menu
  let moveToAreaSubmenu = $derived.by(() => {
    const items: { label: string; action: () => void }[] = [];
    items.push({ label: 'None', action: () => { if (contextListId) editList(contextListId, { areaId: null }); } });
    for (const area of sortedAreas) {
      items.push({ label: area.name, action: () => { if (contextListId) editList(contextListId, { areaId: area.id }); } });
    }
    return items;
  });

  let contextMenuItems = $derived(contextListId ? [
    { label: 'Rename', action: startRenameList },
    { label: 'Change Color', action: openColorPicker },
    { label: 'Move to Area', submenu: moveToAreaSubmenu },
    { label: '', separator: true },
    { label: 'Delete', action: deleteList, danger: true },
  ] : []);

  let areaContextMenuItems = $derived(contextAreaId ? [
    { label: 'Rename', action: startRenameArea },
    { label: 'Change Color', action: openAreaColorPicker },
    { label: '', separator: true },
    { label: 'Delete', action: deleteArea, danger: true },
  ] : []);
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
      {#if overdueCount > 0}
        <span class="overdue-badge">{overdueCount}</span>
      {/if}
    </button>

    <button
      class="nav-item"
      class:active={$currentView === 'next7days'}
      onclick={() => selectView('next7days')}
    >
      <span class="nav-icon" aria-hidden="true">
        <svg viewBox="0 0 16 16" fill="none">
          <rect x="2" y="3" width="12" height="10.5" rx="2" stroke="currentColor" stroke-width="1.4" />
          <path d="M5 1.75V4.25M11 1.75V4.25M2 6h12" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
          <text x="8" y="11.5" font-size="5" font-weight="bold" fill="currentColor" text-anchor="middle">7</text>
        </svg>
      </span>
      <span class="nav-label">Next 7 Days</span>
    </button>

    <button
      class="nav-item"
      class:active={$currentView === 'upcoming'}
      onclick={() => selectView('upcoming')}
    >
      <span class="nav-icon" aria-hidden="true">
        <svg viewBox="0 0 16 16" fill="none">
          <rect x="2" y="3" width="12" height="10.5" rx="2" stroke="currentColor" stroke-width="1.4" />
          <path d="M5 1.75V4.25M11 1.75V4.25M2 6h12" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
          <path d="M5 9l2 2 4-4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </span>
      <span class="nav-label">Upcoming</span>
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

    <button
      class="nav-item"
      class:active={$currentView === 'schedule'}
      onclick={() => selectView('schedule')}
    >
      <span class="nav-icon" aria-hidden="true">
        <svg viewBox="0 0 16 16" fill="none">
          <rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" stroke-width="1.4"/>
          <path d="M2 6h12M6 2v12" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
          <path d="M8.5 8.5h3M8.5 11h2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
        </svg>
      </span>
      <span class="nav-label">Schedule</span>
    </button>

    <button
      class="nav-item"
      class:active={$currentView === 'timeline'}
      onclick={() => selectView('timeline')}
    >
      <span class="nav-icon" aria-hidden="true">
        <svg viewBox="0 0 16 16" fill="none">
          <rect x="2" y="3" width="12" height="10" rx="2" stroke="currentColor" stroke-width="1.4"/>
          <path d="M4.5 6h3M6.5 9h4M5 12h2.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
        </svg>
      </span>
      <span class="nav-label">Timeline</span>
    </button>
  </nav>

  <div class="sidebar-divider"></div>

  <div class="sidebar-section">
    <div class="section-header">
      <span class="section-title">Smart Filters</span>
    </div>
    <button class="nav-item" class:active={$currentView === 'smart-filter' && $selectedSmartFilter === 'overdue'} onclick={() => selectSmartFilter('overdue')}>
      <span class="nav-icon" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none"><path d="M8 3v5l3 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.4"/></svg></span>
      <span class="nav-label">Overdue</span>
    </button>
    <button class="nav-item" class:active={$currentView === 'smart-filter' && $selectedSmartFilter === 'due-this-week'} onclick={() => selectSmartFilter('due-this-week')}>
      <span class="nav-icon" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none"><rect x="2" y="3" width="12" height="10.5" rx="2" stroke="currentColor" stroke-width="1.4"/><path d="M5 1.75V4.25M11 1.75V4.25M2 6h12" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg></span>
      <span class="nav-label">This Week</span>
    </button>
    <button class="nav-item" class:active={$currentView === 'smart-filter' && $selectedSmartFilter === 'high-priority'} onclick={() => selectSmartFilter('high-priority')}>
      <span class="nav-icon" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none"><path d="M8 2L9.8 6h4.2l-3.4 2.8L12 13 8 10.2 4 13l1.4-4.2L2 6h4.2L8 2Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg></span>
      <span class="nav-label">High Priority</span>
    </button>
    <button class="nav-item" class:active={$currentView === 'smart-filter' && $selectedSmartFilter === 'untagged'} onclick={() => selectSmartFilter('untagged')}>
      <span class="nav-icon" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none"><path d="M2.5 9.5l5-7h4l2 2v4l-7 5z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><circle cx="10.5" cy="5.5" r="1" fill="currentColor"/></svg></span>
      <span class="nav-label">Untagged</span>
    </button>
  </div>

  {#if $savedFilters.length > 0 || savedFiltersExpanded}
    <div class="sidebar-section">
      <button
        class="section-header section-toggle"
        onclick={() => (savedFiltersExpanded = !savedFiltersExpanded)}
      >
        <span class="section-title">Saved Filters</span>
        <svg class="toggle-arrow" class:expanded={savedFiltersExpanded} viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <path d="M4 2.5L7.5 6L4 9.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
      {#if savedFiltersExpanded}
        {#each $savedFilters as filter (filter.id)}
          <button
            class="nav-item"
            class:active={$currentView === 'saved-filter' && $selectedSavedFilterId === filter.id}
            onclick={() => selectSavedFilter(filter.id)}
          >
            <span class="nav-icon" aria-hidden="true">
              <svg viewBox="0 0 16 16" fill="none"><path d="M2 4h12l-3 4v4l-2 1V8L2 4Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>
            </span>
            <span class="nav-label">{filter.name}</span>
            <button class="saved-filter-delete" onclick={(e) => handleDeleteSavedFilter(e, filter.id)} aria-label="Delete filter" title="Delete filter">&times;</button>
          </button>
        {/each}
        <button class="new-list-btn" onclick={handleSaveCurrentFilter}>
          <span class="nav-icon" aria-hidden="true">
            <svg viewBox="0 0 16 16" fill="none"><path d="M8 3.25v9.5M3.25 8h9.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
          </span>
          <span class="nav-label">Save Filter</span>
        </button>
      {/if}
    </div>
  {/if}

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

    {#each sortedAreas as area (area.id)}
      {@const areaLists = listsForArea(area.id)}
      {#if areaLists.length > 0}
        <div
          class="area-header section-toggle"
          class:active={$currentView === 'area-view' && $selectedAreaId === area.id}
          data-area-id={area.id}
          draggable="true"
          class:dragging={draggedAreaId === area.id}
          class:drag-over={dragOverAreaId === area.id}
          oncontextmenu={(e) => openAreaContextMenu(e, area.id)}
          ondragstart={(e) => handleAreaDragStart(e, area)}
          ondragover={(e) => handleAreaDragOver(e, area.id)}
          ondrop={(e) => handleAreaDrop(e, area)}
          ondragend={handleAreaDragEnd}
          ondragleave={() => { if (dragOverAreaId === area.id) dragOverAreaId = null; }}
        >
          <span class="area-color-dot" style:background-color={area.color ?? DEFAULT_AREA_COLOR}></span>
          {#if renamingAreaId === area.id}
            <!-- svelte-ignore a11y_autofocus -->
            <input
              bind:this={areaRenameInputRef}
              bind:value={areaRenameValue}
              class="rename-input"
              type="text"
              onkeydown={handleAreaRenameKeydown}
              onblur={confirmAreaRename}
              onclick={(e) => e.stopPropagation()}
            />
          {:else}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <span class="area-name" onclick={() => selectArea(area.id)}>{area.name}</span>
          {/if}
          {#if taskCountForArea(area.id) > 0}
            <span class="area-count">{taskCountForArea(area.id)}</span>
          {/if}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <svg class="toggle-arrow" class:expanded={!collapsedAreas[area.id]} viewBox="0 0 12 12" fill="none" aria-hidden="true" onclick={(e) => { e.stopPropagation(); toggleArea(area.id); }}>
            <path d="M4 2.5L7.5 6L4 9.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </div>
        {#if !collapsedAreas[area.id]}
          {#each areaLists as list (list.id)}
            <button
              class="list-item area-child"
              class:active={$currentView === 'list' && $selectedListId === list.id}
              class:dragging={draggedListId === list.id}
              class:drag-over={dragOverListId === list.id}
              data-list-id={list.id}
              draggable="true"
              onclick={() => selectList(list.id)}
              oncontextmenu={(e) => openListContextMenu(e, list.id)}
              ondragstart={(e) => handleListDragStart(e, list)}
              ondragover={(e) => handleListDragOver(e, list.id)}
              ondrop={(e) => handleListDrop(e, list)}
              ondragend={handleDragEnd}
              ondragleave={() => { if (dragOverListId === list.id) dragOverListId = null; }}
            >
              <span class="list-color-dot" style:background-color={list.color ?? DEFAULT_LIST_COLOR}></span>
              {#if renamingListId === list.id}
                <!-- svelte-ignore a11y_autofocus -->
                <input
                  bind:this={renameInputRef}
                  bind:value={renameValue}
                  class="rename-input"
                  type="text"
                  onkeydown={handleRenameKeydown}
                  onblur={confirmRename}
                  onclick={(e) => e.stopPropagation()}
                />
              {:else}
                <span class="list-name">{list.name}</span>
              {/if}
              {#if taskCountForList(list.id) > 0 && renamingListId !== list.id}
                <span class="task-count">{taskCountForList(list.id)}</span>
              {/if}
            </button>
          {/each}
        {/if}
      {/if}
    {/each}

    {#if uncategorizedLists.length > 0}
      {#each uncategorizedLists as list (list.id)}
        <button
          class="list-item"
          class:active={$currentView === 'list' && $selectedListId === list.id}
          class:dragging={draggedListId === list.id}
          class:drag-over={dragOverListId === list.id}
          data-list-id={list.id}
          draggable="true"
          onclick={() => selectList(list.id)}
          oncontextmenu={(e) => openListContextMenu(e, list.id)}
          ondragstart={(e) => handleListDragStart(e, list)}
          ondragover={(e) => handleListDragOver(e, list.id)}
          ondrop={(e) => handleListDrop(e, list)}
          ondragend={handleDragEnd}
          ondragleave={() => { if (dragOverListId === list.id) dragOverListId = null; }}
        >
          <span class="list-color-dot" style:background-color={list.color ?? DEFAULT_LIST_COLOR}></span>
          {#if renamingListId === list.id}
            <!-- svelte-ignore a11y_autofocus -->
            <input
              bind:this={renameInputRef}
              bind:value={renameValue}
              class="rename-input"
              type="text"
              onkeydown={handleRenameKeydown}
              onblur={confirmRename}
              onclick={(e) => e.stopPropagation()}
            />
          {:else}
            <span class="list-name">{list.name}</span>
          {/if}
          {#if taskCountForList(list.id) > 0 && renamingListId !== list.id}
            <span class="task-count">{taskCountForList(list.id)}</span>
          {/if}
        </button>
      {/each}
    {/if}

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

    {#if creatingArea}
      <div class="new-list-input-row">
        <input
          bind:this={areaInputRef}
          bind:value={newAreaName}
          class="new-list-input"
          type="text"
          placeholder="Area name..."
          onkeydown={handleNewAreaKeydown}
          onblur={cancelNewArea}
        />
      </div>
    {/if}

    <button class="new-list-btn" onclick={startCreatingArea}>
      <span class="nav-icon" aria-hidden="true">
        <svg viewBox="0 0 16 16" fill="none">
          <rect x="3" y="3" width="10" height="10" rx="2" stroke="currentColor" stroke-width="1.4" />
          <path d="M8 5.5v5M5.5 8h5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
        </svg>
      </span>
      <span class="nav-label">New Area</span>
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
        <button
          class="tag-item"
          class:active={$currentView === 'tag-filter' && $selectedTagId === tag.id}
          onclick={() => selectTag(tag.id)}
        >
          <span
            class="tag-color-dot"
            style:background-color={tag.color ?? DEFAULT_TAG_COLOR}
          ></span>
          <span class="tag-name">{tag.name}</span>
          {#if tagCounts[tag.id]}
            <span class="task-count">{tagCounts[tag.id]}</span>
          {/if}
        </button>
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

<ContextMenu open={contextMenuOpen} x={contextMenuX} y={contextMenuY} items={contextMenuItems} onclose={() => (contextMenuOpen = false)} />
<ContextMenu open={areaContextMenuOpen} x={areaContextMenuX} y={areaContextMenuY} items={areaContextMenuItems} onclose={() => (areaContextMenuOpen = false)} />

{#if areaColorPickerId}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="color-picker-overlay" onclick={() => (areaColorPickerId = null)}></div>
  <div class="color-picker-popover" style="left: {areaColorPickerX}px; top: {areaColorPickerY}px">
    <ColorPicker selected={($areas).find((a) => a.id === areaColorPickerId)?.color ?? ''} onselect={handleAreaColorSelect} />
  </div>
{/if}

{#if colorPickerListId}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="color-picker-overlay" onclick={() => (colorPickerListId = null)}></div>
  <div class="color-picker-popover" style="left: {colorPickerX}px; top: {colorPickerY}px">
    <ColorPicker selected={($lists).find((l) => l.id === colorPickerListId)?.color ?? ''} onselect={handleColorSelect} />
  </div>
{/if}

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
    width: 100%;
    background: none;
    border: none;
    cursor: pointer;
    font-family: inherit;
    text-align: left;
    transition: background 150ms ease;
  }

  .tag-item:hover {
    background: var(--color-surface-hover, #2a2e33);
  }

  .tag-item.active {
    background: var(--color-surface-active, #30353b);
    color: var(--color-text-primary, #d4d4d4);
  }

  .saved-filter-delete {
    background: none; border: none; cursor: pointer;
    color: var(--color-text-muted, #90918d);
    font-size: 14px; padding: 0 4px; line-height: 1;
    border-radius: 4px; margin-left: auto; opacity: 0;
    transition: opacity 150ms ease;
  }
  .nav-item:hover .saved-filter-delete { opacity: 1; }
  .saved-filter-delete:hover { color: var(--color-priority-high, #e06c60); }

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

  .rename-input {
    flex: 1;
    padding: 2px 6px;
    border-radius: 6px;
    border: 1px solid var(--color-accent, #6c93c7);
    background: var(--color-input, #17181a);
    color: var(--color-text-primary, #d4d4d4);
    font-size: 14px;
    font-family: inherit;
    outline: none;
    min-width: 0;
  }

  .color-picker-overlay {
    position: fixed;
    inset: 0;
    z-index: 299;
  }

  .color-picker-popover {
    position: fixed;
    z-index: 300;
    background: var(--color-panel, #202225);
    border: 1px solid var(--color-border-subtle, #292c30);
    border-radius: 12px;
    padding: 12px;
    box-shadow: var(--shadow-overlay, 0 20px 56px rgba(0, 0, 0, 0.48));
  }

  .list-item.dragging { opacity: 0.4; }
  .list-item.drag-over { border-top: 2px solid var(--color-accent, #6c93c7); margin-top: -2px; }

  .overdue-badge {
    background: var(--color-danger, #cd4945);
    color: #fff;
    font-size: 10px;
    font-weight: 600;
    padding: 1px 6px;
    border-radius: 999px;
    margin-left: auto;
    flex-shrink: 0;
    line-height: 1.4;
  }

  .area-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    margin-top: 4px;
  }
  .area-header.dragging { opacity: 0.4; }
  .area-header.drag-over { border-top: 2px solid var(--color-accent, #6c93c7); margin-top: 2px; }
  .area-color-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .area-name {
    flex: 1;
    font-size: 12px;
    font-weight: 600;
    color: var(--color-text-muted, #90918d);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .area-count {
    font-size: 10px;
    color: var(--color-text-muted, #90918d);
    flex-shrink: 0;
  }
  .list-item.area-child {
    padding-left: 24px;
  }
</style>
