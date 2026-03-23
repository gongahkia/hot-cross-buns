<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { invoke } from '@tauri-apps/api/core';
  import { exportCsvBackup, exportJsonBackup, chooseImportJsonPayload } from '$lib/services/portability';
  import { loadLists } from '$lib/stores/lists';
  import { loadTags } from '$lib/stores/tags';
  import { loadTasks, taskMutationVersion, tasks } from '$lib/stores/tasks';
  import { currentView, selectedListId, showCompletedTasks } from '$lib/stores/ui';
  import type { SyncConflict, SyncHealth, SyncSettings as SyncSettingsRecord } from '$lib/types';

  let { open = false, onclose }: { open: boolean; onclose: () => void } = $props();

  interface ImportResult {
    lists: number;
    tasks: number;
    tags: number;
  }

  let serverUrl = $state('');
  let authToken = $state('');
  let deviceId = $state('');
  let autoSync = $state(false);
  let syncing = $state(false);
  let syncStatus = $state<string | null>(null);
  let lastSyncedAt = $state<Date | null>(null);
  let syncSummary = $state<{ pushed: number; pulled: number; conflicts: number } | null>(null);
  let settingsLoaded = $state(false);
  let syncHealth = $state<SyncHealth | null>(null);
  let syncConflicts = $state<SyncConflict[]>([]);
  let dataStatus = $state<string | null>(null);
  let dataError = $state<string | null>(null);

  let showMagicLinkForm = $state(false);
  let magicLinkEmail = $state('');
  let magicLinkToken = $state('');
  let magicLinkStep = $state<'email' | 'token'>('email');
  let magicLinkLoading = $state(false);
  let magicLinkMessage = $state<string | null>(null);

  let autoSyncInterval: ReturnType<typeof setInterval> | undefined = undefined;

  function applySettings(settings: SyncSettingsRecord) {
    serverUrl = settings.serverUrl;
    authToken = settings.authToken;
    deviceId = settings.deviceId;
    autoSync = settings.autoSyncEnabled;
    lastSyncedAt = settings.lastSyncedAt ? new Date(settings.lastSyncedAt) : null;
  }

  async function refreshSyncDiagnostics() {
    const [health, conflicts] = await Promise.all([
      invoke<SyncHealth>('get_sync_health'),
      invoke<SyncConflict[]>('list_sync_conflicts'),
    ]);

    syncHealth = health;
    syncConflicts = conflicts;
  }

  async function loadSavedSettings() {
    try {
      const settings = await invoke<SyncSettingsRecord>('get_sync_settings');
      applySettings(settings);
      await refreshSyncDiagnostics();
      if (settings.autoSyncEnabled) {
        startAutoSync();
      }
    } catch (err: unknown) {
      syncStatus = err instanceof Error ? err.message : String(err);
    } finally {
      settingsLoaded = true;
    }
  }

  async function persistSettings() {
    if (!settingsLoaded) return;

    const saved = await invoke<SyncSettingsRecord>('save_sync_settings', {
      serverUrl: serverUrl.trim(),
      authToken: authToken.trim(),
      deviceId,
      autoSyncEnabled: autoSync,
      lastSyncedAt: lastSyncedAt ? lastSyncedAt.toISOString() : null,
    });

    applySettings(saved);
  }

  onMount(() => {
    void loadSavedSettings();

    return () => {
      stopAutoSync();
    };
  });

  let lastSyncedLabel = $derived.by(() => {
    if (!lastSyncedAt) return null;
    const seconds = Math.floor((Date.now() - lastSyncedAt.getTime()) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ago`;
  });

  async function handleAutoSyncToggle() {
    autoSync = !autoSync;
    if (autoSync) {
      startAutoSync();
    } else {
      stopAutoSync();
    }

    try {
      await persistSettings();
    } catch (err: unknown) {
      syncStatus = err instanceof Error ? err.message : String(err);
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
      await persistSettings();
      const result = await invoke<{ pushed: number; pulled: number; conflicts: number }>('sync_now');
      syncSummary = result;
      const saved = await invoke<SyncSettingsRecord>('get_sync_settings');
      applySettings(saved);
      await refreshSyncDiagnostics();
      syncStatus = 'success';
    } catch (err: unknown) {
      syncStatus = err instanceof Error ? err.message : String(err);
      await refreshSyncDiagnostics().catch(() => undefined);
    } finally {
      syncing = false;
    }
  }

  async function refreshImportedWorkspace() {
    const loadedLists = await loadLists();
    await loadTags();

    const defaultList = loadedLists.find((list) => list.isInbox) ?? loadedLists[0] ?? null;
    currentView.set('list');
    selectedListId.set(defaultList?.id ?? null);

    if (defaultList) {
      await loadTasks(defaultList.id, get(showCompletedTasks));
    } else {
      tasks.set([]);
    }

    taskMutationVersion.update((value) => value + 1);
  }

  async function handleExportJson() {
    dataStatus = null;
    dataError = null;

    try {
      const target = await exportJsonBackup();
      if (target) {
        dataStatus = `Saved JSON backup to ${target}`;
      }
    } catch (err: unknown) {
      dataError = err instanceof Error ? err.message : String(err);
    }
  }

  async function handleExportCsv() {
    dataStatus = null;
    dataError = null;

    try {
      const target = await exportCsvBackup();
      if (target) {
        dataStatus = `Saved CSV export to ${target}`;
      }
    } catch (err: unknown) {
      dataError = err instanceof Error ? err.message : String(err);
    }
  }

  async function handleImportJson() {
    dataStatus = null;
    dataError = null;

    try {
      const payload = await chooseImportJsonPayload();
      if (!payload) {
        return;
      }

      const result = await invoke<ImportResult>('import_data', { jsonData: payload });
      await refreshImportedWorkspace();
      await refreshSyncDiagnostics();
      dataStatus = `Imported ${result.lists} lists, ${result.tasks} tasks, and ${result.tags} tags.`;
    } catch (err: unknown) {
      dataError = err instanceof Error ? err.message : String(err);
    }
  }

  function prettyConflictValue(raw: string): string {
    try {
      return JSON.stringify(JSON.parse(raw), null, 2);
    } catch {
      return raw;
    }
  }

  function conflictLabel(conflict: SyncConflict): string {
    return `${conflict.entityType}.${conflict.fieldName}`;
  }

  async function resolveConflict(conflict: SyncConflict, resolution: 'keep_local' | 'apply_remote') {
    await invoke('resolve_sync_conflict', {
      entityType: conflict.entityType,
      entityId: conflict.entityId,
      fieldName: conflict.fieldName,
      resolution,
    });
    await refreshSyncDiagnostics();
  }

  async function dismissConflict(conflict: SyncConflict) {
    await invoke('dismiss_sync_conflict', {
      entityType: conflict.entityType,
      entityId: conflict.entityId,
      fieldName: conflict.fieldName,
    });
    await refreshSyncDiagnostics();
  }

  function handleMagicLink() {
    showMagicLinkForm = !showMagicLinkForm;
    magicLinkStep = 'email';
    magicLinkEmail = '';
    magicLinkToken = '';
    magicLinkMessage = null;
    magicLinkLoading = false;
  }

  async function submitMagicLinkEmail() {
    if (!magicLinkEmail.trim() || !serverUrl.trim()) {
      magicLinkMessage = 'Please enter both a server URL and email address.';
      return;
    }

    magicLinkLoading = true;
    magicLinkMessage = null;

    try {
      const res = await fetch(`${serverUrl}/api/v1/auth/magic-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: magicLinkEmail.trim() }),
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(body || `Server responded with ${res.status}`);
      }

      magicLinkMessage = 'Check your email for a magic link.';
      magicLinkStep = 'token';
    } catch (err: unknown) {
      magicLinkMessage = err instanceof Error ? err.message : String(err);
    } finally {
      magicLinkLoading = false;
    }
  }

  async function submitMagicLinkToken() {
    if (!magicLinkToken.trim()) {
      magicLinkMessage = 'Please paste the token from your email.';
      return;
    }

    magicLinkLoading = true;
    magicLinkMessage = null;

    try {
      const res = await fetch(`${serverUrl}/api/v1/auth/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: magicLinkToken.trim() }),
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(body || `Verification failed with ${res.status}`);
      }

      const data = await res.json();
      authToken = data.jwt ?? data.token ?? '';
      await persistSettings();
      magicLinkMessage = null;
      showMagicLinkForm = false;
      magicLinkStep = 'email';
      magicLinkEmail = '';
      magicLinkToken = '';
      syncStatus = 'success';
    } catch (err: unknown) {
      magicLinkMessage = err instanceof Error ? err.message : String(err);
    } finally {
      magicLinkLoading = false;
    }
  }

  function handleMagicLinkEmailKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      submitMagicLinkEmail();
    }
  }

  function handleMagicLinkTokenKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      submitMagicLinkToken();
    }
  }

  function handleOverlayClick(e: MouseEvent) {
    if (e.target === e.currentTarget) {
      handleClose();
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      handleClose();
    }
  }

  function handleServerUrlBlur() {
    void persistSettings().catch((err: unknown) => {
      syncStatus = err instanceof Error ? err.message : String(err);
    });
  }

  function handleAuthTokenBlur() {
    void persistSettings().catch((err: unknown) => {
      syncStatus = err instanceof Error ? err.message : String(err);
    });
  }

  function handleClose() {
    void persistSettings().catch((err: unknown) => {
      syncStatus = err instanceof Error ? err.message : String(err);
    });
    onclose();
  }
</script>

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="sync-overlay" onclick={handleOverlayClick} onkeydown={handleKeydown}>
    <div class="sync-panel" role="dialog" aria-label="Sync Settings">
      <div class="panel-header">
        <h2 class="panel-title">Sync Settings</h2>
        <button class="panel-close" onclick={handleClose} aria-label="Close">
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
            onblur={handleServerUrlBlur}
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
            onblur={handleAuthTokenBlur}
          />
          <button class="magic-link-btn" onclick={handleMagicLink}>
            {showMagicLinkForm ? 'Cancel Magic Link' : 'Login with Magic Link'}
          </button>

          {#if showMagicLinkForm}
            <div class="magic-link-form">
              {#if magicLinkStep === 'email'}
                <input
                  class="field-input magic-link-input"
                  type="email"
                  placeholder="you@example.com"
                  bind:value={magicLinkEmail}
                  onkeydown={handleMagicLinkEmailKeydown}
                  disabled={magicLinkLoading}
                />
                <button
                  class="magic-link-submit"
                  onclick={submitMagicLinkEmail}
                  disabled={magicLinkLoading}
                >
                  {#if magicLinkLoading}
                    Sending...
                  {:else}
                    Send Magic Link
                  {/if}
                </button>
              {:else}
                <input
                  class="field-input magic-link-input"
                  type="text"
                  placeholder="Paste token from email..."
                  bind:value={magicLinkToken}
                  onkeydown={handleMagicLinkTokenKeydown}
                  disabled={magicLinkLoading}
                />
                <button
                  class="magic-link-submit"
                  onclick={submitMagicLinkToken}
                  disabled={magicLinkLoading}
                >
                  {#if magicLinkLoading}
                    Verifying...
                  {:else}
                    Verify Token
                  {/if}
                </button>
              {/if}

              {#if magicLinkMessage}
                <div class="magic-link-message">{magicLinkMessage}</div>
              {/if}
            </div>
          {/if}
        </div>

        <div class="field">
          <label class="field-label" for="sync-device-id">Device ID</label>
          <input
            id="sync-device-id"
            class="field-input"
            type="text"
            value={deviceId}
            readonly
          />
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

        <div class="health-card">
          <div class="health-title">Sync Health</div>
          <div class="health-grid">
            <div class="health-metric">
              <span class="health-label">Pending changes</span>
              <strong>{syncHealth?.pendingChanges ?? 0}</strong>
            </div>
            <div class="health-metric">
              <span class="health-label">Open conflicts</span>
              <strong>{syncHealth?.conflictCount ?? 0}</strong>
            </div>
          </div>
          {#if syncHealth?.lastSyncError}
            <div class="sync-error">{syncHealth.lastSyncError}</div>
          {/if}
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

        <div class="portability-card">
          <div class="health-title">Portability</div>
          <div class="portability-actions">
            <button class="secondary-btn" onclick={handleExportJson}>Export JSON</button>
            <button class="secondary-btn" onclick={handleExportCsv}>Export CSV</button>
            <button class="secondary-btn" onclick={handleImportJson}>Import JSON</button>
          </div>
          <p class="field-hint">
            JSON is the full-fidelity backup format. CSV exports active tasks for interoperability.
          </p>
          {#if dataStatus}
            <div class="sync-summary">{dataStatus}</div>
          {/if}
          {#if dataError}
            <div class="sync-error">{dataError}</div>
          {/if}
        </div>

        {#if syncConflicts.length > 0}
          <div class="conflicts-card">
            <div class="health-title">Conflict Review</div>
            {#each syncConflicts as conflict (`${conflict.entityType}:${conflict.entityId}:${conflict.fieldName}`)}
              <div class="conflict-item">
                <div class="conflict-header">
                  <strong>{conflictLabel(conflict)}</strong>
                  <span class="conflict-meta">{conflict.entityId}</span>
                </div>
                <div class="conflict-columns">
                  <div class="conflict-column">
                    <span class="health-label">Local</span>
                    <pre>{prettyConflictValue(conflict.localValue)}</pre>
                  </div>
                  <div class="conflict-column">
                    <span class="health-label">Remote</span>
                    <pre>{prettyConflictValue(conflict.remoteValue)}</pre>
                  </div>
                </div>
                <div class="conflict-actions">
                  <button class="secondary-btn" onclick={() => resolveConflict(conflict, 'keep_local')}>
                    Keep Local
                  </button>
                  <button class="secondary-btn" onclick={() => resolveConflict(conflict, 'apply_remote')}>
                    Apply Remote
                  </button>
                  <button class="ghost-btn" onclick={() => dismissConflict(conflict)}>
                    Dismiss
                  </button>
                </div>
              </div>
            {/each}
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

  .sync-panel {
    background: var(--color-panel, #202225);
    border: 1px solid var(--color-border-subtle, #292c30);
    border-radius: 12px;
    width: 400px;
    max-width: 90vw;
    max-height: 80vh;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    box-shadow: var(--shadow-overlay, 0 20px 56px rgba(0, 0, 0, 0.48));
    animation: slideUp 200ms cubic-bezier(0.4, 0, 0.2, 1);
  }

  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid var(--color-border-subtle, #292c30);
  }

  .panel-title {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
    color: var(--color-text-primary, #d4d4d4);
  }

  .panel-close {
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

  .panel-close:hover {
    background: var(--color-surface-hover, #2a2e33);
    color: var(--color-text-primary, #d4d4d4);
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
    color: var(--color-text-muted, #90918d);
  }

  .field-input {
    width: 100%;
    padding: 8px 10px;
    border-radius: 8px;
    border: 1px solid var(--color-border, #32353a);
    background: var(--color-input, #17181a);
    color: var(--color-text-primary, #d4d4d4);
    font-size: 13px;
    font-family: inherit;
    outline: none;
    box-sizing: border-box;
    transition: border-color 200ms ease, box-shadow 200ms ease;
  }

  .field-input:focus {
    border-color: var(--color-accent, #6c93c7);
    box-shadow: 0 0 0 3px var(--color-accent-soft, rgba(108, 147, 199, 0.16));
  }

  .field-input::placeholder {
    color: var(--color-text-muted, #90918d);
  }

  .field-hint {
    margin: 0;
    font-size: 12px;
    color: var(--color-text-muted, #90918d);
    line-height: 1.4;
  }

  .health-card,
  .portability-card,
  .conflicts-card {
    border: 1px solid var(--color-border-subtle, #292c30);
    border-radius: 10px;
    padding: 12px;
    background: var(--color-bg-secondary, #1f2124);
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .health-title {
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.5px;
    text-transform: uppercase;
    color: var(--color-text-secondary, #b6b6b2);
  }

  .health-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }

  .health-metric {
    padding: 10px;
    border-radius: 8px;
    background: var(--color-bg-tertiary, #151618);
    border: 1px solid var(--color-border-subtle, #292c30);
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .health-metric strong {
    font-size: 18px;
    color: var(--color-text-primary, #d4d4d4);
  }

  .health-label {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    color: var(--color-text-muted, #90918d);
  }

  .portability-actions,
  .conflict-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .secondary-btn,
  .ghost-btn {
    border-radius: 8px;
    border: 1px solid var(--color-border, #32353a);
    background: var(--color-input, #17181a);
    color: var(--color-text-primary, #d4d4d4);
    font-size: 12px;
    font-family: inherit;
    padding: 8px 12px;
    cursor: pointer;
  }

  .secondary-btn:hover,
  .ghost-btn:hover {
    background: var(--color-surface-hover, #2a2e33);
  }

  .ghost-btn {
    color: var(--color-text-muted, #90918d);
  }

  .conflict-item {
    border: 1px solid var(--color-border-subtle, #292c30);
    border-radius: 8px;
    background: var(--color-bg-tertiary, #151618);
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .conflict-header {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    align-items: baseline;
    color: var(--color-text-primary, #d4d4d4);
  }

  .conflict-meta {
    font-size: 11px;
    color: var(--color-text-muted, #90918d);
  }

  .conflict-columns {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }

  .conflict-column {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .conflict-column pre {
    margin: 0;
    padding: 8px;
    border-radius: 8px;
    background: var(--color-panel, #202225);
    border: 1px solid var(--color-border-subtle, #292c30);
    color: var(--color-text-primary, #d4d4d4);
    font-size: 11px;
    overflow: auto;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .magic-link-btn {
    background: none;
    border: none;
    color: var(--color-accent, #6c93c7);
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
    color: var(--color-accent-hover, #7ca2d5);
  }

  .magic-link-form {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 4px;
    padding: 10px;
    background: var(--color-panel, #202225);
    border: 1px solid var(--color-border-subtle, #292c30);
    border-radius: 8px;
  }

  .magic-link-input {
    font-size: 13px;
  }

  .magic-link-submit {
    padding: 8px 12px;
    border-radius: 8px;
    border: none;
    background: var(--color-accent, #6c93c7);
    color: var(--color-on-accent, #f7f7f5);
    font-size: 12px;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    transition: background 200ms ease, opacity 200ms ease;
  }

  .magic-link-submit:hover:not(:disabled) {
    background: var(--color-accent-hover, #7ca2d5);
  }

  .magic-link-submit:disabled {
    opacity: 0.7;
    cursor: not-allowed;
  }

  .magic-link-message {
    font-size: 12px;
    color: var(--color-text-muted, #90918d);
    text-align: center;
    padding: 4px 0;
  }

  /* Toggle switch */
  .toggle-btn {
    position: relative;
    width: 40px;
    height: 22px;
    border-radius: 11px;
    border: none;
    background: var(--color-surface-1, #2d3136);
    cursor: pointer;
    padding: 0;
    flex-shrink: 0;
    transition: background 200ms ease;
  }

  .toggle-btn.toggle-on {
    background: var(--color-accent, #6c93c7);
  }

  .toggle-knob {
    position: absolute;
    top: 3px;
    left: 3px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--color-on-accent, #f7f7f5);
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
    background: var(--color-accent, #6c93c7);
    color: var(--color-on-accent, #f7f7f5);
    font-size: 13px;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    transition: background 200ms ease, opacity 200ms ease;
  }

  .sync-now-btn:hover:not(:disabled) {
    background: var(--color-accent-hover, #7ca2d5);
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
    border-top-color: var(--color-on-accent, #f7f7f5);
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
    color: var(--color-text-faint, #70726f);
    text-align: center;
  }

  .sync-summary {
    font-size: 12px;
    color: var(--color-success, #2d9964);
    text-align: center;
    padding: 8px 12px;
    background: color-mix(in srgb, var(--color-success, #2d9964) 12%, transparent);
    border-radius: 6px;
  }

  .sync-error {
    font-size: 12px;
    color: var(--color-danger, #cd4945);
    text-align: center;
    padding: 8px 12px;
    background: color-mix(in srgb, var(--color-danger, #cd4945) 12%, transparent);
    border-radius: 6px;
  }
</style>
