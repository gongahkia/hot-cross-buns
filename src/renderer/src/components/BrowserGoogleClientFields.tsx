import { Button, Input } from "./primitives";

/** Shared setup/settings fields for the public Web OAuth client ID. */
export function BrowserGoogleClientFields({ value, onValueChange, onSave, busy = false }: {
  value: string;
  onValueChange: (value: string) => void;
  onSave: () => Promise<void>;
  busy?: boolean;
}) {
  return <div className="grid min-w-0 gap-3">
    <label className="grid gap-1.5 text-sm font-medium text-text-primary">
      Web OAuth client ID
      <Input aria-label="Google OAuth client ID" autoCapitalize="none" autoComplete="off" spellCheck={false}
        disabled={busy} value={value} onChange={(event) => onValueChange(event.currentTarget.value)}
        placeholder="1234567890-example.apps.googleusercontent.com" />
    </label>
    <p className="text-sm text-text-muted">Saved for this site in this browser profile. Use the client ID only; no client secret is needed.</p>
    <details className="text-sm text-text-secondary">
      <summary className="cursor-pointer py-1">Google Cloud setup</summary>
      <div className="grid gap-2 py-2">
        <p>Create a <strong>Web application</strong> client in <a className="text-accent underline" href="https://console.cloud.google.com/auth/clients" target="_blank" rel="noopener noreferrer">Google Cloud</a>, then paste its client ID above.</p>
        <p>Add this exact address to <strong>Authorized JavaScript origins</strong>:</p>
        <code className="select-text break-all rounded-hcbSm bg-surface-0 p-2">{window.location.origin}</code>
        <p>Enable the Google Tasks and Calendar APIs and configure the consent screen. If the app is in testing, add your Google account as a test user.</p>
      </div>
    </details>
    <div><Button disabled={!value.trim() || busy} onClick={() => void onSave()} variant="secondary">{busy ? "Please wait…" : "Save client ID"}</Button></div>
  </div>;
}
