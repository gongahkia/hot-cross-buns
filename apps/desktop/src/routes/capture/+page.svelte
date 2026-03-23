<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import { parseQuickAdd } from '$lib/services/nlp-quickadd';

  let input = $state('');
  let lists: { id: string; name: string; isInbox: boolean }[] = $state([]);
  let selectedListId = $state('');
  let submitting = $state(false);

  $effect(() => { // load lists on mount
    invoke<any[]>('get_lists').then((result) => {
      lists = result;
      const inbox = result.find((l) => l.isInbox ?? l.is_inbox);
      if (inbox) selectedListId = inbox.id;
      else if (result.length > 0) selectedListId = result[0].id;
    });
  });

  async function submit() {
    if (!input.trim() || !selectedListId || submitting) return;
    submitting = true;
    try {
      const parsed = parseQuickAdd(input);
      await invoke('create_task', {
        listId: selectedListId,
        title: parsed.title,
        dueDate: parsed.dueDate ?? null,
        priority: parsed.priority ?? null,
        recurrenceRule: parsed.recurrenceRule ?? null,
      });
      input = '';
      await getCurrentWindow().hide();
    } catch (err) {
      console.error('Quick capture failed:', err);
    } finally {
      submitting = false;
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    } else if (e.key === 'Escape') {
      getCurrentWindow().hide();
    }
  }

  let preview = $derived(input.trim() ? parseQuickAdd(input) : null);
</script>

<div class="capture-window" onkeydown={handleKeydown}>
  <div class="capture-header">
    <select class="list-select" bind:value={selectedListId}>
      {#each lists as list (list.id)}
        <option value={list.id}>{list.name}</option>
      {/each}
    </select>
  </div>
  <input
    class="capture-input"
    type="text"
    bind:value={input}
    placeholder="Add a task... (try: Buy milk tomorrow #groceries !high)"
    autofocus
  />
  {#if preview && (preview.dueDate || preview.priority || preview.tagNames.length > 0)}
    <div class="capture-preview">
      {#if preview.dueDate}<span class="chip date">{preview.dueDate}</span>{/if}
      {#if preview.priority}<span class="chip pri">{'!' + ['', 'Low', 'Med', 'High'][preview.priority]}</span>{/if}
      {#each preview.tagNames as tag}<span class="chip tag">#{tag}</span>{/each}
    </div>
  {/if}
  <div class="capture-footer">
    <span class="hint">Enter to add / Esc to close</span>
    <button class="submit-btn" onclick={submit} disabled={!input.trim() || submitting}>Add Task</button>
  </div>
</div>

<style>
  :global(body) { margin: 0; background: transparent; overflow: hidden; }
  .capture-window {
    display: flex; flex-direction: column; gap: 8px;
    padding: 16px;
    background: var(--color-panel, #202225);
    border: 1px solid var(--color-border-subtle, #292c30);
    border-radius: 16px;
    box-shadow: 0 24px 48px rgba(0,0,0,0.4);
    height: 100vh; box-sizing: border-box;
    font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', system-ui, sans-serif;
    color: var(--color-text-primary, #d4d4d4);
  }
  .capture-header { display: flex; gap: 8px; }
  .list-select {
    flex: 1; padding: 6px 10px; border-radius: 8px;
    border: 1px solid var(--color-border, #32353a);
    background: var(--color-input, #17181a);
    color: var(--color-text-primary, #d4d4d4);
    font-size: 13px; font-family: inherit; outline: none;
  }
  .capture-input {
    padding: 10px 14px; border-radius: 10px;
    border: 1px solid var(--color-border, #32353a);
    background: var(--color-input, #17181a);
    color: var(--color-text-primary, #d4d4d4);
    font-size: 15px; font-family: inherit; outline: none;
  }
  .capture-input:focus { border-color: var(--color-accent, #6c93c7); }
  .capture-input::placeholder { color: var(--color-text-muted, #90918d); }
  .capture-preview { display: flex; gap: 4px; flex-wrap: wrap; }
  .chip {
    font-size: 11px; padding: 2px 8px; border-radius: 6px;
    background: var(--color-surface-0, #25282c);
    color: var(--color-text-secondary, #b6b6b2);
  }
  .chip.date { color: var(--color-accent, #6c93c7); }
  .chip.pri { color: var(--color-priority-high, #cd4945); }
  .chip.tag { color: var(--color-info, #2e7cd1); }
  .capture-footer { display: flex; justify-content: space-between; align-items: center; }
  .hint { font-size: 11px; color: var(--color-text-faint, #70726f); }
  .submit-btn {
    padding: 6px 16px; border-radius: 8px; border: none;
    background: var(--color-accent, #6c93c7);
    color: var(--color-on-accent, #f7f7f5);
    font-size: 13px; font-weight: 500; cursor: pointer;
    font-family: inherit; transition: opacity 150ms ease;
  }
  .submit-btn:hover { opacity: 0.9; }
  .submit-btn:disabled { opacity: 0.4; cursor: default; }
</style>
