interface SettingsPanelProps {
  readonly clientId: string;
  readonly status: string;
  readonly connected: boolean;
  readonly busy: boolean;
  sync(): Promise<void>;
  disconnect(): Promise<void>;
  clearLocalData(): Promise<void>;
}

export function SettingsPanel({ clientId, status, connected, busy, sync, disconnect, clearLocalData }: SettingsPanelProps): React.JSX.Element {
  const run = (action: () => Promise<void>): void => { void action().catch(() => undefined); };
  return (
    <section className="workspace-panel settings-panel" aria-labelledby="settings-heading">
      <p className="eyebrow">local privacy controls</p>
      <h2 id="settings-heading">Settings</h2>
      <dl>
        <div><dt>OAuth client ID</dt><dd>{clientId || "Not configured"}</dd></div>
        <div><dt>Authorization</dt><dd>{connected ? "Active in this browser session" : "Not active"}</dd></div>
        <div><dt>Stored by Hot Cross Buns</dt><dd>Only browser-local cached data and this non-secret client ID.</dd></div>
      </dl>
      <p className="status" aria-live="polite">{status}</p>
      <div className="button-row">
        <button type="button" disabled={busy || !connected} onClick={() => run(sync)}>Sync now</button>
        <button type="button" disabled={busy || !connected} onClick={() => run(disconnect)}>Disconnect Google</button>
        <button className="danger-button" type="button" disabled={busy} onClick={() => run(clearLocalData)}>Clear browser-local data</button>
      </div>
    </section>
  );
}
