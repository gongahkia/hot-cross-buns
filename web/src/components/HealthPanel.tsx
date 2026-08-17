import { useEffect, useState } from "react";

import { buildDiagnostics, type DiagnosticsSnapshot } from "@/features/diagnostics";
import type { SyncProgress } from "@/features/useWorkspace";
import { managedServiceAvailable } from "@/auth/managedConnection";
import type { ConnectionProfile } from "@/types";

interface HealthPanelProps {
  readonly subject: string;
  readonly connected: boolean;
  readonly connectionProfile: ConnectionProfile;
  readonly status: string;
  readonly syncProgress: SyncProgress;
  openDiagnostics(): void;
}

function state(ok: boolean): React.JSX.Element {
  return <span className={ok ? "health-state ok" : "health-state issue"}>{ok ? "Available" : "Needs attention"}</span>;
}

export function HealthPanel({ subject, connected, connectionProfile, status, syncProgress, openDiagnostics }: HealthPanelProps): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<DiagnosticsSnapshot>();
  const [error, setError] = useState("");
  const [managedService, setManagedService] = useState<"checking" | "available" | "unavailable">(connectionProfile.mode === "managed" ? "checking" : "available");
  useEffect(() => {
    let current = true;
    void buildDiagnostics(subject, syncProgress).then((next) => { if (current) { setSnapshot(next); setError(""); } }, (reason: unknown) => { if (current) setError(reason instanceof Error ? reason.message : "Health checks could not run"); });
    return () => { current = false; };
  }, [subject, syncProgress]);
  useEffect(() => {
    let current = true;
    if (connectionProfile.mode !== "managed" || !connectionProfile.backendOrigin) {
      setManagedService("available");
      return () => { current = false; };
    }
    setManagedService("checking");
    void managedServiceAvailable(connectionProfile.backendOrigin).then((available) => {
      if (current) setManagedService(available ? "available" : "unavailable");
    }, () => {
      if (current) setManagedService("unavailable");
    });
    return () => { current = false; };
  }, [connectionProfile]);
  const capabilities = snapshot?.browser.capabilities;
  const storageFull = Boolean(snapshot?.storage.usage && snapshot?.storage.quota && snapshot.storage.usage / snapshot.storage.quota >= 0.85);
  return <section className="workspace-panel health-panel" aria-labelledby="health-heading">
    <div className="panel-heading"><div><p className="eyebrow">Local service status</p><h2 id="health-heading">Health & logs</h2></div><button type="button" onClick={openDiagnostics}>Export diagnostic log</button></div>
    <p className="field-help">This page reports browser-local capabilities and synchronization state. It never displays OAuth tokens or Google content.</p>
    <ul className="health-list">
      {connectionProfile.mode === "managed" && <li><div><strong>Managed service</strong><span>{managedService === "checking" ? "Checking server and database" : managedService === "available" ? "Server and database are reachable" : "The configured managed service is unavailable"}</span></div>{state(managedService === "available")}</li>}
      <li><div><strong>Google authorization</strong><span>{connected ? connectionProfile.mode === "managed" ? "Active through the managed server session" : "Active for this browser session" : connectionProfile.mode === "managed" ? "Sign in through the managed service to sync" : "Select Sync to renew Google access"}</span></div>{state(connected)}</li>
      <li><div><strong>Synchronization</strong><span>{syncProgress.active ? syncProgress.detail : status}</span></div>{state(connected && syncProgress.phase !== "error" && syncProgress.phase !== "paused")}</li>
      <li><div><strong>Browser-local database</strong><span>{capabilities?.indexedDb ? `${snapshot?.cache.tasks ?? 0} cached tasks · ${snapshot?.cache.visibleEvents ?? 0} cached events` : "IndexedDB is unavailable"}</span></div>{state(Boolean(capabilities?.indexedDb))}</li>
      <li><div><strong>Offline app shell</strong><span>{capabilities?.serviceWorker ? "Service worker available" : "This browser cannot install the offline shell"}</span></div>{state(Boolean(capabilities?.serviceWorker))}</li>
      <li><div><strong>Foreground reminders</strong><span>{capabilities?.notifications ? "Notifications can be enabled in Settings" : "Notifications are unavailable in this browser"}</span></div>{state(Boolean(capabilities?.notifications))}</li>
      <li><div><strong>Storage</strong><span>{snapshot?.storage.usage !== undefined && snapshot?.storage.quota !== undefined ? `${(snapshot.storage.usage / (1024 * 1024)).toFixed(1)} MiB of ${(snapshot.storage.quota / (1024 * 1024)).toFixed(1)} MiB` : "Storage estimate unavailable"}</span></div>{state(!storageFull)}</li>
    </ul>
    {error && <p className="error" role="alert">{error}</p>}
  </section>;
}
