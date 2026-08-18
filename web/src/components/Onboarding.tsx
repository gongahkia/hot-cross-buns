import { useState } from "react";

import { LoadingState } from "@/components/LoadingState";
import type { ConnectionProfile } from "@/types";

interface OnboardingProps {
  readonly savedClientId: string;
  readonly displayTimeZone: string;
  readonly connectionProfile: ConnectionProfile;
  readonly managedConnectionAvailable: boolean;
  readonly busy: boolean;
  readonly status: string;
  saveClientId(clientId: string): Promise<void>;
  saveDisplayTimeZone(timeZone: string): Promise<void>;
  connect(): Promise<void>;
  connectManaged(): Promise<void>;
  useDirectConnection(): Promise<void>;
}

export function Onboarding({ savedClientId, displayTimeZone, connectionProfile, managedConnectionAvailable, busy, status, saveClientId, saveDisplayTimeZone, connect, connectManaged, useDirectConnection }: OnboardingProps): React.JSX.Element {
  const [clientId, setClientId] = useState(savedClientId);
  const [timeZone, setTimeZone] = useState(displayTimeZone);
  const [mode, setMode] = useState<ConnectionProfile["mode"]>(connectionProfile.mode);
  const [error, setError] = useState("");
  const origin = window.location.origin;

  async function saveAndConnect(): Promise<void> {
    setError("");
    try {
      await saveDisplayTimeZone(timeZone);
      await useDirectConnection();
      await saveClientId(clientId);
      await connect();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Google setup failed");
    }
  }

  async function connectThroughManagedService(): Promise<void> {
    setError("");
    try {
      await saveDisplayTimeZone(timeZone);
      await connectManaged();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Managed Google setup failed");
    }
  }

  return (
    <main className="onboarding-shell">
      <section className="onboarding-card" aria-labelledby="onboarding-title">
        <p className="eyebrow">Google workspace connection</p>
        <h1 id="onboarding-title">Connect Google</h1>
        <p>Your public HCB data stays in this browser. A reliable connection is available only when you run the full stack on infrastructure you control.</p>
        <div className="connection-mode-options" role="radiogroup" aria-label="Google connection model">
          <label className={mode === "direct" ? "connection-mode-option active" : "connection-mode-option"}>
            <input type="radio" name="connection-mode" value="direct" checked={mode === "direct"} onChange={() => setMode("direct")} />
            <span><strong>Direct browser connection</strong><small>Use your own Google Cloud OAuth client. Google access is kept only in this browser session, so Google may require a reconnect after it expires.</small></span>
          </label>
          {managedConnectionAvailable && <label className={mode === "managed" ? "connection-mode-option active" : "connection-mode-option"}>
            <input type="radio" name="connection-mode" value="managed" checked={mode === "managed"} onChange={() => setMode("managed")} />
            <span><strong>Self-hosted reliable connection</strong><small>Run the documented full stack yourself. It stores an encrypted Google refresh token, a Calendar and Task mirror, and this device's Web Push subscription in your own PostgreSQL database.</small></span>
          </label>}
        </div>
        {mode === "direct" ? <>
          <ol className="setup-steps">
            <li>Create or choose a Google Cloud project you control.</li>
            <li>Enable Google Tasks API, Google Calendar API, and Google Drive API.</li>
            <li>Create a <strong>Web application</strong> OAuth client.</li>
            <li>Add <code>{origin}</code> as an authorized JavaScript origin. Add your local development origin too when developing locally.</li>
            <li>Configure the consent screen and test users in Google Cloud before connecting.</li>
          </ol>
          <label className="field-label" htmlFor="google-client-id">Google Web OAuth client ID</label>
          <input id="google-client-id" autoComplete="off" spellCheck={false} value={clientId} onChange={(event) => setClientId(event.target.value)} placeholder="1234567890-example.apps.googleusercontent.com" />
          <p className="field-help">Do not paste a client secret. A static web app cannot protect one, and this app does not collect it.</p>
        </> : <p className="field-help">Your self-hosted server never sends its Google client secret or refresh token to the browser. You will be redirected to Google once to approve access. Calendar and Task polling runs every five minutes; Web Push is best effort, not a delivery guarantee.</p>}
        <label className="field-label" htmlFor="onboarding-time-zone">Default time zone</label>
        <div className="time-zone-choice"><input id="onboarding-time-zone" value={timeZone} onChange={(event) => setTimeZone(event.target.value)} list="onboarding-time-zones" /><button type="button" onClick={() => setTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC")}>Use device time zone</button></div>
        <datalist id="onboarding-time-zones">{(typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [Intl.DateTimeFormat().resolvedOptions().timeZone]).map((zone) => <option key={zone} value={zone} />)}</datalist>
        <p className="field-help">Calendar times, agenda labels, and new event defaults use this time zone. You can change it later in Settings.</p>
        {error && <p className="error" role="alert">{error}</p>}
        {busy && <LoadingState label={mode === "managed" ? "Connecting self-hosted Google" : "Requesting Google access"} variant="Orbit" className="onboarding-loader" />}
        <p className="status" aria-live="polite">{status}</p>
        <button className="primary-button" type="button" disabled={busy || (mode === "direct" && !clientId.trim())} onClick={() => void (mode === "managed" ? connectThroughManagedService() : saveAndConnect())}>
          {busy ? "Connecting…" : mode === "managed" ? "Connect through self-hosted service" : "Save and connect Google"}
        </button>
      </section>
    </main>
  );
}
