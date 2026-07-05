import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { sendExtensionMessage } from "./extensionApi";
import type { AuthStatus, ExtensionSettings } from "./types";
import "./styles.css";

function OptionsApp() {
  const [clientId, setClientId] = useState("");
  const [redirectUri, setRedirectUri] = useState("");
  const [status, setStatus] = useState("Loading...");

  useEffect(() => {
    void Promise.all([
      sendExtensionMessage<ExtensionSettings>({ type: "settings.get" }),
      sendExtensionMessage<AuthStatus>({ type: "auth.status" })
    ]).then(([settings, auth]) => {
      setClientId(settings.googleClientId);
      setRedirectUri(auth.redirectUri);
      setStatus(auth.signedIn ? "Connected" : "Not connected");
    }).catch((error: unknown) => {
      setStatus(error instanceof Error ? error.message : String(error));
    });
  }, []);

  const save = async () => {
    await sendExtensionMessage<ExtensionSettings>({
      type: "settings.save",
      settings: { googleClientId: clientId }
    });
    setStatus("Saved");
  };

  return (
    <main className="options-shell">
      <h1>Hot Cross Buns Extension</h1>
      <p className="status">{status}</p>

      <label>
        Google OAuth client ID
        <input
          value={clientId}
          onChange={(event) => setClientId(event.target.value)}
          placeholder="client-id.apps.googleusercontent.com"
        />
      </label>

      <label>
        Authorized redirect URI
        <input value={redirectUri} readOnly />
      </label>

      <div className="button-row">
        <button type="button" onClick={() => void save()}>Save</button>
      </div>
    </main>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <OptionsApp />
  </React.StrictMode>
);
