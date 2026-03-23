<script lang="ts">
  import {
    notifications,
    markRead,
    markAllRead,
    type Notification,
  } from '$lib/stores/notifications';
  import { currentView, selectedListId, selectedTaskId } from '$lib/stores/ui';

  let open = $state(false);

  // Derive unread count reactively via $derived.
  let unreadCount = $derived(
    ($notifications).filter((n: Notification) => !n.read).length
  );

  function togglePanel() {
    open = !open;
  }

  function handleNotificationClick(n: Notification) {
    markRead(n.id);
    selectedListId.set(n.listId);
    currentView.set('list');
    selectedTaskId.set(n.taskId);
    open = false;
  }

  function handleMarkAllRead() {
    markAllRead();
  }

  function onFocusOut(e: FocusEvent) {
    const related = e.relatedTarget as HTMLElement | null;
    if (related && (e.currentTarget as HTMLElement)?.contains(related)) return;
    setTimeout(() => {
      open = false;
    }, 150);
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="notification-center" onfocusout={onFocusOut}>
  <button class="bell-button" onclick={togglePanel} aria-label="Notifications">
    <svg class="bell-icon" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M8 1.5A3.5 3.5 0 0 0 4.5 5v2.5c0 .5-.2 1.2-.6 1.8-.4.6-.9 1-.9 1H13s-.5-.4-.9-1c-.4-.6-.6-1.3-.6-1.8V5A3.5 3.5 0 0 0 8 1.5ZM6.5 12a1.5 1.5 0 0 0 3 0"
        stroke="currentColor"
        stroke-width="1.2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
    {#if unreadCount > 0}
      <span class="badge">{unreadCount > 99 ? '99+' : unreadCount}</span>
    {/if}
  </button>

  {#if open}
    <div class="dropdown">
      <div class="dropdown-header">
        <span class="dropdown-title">Notifications</span>
        {#if ($notifications).length > 0}
          <button class="mark-all-btn" onclick={handleMarkAllRead}>Mark all read</button>
        {/if}
      </div>

      {#if ($notifications).length === 0}
        <div class="empty-state">No notifications</div>
      {:else}
        <div class="notification-list">
          {#each $notifications as n (n.id)}
            <button
              class="notification-item"
              class:unread={!n.read}
              onclick={() => handleNotificationClick(n)}
            >
              <div class="notification-content">
                <span class="notification-title">{n.title}</span>
                <span class="notification-message">{n.message}</span>
              </div>
            </button>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .notification-center {
    position: relative;
  }

  .bell-button {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    background: none;
    border: none;
    border-radius: 6px;
    color: var(--color-text-secondary, #b6b6b2);
    cursor: pointer;
    transition: background 200ms ease;
  }

  .bell-button:hover {
    background: var(--color-surface-hover, #2a2e33);
  }

  .bell-icon {
    width: 18px;
    height: 18px;
  }

  .badge {
    position: absolute;
    top: 2px;
    right: 2px;
    min-width: 16px;
    height: 16px;
    padding: 0 4px;
    border-radius: 8px;
    background: var(--color-danger, #cd4945);
    color: var(--color-on-accent, #f7f7f5);
    font-size: 10px;
    font-weight: 700;
    line-height: 16px;
    text-align: center;
  }

  .dropdown {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    width: 320px;
    max-height: 400px;
    background: var(--color-panel, #202225);
    border: 1px solid var(--color-border-subtle, #292c30);
    border-radius: 12px;
    box-shadow: var(--shadow-overlay, 0 20px 56px rgba(0, 0, 0, 0.48));
    z-index: 300;
    display: flex;
    flex-direction: column;
  }

  .dropdown-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 12px;
    border-bottom: 1px solid var(--color-border-subtle, #292c30);
  }

  .dropdown-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--color-text-primary, #d4d4d4);
  }

  .mark-all-btn {
    background: none;
    border: none;
    color: var(--color-accent, #6c93c7);
    font-size: 12px;
    cursor: pointer;
    font-family: inherit;
  }

  .mark-all-btn:hover {
    text-decoration: underline;
  }

  .empty-state {
    padding: 24px;
    text-align: center;
    color: var(--color-text-muted, #90918d);
    font-size: 13px;
  }

  .notification-list {
    overflow-y: auto;
    padding: 4px;
  }

  .notification-list::-webkit-scrollbar {
    width: 6px;
  }

  .notification-list::-webkit-scrollbar-track {
    background: transparent;
  }

  .notification-list::-webkit-scrollbar-thumb {
    background: var(--color-surface-1, #2d3136);
    border-radius: 3px;
  }

  .notification-item {
    display: flex;
    width: 100%;
    padding: 8px 10px;
    border: none;
    background: none;
    color: var(--color-text-primary, #d4d4d4);
    font-size: 13px;
    cursor: pointer;
    border-radius: 8px;
    transition: background 200ms ease;
    font-family: inherit;
    text-align: left;
  }

  .notification-item:hover {
    background: var(--color-surface-hover, #2a2e33);
  }

  .notification-item.unread {
    background: var(--color-accent-soft, rgba(108, 147, 199, 0.16));
  }

  .notification-content {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .notification-title {
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .notification-message {
    font-size: 11px;
    color: var(--color-text-muted, #90918d);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
