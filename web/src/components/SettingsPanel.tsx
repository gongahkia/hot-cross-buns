import { useState } from "react";

import { bindingFromKeyboardEvent, formatBinding, keybindingLabels } from "@/features/keybindings";
import type { SyncProgress } from "@/features/useWorkspace";
import type { ConnectionProfile, GoogleCalendar, GoogleTaskList, UndoEntry, WorkspaceConflict, WorkspaceKeybindings, WorkspacePreferences } from "@/types";

interface SettingsPanelProps {
  readonly clientId: string;
  readonly connectionProfile: ConnectionProfile;
  readonly managedConnectionAvailable: boolean;
  readonly status: string;
  readonly connected: boolean;
  readonly busy: boolean;
  connect(): Promise<void>;
  connectManaged(): Promise<void>;
  useDirectConnection(): Promise<void>;
  sync(): Promise<void>;
  refreshAllTasks(): Promise<void>;
  readonly syncProgress: SyncProgress;
  cancelSync(): void;
  disconnect(): Promise<void>;
  clearLocalData(): Promise<void>;
  readonly preferences: WorkspacePreferences;
  readonly undoEntries: readonly UndoEntry[];
  readonly conflicts: readonly WorkspaceConflict[];
  readonly taskLists: readonly GoogleTaskList[];
  readonly calendars: readonly GoogleCalendar[];
  savePreferences(update: Partial<WorkspacePreferences>): Promise<void>;
  undo(): Promise<void>;
  redo(): Promise<void>;
  dismissConflict(id: string): Promise<void>;
  openImport(): void;
  openDiagnostics(): void;
  requestNotifications(): Promise<void>;
}

function KeybindingField({ binding, value, save }: { readonly binding: keyof WorkspaceKeybindings; readonly value: string; save(value: string): void }): React.JSX.Element {
  const [capturing, setCapturing] = useState(false);
  return <label className="keybinding-field"><span>{keybindingLabels[binding]}</span><button type="button" className={capturing ? "keybinding-capture active" : "keybinding-capture"} onClick={() => setCapturing(true)} onKeyDown={(event) => {
    if (!capturing) return;
    const captured = bindingFromKeyboardEvent(event);
    if (!captured) return;
    event.preventDefault();
    event.stopPropagation();
    save(captured);
    setCapturing(false);
  }} onBlur={() => setCapturing(false)}>{capturing ? "Press shortcut…" : <kbd>{formatBinding(value)}</kbd>}</button></label>;
}

export function SettingsPanel({ clientId, connectionProfile, managedConnectionAvailable, status, connected, busy, connect, connectManaged, useDirectConnection, sync, refreshAllTasks, syncProgress, cancelSync, disconnect, clearLocalData, preferences, undoEntries, conflicts, taskLists, calendars, savePreferences, undo, redo, dismissConflict, openImport, openDiagnostics, requestNotifications }: SettingsPanelProps): React.JSX.Element {
  const [filter, setFilter] = useState("");
  const run = (action: () => Promise<void>): void => { void action().catch(() => undefined); };
  const save = (update: Partial<WorkspacePreferences>): void => run(() => savePreferences(update));
  const matches = (terms: string): boolean => !filter.trim() || terms.toLocaleLowerCase().includes(filter.trim().toLocaleLowerCase());
  const managed = connectionProfile.mode === "managed";
  const canConnect = managed || Boolean(clientId);
  return (
    <section className="workspace-panel settings-panel" aria-labelledby="settings-heading">
      <p className="eyebrow">connection and local privacy controls</p>
      <h2 id="settings-heading">Settings</h2>
      <dl>
        <div><dt>Connection model</dt><dd>{managed ? "Managed server connection" : "Direct browser connection"}</dd></div>
        <div><dt>OAuth client ID</dt><dd>{managed ? "Configured on the managed service" : clientId || "Not configured"}</dd></div>
        <div><dt>Authorization</dt><dd>{connected ? managed ? "Active through the managed service" : "Active in this browser session" : "Not active"}</dd></div>
        <div><dt>Stored by Hot Cross Buns</dt><dd>{managed ? "Browser-local cache plus an encrypted Google refresh token and opaque session on the configured managed service." : "Only browser-local cached data and this non-secret client ID."}</dd></div>
        <div><dt>Calendar synchronization</dt><dd>Google Calendar uses browser-local sync tokens. Google Tasks uses timestamp-based changes because its API has no sync-token endpoint.</dd></div>
        <div><dt>Keyboard</dt><dd><kbd>{formatBinding(preferences.keybindings.commandPalette)}</kbd> opens cached search and commands. Workspace shortcuts are configurable below; use ↑ ↓ and Enter inside the palette.</dd></div>
      </dl>
      <p className="status" aria-live="polite">{status}</p>
      <label className="settings-search"><span>Search settings</span><input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Search appearance, sync, shortcuts, import…" /></label>
      {matches("planner notes conflict week time timezone workday undo quick capture aliases task list calendar") && <details className="settings-group" open>
        <summary>Planner preferences</summary>
        <div className="settings-fields">
          <label>Conflict policy<select value={preferences.conflictPolicy} onChange={(event) => save({ conflictPolicy: event.target.value as WorkspacePreferences["conflictPolicy"] })}><option value="prefer-google">Prefer Google</option><option value="prefer-local">Prefer Local</option><option value="ask">Ask every time</option></select></label>
          <label>Week starts on<select value={preferences.weekStartsOn} onChange={(event) => save({ weekStartsOn: Number(event.target.value) as 0 | 1 | 6 })}><option value="0">Sunday</option><option value="1">Monday</option><option value="6">Saturday</option></select></label>
          <label>Time format<select value={preferences.hourCycle} onChange={(event) => save({ hourCycle: event.target.value as WorkspacePreferences["hourCycle"] })}><option value="h12">12-hour</option><option value="h23">24-hour</option></select></label>
          <label>Display timezone<input value={preferences.displayTimeZone} onChange={(event) => save({ displayTimeZone: event.target.value })} list="settings-time-zones" /></label>
          <label>Workday starts<input type="number" min="0" max="23" value={preferences.workdayStartHour} onChange={(event) => save({ workdayStartHour: Number(event.target.value) })} /></label>
          <label>Workday ends<input type="number" min="1" max="24" value={preferences.workdayEndHour} onChange={(event) => save({ workdayEndHour: Number(event.target.value) })} /></label>
          <label>Undo retention (days)<input type="number" min="1" max="30" value={preferences.undoRetentionDays} onChange={(event) => save({ undoRetentionDays: Number(event.target.value) })} /></label>
          <label>Undo history limit<input type="number" min="1" max="200" value={preferences.undoMaximumEntries} onChange={(event) => save({ undoMaximumEntries: Number(event.target.value) })} /></label>
          <label>Default event duration (minutes)<input type="number" min="1" max="1440" value={preferences.quickCapture.defaultEventDurationMinutes} onChange={(event) => save({ quickCapture: { ...preferences.quickCapture, defaultEventDurationMinutes: Number(event.target.value) } })} /></label>
          <label>Quick-capture task list<select value={preferences.quickCapture.defaultTaskListId ?? ""} onChange={(event) => save({ quickCapture: { ...preferences.quickCapture, defaultTaskListId: event.target.value || undefined } })}><option value="">First available list</option>{taskLists.map((list) => <option key={list.id} value={list.id}>{list.title}</option>)}</select></label>
          <label>Quick-capture calendar<select value={preferences.quickCapture.defaultCalendarId ?? ""} onChange={(event) => save({ quickCapture: { ...preferences.quickCapture, defaultCalendarId: event.target.value || undefined } })}><option value="">Primary / first available calendar</option>{calendars.map((calendar) => <option key={calendar.id} value={calendar.id}>{calendar.summary}</option>)}</select></label>
          <label className="check-label"><input type="checkbox" checked={preferences.quickCapture.removeRecognizedText} onChange={(event) => save({ quickCapture: { ...preferences.quickCapture, removeRecognizedText: event.target.checked } })} /> Remove recognized capture tokens from the title</label>
          <label>Task aliases (comma-separated)<input value={preferences.quickCapture.taskAliases.join(", ")} onChange={(event) => save({ quickCapture: { ...preferences.quickCapture, taskAliases: event.target.value.split(",").map((value) => value.trim()).filter(Boolean) } })} /></label>
          <label>Event aliases (comma-separated)<input value={preferences.quickCapture.eventAliases.join(", ")} onChange={(event) => save({ quickCapture: { ...preferences.quickCapture, eventAliases: event.target.value.split(",").map((value) => value.trim()).filter(Boolean) } })} /></label>
          <label>Priority aliases high / medium / low<input value={`${preferences.quickCapture.highPriorityAliases.join(",")}; ${preferences.quickCapture.mediumPriorityAliases.join(",")}; ${preferences.quickCapture.lowPriorityAliases.join(",")}`} onChange={(event) => { const [high = "", medium = "", low = ""] = event.target.value.split(";"); const list = (value: string) => value.split(",").map((entry) => entry.trim()).filter(Boolean); save({ quickCapture: { ...preferences.quickCapture, highPriorityAliases: list(high), mediumPriorityAliases: list(medium), lowPriorityAliases: list(low) } }); }} /></label>
        </div>
        <datalist id="settings-time-zones">{(typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [Intl.DateTimeFormat().resolvedOptions().timeZone]).map((zone) => <option key={zone} value={zone} />)}</datalist>
      </details>}
      {matches("appearance light dark monochrome density accent color font local google stylesheet scale task list pane") && <details className="settings-group" open={Boolean(filter)}>
        <summary>Appearance</summary>
        <div className="settings-fields">
          <label>Appearance<select value={preferences.appearance} onChange={(event) => save({ appearance: event.target.value as WorkspacePreferences["appearance"] })}><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label>
          <label>Density<select value={preferences.density} onChange={(event) => save({ density: event.target.value as WorkspacePreferences["density"] })}><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select></label>
          <label>Accent color<input type="color" value={preferences.accentColor} onChange={(event) => save({ accentColor: event.target.value })} /></label>
          <label>Font<select value={preferences.fontFamily} onChange={(event) => save({ fontFamily: event.target.value as WorkspacePreferences["fontFamily"] })}><option value="system">System UI</option><option value="sans">Sans serif</option><option value="serif">Serif</option><option value="mono">Monospace</option><option value="arial">Arial</option><option value="georgia">Georgia</option><option value="verdana">Verdana</option><option value="trebuchet">Trebuchet MS</option><option value="courier">Courier New</option><option value="custom">Custom / installed font</option></select></label>
          <label>Custom or installed font family<input value={preferences.customFontFamily} onChange={(event) => save({ customFontFamily: event.target.value })} placeholder="e.g. Aptos, Atkinson Hyperlegible" disabled={preferences.fontFamily !== "custom"} /></label>
          <label>Font stylesheet URL<input type="url" value={preferences.fontStylesheetUrl} onChange={(event) => save({ fontStylesheetUrl: event.target.value })} placeholder="https://fonts.googleapis.com/css2?family=…" /></label>
          <label>Font scale<input type="number" min="0.8" max="1.4" step="0.05" value={preferences.fontScale} onChange={(event) => save({ fontScale: Number(event.target.value) })} /></label>
          <label>Task list pane width<input type="number" min="180" max="480" value={preferences.taskListPaneWidth} onChange={(event) => save({ taskListPaneWidth: Number(event.target.value) })} /></label>
        </div>
        <p className="field-help">Choose a bundled browser font, enter a locally installed font name, or paste an HTTPS stylesheet URL such as Google Fonts. The selected family name is saved only in this browser.</p>
      </details>}
      {matches("keyboard shortcut keybinding search quick capture sync tasks calendar settings health tutorial") && <details className="settings-group" open={Boolean(filter)}>
        <summary>Keyboard shortcuts</summary>
        <p className="field-help">Select a shortcut then press the new key combination. Workspace shortcuts are saved locally and update every visible shortcut hint.</p>
        <div className="keybinding-grid">{(Object.keys(keybindingLabels) as Array<keyof WorkspaceKeybindings>).map((binding) => <KeybindingField key={binding} binding={binding} value={preferences.keybindings[binding]} save={(value) => save({ keybindings: { ...preferences.keybindings, [binding]: value } })} />)}</div>
      </details>}
      <section className="undo-controls" aria-label="Undo history"><p className="field-help">{undoEntries.find((entry) => entry.state === "undoable")?.label ?? "No undoable local change"}</p><div className="button-row"><button type="button" disabled={!undoEntries.some((entry) => entry.state === "undoable")} onClick={() => run(undo)}>Undo</button><button type="button" disabled={!undoEntries.some((entry) => entry.state === "redoable")} onClick={() => run(redo)}>Redo</button></div></section>
      {matches("conflict history google retry local") && <details className="settings-group" open={conflicts.some((conflict) => conflict.retryState === "pending") || Boolean(filter)}>
        <summary>Conflict history{conflicts.length ? ` (${conflicts.length})` : ""}</summary>
        {conflicts.length === 0 ? <p className="field-help">No task, event, or invitation conflicts are awaiting review.</p> : <ul className="conflict-history">{conflicts.map((conflict) => <li key={conflict.id}><div><strong>{conflict.resourceKind === "task" ? "Task" : "Event"} {conflict.operation}</strong><p className="field-help">{conflict.reason === "authorization" ? "Authorization expired" : conflict.reason === "gone" ? "The Google resource no longer exists" : "Google changed the resource"}. {conflict.retryState === "pending" ? "The local intent is retained for review." : "Resolved."}</p><p className="field-help">{new Date(conflict.createdAt).toLocaleString()}</p></div><button type="button" onClick={() => run(() => dismissConflict(conflict.id))}>Dismiss record</button></li>)}</ul>}
        <p className="field-help">Prefer Google replaces the local cache when a current remote version is available. Prefer Local and Ask retain the local intent; reopen the affected item to make an explicit retry.</p>
      </details>}
      {syncProgress.storage?.usage !== undefined && syncProgress.storage.quota !== undefined && <p className="field-help">Browser storage estimate: {(syncProgress.storage.usage / (1024 * 1024)).toFixed(1)} MiB used of {(syncProgress.storage.quota / (1024 * 1024)).toFixed(1)} MiB available.</p>}
      {matches("connect authorization managed direct sync refresh disconnect import diagnostics notifications browser local data") && <div className="button-row">
        {managedConnectionAvailable && !managed && <button type="button" disabled={busy} onClick={() => run(connectManaged)}>Use managed connection</button>}
        {managed && <button type="button" disabled={busy} onClick={() => run(useDirectConnection)}>Use direct browser connection</button>}
        <button type="button" disabled={busy || !canConnect} onClick={() => run(connect)}>{connected ? managed ? "Reconnect managed Google" : "Renew Google access" : "Connect Google"}</button>
        <button type="button" disabled={busy || !canConnect} onClick={() => run(sync)}>{connected ? "Sync now" : "Sync and reconnect"}</button>
        <button type="button" disabled={busy || !canConnect} onClick={() => run(refreshAllTasks)}>Refresh all Tasks from Google</button>
        {syncProgress.cancellable && <button type="button" onClick={cancelSync}>Cancel sync</button>}
        <button type="button" disabled={busy || !connected} onClick={() => run(disconnect)}>Disconnect Google</button>
        <button type="button" disabled={busy} onClick={openImport}>Import tasks or events</button>
        <button type="button" disabled={busy} onClick={openDiagnostics}>Diagnostics</button>
        <button type="button" disabled={busy} onClick={() => run(requestNotifications)}>Enable foreground reminders</button>
        <button className="danger-button" type="button" disabled={busy} onClick={() => run(clearLocalData)}>Clear browser-local data</button>
      </div>}
    </section>
  );
}
