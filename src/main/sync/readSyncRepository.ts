import type { JsonValue } from "@shared/domain/localData";
import type { HcbErrorCode } from "@shared/ipc/result";
import type { SqliteConnection, SqliteWriteOperation } from "../data/sqliteConnection";
import type {
  GoogleAccountConnectionStatusDto,
  GoogleCalendarEventMirror,
  GoogleCalendarListMirror,
  GoogleTaskListMirror,
  GoogleTaskMirror
} from "../google";
import type {
  ReadSyncResource,
  SanitizedSyncDiagnosticsDto,
  SanitizedSyncStatusDto,
  SyncProgressEvent
} from "./types";

export interface TaskWriteOptions {
  fullSync: boolean;
  now: string;
}

export interface CalendarEventWriteOptions {
  fullSync: boolean;
  now: string;
}

export class GoogleSyncRepository {
  private readonly connection: SqliteConnection;

  constructor(connection: SqliteConnection) {
    this.connection = connection;
    this.ensureSchema();
  }

  ensureSchema(): void {
    this.connection.exec(GOOGLE_SYNC_SCHEMA);
  }

  upsertAccountStatus(status: GoogleAccountConnectionStatusDto): void {
    this.connection.run(
      `INSERT INTO google_accounts (
        id, google_account_id, email, display_name, avatar_url, locale, time_zone,
        connection_state, granted_scopes_json, missing_scopes_json, last_authenticated_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        google_account_id = excluded.google_account_id,
        email = excluded.email,
        display_name = excluded.display_name,
        avatar_url = excluded.avatar_url,
        locale = excluded.locale,
        time_zone = excluded.time_zone,
        connection_state = excluded.connection_state,
        granted_scopes_json = excluded.granted_scopes_json,
        missing_scopes_json = excluded.missing_scopes_json,
        last_authenticated_at = excluded.last_authenticated_at,
        updated_at = excluded.updated_at,
        deleted_at = NULL;`,
      [
        status.accountId,
        status.googleAccountId ?? null,
        status.email ?? null,
        status.displayName ?? null,
        status.avatarUrl ?? null,
        status.locale ?? null,
        status.timeZone ?? null,
        status.connectionState,
        JSON.stringify(status.grantedScopes),
        JSON.stringify(status.missingScopes),
        status.lastAuthenticatedAt ?? null,
        status.updatedAt
      ]
    );
  }

  readCheckpoint(request: {
    accountId: string;
    resourceType: string;
    resourceId: string;
    checkpointType: string;
  }): string | null {
    const row = this.connection.get<{ checkpoint_value: string }>(
      `SELECT checkpoint_value
       FROM google_sync_checkpoints
       WHERE account_id = ? AND resource_type = ? AND resource_id = ? AND checkpoint_type = ?;`,
      [request.accountId, request.resourceType, request.resourceId, request.checkpointType]
    );

    return row?.checkpoint_value ?? null;
  }

  saveCheckpoint(request: {
    accountId: string;
    resourceType: string;
    resourceId: string;
    checkpointType: string;
    checkpointValue: string;
    metadata?: JsonValue;
    now: string;
  }): void {
    const id = checkpointId(request.accountId, request.resourceType, request.resourceId, request.checkpointType);

    this.connection.run(
      `INSERT INTO google_sync_checkpoints (
        id, account_id, resource_type, resource_id, checkpoint_type, checkpoint_value,
        metadata_json, last_successful_sync_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(account_id, resource_type, resource_id, checkpoint_type) DO UPDATE SET
        checkpoint_value = excluded.checkpoint_value,
        metadata_json = excluded.metadata_json,
        last_successful_sync_at = excluded.last_successful_sync_at,
        updated_at = excluded.updated_at;`,
      [
        id,
        request.accountId,
        request.resourceType,
        request.resourceId,
        request.checkpointType,
        request.checkpointValue,
        JSON.stringify(request.metadata ?? {}),
        request.now,
        request.now
      ]
    );
  }

  clearCheckpoint(request: {
    accountId: string;
    resourceType: string;
    resourceId: string;
    checkpointType: string;
  }): void {
    this.connection.run(
      `DELETE FROM google_sync_checkpoints
       WHERE account_id = ? AND resource_type = ? AND resource_id = ? AND checkpoint_type = ?;`,
      [request.accountId, request.resourceType, request.resourceId, request.checkpointType]
    );
  }

  writeTaskLists(accountId: string, taskLists: readonly GoogleTaskListMirror[], now: string): void {
    this.connection.executeTransaction(
      taskLists.map((taskList, index) => ({
        kind: "run",
        sql: `INSERT INTO google_task_lists (
          id, account_id, google_id, title, etag, sort_order, is_selected,
          sync_status, google_updated_at, created_at, updated_at, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
        ON CONFLICT(account_id, google_id) DO UPDATE SET
          title = excluded.title,
          etag = excluded.etag,
          sort_order = excluded.sort_order,
          sync_status = excluded.sync_status,
          google_updated_at = excluded.google_updated_at,
          updated_at = excluded.updated_at,
          deleted_at = NULL;`,
        params: [
          taskListLocalId(accountId, taskList.id),
          accountId,
          taskList.id,
          taskList.title,
          taskList.etag ?? null,
          index,
          1,
          "synced",
          taskList.updatedAt ?? null,
          now,
          now
        ]
      }))
    );
  }

  writeTasks(
    accountId: string,
    taskListGoogleId: string,
    tasks: readonly GoogleTaskMirror[],
    options: TaskWriteOptions
  ): void {
    const taskListId = taskListLocalId(accountId, taskListGoogleId);
    const operations: SqliteWriteOperation[] = [];

    if (options.fullSync) {
      operations.push({
        kind: "run",
        sql: `UPDATE google_tasks
              SET deleted_at = ?, updated_at = ?
              WHERE account_id = ? AND task_list_id = ? AND deleted_at IS NULL;`,
        params: [options.now, options.now, accountId, taskListId]
      });
    }

    operations.push(
      ...tasks.map((task, index) => ({
        kind: "run" as const,
        sql: `INSERT INTO google_tasks (
          id, account_id, task_list_id, google_id, parent_task_id, title, notes,
          status, due_at, due_time_zone, completed_at, position, sort_order,
          is_hidden, etag, google_updated_at, created_at, updated_at, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(account_id, task_list_id, google_id) DO UPDATE SET
          parent_task_id = excluded.parent_task_id,
          title = excluded.title,
          notes = excluded.notes,
          status = excluded.status,
          due_at = excluded.due_at,
          due_time_zone = excluded.due_time_zone,
          completed_at = excluded.completed_at,
          position = excluded.position,
          sort_order = excluded.sort_order,
          is_hidden = excluded.is_hidden,
          etag = excluded.etag,
          google_updated_at = excluded.google_updated_at,
          updated_at = excluded.updated_at,
          deleted_at = excluded.deleted_at;`,
        params: [
          taskLocalId(accountId, taskListGoogleId, task.id),
          accountId,
          taskListId,
          task.id,
          task.parentId === undefined || task.parentId === null
            ? null
            : taskLocalId(accountId, taskListGoogleId, task.parentId),
          task.title,
          task.notes ?? null,
          task.status,
          task.dueAt ?? null,
          null,
          task.completedAt ?? null,
          task.position ?? null,
          index,
          boolInt(task.hidden),
          task.etag ?? null,
          task.updatedAt ?? null,
          options.now,
          options.now,
          task.deleted ? options.now : null
        ]
      }))
    );

    this.connection.executeTransaction(operations);
  }

  writeCalendarLists(
    accountId: string,
    calendars: readonly GoogleCalendarListMirror[],
    now: string
  ): void {
    this.connection.executeTransaction(
      calendars.map((calendar) => ({
        kind: "run",
        sql: `INSERT INTO google_calendar_lists (
          id, account_id, google_id, summary, description, time_zone, background_color,
          foreground_color, access_role, is_selected, is_hidden, is_primary, etag,
          google_updated_at, created_at, updated_at, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
        ON CONFLICT(account_id, google_id) DO UPDATE SET
          summary = excluded.summary,
          description = excluded.description,
          time_zone = excluded.time_zone,
          background_color = excluded.background_color,
          foreground_color = excluded.foreground_color,
          access_role = excluded.access_role,
          is_selected = excluded.is_selected,
          is_hidden = excluded.is_hidden,
          is_primary = excluded.is_primary,
          etag = excluded.etag,
          google_updated_at = excluded.google_updated_at,
          updated_at = excluded.updated_at,
          deleted_at = NULL;`,
        params: [
          calendarLocalId(accountId, calendar.id),
          accountId,
          calendar.id,
          calendar.summary,
          calendar.description ?? null,
          calendar.timeZone ?? null,
          calendar.backgroundColor ?? null,
          calendar.foregroundColor ?? null,
          calendar.accessRole ?? null,
          boolInt(calendar.isSelected),
          boolInt(calendar.isHidden),
          boolInt(calendar.isPrimary),
          calendar.etag ?? null,
          calendar.updatedAt ?? null,
          now,
          now
        ]
      }))
    );
  }

  writeCalendarEvents(
    accountId: string,
    calendarGoogleId: string,
    events: readonly GoogleCalendarEventMirror[],
    options: CalendarEventWriteOptions
  ): void {
    const calendarId = calendarLocalId(accountId, calendarGoogleId);
    const operations: SqliteWriteOperation[] = [];

    if (options.fullSync) {
      operations.push({
        kind: "run",
        sql: `UPDATE google_calendar_events
              SET deleted_at = ?, updated_at = ?
              WHERE account_id = ? AND calendar_id = ? AND deleted_at IS NULL;`,
        params: [options.now, options.now, accountId, calendarId]
      });
    }

    operations.push(
      ...events.map((event) => ({
        kind: "run" as const,
        sql: `INSERT INTO google_calendar_events (
          id, account_id, calendar_id, google_id, recurring_event_id, original_start_at,
          status, summary, description, location, start_at, start_time_zone, end_at,
          end_time_zone, is_all_day, recurrence_rule, transparency, visibility, etag,
          sequence, google_updated_at, created_at, updated_at, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(account_id, calendar_id, google_id) DO UPDATE SET
          recurring_event_id = excluded.recurring_event_id,
          original_start_at = excluded.original_start_at,
          status = excluded.status,
          summary = excluded.summary,
          description = excluded.description,
          location = excluded.location,
          start_at = excluded.start_at,
          start_time_zone = excluded.start_time_zone,
          end_at = excluded.end_at,
          end_time_zone = excluded.end_time_zone,
          is_all_day = excluded.is_all_day,
          recurrence_rule = excluded.recurrence_rule,
          transparency = excluded.transparency,
          visibility = excluded.visibility,
          etag = excluded.etag,
          sequence = excluded.sequence,
          google_updated_at = excluded.google_updated_at,
          updated_at = excluded.updated_at,
          deleted_at = excluded.deleted_at;`,
        params: [
          eventLocalId(accountId, calendarGoogleId, event.id),
          accountId,
          calendarId,
          event.id,
          event.recurringEventId ?? null,
          event.originalStartAt ?? null,
          event.status,
          event.summary,
          event.description ?? null,
          event.location ?? null,
          event.startAt,
          event.startTimeZone ?? null,
          event.endAt,
          event.endTimeZone ?? null,
          boolInt(event.isAllDay),
          event.recurrenceRule ?? null,
          event.transparency ?? null,
          event.visibility ?? null,
          event.etag ?? null,
          event.sequence ?? null,
          event.updatedAt ?? null,
          options.now,
          options.now,
          event.status === "cancelled" ? options.now : null
        ]
      }))
    );

    this.connection.executeTransaction(operations);
  }

  recordProgressEvent(event: SyncProgressEvent): void {
    this.connection.run(
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

  recordDiagnostics(diagnostics: SanitizedSyncDiagnosticsDto): void {
    this.connection.run(
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

  syncStatus(): SanitizedSyncStatusDto {
    const pendingMutationCount =
      this.connection.get<{ count: number }>(
        `SELECT COUNT(*) AS count
         FROM google_pending_mutations
         WHERE status IN ('pending', 'applying', 'failed');`
      )?.count ?? 0;
    const latest = this.connection.get<{
      state: "running" | "idle" | "error";
      completed_at: string | null;
      duration_ms: number | null;
      last_error_code: HcbErrorCode | null;
    }>(
      `SELECT state, completed_at, duration_ms, last_error_code
       FROM google_sync_diagnostics
       ORDER BY started_at DESC
       LIMIT 1;`
    );

    return {
      state: latest?.state ?? "idle",
      pendingMutationCount,
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
}

export function taskListLocalId(accountId: string, googleId: string): string {
  return `${accountId}:task-list:${googleId}`;
}

export function taskLocalId(accountId: string, taskListGoogleId: string, googleId: string): string {
  return `${accountId}:task:${taskListGoogleId}:${googleId}`;
}

export function calendarLocalId(accountId: string, googleId: string): string {
  return `${accountId}:calendar:${googleId}`;
}

export function eventLocalId(accountId: string, calendarGoogleId: string, googleId: string): string {
  return `${accountId}:event:${calendarGoogleId}:${googleId}`;
}

function checkpointId(
  accountId: string,
  resourceType: string,
  resourceId: string,
  checkpointType: string
): string {
  return `${accountId}:checkpoint:${resourceType}:${resourceId}:${checkpointType}`;
}

function boolInt(value: boolean): number {
  return value ? 1 : 0;
}

const GOOGLE_SYNC_SCHEMA = `
CREATE TABLE IF NOT EXISTS google_accounts (
  id TEXT PRIMARY KEY,
  google_account_id TEXT,
  email TEXT,
  display_name TEXT,
  avatar_url TEXT,
  locale TEXT,
  time_zone TEXT,
  connection_state TEXT NOT NULL,
  granted_scopes_json TEXT NOT NULL,
  missing_scopes_json TEXT NOT NULL,
  last_authenticated_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS google_task_lists (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  google_id TEXT NOT NULL,
  title TEXT NOT NULL,
  etag TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_selected INTEGER NOT NULL DEFAULT 1,
  sync_status TEXT NOT NULL DEFAULT 'synced',
  google_updated_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE(account_id, google_id)
);

CREATE TABLE IF NOT EXISTS google_tasks (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  task_list_id TEXT NOT NULL,
  google_id TEXT NOT NULL,
  parent_task_id TEXT,
  title TEXT NOT NULL,
  notes TEXT,
  status TEXT NOT NULL,
  due_at TEXT,
  due_time_zone TEXT,
  completed_at TEXT,
  position TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_hidden INTEGER NOT NULL DEFAULT 0,
  etag TEXT,
  google_updated_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE(account_id, task_list_id, google_id)
);

CREATE INDEX IF NOT EXISTS idx_google_tasks_list_status_due
  ON google_tasks(account_id, task_list_id, status, due_at, sort_order);

CREATE TABLE IF NOT EXISTS google_calendar_lists (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  google_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  description TEXT,
  time_zone TEXT,
  background_color TEXT,
  foreground_color TEXT,
  access_role TEXT,
  is_selected INTEGER NOT NULL DEFAULT 1,
  is_hidden INTEGER NOT NULL DEFAULT 0,
  is_primary INTEGER NOT NULL DEFAULT 0,
  etag TEXT,
  google_updated_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE(account_id, google_id)
);

CREATE TABLE IF NOT EXISTS google_calendar_events (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  calendar_id TEXT NOT NULL,
  google_id TEXT NOT NULL,
  recurring_event_id TEXT,
  original_start_at TEXT,
  status TEXT NOT NULL,
  summary TEXT NOT NULL,
  description TEXT,
  location TEXT,
  start_at TEXT NOT NULL,
  start_time_zone TEXT,
  end_at TEXT NOT NULL,
  end_time_zone TEXT,
  is_all_day INTEGER NOT NULL DEFAULT 0,
  recurrence_rule TEXT,
  transparency TEXT,
  visibility TEXT,
  etag TEXT,
  sequence INTEGER,
  google_updated_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE(account_id, calendar_id, google_id)
);

CREATE INDEX IF NOT EXISTS idx_google_calendar_events_range
  ON google_calendar_events(account_id, calendar_id, start_at, end_at, status);

CREATE TABLE IF NOT EXISTS google_sync_checkpoints (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  checkpoint_type TEXT NOT NULL,
  checkpoint_value TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  last_successful_sync_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(account_id, resource_type, resource_id, checkpoint_type)
);

CREATE TABLE IF NOT EXISTS google_sync_diagnostics (
  run_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  state TEXT NOT NULL,
  resources_json TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  duration_ms INTEGER,
  last_error_code TEXT,
  retry_after_ms INTEGER,
  task_list_count INTEGER,
  task_count INTEGER,
  calendar_list_count INTEGER,
  event_count INTEGER
);

CREATE INDEX IF NOT EXISTS idx_google_sync_diagnostics_started
  ON google_sync_diagnostics(started_at DESC);

CREATE TABLE IF NOT EXISTS google_sync_progress_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  resource TEXT,
  stage TEXT,
  completed_count INTEGER,
  total_count INTEGER,
  duration_ms INTEGER,
  error_code TEXT,
  retry_after_ms INTEGER,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS google_pending_mutations (
  id TEXT PRIMARY KEY,
  account_id TEXT,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_retry_at TEXT,
  last_error_code TEXT,
  last_error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  applied_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_google_pending_mutations_status_retry
  ON google_pending_mutations(status, next_retry_at, resource_type);
`;
