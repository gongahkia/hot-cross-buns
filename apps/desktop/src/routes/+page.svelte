<script lang="ts">
  import { onMount } from 'svelte';
  import Sidebar from '$lib/components/Sidebar.svelte';
  import TaskList from '$lib/components/TaskList.svelte';
  import TaskDetail from '$lib/components/TaskDetail.svelte';
  import TodayView from '$lib/components/TodayView.svelte';
  import CalendarView from '$lib/components/CalendarView.svelte';
  import WeekView from '$lib/components/WeekView.svelte';
  import ShortcutsModal from '$lib/components/ShortcutsModal.svelte';
  import SearchBar from '$lib/components/SearchBar.svelte';
  import { selectedListId, selectedTaskId, currentView } from '$lib/stores/ui';
  import { editTask, removeTask } from '$lib/stores/tasks';
  import { registerShortcuts } from '$lib/services/shortcuts';

  let showShortcuts = $state(false);

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

  onMount(() => {
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
      {#if activeView === 'calendar'}
        <CalendarView />
      {:else if activeView === 'week'}
        <WeekView />
      {:else if activeView === 'today'}
        <TodayView />
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
