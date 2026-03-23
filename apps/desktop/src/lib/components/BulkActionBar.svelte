<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import { selectedTaskIds, clearSelection } from '$lib/stores/selection';
  import { taskMutationVersion } from '$lib/stores/tasks';
  import { lists } from '$lib/stores/lists';
  import { tags, tagTask } from '$lib/stores/tags';

  let showMoveDropdown = $state(false);
  let showTagDropdown = $state(false);

  let count = $derived($selectedTaskIds.size);
  let ids = $derived([...$selectedTaskIds]);

  async function bulkDelete() {
    if (!confirm(`Delete ${count} task(s)?`)) return;
    await invoke('bulk_delete_tasks', { ids });
    taskMutationVersion.update((v) => v + 1);
    clearSelection();
  }

  async function bulkSetPriority(priority: number) {
    await invoke('bulk_update_tasks', { ids, priority });
    taskMutationVersion.update((v) => v + 1);
    clearSelection();
  }

  async function bulkMove(listId: string) {
    await invoke('bulk_move_tasks', { ids, newListId: listId });
    taskMutationVersion.update((v) => v + 1);
    clearSelection();
    showMoveDropdown = false;
  }

  async function bulkTag(tagId: string) {
    for (const taskId of ids) {
      try { await tagTask(taskId, tagId); } catch {} // best-effort
    }
    taskMutationVersion.update((v) => v + 1);
    clearSelection();
    showTagDropdown = false;
  }
</script>

{#if count > 0}
  <div class="bulk-bar">
    <span class="bulk-count">{count} selected</span>
    <div class="bulk-actions">
      <div class="bulk-dropdown-wrapper">
        <button class="bulk-btn" onclick={() => (showMoveDropdown = !showMoveDropdown)}>Move</button>
        {#if showMoveDropdown}
          <div class="bulk-dropdown">
            {#each $lists as list (list.id)}
              <button class="bulk-dropdown-item" onclick={() => bulkMove(list.id)}>{list.name}</button>
            {/each}
          </div>
        {/if}
      </div>
      <button class="bulk-btn" onclick={() => bulkSetPriority(3)}>!High</button>
      <button class="bulk-btn" onclick={() => bulkSetPriority(2)}>!Med</button>
      <button class="bulk-btn" onclick={() => bulkSetPriority(1)}>!Low</button>
      <div class="bulk-dropdown-wrapper">
        <button class="bulk-btn" onclick={() => (showTagDropdown = !showTagDropdown)}>Tag</button>
        {#if showTagDropdown}
          <div class="bulk-dropdown">
            {#each $tags as tag (tag.id)}
              <button class="bulk-dropdown-item" onclick={() => bulkTag(tag.id)}>
                <span class="tag-dot" style:background={tag.color ?? 'var(--color-tag-default)'}></span>
                {tag.name}
              </button>
            {/each}
          </div>
        {/if}
      </div>
      <button class="bulk-btn danger" onclick={bulkDelete}>Delete</button>
      <button class="bulk-btn muted" onclick={clearSelection}>Cancel</button>
    </div>
  </div>
{/if}

<style>
  .bulk-bar {
    display: flex; align-items: center; gap: 12px;
    padding: 8px 16px;
    background: var(--color-surface-1, #2d3136);
    border-top: 1px solid var(--color-border-subtle, #292c30);
    border-radius: 10px;
    margin: 8px 12px;
  }
  .bulk-count { font-size: 13px; font-weight: 600; color: var(--color-accent, #6c93c7); white-space: nowrap; }
  .bulk-actions { display: flex; gap: 4px; flex-wrap: wrap; }
  .bulk-btn {
    padding: 4px 12px; border-radius: 6px;
    border: 1px solid var(--color-border, #32353a);
    background: var(--color-input, #17181a);
    color: var(--color-text-primary, #d4d4d4);
    font-size: 12px; cursor: pointer; font-family: inherit;
    transition: all 150ms ease;
  }
  .bulk-btn:hover { border-color: var(--color-accent, #6c93c7); }
  .bulk-btn.danger { border-color: var(--color-danger, #cd4945); color: var(--color-danger, #cd4945); }
  .bulk-btn.danger:hover { background: color-mix(in srgb, var(--color-danger) 10%, transparent); }
  .bulk-btn.muted { color: var(--color-text-muted, #90918d); }
  .bulk-dropdown-wrapper { position: relative; }
  .bulk-dropdown {
    position: absolute; bottom: 100%; left: 0; margin-bottom: 4px;
    background: var(--color-panel, #202225);
    border: 1px solid var(--color-border-subtle, #292c30);
    border-radius: 8px; padding: 4px; min-width: 140px; z-index: 10;
    box-shadow: var(--shadow-overlay, 0 20px 56px rgba(0, 0, 0, 0.48));
  }
  .bulk-dropdown-item {
    display: flex; align-items: center; gap: 8px;
    width: 100%; padding: 6px 10px; border: none; background: none;
    color: var(--color-text-primary, #d4d4d4); font-size: 12px;
    cursor: pointer; border-radius: 6px; font-family: inherit; text-align: left;
    transition: background 150ms ease;
  }
  .bulk-dropdown-item:hover { background: var(--color-surface-hover, #2a2e33); }
  .tag-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
</style>
