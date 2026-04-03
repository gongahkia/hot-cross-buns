<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { listen } from '@tauri-apps/api/event';
  import Sidebar from '$lib/components/Sidebar.svelte';
  import TaskList from '$lib/components/TaskList.svelte';
  import TaskDetail from '$lib/components/TaskDetail.svelte';
  import ShortcutsModal from '$lib/components/ShortcutsModal.svelte';
  import NotificationCenter from '$lib/components/NotificationCenter.svelte';
  import Onboarding from '$lib/components/Onboarding.svelte';
  import CommandPalette from '$lib/components/CommandPalette.svelte';
  import { selectedListId, selectedTaskId, currentView } from '$lib/stores/ui';
  import { editTask, removeTask } from '$lib/stores/tasks';
  import { addNotification } from '$lib/stores/notifications';
  import { loadLists } from '$lib/stores/lists';
  import { loadTags } from '$lib/stores/tags';
  import { registerShortcuts } from '$lib/services/shortcuts';
  import { markBootstrapCompleted, markFirstInteractive } from '$lib/services/startup';
  import type { List, Task } from '$lib/types';

  type ViewModule = { default: import('svelte').Component };
  const viewModules: Record<string, ViewModule | null> = $state({});
  const VIEW_MAP: Record<string, () => Promise<ViewModule>> = {
    'today': () => import('$lib/components/TodayView.svelte'),
    'calendar': () => import('$lib/components/CalendarView.svelte'),
    'smart-filter': () => import('$lib/components/SmartFilterView.svelte'),
    'tag-filter': () => import('$lib/components/TagFilterView.svelte'),
    'area-view': () => import('$lib/components/AreaView.svelte'),
    'saved-filter': () => import('$lib/components/SavedFilterView.svelte'),
    'logbook': () => import('$lib/components/LogbookView.svelte'),
  };

  let showShortcuts = $state(false);
  let showOnboarding = $state(false);
  let appReady = $state(false);
  let startupError = $state<string | null>(null);

  function defaultListFrom(lists: List[]): List | null {
    return lists.find((list) => list.isInbox) ?? lists[0] ?? null;
  }

  async function focusQuickAddInput() {
    await tick();
    requestAnimationFrame(() => {
      document.querySelector<HTMLInputElement>('.quick-add-input')?.focus();
    });
  }

  let hasSelectedList = $derived($selectedListId !== null);
  let activeView = $derived($currentView);
  let ActiveComponent = $derived(viewModules[activeView]?.default ?? null);
  let isLazyView = $derived(activeView in VIEW_MAP);

  async function ensureViewModule(view: string) {
    if (view in VIEW_MAP && !viewModules[view]) {
      viewModules[view] = await VIEW_MAP[view]();
    }
  }

  function hasSeenOnboarding(): boolean {
    if (typeof localStorage === 'undefined') return true;
    return localStorage.getItem('cross2:onboardingSeen') === 'true';
  }

  function markOnboardingSeen() {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('cross2:onboardingSeen', 'true');
    }
    showOnboarding = false;
  }

  $effect(() => {
    void ensureViewModule(activeView);
  });

  onMount(() => {
    let notificationPoll: ReturnType<typeof setInterval> | undefined;
    let removeTrayQuickAddListener: (() => void) | undefined;

    function notificationMessage(task: Task): string {
      if (!task.dueDate) return 'Due soon';
      const parsed = new Date(task.dueDate);
      if (Number.isNaN(parsed.getTime())) return `Due at ${task.dueDate}`;
      return `Due at ${parsed.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
    }

    async function pollDueNotifications() {
      try {
        const dueSoonTasks = await invoke<Task[]>('drain_due_notifications');
        for (const task of dueSoonTasks) {
          addNotification({
            taskId: task.id,
            listId: task.listId,
            title: task.title,
            message: notificationMessage(task),
          });
        }
      } catch (err) {
        console.error('Failed to poll due notifications:', err);
      }
    }

    async function bootstrapApp() {
      try {
        const loadedLists = await loadLists();
        await loadTags();
        const defaultList = defaultListFrom(loadedLists);
        selectedListId.set(defaultList?.id ?? null);
        showOnboarding = !hasSeenOnboarding() && loadedLists.length <= 1;
        startupError = null;
      } catch (err) {
        console.error('Failed to bootstrap desktop data:', err);
        startupError = 'Could not load your lists.';
        selectedListId.set(null);
        showOnboarding = false;
      } finally {
        appReady = true;
        markBootstrapCompleted();
        requestAnimationFrame(() => { markFirstInteractive(); });
      }
    }

    const cleanup = registerShortcuts({
      focusQuickAdd() {
        const input = document.querySelector<HTMLInputElement>('.quick-add-input');
        if (input) input.focus();
      },
      closeDetail() {
        selectedTaskId.set(null);
        showShortcuts = false;
      },
      deleteSelectedTask() {
        let taskId: string | null = null;
        const unsub = selectedTaskId.subscribe((v) => (taskId = v));
        unsub();
        if (taskId) {
          selectedTaskId.set(null);
          removeTask(taskId);
        }
      },
      setPriority(level: number) {
        let taskId: string | null = null;
        const unsub = selectedTaskId.subscribe((v) => (taskId = v));
        unsub();
        if (taskId) editTask(taskId, { priority: level });
      },
      switchToToday() { currentView.set('today'); },
      switchToCalendar() { currentView.set('calendar'); },
      showShortcutsModal() { showShortcuts = true; },
    });

    void listen('tray://quick-add-task', async () => {
      currentView.set('list');
      selectedTaskId.set(null);
      let selectedList: string | null = null;
      const unsub = selectedListId.subscribe((value) => (selectedList = value));
      unsub();
      if (!selectedList) {
        const loadedLists = await loadLists();
        const defaultList = defaultListFrom(loadedLists);
        selectedListId.set(defaultList?.id ?? null);
      }
      await focusQuickAddInput();
    }).then((unlisten) => { removeTrayQuickAddListener = unlisten; });

    void bootstrapApp();
    void pollDueNotifications();
    notificationPoll = setInterval(() => { void pollDueNotifications(); }, 60_000);

    return () => {
      cleanup();
      removeTrayQuickAddListener?.();
      if (notificationPoll !== undefined) clearInterval(notificationPoll);
    };
  });
</script>

<div class="app">
  <Sidebar />

  <main class="content">
    <header class="toolbar">
      <div class="toolbar-actions">
        <NotificationCenter />
      </div>
    </header>
    <div class="main-area">
      {#if !appReady}
        <p class="empty-state">Loading your workspace...</p>
      {:else if startupError}
        <p class="empty-state">{startupError}</p>
      {:else if isLazyView}
        {#if ActiveComponent}
          <ActiveComponent />
        {:else}
          <p class="empty-state">Loading...</p>
        {/if}
      {:else if hasSelectedList}
        <TaskList />
      {:else}
        <p class="empty-state">Select a list to view tasks</p>
      {/if}
    </div>
  </main>
</div>

<TaskDetail />
<ShortcutsModal open={showShortcuts} onclose={() => (showShortcuts = false)} />
<CommandPalette />
{#if showOnboarding}
  <Onboarding onDone={markOnboardingSeen} />
{/if}

<style>
  :global(body) {
    margin: 0;
    padding: 0;
    font-family: var(--font-sans, -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', system-ui, sans-serif);
    font-size: 13px;
    background: var(--color-bg-primary, #191919);
    color: var(--color-text-primary, #d4d4d4);
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
  }

  .app {
    display: grid;
    grid-template-columns: 250px 1fr;
    height: 100vh;
    overflow: hidden;
  }

  .content {
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .toolbar {
    height: 48px;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    padding: 0 16px;
    border-bottom: 1px solid var(--color-border-subtle, #292c30);
    background: var(--color-panel, #202225);
  }

  .toolbar-actions {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
  }

  .main-area {
    flex: 1;
    overflow: hidden;
  }

  .empty-state {
    color: var(--color-text-muted, #90918d);
    font-size: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    margin: 0;
  }
</style>
