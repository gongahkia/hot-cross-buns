import { useState } from "react";

import { ModalDialog } from "@/components/ModalDialog";
import { buildDiagnostics, type DiagnosticsSnapshot } from "@/features/diagnostics";
import type { SyncProgress } from "@/features/useWorkspace";

export function DiagnosticsDialog({ subject, syncProgress, close }: { readonly subject: string; readonly syncProgress: SyncProgress; close(): void }): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<DiagnosticsSnapshot>();
  const [error, setError] = useState("");

  async function generate(): Promise<void> {
    setError("");
    try {
      setSnapshot(await buildDiagnostics(subject, syncProgress));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Diagnostics could not be generated");
    }
  }

  function download(): void {
    if (!snapshot) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `hot-cross-buns-diagnostics-${snapshot.generatedAt.slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return <ModalDialog className="diagnostics-dialog" labelledBy="diagnostics-heading" onClose={close}>
    <div className="panel-heading"><div><p className="eyebrow">Local support data</p><h2 id="diagnostics-heading">Diagnostics</h2></div><button type="button" onClick={close}>Close</button></div>
    <p>Generate a redacted local JSON file. It includes browser capability checks, storage/cache counts, and sync state; it excludes Google identities, task/event content, OAuth client IDs, tokens, URLs, and raw Google responses.</p>
    <div className="button-row"><button type="button" onClick={() => void generate()}>Generate snapshot</button>{snapshot && <><button type="button" onClick={() => void navigator.clipboard?.writeText(JSON.stringify(snapshot, null, 2))}>Copy JSON</button><button type="button" onClick={download}>Download JSON</button></>}</div>
    {snapshot && <pre className="diagnostics-preview">{JSON.stringify(snapshot, null, 2)}</pre>}
    {error && <p className="error" role="alert">{error}</p>}
  </ModalDialog>;
}
