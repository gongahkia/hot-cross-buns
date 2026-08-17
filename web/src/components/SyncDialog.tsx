import { LoadingState } from "@/components/LoadingState";
import { ModalDialog } from "@/components/ModalDialog";
import type { SyncProgress } from "@/features/useWorkspace";

interface SyncDialogProps {
  readonly progress: SyncProgress;
  readonly error?: string;
  cancel(): void;
  close(): void;
}

export function SyncDialog({ progress, error, cancel, close }: SyncDialogProps): React.JSX.Element {
  const complete = progress.phase === "complete";
  return <ModalDialog className="sync-dialog" labelledBy="sync-dialog-heading" onClose={progress.active ? () => undefined : close}>
    <h2 id="sync-dialog-heading" className="visually-hidden">{complete ? "Sync complete" : "Synchronizing"}</h2>
    {progress.active && <LoadingState label="Synchronizing" variant="Drive" className="sync-loader" />}
    <p className="sync-detail" aria-live="polite">{error || progress.detail}</p>
    <div className="button-row sync-dialog-actions">
      {progress.cancellable && <button type="button" onClick={cancel}>Cancel sync</button>}
      {!progress.active && <button type="button" onClick={close}>Done</button>}
    </div>
  </ModalDialog>;
}
