import type { HcbErrorCode } from "@shared/ipc/result";
import type { SqliteConnection } from "../../data/sqliteConnection";
import type {
  SanitizedSyncDiagnosticsDto,
  SanitizedSyncStatusDto,
  SyncProgressEvent
} from "../types";
import type { GoogleCacheDiagnostics, SelectedResourceDiagnostics } from "./types";
import { countRows } from "./json";

export function recordProgressEvent(connection: SqliteConnection, event: SyncProgressEvent): void {
  connection.run(
    `INSERT INTO google_sync_progress_events (
      run_id, account_id, event_type, resource, stage, completed_count, total_count,
      duration_ms, error_code, retry_after_ms, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    [
      event.runId,
      event.accountId,
      event.type,
      event.resource ?? null,
      event.stage ?? null,
      event.completedCount ?? null,
      event.totalCount ?? null,
      event.durationMs ?? null,
      event.errorCode ?? null,
      event.retryAfterMs ?? null,
      event.at
    ]
  );
}

export function recordDiagnostics(
  connection: SqliteConnection,
  diagnostics: SanitizedSyncDiagnosticsDto
): void {
  connection.run(
    `INSERT INTO google_sync_diagnostics (
      run_id, account_id, state, resources_json, started_at, completed_at, duration_ms,
      last_error_code, retry_after_ms, task_list_count, task_count, calendar_list_count, event_count
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(run_id) DO UPDATE SET
      state = excluded.state,
      resources_json = excluded.resources_json,
      completed_at = excluded.completed_at,
      duration_ms = excluded.duration_ms,
      last_error_code = excluded.last_error_code,
      retry_after_ms = excluded.retry_after_ms,
      task_list_count = excluded.task_list_count,
      task_count = excluded.task_count,
      calendar_list_count = excluded.calendar_list_count,
      event_count = excluded.event_count;`,
    [
      diagnostics.runId,
      diagnostics.accountId,
      diagnostics.state,
      JSON.stringify(diagnostics.resources),
      diagnostics.startedAt,
      diagnostics.completedAt ?? null,
      diagnostics.durationMs ?? null,
      diagnostics.lastErrorCode ?? null,
      diagnostics.retryAfterMs ?? null,
      diagnostics.taskListCount ?? null,
      diagnostics.taskCount ?? null,
      diagnostics.calendarListCount ?? null,
      diagnostics.eventCount ?? null
    ]
  );
}

export function syncStatus(connection: SqliteConnection): SanitizedSyncStatusDto {
  const pendingMutationCount =
    connection.get<{ count: number }>(
      `SELECT COUNT(*) AS count
       FROM google_pending_mutations
       WHERE status IN ('pending', 'applying', 'failed');`
    )?.count ?? 0;
  const latest = connection.get<{
    state: "running" | "idle" | "error";
    started_at: string;
    completed_at: string | null;
    duration_ms: number | null;
    last_error_code: HcbErrorCode | null;
  }>(
    `SELECT state, started_at, completed_at, duration_ms, last_error_code
     FROM google_sync_diagnostics
     ORDER BY started_at DESC
     LIMIT 1;`
  );

  return {
    state: latest?.state ?? "idle",
    pendingMutationCount,
    ...(latest?.started_at === undefined ? {} : { lastStartedAt: latest.started_at }),
    ...(latest?.completed_at === undefined || latest.completed_at === null
      ? {}
      : { lastCompletedAt: latest.completed_at }),
    ...(latest?.last_error_code === undefined || latest.last_error_code === null
      ? {}
      : { lastErrorCode: latest.last_error_code }),
    ...(latest?.duration_ms === undefined || latest.duration_ms === null
      ? {}
      : { lastDurationMs: latest.duration_ms })
  };
}

export function cacheDiagnostics(connection: SqliteConnection): GoogleCacheDiagnostics {
  return {
    taskListCount: countRows(
      connection,
      "SELECT COUNT(*) AS count FROM google_task_lists WHERE deleted_at IS NULL;"
    ),
    taskCount: countRows(
      connection,
      "SELECT COUNT(*) AS count FROM google_tasks WHERE deleted_at IS NULL;"
    ),
    calendarCount: countRows(
      connection,
      `SELECT COUNT(*) AS count
       FROM google_calendar_lists
       WHERE deleted_at IS NULL AND is_hidden = 0;`
    ),
    eventCount: countRows(
      connection,
      `SELECT COUNT(*) AS count
       FROM google_calendar_events
       WHERE deleted_at IS NULL AND status != 'cancelled';`
    ),
    noteCount: countRows(
      connection,
      `SELECT COUNT(*) AS count
       FROM google_tasks tasks
       INNER JOIN google_task_lists lists ON lists.id = tasks.task_list_id
       WHERE tasks.deleted_at IS NULL
         AND tasks.is_hidden = 0
         AND tasks.status != 'completed'
         AND tasks.parent_task_id IS NULL
         AND tasks.due_at IS NULL
         AND lists.deleted_at IS NULL;`
    ),
    performanceSampleCount: countRows(
      connection,
      "SELECT COUNT(*) AS count FROM local_performance_timings;"
    )
  };
}

export function selectedResourceDiagnostics(
  connection: SqliteConnection,
  settings: {
    selectedTaskListIds: readonly string[];
    selectedCalendarIds: readonly string[];
  }
): SelectedResourceDiagnostics {
  const taskListSelection = new Set(settings.selectedTaskListIds);
  const calendarSelection = new Set(settings.selectedCalendarIds);
  const taskLists = connection
    .query<{ id: string; title: string }>(
      `SELECT id, title
       FROM google_task_lists
       WHERE deleted_at IS NULL
       ORDER BY sort_order ASC, title COLLATE NOCASE ASC, id ASC
       LIMIT 100;`
    )
    .map((row) => ({
      id: row.id,
      title: row.title,
      selected: taskListSelection.size === 0 || taskListSelection.has(row.id)
    }));
  const calendars = connection
    .query<{ id: string; title: string; selected: number }>(
      `SELECT id, summary AS title, is_selected AS selected
       FROM google_calendar_lists
       WHERE deleted_at IS NULL AND is_hidden = 0
       ORDER BY is_primary DESC, summary COLLATE NOCASE ASC, id ASC
       LIMIT 100;`
    )
    .map((row) => ({
      id: row.id,
      title: row.title,
      selected: calendarSelection.size === 0 ? row.selected === 1 : calendarSelection.has(row.id)
    }));

  return {
    taskLists,
    calendars
  };
}

export function clearLocalGoogleCache(
  connection: SqliteConnection,
  now = new Date().toISOString()
): void {
  connection.executeTransaction([
    {
      kind: "run",
      sql: "DELETE FROM google_sync_checkpoints;"
    },
    {
      kind: "run",
      sql: "DELETE FROM google_sync_progress_events;"
    },
    {
      kind: "run",
      sql: "DELETE FROM google_sync_diagnostics;"
    },
    {
      kind: "run",
      sql: "DELETE FROM google_calendar_event_instances;"
    },
    {
      kind: "run",
      sql: "DELETE FROM google_calendar_events;"
    },
    {
      kind: "run",
      sql: "DELETE FROM google_calendar_lists;"
    },
    {
      kind: "run",
      sql: "DELETE FROM google_tasks;"
    },
    {
      kind: "run",
      sql: "DELETE FROM google_task_lists;"
    },
    {
      kind: "run",
      sql: `INSERT INTO google_sync_diagnostics (
        run_id, account_id, state, resources_json, started_at, completed_at, duration_ms,
        last_error_code, retry_after_ms, task_list_count, task_count, calendar_list_count, event_count
      ) VALUES (?, ?, 'idle', ?, ?, ?, 0, NULL, NULL, 0, 0, 0, 0);`,
      params: [`cache-clear:${now}`, "local-google-account", JSON.stringify([]), now, now]
    }
  ]);
}
