import type { HcbErrorCode } from "@shared/ipc/result";
import type { GoogleAccountConnectionStatusDto } from "../google";

export type ReadSyncResource = "tasks" | "calendar";

export interface ReadSyncRunRequest {
  account: GoogleAccountConnectionStatusDto;
  resources?: readonly ReadSyncResource[];
  full?: boolean;
  dryRun?: boolean;
  attempt?: number;
  completedTaskRetentionDaysBack?: number;
  eventRetentionDaysBack?: number;
}

export type SyncProgressEventType =
  | "sync.started"
  | "sync.completed"
  | "sync.failed"
  | "resource.started"
  | "resource.progress"
  | "resource.completed"
  | "resource.failed"
  | "checkpoint.invalid"
  | "backoff.scheduled";

export interface SyncProgressEvent {
  runId: string;
  type: SyncProgressEventType;
  accountId: string;
  resource?: ReadSyncResource;
  stage?: string;
  completedCount?: number;
  totalCount?: number;
  durationMs?: number;
  errorCode?: HcbErrorCode;
  retryAfterMs?: number;
  at: string;
}

export interface SanitizedSyncDiagnosticsDto {
  runId: string;
  accountId: string;
  state: "running" | "idle" | "error";
  resources: readonly ReadSyncResource[];
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  lastErrorCode?: HcbErrorCode;
  retryAfterMs?: number;
  taskListCount?: number;
  taskCount?: number;
  calendarListCount?: number;
  eventCount?: number;
}

export interface SanitizedSyncStatusDto {
  state: "idle" | "running" | "error";
  pendingMutationCount: number;
  lastCompletedAt?: string;
  lastErrorCode?: HcbErrorCode;
  lastDurationMs?: number;
}

export interface ReadSyncResourceSummary {
  resource: ReadSyncResource;
  listCount: number;
  itemCount: number;
  fullSyncCount: number;
  durationMs: number;
}

export interface ReadSyncFailure {
  code: HcbErrorCode;
  message: string;
  recoverable: boolean;
  retryAfterMs?: number;
}

export type ReadSyncResult =
  | {
      ok: true;
      diagnostics: SanitizedSyncDiagnosticsDto;
      summaries: readonly ReadSyncResourceSummary[];
      events: readonly SyncProgressEvent[];
    }
  | {
      ok: false;
      error: ReadSyncFailure;
      diagnostics: SanitizedSyncDiagnosticsDto;
      summaries: readonly ReadSyncResourceSummary[];
      events: readonly SyncProgressEvent[];
    };
