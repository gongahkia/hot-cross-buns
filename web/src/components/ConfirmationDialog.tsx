import { useId, useRef, useState } from "react";

import { ModalDialog } from "@/components/ModalDialog";

interface ConfirmationDialogProps {
  readonly title: string;
  readonly description: React.ReactNode;
  readonly confirmLabel: string;
  readonly destructive?: boolean;
  confirm(): Promise<void> | void;
  close(): void;
}

/** A focused, cancellable in-app guard for destructive workspace mutations. */
export function ConfirmationDialog({ title, description, confirmLabel, destructive = false, confirm, close }: ConfirmationDialogProps): React.JSX.Element {
  const headingId = useId();
  const descriptionId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  async function submit(): Promise<void> {
    setWorking(true);
    setError("");
    try {
      await confirm();
      close();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "That change could not be completed");
    } finally {
      setWorking(false);
    }
  }

  return <ModalDialog className="confirmation-dialog" labelledBy={headingId} describedBy={descriptionId} initialFocusRef={cancelRef} onClose={working ? () => undefined : close}>
    <p className="eyebrow">Confirm change</p>
    <h2 id={headingId}>{title}</h2>
    <p id={descriptionId}>{description}</p>
    {error && <p className="error" role="alert">{error}</p>}
    <div className="button-row confirmation-actions">
      <button ref={cancelRef} type="button" disabled={working} onClick={close}>Cancel</button>
      <button type="button" className={destructive ? "danger-button" : undefined} disabled={working} onClick={() => void submit()}>{working ? "Working…" : confirmLabel}</button>
    </div>
  </ModalDialog>;
}
