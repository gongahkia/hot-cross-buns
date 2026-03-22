<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';

  let { open = false, onclose }: { open: boolean; onclose: () => void } = $props();

  let serverUrl = $state('');
  let authToken = $state('');
  let autoSync = $state(false);
  let syncing = $state(false);
  let syncStatus = $state<string | null>(null);
  let lastSyncedAt = $state<Date | null>(null);
  let syncSummary = $state<{ pushed: number; pulled: number; conflicts: number } | null>(null);

  let autoSyncInterval: ReturnType<typeof setInterval> | undefined = undefined;

  let lastSyncedLabel = $derived.by(() => {
    if (!lastSyncedAt) return null;
    const seconds = Math.floor((Date.now() - lastSyncedAt.getTime()) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ago`;
  });

  function handleAutoSyncToggle() {
    autoSync = !autoSync;
    if (autoSync) {
      startAutoSync();
    } else {
      stopAutoSync();
    }
  }

  function startAutoSync() {
    stopAutoSync();
    autoSyncInterval = setInterval(() => {
      if (!syncing) {
        doSync();
      }
    }, 60_000);
  }

  function stopAutoSync() {
    if (autoSyncInterval !== undefined) {
      clearInterval(autoSyncInterval);
      autoSyncInterval = undefined;
    }
  }

  async function doSync() {
    if (syncing) return;
    syncing = true;
    syncStatus = null;
    syncSummary = null;

    try {
      const result = await invoke<{ pushed: number; pulled: number; conflicts: number }>('sync_now', {
        serverUrl,
        authToken,
      });
      syncSummary = result;
      lastSyncedAt = new Date();
      syncStatus = 'success';
    } catch (err: unknown) {
      syncStatus = err instanceof Error ? err.message : String(err);
    } finally {
      syncing = false;
    }
  }

  function handleMagicLink() {
    // Placeholder for magic link login flow
    syncStatus = 'Magic link login is not yet implemented.';
  }

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
  <div class="sync-overlay" onclick={handleOverlayClick} onkeydown={handleKeydown}>
    <div class="sync-panel" role="dialog" aria-label="Sync Settings">
      <div class="panel-header">
        <h2 class="panel-title">Sync Settings</h2>
        <button class="panel-close" onclick={onclose} aria-label="Close">
          &#x2715;
        </button>
      </div>

      <div class="panel-body">
        <div class="field">
          <label class="field-label" for="sync-server-url">Server URL</label>
          <input
            id="sync-server-url"
            class="field-input"
            type="text"
            placeholder="https://api.example.com/sync"
            bind:value={serverUrl}
          />
        </div>

        <div class="field">
          <label class="field-label" for="sync-auth-token">Auth Token</label>
          <input
            id="sync-auth-token"
            class="field-input"
            type="password"
            placeholder="Paste your auth token..."
            bind:value={authToken}
          />
          <button class="magic-link-btn" onclick={handleMagicLink}>
            Login with Magic Link
          </button>
        </div>

        <div class="field field-row">
          <span class="field-label">Auto Sync (every 60s)</span>
          <button
            class="toggle-btn"
            class:toggle-on={autoSync}
            onclick={handleAutoSyncToggle}
            aria-pressed={autoSync}
            aria-label="Toggle auto sync"
          >
            <span class="toggle-knob"></span>
          </button>
        </div>

        <div class="sync-actions">
          <button class="sync-now-btn" onclick={doSync} disabled={syncing}>
            {#if syncing}
              <span class="spinner"></span>
              Syncing...
            {:else}
              Sync Now
            {/if}
          </button>
        </div>

        {#if lastSyncedLabel}
          <div class="last-synced">
            Last synced: {lastSyncedLabel}
          </div>
        {/if}

        {#if syncSummary}
          <div class="sync-summary">
            Pushed {syncSummary.pushed}, Pulled {syncSummary.pulled}, Conflicts {syncSummary.conflicts}
          </div>
        {/if}

        {#if syncStatus && syncStatus !== 'success'}
          <div class="sync-error">
            {syncStatus}
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .sync-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
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

  .sync-panel {
    background: #1e1e2e;
    border: 1px solid #313244;
    border-radius: 12px;
    width: 400px;
    max-width: 90vw;
    max-height: 80vh;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5);
    animation: slideUp 200ms cubic-bezier(0.4, 0, 0.2, 1);
  }

  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid #313244;
  }

  .panel-title {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
    color: #cdd6f4;
  }

  .panel-close {
    background: none;
    border: none;
    color: #a6adc8;
    font-size: 16px;
    cursor: pointer;
    padding: 4px 8px;
    border-radius: 6px;
    line-height: 1;
    transition: background 200ms ease, color 200ms ease;
  }

  .panel-close:hover {
    background: #313244;
    color: #cdd6f4;
  }

  .panel-body {
    padding: 16px 20px;
    display: flex;
    flex-direction: column;
    gap: 16px;
    overflow-y: auto;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .field-row {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
  }

  .field-label {
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: #a6adc8;
  }

  .field-input {
    width: 100%;
    padding: 8px 10px;
    border-radius: 8px;
    border: 1px solid #313244;
    background: #181825;
    color: #cdd6f4;
    font-size: 13px;
    font-family: inherit;
    outline: none;
    box-sizing: border-box;
    transition: border-color 200ms ease;
  }

  .field-input:focus {
    border-color: #89b4fa;
  }

  .field-input::placeholder {
    color: #6c7086;
  }

  .magic-link-btn {
    background: none;
    border: none;
    color: #89b4fa;
    font-size: 12px;
    cursor: pointer;
    padding: 0;
    text-align: left;
    font-family: inherit;
    text-decoration: underline;
    text-underline-offset: 2px;
    transition: color 200ms ease;
  }

  .magic-link-btn:hover {
    color: #b4d0fb;
  }

  /* Toggle switch */
  .toggle-btn {
    position: relative;
    width: 40px;
    height: 22px;
    border-radius: 11px;
    border: none;
    background: #45475a;
    cursor: pointer;
    padding: 0;
    flex-shrink: 0;
    transition: background 200ms ease;
  }

  .toggle-btn.toggle-on {
    background: #89b4fa;
  }

  .toggle-knob {
    position: absolute;
    top: 3px;
    left: 3px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: #cdd6f4;
    transition: transform 200ms ease;
    pointer-events: none;
  }

  .toggle-btn.toggle-on .toggle-knob {
    transform: translateX(18px);
  }

  /* Sync Now button */
  .sync-actions {
    display: flex;
  }

  .sync-now-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    width: 100%;
    padding: 10px 16px;
    border-radius: 8px;
    border: none;
    background: #cba6f7;
    color: #1e1e2e;
    font-size: 13px;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    transition: background 200ms ease, opacity 200ms ease;
  }

  .sync-now-btn:hover:not(:disabled) {
    background: #b490e0;
  }

  .sync-now-btn:disabled {
    opacity: 0.7;
    cursor: not-allowed;
  }

  /* Spinner */
  .spinner {
    width: 14px;
    height: 14px;
    border: 2px solid transparent;
    border-top-color: #1e1e2e;
    border-radius: 50%;
    animation: spin 600ms linear infinite;
    flex-shrink: 0;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  /* Status messages */
  .last-synced {
    font-size: 12px;
    color: #6c7086;
    text-align: center;
  }

  .sync-summary {
    font-size: 12px;
    color: #a6e3a1;
    text-align: center;
    padding: 8px 12px;
    background: rgba(166, 227, 161, 0.08);
    border-radius: 6px;
  }

  .sync-error {
    font-size: 12px;
    color: #f38ba8;
    text-align: center;
    padding: 8px 12px;
    background: rgba(243, 139, 168, 0.08);
    border-radius: 6px;
  }
</style>
