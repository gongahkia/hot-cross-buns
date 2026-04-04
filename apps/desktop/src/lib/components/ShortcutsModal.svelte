<script lang="ts">
  let { open = false, onclose }: { open: boolean; onclose: () => void } = $props();

  const shortcuts: { key: string; description: string }[] = [
    { key: 'N', description: 'Focus quick-add input' },
    { key: 'Esc', description: 'Close panel / deselect' },
    { key: 'Del / Backspace', description: 'Delete selected task' },
    { key: '1 / 2 / 3', description: 'Set priority (Low / Med / High)' },
    { key: '0', description: 'Clear priority' },
    { key: 'T', description: 'Switch to Today view' },
    { key: 'C', description: 'Switch to Calendar view' },
    { key: '?', description: 'Show this help' },
    { key: '\u2318K / Ctrl+K', description: 'Open search palette' },
    { key: '\u2318\u21e7P / Ctrl+P', description: 'Open command palette' },
  ];

  function handleOverlayClick(e: MouseEvent) {
    if (e.target === e.currentTarget) {
      onclose();
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      onclose();
    }
  }
</script>

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="shortcuts-overlay" onclick={handleOverlayClick} onkeydown={handleKeydown}>
    <div class="shortcuts-modal" role="dialog" aria-label="Keyboard shortcuts">
      <div class="modal-header">
        <h2 class="modal-title">Keyboard Shortcuts</h2>
        <button class="modal-close" onclick={onclose} aria-label="Close">
          &#x2715;
        </button>
      </div>

      <div class="shortcuts-grid">
        {#each shortcuts as shortcut}
          <div class="shortcut-row">
            <kbd class="shortcut-key">{shortcut.key}</kbd>
            <span class="shortcut-desc">{shortcut.description}</span>
          </div>
        {/each}
      </div>

      <div class="modal-footer">
        <span class="footer-hint">Press <kbd class="inline-kbd">Esc</kbd> to close</span>
      </div>
    </div>
  </div>
{/if}

<style>
  .shortcuts-overlay {
    position: fixed;
    inset: 0;
    background: var(--color-overlay, rgba(8, 8, 8, 0.56));
    z-index: 200;
    display: flex;
    align-items: center;
    justify-content: center;
    animation: fadeIn 150ms ease;
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  @keyframes slideUp {
    from {
      opacity: 0;
      transform: translateY(8px) scale(0.98);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  .shortcuts-modal {
    background: var(--color-panel, #202225);
    border: 1px solid var(--color-border-subtle, #292c30);
    border-radius: 12px;
    width: 420px;
    max-width: 90vw;
    max-height: 80vh;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    box-shadow: var(--shadow-overlay, 0 20px 56px rgba(0, 0, 0, 0.48));
    animation: slideUp 200ms cubic-bezier(0.4, 0, 0.2, 1);
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid var(--color-border-subtle, #292c30);
  }

  .modal-title {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
    color: var(--color-text-primary, #d4d4d4);
  }

  .modal-close {
    background: none;
    border: none;
    color: var(--color-text-muted, #90918d);
    font-size: 16px;
    cursor: pointer;
    padding: 4px 8px;
    border-radius: 6px;
    line-height: 1;
    transition: background 200ms ease, color 200ms ease;
  }

  .modal-close:hover {
    background: var(--color-surface-hover, #2a2e33);
    color: var(--color-text-primary, #d4d4d4);
  }

  .shortcuts-grid {
    padding: 12px 20px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    overflow-y: auto;
  }

  .shortcut-row {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 8px 0;
  }

  .shortcut-key {
    min-width: 130px;
    display: inline-block;
    padding: 4px 10px;
    background: var(--color-input, #17181a);
    border: 1px solid var(--color-border, #32353a);
    border-radius: 6px;
    font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
    font-size: 12px;
    font-weight: 500;
    color: var(--color-accent, #6c93c7);
    text-align: center;
    white-space: nowrap;
  }

  .shortcut-desc {
    font-size: 13px;
    color: var(--color-text-secondary, #b6b6b2);
  }

  .modal-footer {
    padding: 12px 20px;
    border-top: 1px solid var(--color-border-subtle, #292c30);
    display: flex;
    justify-content: center;
  }

  .footer-hint {
    font-size: 12px;
    color: var(--color-text-faint, #70726f);
  }

  .inline-kbd {
    padding: 1px 6px;
    background: var(--color-input, #17181a);
    border: 1px solid var(--color-border, #32353a);
    border-radius: 4px;
    font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
    font-size: 11px;
    color: var(--color-text-muted, #90918d);
  }
</style>
