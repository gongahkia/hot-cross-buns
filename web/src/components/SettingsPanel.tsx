import type { SyncProgress } from "@/features/useWorkspace";

interface SettingsPanelProps {
  readonly clientId: string;
  readonly status: string;
  readonly connected: boolean;
  readonly busy: boolean;
  connect(): Promise<void>;
  sync(): Promise<void>;
  refreshAllTasks(): Promise<void>;
  readonly syncProgress: SyncProgress;
  cancelSync(): void;
  disconnect(): Promise<void>;
  clearLocalData(): Promise<void>;
}

export function SettingsPanel({ clientId, status, connected, busy, connect, sync, refreshAllTasks, syncProgress, cancelSync, disconnect, clearLocalData }: SettingsPanelProps): React.JSX.Element {
  const run = (action: () => Promise<void>): void => { void action().catch(() => undefined); };
  return (
    <section className="workspace-panel settings-panel" aria-labelledby="settings-heading">
      <p className="eyebrow">local privacy controls</p>
      <h2 id="settings-heading">Settings</h2>
      <dl>
        <div><dt>OAuth client ID</dt><dd>{clientId || "Not configured"}</dd></div>
        <div><dt>Authorization</dt><dd>{connected ? "Active in this browser session" : "Not active"}</dd></div>
        <div><dt>Stored by Hot Cross Buns</dt><dd>Only browser-local cached data and this non-secret client ID.</dd></div>
        <div><dt>Calendar synchronization</dt><dd>Google Calendar uses browser-local sync tokens. Google Tasks uses timestamp-based changes because its API has no sync-token endpoint.</dd></div>
        <div><dt>Keyboard</dt><dd><kbd>⌘/Ctrl K</kbd> opens cached search and commands. Use ↑ ↓ and Enter inside the palette.</dd></div>
      </dl>
      <p className="status" aria-live="polite">{status}</p>
      {syncProgress.storage?.usage !== undefined && syncProgress.storage.quota !== undefined && <p className="field-help">Browser storage estimate: {(syncProgress.storage.usage / (1024 * 1024)).toFixed(1)} MiB used of {(syncProgress.storage.quota / (1024 * 1024)).toFixed(1)} MiB available.</p>}
      <div className="button-row">
        <button type="button" disabled={busy || !clientId} onClick={() => run(connect)}>{connected ? "Reconnect Google" : "Connect Google"}</button>
        <button type="button" disabled={busy || !connected} onClick={() => run(sync)}>Sync now</button>
        <button type="button" disabled={busy || !connected} onClick={() => run(refreshAllTasks)}>Refresh all Tasks from Google</button>
        {syncProgress.cancellable && <button type="button" onClick={cancelSync}>Cancel sync</button>}
        <button type="button" disabled={busy || !connected} onClick={() => run(disconnect)}>Disconnect Google</button>
        <button className="danger-button" type="button" disabled={busy} onClick={() => run(clearLocalData)}>Clear browser-local data</button>
      </div>
    </section>
  );
}
