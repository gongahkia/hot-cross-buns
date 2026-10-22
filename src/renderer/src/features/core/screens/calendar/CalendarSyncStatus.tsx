import { AlertCircle, CloudUpload } from "lucide-react";
import type { SyncStatusResponse } from "@shared/ipc/contracts";
import type { CalendarEventViewModel } from "../../coreViewModels";

export function openCalendarSyncDetails(): void {
  window.dispatchEvent(new CustomEvent("hcb:open-diagnostics", { detail: { tab: "sync" } }));
}

export function CalendarSyncBadge({ state }: { state: CalendarEventViewModel["mutationState"] }) {
  if (state !== "queued" && state !== "failed") return null;
  const label = state === "failed" ? "Google sync failed — review sync details" : "Saved locally — waiting for Google sync";
  const Icon = state === "failed" ? AlertCircle : CloudUpload;
  return <span role="img" aria-label={label} title={label} className={`calendar-sync-badge ${state === "failed" ? "text-danger" : "text-text-muted"}`}>
    <Icon aria-hidden="true" size={13} />
  </span>;
}

export function CalendarSyncStatus({ loading, error, onRetry, sync, offline, stale, hasRemote }: {
  loading: boolean; error?: string; onRetry: () => void; sync: SyncStatusResponse;
  offline: boolean; stale: boolean; hasRemote: boolean;
}) {
  const queued = sync.pendingMutationCount;
  const failed = (sync.failedMutationCount ?? 0) > 0 || sync.state === "error";
  const message = loading ? "Loading calendar dates…"
    : error ? "Calendar dates could not be loaded. This view may be incomplete."
    : offline ? `Offline · showing cached calendar${queued ? ` · ${queued} changes waiting` : ""}`
    : failed ? "Some changes have not reached Google. Review sync details."
    : sync.state === "syncing" ? "Syncing with Google…"
    : hasRemote && queued ? `${queued} ${queued === 1 ? "change" : "changes"} saved locally · waiting for Google sync`
    : stale || (hasRemote && !sync.lastCompletedAt) ? "Showing cached calendar · Google sync not yet checked"
    : hasRemote ? `Last Google sync: ${new Date(sync.lastCompletedAt!).toLocaleString()}` : "Saved on this device";
  return <div className="calendar-sync-status">
    <span role="status" aria-label="Calendar status">{message}</span>
    {error ? <button type="button" onClick={onRetry}>Retry loading dates</button> : null}
    {hasRemote || failed ? <button type="button" onClick={openCalendarSyncDetails}>{failed ? "Review sync" : "Sync details"}</button> : null}
  </div>;
}
