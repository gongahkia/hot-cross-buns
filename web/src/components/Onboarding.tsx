import { useState } from "react";

interface OnboardingProps {
  readonly savedClientId: string;
  readonly busy: boolean;
  readonly status: string;
  saveClientId(clientId: string): Promise<void>;
  connect(): Promise<void>;
}

export function Onboarding({ savedClientId, busy, status, saveClientId, connect }: OnboardingProps): React.JSX.Element {
  const [clientId, setClientId] = useState(savedClientId);
  const [error, setError] = useState("");
  const origin = window.location.origin;

  async function saveAndConnect(): Promise<void> {
    setError("");
    try {
      await saveClientId(clientId);
      await connect();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Google setup failed");
    }
  }

  return (
    <main className="onboarding-shell">
      <section className="onboarding-card" aria-labelledby="onboarding-title">
        <p className="eyebrow">browser-local Google workspace</p>
        <h1 id="onboarding-title">Connect your own Google Cloud project</h1>
        <p>
          Hot Cross Buns calls Google directly from this browser. It has no account, server database, or stored
          Google credential.
        </p>
        <ol className="setup-steps">
          <li>Create or choose a Google Cloud project you control.</li>
          <li>Enable Google Tasks API, Google Calendar API, and Google Drive API.</li>
          <li>Create a <strong>Web application</strong> OAuth client.</li>
          <li>
            Add <code>{origin}</code> as an authorized JavaScript origin. Add your local development origin too when
            developing locally.
          </li>
          <li>Configure the consent screen and test users in Google Cloud before connecting.</li>
        </ol>
        <label className="field-label" htmlFor="google-client-id">
          Google Web OAuth client ID
        </label>
        <input
          id="google-client-id"
          autoComplete="off"
          spellCheck={false}
          value={clientId}
          onChange={(event) => setClientId(event.target.value)}
          placeholder="1234567890-example.apps.googleusercontent.com"
        />
        <p className="field-help">
          Do not paste a client secret. A static web app cannot protect one, and this app does not collect it.
        </p>
        {error && <p className="error" role="alert">{error}</p>}
        <p className="status" aria-live="polite">{status}</p>
        <button className="primary-button" type="button" disabled={busy || !clientId.trim()} onClick={() => void saveAndConnect()}>
          {busy ? "Connecting…" : "Save and connect Google"}
        </button>
      </section>
    </main>
  );
}
