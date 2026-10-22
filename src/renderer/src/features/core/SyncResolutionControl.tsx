import { useState } from "react";
import type { SyncResolutionPreview } from "@shared/syncResolution";
import { Button } from "../../components/primitives";

function display(value: unknown): string {
  if (value === null || value === undefined || value === "") return "(empty)";
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

export function SyncResolutionControl({ id, disabled, onResolved }: { id: string; disabled: boolean; onResolved: () => void }): JSX.Element {
  const [preview, setPreview] = useState<SyncResolutionPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [page, setPage] = useState(0);
  const pageSize = 20;
  async function compare() {
    setBusy(true); setError(""); setPreview(null); setPage(0);
    try {
      const result = await window.hcb?.diagnostics.previewMutationResolution({ id });
      if (!result?.ok) throw new Error(result?.error.message ?? "Google comparison is unavailable.");
      setPreview(result.data);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Google comparison failed."); }
    finally { setBusy(false); }
  }
  async function resolve(strategy: "local" | "google") {
    if (!preview || busy) return;
    setBusy(true); setError("");
    try {
      const result = await window.hcb?.diagnostics.resolveMutation({ id, reviewId: preview.reviewId, strategy });
      if (!result?.ok) throw new Error(result?.error.message ?? "Recovery is unavailable.");
      setPreview(null);
      window.dispatchEvent(new Event("hcb:core-data-invalidated"));
      onResolved();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Recovery failed."); }
    finally { setBusy(false); }
  }
  return <div className="grid min-w-0 gap-3">
    <div className="flex flex-wrap gap-2">
      <Button disabled={disabled || busy} onClick={() => void compare()}>{busy ? "Working…" : preview ? "Refresh comparison" : "Compare and resolve"}</Button>
      {preview ? <Button disabled={busy} variant="ghost" onClick={() => { setPreview(null); setError(""); }}>Close comparison</Button> : null}
    </div>
    {error ? <p role="alert" className="text-[var(--text-sm)] text-danger">{error}</p> : null}
    {preview ? <section aria-label="Review sync changes" className="grid min-w-0 gap-3 rounded-lg border border-border p-3 text-[var(--text-sm)]">
      <p>{preview.message}</p>
      <p className="font-semibold tabular-nums">{preview.affectedCount} queued {preview.affectedCount === 1 ? "change" : "changes"} affected</p>
      {preview.items.length > pageSize ? <div className="flex flex-wrap items-center gap-2" aria-label="Comparison pages">
        <Button disabled={busy || page === 0} onClick={() => setPage((value) => value - 1)}>Previous items</Button>
        <span className="tabular-nums">{page * pageSize + 1}–{Math.min((page + 1) * pageSize, preview.items.length)} of {preview.items.length} items</span>
        <Button disabled={busy || (page + 1) * pageSize >= preview.items.length} onClick={() => setPage((value) => value + 1)}>Next items</Button>
      </div> : null}
      {preview.items.slice(page * pageSize, (page + 1) * pageSize).map((item) => <details key={`${item.kind}:${item.id}`} open={preview.items.length === 1}>
        <summary className="cursor-pointer py-2 font-semibold">{item.kind} · {item.title}</summary>
        <div className="overflow-auto">
          <table className="w-full table-fixed border-collapse text-left">
            <thead><tr><th className="w-1/5 border-b border-border p-2">Field</th><th className="border-b border-border p-2">Local</th><th className="border-b border-border p-2">Google</th></tr></thead>
            <tbody>{Array.from(new Set([...Object.keys(item.local ?? {}), ...Object.keys(item.google ?? {})])).map((field) => {
              const changed = display(item.local?.[field]) !== display(item.google?.[field]);
              return <tr key={field} className={changed ? "bg-bg-secondary" : ""}>
                <th scope="row" className="border-b border-border p-2 align-top font-medium">{field.replace(/([a-z])([A-Z])/g, "$1 $2")}{changed ? " *" : ""}</th>
                <td className="whitespace-pre-wrap break-words border-b border-border p-2 align-top">{item.local ? display(item.local[field]) : "Deleted locally"}</td>
                <td className="whitespace-pre-wrap break-words border-b border-border p-2 align-top">{item.google ? display(item.google[field]) : "No linked Google item"}</td>
              </tr>;
            })}</tbody>
          </table>
        </div>
      </details>)}
      <p className="text-text-muted">* Fields differ. Google is read again before applying this decision.</p>
      <div className="flex flex-wrap gap-2">
        <Button disabled={disabled || busy || !preview.canKeepLocal} onClick={() => void resolve("local")}>Keep local and retry {preview.affectedCount} {preview.affectedCount === 1 ? "change" : "changes"}</Button>
        <Button disabled={disabled || busy} onClick={() => void resolve("google")}>Use Google and discard {preview.affectedCount} local {preview.affectedCount === 1 ? "change" : "changes"}</Button>
      </div>
    </section> : null}
  </div>;
}
