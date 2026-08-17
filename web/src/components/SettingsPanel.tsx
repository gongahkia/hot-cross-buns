import type { SyncProgress } from "@/features/useWorkspace";
import type { UndoEntry, WorkspacePreferences } from "@/types";

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
  readonly preferences: WorkspacePreferences;
  readonly undoEntries: readonly UndoEntry[];
  savePreferences(update: Partial<WorkspacePreferences>): Promise<void>;
  undo(): Promise<void>;
  redo(): Promise<void>;
}

export function SettingsPanel({ clientId, status, connected, busy, connect, sync, refreshAllTasks, syncProgress, cancelSync, disconnect, clearLocalData, preferences, undoEntries, savePreferences, undo, redo }: SettingsPanelProps): React.JSX.Element {
  const run = (action: () => Promise<void>): void => { void action().catch(() => undefined); };
  const save = (update: Partial<WorkspacePreferences>): void => run(() => savePreferences(update));
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
      <details className="settings-group" open>
        <summary>Planner preferences</summary>
        <div className="settings-fields">
          <label>Notes projection<select value={preferences.notesProjectionMode} onChange={(event) => save({ notesProjectionMode: event.target.value as WorkspacePreferences["notesProjectionMode"] })}><option value="disabled">Disabled</option><option value="notes-only">Notes only</option><option value="mirrored">Tasks and Notes</option></select></label>
          <label>Conflict policy<select value={preferences.conflictPolicy} onChange={(event) => save({ conflictPolicy: event.target.value as WorkspacePreferences["conflictPolicy"] })}><option value="prefer-google">Prefer Google</option><option value="prefer-local">Prefer Local</option><option value="ask">Ask every time</option></select></label>
          <label>Week starts on<select value={preferences.weekStartsOn} onChange={(event) => save({ weekStartsOn: Number(event.target.value) as 0 | 1 | 6 })}><option value="0">Sunday</option><option value="1">Monday</option><option value="6">Saturday</option></select></label>
          <label>Time format<select value={preferences.hourCycle} onChange={(event) => save({ hourCycle: event.target.value as WorkspacePreferences["hourCycle"] })}><option value="h12">12-hour</option><option value="h23">24-hour</option></select></label>
          <label>Display timezone<input value={preferences.displayTimeZone} onChange={(event) => save({ displayTimeZone: event.target.value })} list="settings-time-zones" /></label>
          <label>Workday starts<input type="number" min="0" max="23" value={preferences.workdayStartHour} onChange={(event) => save({ workdayStartHour: Number(event.target.value) })} /></label>
          <label>Workday ends<input type="number" min="1" max="24" value={preferences.workdayEndHour} onChange={(event) => save({ workdayEndHour: Number(event.target.value) })} /></label>
          <label>Undo retention (days)<input type="number" min="1" max="30" value={preferences.undoRetentionDays} onChange={(event) => save({ undoRetentionDays: Number(event.target.value) })} /></label>
          <label>Undo history limit<input type="number" min="1" max="200" value={preferences.undoMaximumEntries} onChange={(event) => save({ undoMaximumEntries: Number(event.target.value) })} /></label>
          <label>Default event duration (minutes)<input type="number" min="1" max="1440" value={preferences.quickCapture.defaultEventDurationMinutes} onChange={(event) => save({ quickCapture: { ...preferences.quickCapture, defaultEventDurationMinutes: Number(event.target.value) } })} /></label>
        </div>
        <datalist id="settings-time-zones">{(typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [Intl.DateTimeFormat().resolvedOptions().timeZone]).map((zone) => <option key={zone} value={zone} />)}</datalist>
      </details>
      <details className="settings-group">
        <summary>Appearance</summary>
        <div className="settings-fields">
          <label>Appearance<select value={preferences.appearance} onChange={(event) => save({ appearance: event.target.value as WorkspacePreferences["appearance"] })}><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label>
          <label>Density<select value={preferences.density} onChange={(event) => save({ density: event.target.value as WorkspacePreferences["density"] })}><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select></label>
          <label>Accent color<input type="color" value={preferences.accentColor} onChange={(event) => save({ accentColor: event.target.value })} /></label>
          <label>Font<select value={preferences.fontFamily} onChange={(event) => save({ fontFamily: event.target.value as WorkspacePreferences["fontFamily"] })}><option value="system">System</option><option value="serif">Serif</option><option value="monospace">Monospace</option></select></label>
          <label>Font scale<input type="number" min="0.8" max="1.4" step="0.05" value={preferences.fontScale} onChange={(event) => save({ fontScale: Number(event.target.value) })} /></label>
          <label>Task list pane width<input type="number" min="180" max="480" value={preferences.taskListPaneWidth} onChange={(event) => save({ taskListPaneWidth: Number(event.target.value) })} /></label>
        </div>
      </details>
      <section className="undo-controls" aria-label="Undo history"><p className="field-help">{undoEntries.find((entry) => entry.state === "undoable")?.label ?? "No undoable local change"}</p><div className="button-row"><button type="button" disabled={!undoEntries.some((entry) => entry.state === "undoable")} onClick={() => run(undo)}>Undo</button><button type="button" disabled={!undoEntries.some((entry) => entry.state === "redoable")} onClick={() => run(redo)}>Redo</button></div></section>
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
