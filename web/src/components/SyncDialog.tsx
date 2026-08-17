import { useEffect, useState } from "react";

import { Icon } from "@/components/Icons";
import { ModalDialog } from "@/components/ModalDialog";
import type { SyncProgress } from "@/features/useWorkspace";

interface SyncDialogProps {
  readonly progress: SyncProgress;
  readonly error?: string;
  cancel(): void;
  close(): void;
}

export function SyncDialog({ progress, error, cancel, close }: SyncDialogProps): React.JSX.Element {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!progress.active) return;
    const started = Date.now();
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1_000);
    return () => window.clearInterval(timer);
  }, [progress.active]);
  const completion = progress.completed !== undefined && progress.total !== undefined
    ? `${progress.completed} of ${progress.total} resources`
    : `${progress.pagesSaved} pages saved`;
  const complete = progress.phase === "complete";
  return <ModalDialog className="sync-dialog" labelledBy="sync-dialog-heading" onClose={progress.active ? () => undefined : close}>
    <div className="sync-orbit" aria-hidden="true"><Icon name="sync" /></div>
    <p className="eyebrow">Google workspace</p>
    <h2 id="sync-dialog-heading">{complete ? "Sync complete" : "Synchronizing"}</h2>
    <p className="sync-detail" aria-live="polite">{error || progress.detail}</p>
    <div className="sync-meter" aria-label={completion}><span style={{ width: progress.total ? `${Math.min(100, Math.round(((progress.completed ?? 0) / progress.total) * 100))}%` : complete ? "100%" : "18%" }} /></div>
    <div className="sync-dialog-meta"><span>{completion}</span>{progress.active && <span>{elapsed}s elapsed</span>}</div>
    <div className="button-row sync-dialog-actions">
      {progress.cancellable && <button type="button" onClick={cancel}>Cancel sync</button>}
      {!progress.active && <button type="button" onClick={close}>Done</button>}
    </div>
  </ModalDialog>;
}
