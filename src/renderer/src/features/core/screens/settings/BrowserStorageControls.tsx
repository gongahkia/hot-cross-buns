import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useRef, useState } from "react";
import { Button, Input } from "../../../../components/primitives";
import { SettingsControlRow, SettingsGroup } from "./SettingsPrimitives";

type OfflineStatus = { state: "preparing" | "ready" | "update-ready" | "unavailable"; message?: string };
const readOfflineStatus = () => (window as Window & { hcbOffline?: OfflineStatus }).hcbOffline;

type StorageInfo = { usage?: number | null; quota?: number | null; persisted: boolean; available: boolean; granted?: boolean };
type ImportReview = { reviewId: string; summary: Record<string, number>; warnings: string[] };
const bytesLabel = (value?: number | null) => value == null ? "Unavailable" : `${(value / 1024 / 1024).toFixed(1)} MB`;

export function BrowserStorageControls(): JSX.Element {
  const importTrigger = useRef<HTMLButtonElement | null>(null);
  const confirmationInput = useRef<HTMLInputElement | null>(null);
  const [offline, setOffline] = useState<OfflineStatus | undefined>(readOfflineStatus);
  const [info, setInfo] = useState<StorageInfo | null>(null);
  const [review, setReview] = useState<ImportReview | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const update = () => setOffline(readOfflineStatus());
    window.addEventListener("hcb:offline-status", update);
    return () => window.removeEventListener("hcb:offline-status", update);
  }, []);

  useEffect(() => {
    let active = true;
    void window.hcb?.workspace.storageInfo().then((result) => {
      if (!active) return;
      if (result.ok) setInfo(result.data);
      else setError(result.error.message);
    }).catch(() => { if (active) setError("Browser storage information could not be read."); });
    return () => { active = false; };
  }, []);

  async function run(action: "exportArchive" | "stageImport" | "requestPersistence") {
    setPending(true); setError(null); setMessage(null);
    try {
      // Invoke immediately so file selection and persistence requests keep user activation.
      const result = await window.hcb!.workspace[action]();
      if (!result.ok) { setError(result.error.message); return; }
      if (action === "stageImport") { if (!result.data.cancelled) { setReview(result.data); setConfirmation(""); } }
      else if (action === "requestPersistence") {
        setInfo(result.data);
        setMessage(result.data.persisted || result.data.granted ? "Persistent browser storage is enabled." : "Your browser did not grant persistent storage. Export backups regularly; your workspace still saves in IndexedDB.");
      } else setMessage("Workspace archive downloaded. Keep the file somewhere safe.");
    } catch { setError("The browser could not complete this operation. Your current workspace has not been replaced."); }
    finally { setPending(false); }
  }

  async function restore() {
    if (!review || confirmation !== "REPLACE") return;
    setPending(true); setError(null);
    try {
      const result = await window.hcb!.workspace.confirmImport({ reviewId: review.reviewId, confirmation: "REPLACE_WORKSPACE" });
      if (!result.ok) { setError(result.error.message); return; }
      window.location.reload();
    } catch { setError("The archive could not be restored. Your previous durable workspace is preserved."); }
    finally { setPending(false); }
  }

  return <>
    <SettingsGroup title="Offline availability">
      <p className="px-3 py-3 text-sm text-text-secondary" role="status">{offline?.state === "ready" ? "Ready to open offline in this browser." : offline?.state === "preparing" ? "Downloading application files for offline use. Keep this tab online until ready." : offline?.state === "update-ready" ? "An application update is ready. Close all HCB tabs and reopen to use it." : offline?.message ?? "Offline application files are not available in this session."}</p>
      <p className="px-3 pb-3 text-sm text-text-muted">The first load requires a network connection. After offline files are ready, local planning works without Google. Updates activate after all HCB tabs close; they do not interrupt open editors. Workspace data stays in IndexedDB.</p>
    </SettingsGroup>
    <SettingsGroup title="Browser storage">
      <p className="px-3 py-3 text-sm text-text-secondary">This workspace belongs to this site's browser profile. Clearing site data removes it. Private browsing usually removes it when the private session ends. Sync runs while HCB is open and connected.</p>
      <SettingsControlRow label="Storage used" description="Browser estimates include this site's storage, not just the planner database."><span>{bytesLabel(info?.usage)} / {bytesLabel(info?.quota)}</span></SettingsControlRow>
      <SettingsControlRow label="Persistent storage" description={info?.persisted ? "Enabled. Browser storage pressure should not automatically evict this site's data." : "Request protection against automatic eviction. This does not protect against clearing site data."}>
        <Button disabled={pending || info?.persisted || info?.available === false} onClick={() => void run("requestPersistence")} variant="secondary">Request persistent storage</Button>
      </SettingsControlRow>
    </SettingsGroup>
    <SettingsGroup title="Workspace archives">
      <p className="px-3 py-3 text-sm text-text-secondary">Export tasks, notes, calendars, settings, undo history, and pending sync changes. Google access tokens are excluded. Restoring replaces the whole local workspace after review; reconnect Google separately.</p>
      <div className="flex flex-wrap gap-2 px-3 pb-3">
        <Button disabled={pending} onClick={() => void run("exportArchive")} variant="secondary">Export workspace</Button>
        <Button disabled={pending} onClick={(event) => { importTrigger.current = event.currentTarget; void run("stageImport"); }} variant="secondary">Import workspace…</Button>
      </div>
    </SettingsGroup>
    {message ? <p role="status" className="text-sm text-text-secondary">{message}</p> : null}
    {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
    <Dialog.Root open={review !== null} onOpenChange={(open) => { if (!open && !pending) { setReview(null); setConfirmation(""); } }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[80] bg-black/40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[81] grid max-h-[90vh] w-[min(36rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 gap-3 overflow-auto rounded-hcbLg border border-border bg-surface-0 p-5 shadow-hcbLg"
          onOpenAutoFocus={(event) => { event.preventDefault(); confirmationInput.current?.focus(); }}
          onCloseAutoFocus={(event) => { event.preventDefault(); importTrigger.current?.focus(); }}
          onEscapeKeyDown={(event) => { if (pending) event.preventDefault(); }}
          onInteractOutside={(event) => event.preventDefault()}>
          <Dialog.Title className="text-lg font-semibold">Review workspace replacement</Dialog.Title>
          <Dialog.Description>This replaces every task, note, calendar, preference, and undo entry in this browser workspace. Export your current workspace first if you want to keep it.</Dialog.Description>
          <dl className="grid grid-cols-2 gap-2">{Object.entries(review?.summary ?? {}).map(([key, count]) => <div key={key}><dt className="text-text-secondary">{key.replace(/([A-Z])/g, " $1")}</dt><dd>{count}</dd></div>)}</dl>
          {review?.warnings.map((warning, index) => <p key={index} className="text-warning">{warning}</p>)}
          <label className="grid gap-2">Type REPLACE to confirm<Input ref={confirmationInput} aria-label="Confirm workspace replacement" value={confirmation} onChange={(event) => setConfirmation(event.currentTarget.value)} /></label>
          {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
          <div className="flex justify-end gap-2"><Button disabled={pending} onClick={() => { setReview(null); setConfirmation(""); }} variant="secondary">Cancel</Button><Button disabled={pending || confirmation !== "REPLACE"} onClick={() => void restore()} variant="primary">Replace workspace</Button></div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  </>;
}
