import { useModalEscape } from "./useModalEscape";
import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
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
    <div><Button disabled={!value.trim() || busy} onClick={() => void onSave()} variant="secondary">{busy ? "Please wait…" : "Save client ID"}</Button></div>
  </div>;
}

export function BrowserGoogleSetupInstructions() {
  return <ol className="grid gap-4 text-sm leading-relaxed text-text-secondary">
    <li><strong>1. Create your client.</strong> Open <a className="text-accent underline" href="https://console.cloud.google.com/auth/clients" target="_blank" rel="noopener noreferrer">Google Cloud</a> and create a <strong>Web application</strong> OAuth client.</li>
    <li><strong>2. Allow this site.</strong> Add this exact address to <strong>Authorized JavaScript origins</strong>:<code className="mt-2 block select-text break-all rounded-hcbSm bg-surface-0 p-2">{window.location.origin}</code></li>
    <li><strong>3. Enable access.</strong> Enable the Google Tasks and Calendar APIs and configure the consent screen. If the app is in testing, add your Google account as a test user.</li>
  </ol>;
}


export function GoogleSetupHelp(): JSX.Element {
  const [open, setOpen] = useState(false);
  useModalEscape(open, () => setOpen(false));
  return <Dialog.Root open={open} onOpenChange={setOpen}>
    <Dialog.Trigger asChild><button type="button" className="text-accent underline underline-offset-2">Connect</button></Dialog.Trigger>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-[80] bg-black/40 backdrop-blur-sm" />
      <Dialog.Content className="fixed left-1/2 top-1/2 z-[81] grid max-h-[calc(100dvh-2rem)] w-[min(440px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-2xl border border-border bg-bg-primary p-6 text-text-primary shadow-2xl outline-none" onEscapeKeyDown={event => { event.preventDefault(); event.stopPropagation(); setOpen(false); }}>
        <Dialog.Title className="hcb-brand-heading text-2xl">Google Cloud setup</Dialog.Title>
        <Dialog.Description className="text-sm text-text-muted">Set up a Web application client to connect your Google account.</Dialog.Description>
        <BrowserGoogleSetupInstructions />
        <div className="flex justify-end"><Dialog.Close asChild><Button variant="secondary">Done</Button></Dialog.Close></div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
