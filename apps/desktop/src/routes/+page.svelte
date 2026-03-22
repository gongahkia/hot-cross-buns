<script lang="ts">
  import Sidebar from '$lib/components/Sidebar.svelte';
  import TaskList from '$lib/components/TaskList.svelte';
  import TaskDetail from '$lib/components/TaskDetail.svelte';
  import { selectedListId } from '$lib/stores/ui';

  let hasSelectedList = $derived.by(() => {
    let value: string | null = null;
    const unsub = selectedListId.subscribe((v) => (value = v));
    unsub();
    return value !== null;
  });
</script>

<div class="app">
  <Sidebar />

  <main class="content">
    <header class="toolbar">
      <span class="toolbar-title">TickClone</span>
    </header>
    <div class="main-area">
      {#if hasSelectedList}
        <TaskList />
      {:else}
        <p class="empty-state">Select a list to view tasks</p>
      {/if}
    </div>
  </main>
</div>

<TaskDetail />

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
