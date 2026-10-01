import { useState } from "react";
import { Check, FileText, Import, ListTodo } from "lucide-react";
import type { LegacyPseudoNoteCandidate, LegacyPseudoNotesMigrationPreview } from "@shared/ipc/contracts";
import { Button, cx } from "../../../components/primitives";
import { buildNotePreview } from "../notesParsing";

export function LegacyNotesMigrationDialog({
  preview,
  onDismiss,
  onImport
}: {
  preview: LegacyPseudoNotesMigrationPreview;
  onDismiss: () => void;
  onImport: (taskIds: string[]) => Promise<{ ok: boolean; error?: string }>;
}): JSX.Element {
  const [reviewing, setReviewing] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set(preview.items.map((item) => item.sourceTaskId)));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectedCount = selectedIds.size;
  const allSelected = preview.items.length > 0 && selectedCount === preview.items.length;

  function toggleCandidate(candidate: LegacyPseudoNoteCandidate): void {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(candidate.sourceTaskId)) next.delete(candidate.sourceTaskId);
      else next.add(candidate.sourceTaskId);
      return next;
    });
  }

  async function importSelected(): Promise<void> {
    if (selectedCount === 0 || submitting) return;
    setSubmitting(true);
    setError(null);
    const result = await onImport([...selectedIds]);
    setSubmitting(false);
    if (!result.ok) setError(result.error ?? "HCB could not import those legacy notes.");
  }

  return (
    <div
      aria-label="Legacy notes found"
      aria-modal="true"
      className="fixed inset-0 z-[75] grid place-items-center overflow-auto bg-bg-primary/70 p-4 backdrop-blur-sm"
      onKeyDown={(event) => {
        if (event.key === "Escape" && !submitting) onDismiss();
      }}
      role="dialog"
    >
      <section className="hcb-raised w-full max-w-3xl overflow-hidden rounded-hcbLg border border-border bg-bg-primary shadow-hcbLg">
        <header className="flex items-start gap-3 border-b border-border px-5 py-4">
          <div className="grid size-10 shrink-0 place-items-center rounded-hcbMd bg-accent/15 text-accent">
            <FileText aria-hidden="true" size={20} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-[var(--text-lg)] font-semibold text-text-primary">Legacy notes found</h2>
            <p className="mt-1 text-[var(--text-sm)] leading-relaxed text-text-secondary">
              HCB found {preview.foundCount} {preview.foundCount === 1 ? "item" : "items"} that were previously shown in Notes before native Notes storage was restored.
            </p>
          </div>
        </header>

        {!reviewing ? (
          <div className="space-y-4 px-5 py-5">
            <p className="text-[var(--text-base)] leading-relaxed text-text-secondary">
              Importing creates local HCB Notes and keeps the original Google Tasks unchanged. You can review every item before copying it.
            </p>
            <div className="flex flex-wrap justify-end gap-2">
              <Button onClick={onDismiss} variant="ghost">Not now</Button>
              <Button onClick={() => setReviewing(true)} variant="primary">
                <Import aria-hidden="true" size={16} />
                Review and import
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
              <label className="flex min-h-10 cursor-pointer items-center gap-2 text-[var(--text-sm)] font-medium text-text-primary">
                <input
                  checked={allSelected}
                  className="size-4 accent-[var(--accent)]"
                  onChange={() => setSelectedIds(allSelected ? new Set() : new Set(preview.items.map((item) => item.sourceTaskId)))}
                  type="checkbox"
                />
                Select all ({preview.items.length})
              </label>
              <span className="text-[var(--text-sm)] text-text-muted">{selectedCount} selected</span>
            </div>
            <div className="max-h-[min(52vh,34rem)] divide-y divide-border overflow-y-auto">
              {preview.items.map((item) => (
                <label
                  className={cx(
                    "grid cursor-pointer grid-cols-[auto_minmax(0,1fr)] gap-3 px-5 py-3 transition-colors duration-fast ease-hcb hover:bg-surface-0",
                    selectedIds.has(item.sourceTaskId) && "bg-accent/5"
                  )}
                  key={item.sourceTaskId}
                >
                  <input
                    aria-label={`Import ${item.title}`}
                    checked={selectedIds.has(item.sourceTaskId)}
                    className="mt-1 size-4 accent-[var(--accent)]"
                    onChange={() => toggleCandidate(item)}
                    type="checkbox"
                  />
                  <div className="min-w-0">
                    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="min-w-0 break-words font-medium text-text-primary">{item.title}</span>
                      <span className="inline-flex items-center gap-1 rounded-full bg-surface-0 px-2 py-0.5 text-[var(--text-xs)] text-text-secondary">
                        <ListTodo aria-hidden="true" size={12} />
                        {item.sourceListTitle}
                      </span>
                    </div>
                    {buildNotePreview(item.body) ? (
                      <p className="mt-1 line-clamp-2 text-[var(--text-sm)] leading-relaxed text-text-secondary">{buildNotePreview(item.body)}</p>
                    ) : (
                      <p className="mt-1 text-[var(--text-sm)] text-text-muted">No task details</p>
                    )}
                    <p className="mt-1 truncate text-[var(--text-xs)] text-text-muted" title={item.sourceTaskId}>
                      Original Google Task source · {item.sourceTaskId}
                    </p>
                  </div>
                </label>
              ))}
            </div>
            <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-4">
              <p className="text-[var(--text-sm)] text-text-secondary">Original Google Tasks will not be changed or deleted.</p>
              <div className="flex items-center gap-2">
                <Button disabled={submitting} onClick={onDismiss} variant="ghost">Not now</Button>
                <Button disabled={selectedCount === 0 || submitting} onClick={() => void importSelected()} variant="primary">
                  <Check aria-hidden="true" size={16} />
                  {submitting ? "Importing…" : `Import ${selectedCount} ${selectedCount === 1 ? "note" : "notes"}`}
                </Button>
              </div>
              {error ? <p className="basis-full text-[var(--text-sm)] text-danger" role="alert">{error}</p> : null}
            </footer>
          </>
        )}
      </section>
    </div>
  );
}
