<script lang="ts">
  import { onMount } from 'svelte';
  import Sidebar from '$lib/components/Sidebar.svelte';
  import TaskList from '$lib/components/TaskList.svelte';
  import TaskDetail from '$lib/components/TaskDetail.svelte';
  import ShortcutsModal from '$lib/components/ShortcutsModal.svelte';
  import SearchBar from '$lib/components/SearchBar.svelte';
  import Onboarding from '$lib/components/Onboarding.svelte';
  import { selectedListId, selectedTaskId, currentView } from '$lib/stores/ui';
  import { editTask, removeTask } from '$lib/stores/tasks';
  import { loadLists } from '$lib/stores/lists';
  import { loadTags } from '$lib/stores/tags';
  import { registerShortcuts } from '$lib/services/shortcuts';
  import { markBootstrapCompleted, markFirstInteractive } from '$lib/services/startup';
  import type { List } from '$lib/types';

  type TodayViewModule = typeof import('$lib/components/TodayView.svelte');
  type WeekViewModule = typeof import('$lib/components/WeekView.svelte');
  type CalendarViewModule = typeof import('$lib/components/CalendarView.svelte');

  let showShortcuts = $state(false);
  let showOnboarding = $state(false);
  let appReady = $state(false);
  let startupError = $state<string | null>(null);
  let todayViewModule = $state<TodayViewModule | null>(null);
  let weekViewModule = $state<WeekViewModule | null>(null);
  let calendarViewModule = $state<CalendarViewModule | null>(null);

  let hasSelectedList = $derived.by(() => {
    let value: string | null = null;
    const unsub = selectedListId.subscribe((v) => (value = v));
    unsub();
    return value !== null;
  });

  let activeView = $derived.by(() => {
    let value: string = 'list';
    const unsub = currentView.subscribe((v) => (value = v));
    unsub();
    return value;
  });

  async function ensureViewModule(view: string) {
    if (view === 'today' && !todayViewModule) {
      todayViewModule = await import('$lib/components/TodayView.svelte');
    }

    if (view === 'week' && !weekViewModule) {
      weekViewModule = await import('$lib/components/WeekView.svelte');
    }

    if (view === 'calendar' && !calendarViewModule) {
      calendarViewModule = await import('$lib/components/CalendarView.svelte');
    }
  }

  function hasSeenOnboarding(): boolean {
    if (typeof localStorage === 'undefined') {
      return true;
    }

    return localStorage.getItem('tickclone:onboardingSeen') === 'true';
  }

  function markOnboardingSeen() {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('tickclone:onboardingSeen', 'true');
    }
    showOnboarding = false;
  }

  $effect(() => {
    void ensureViewModule(activeView);
  });

  onMount(() => {
    async function bootstrapApp() {
      try {
        const loadedLists = await loadLists();
        await loadTags();

        const defaultList =
          loadedLists.find((list: List) => list.isInbox) ?? loadedLists[0] ?? null;

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
        requestAnimationFrame(() => {
          markFirstInteractive();
        });
      }
    }

    const cleanup = registerShortcuts({
      focusQuickAdd() {
        const input = document.querySelector<HTMLInputElement>('.quick-add-input');
        if (input) {
          input.focus();
        }
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
        if (taskId) {
          editTask(taskId, { priority: level });
        }
      },
      switchToToday() {
        currentView.set('today');
      },
      switchToCalendar() {
        currentView.set('calendar');
      },
      showShortcutsModal() {
        showShortcuts = true;
      },
    });

    void bootstrapApp();

    return cleanup;
  });
</script>

<div class="app">
  <Sidebar />

  <main class="content">
    <header class="toolbar">
      <span class="toolbar-title">TickClone</span>
      <SearchBar />
    </header>
    <div class="main-area">
      {#if !appReady}
        <p class="empty-state">Loading your workspace...</p>
      {:else if startupError}
        <p class="empty-state">{startupError}</p>
      {:else if activeView === 'calendar'}
        {#if calendarViewModule}
          <calendarViewModule.default />
        {:else}
          <p class="empty-state">Loading calendar...</p>
        {/if}
      {:else if activeView === 'week'}
        {#if weekViewModule}
          <weekViewModule.default />
        {:else}
          <p class="empty-state">Loading week view...</p>
        {/if}
      {:else if activeView === 'today'}
        {#if todayViewModule}
          <todayViewModule.default />
        {:else}
          <p class="empty-state">Loading today...</p>
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
{#if showOnboarding}
  <Onboarding onDone={markOnboardingSeen} />
{/if}

<style>
  :global(body) {
    margin: 0;
    padding: 0;
    font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', system-ui, Roboto, 'Helvetica Neue', Arial, sans-serif;
    font-size: 13px;
    background: var(--color-bg-primary, #1e1e2e);
    color: var(--color-text-primary, #cdd6f4);
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
    padding: 0 16px;
    border-bottom: 1px solid var(--color-border-subtle, #313244);
    background: var(--color-bg-primary, #1e1e2e);
  }

  .toolbar-title {
    font-size: 14px;
    font-weight: 500;
  }

  .main-area {
    flex: 1;
    overflow: hidden;
  }

  .empty-state {
    color: var(--color-text-muted, #a6adc8);
    font-size: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    margin: 0;
  }
</style>
