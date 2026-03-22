<div class="app">
  <aside class="sidebar">
    <div class="sidebar-header">
      <h2>TickClone</h2>
    </div>
    <nav class="sidebar-nav">
      <div class="nav-item active">Inbox</div>
    </nav>
  </aside>

  <main class="content">
    <header class="toolbar">
      <span class="toolbar-title">TickClone</span>
    </header>
    <div class="main-area">
      <p class="empty-state">Select a list to view tasks</p>
    </div>
  </main>
</div>

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

  .sidebar {
    background: var(--color-bg-secondary, #181825);
    border-right: 1px solid var(--color-border-subtle, #313244);
    display: flex;
    flex-direction: column;
    overflow-y: auto;
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
  }

  .nav-item {
    padding: 8px 12px;
    border-radius: 8px;
    cursor: pointer;
    font-size: 14px;
    transition: background 200ms ease;
  }

  .nav-item:hover {
    background: var(--color-surface-0, #313244);
  }

  .nav-item.active {
    background: var(--color-surface-0, #313244);
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
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .empty-state {
    color: var(--color-text-muted, #a6adc8);
    font-size: 14px;
  }
</style>
