import { randomUUID } from "node:crypto";
import type { JsonValue } from "@shared/domain/localData";
import {
  addUtcDays,
  normalizeGuestEmails,
  normalizeReminderMinutes
} from "@shared/domain/calendar";
import type { HcbErrorCode } from "@shared/ipc/result";
import type { SqliteConnection, SqliteWriteOperation } from "../data/sqliteConnection";
import { sanitizeGoogleAccountConnectionStatus } from "../google";
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

export interface GoogleCacheDiagnostics {
  taskListCount: number;
  taskCount: number;
  calendarCount: number;
  eventCount: number;
  noteCount: number;
  performanceSampleCount: number;
}

export interface GoogleCheckpointDiagnostics {
  totalCount: number;
  tasksCount: number;
  calendarCount: number;
  lastUpdatedAt?: string;
}

export interface PendingMutationDiagnostics {
  totalCount: number;
  pendingCount: number;
  applyingCount: number;
  failedCount: number;
  retryableCount: number;
  authPausedCount: number;
  nextRetryAt?: string;
  lastErrorCode?: HcbErrorCode;
  byResourceType: Array<{ resourceType: string; count: number }>;
}

export interface SelectedResourceDiagnostics {
  taskLists: Array<{ id: string; title: string; selected: boolean }>;
  calendars: Array<{ id: string; title: string; selected: boolean }>;
}

export type PendingGoogleMutationResourceType = "task" | "task_list" | "event";
export type PendingGoogleMutationStatus = "pending" | "applying" | "failed" | "applied" | "cancelled";

export interface PendingGoogleMutation {
  id: string;
  accountId: string | null;
  resourceType: PendingGoogleMutationResourceType;
  resourceId: string;
  operation: string;
  payload: JsonValue;
  status: PendingGoogleMutationStatus;
  attemptCount: number;
  nextRetryAt: string | null;
  lastErrorCode: HcbErrorCode | null;
  lastErrorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  appliedAt: string | null;
}

export interface TaskListMutationTarget extends Record<string, unknown> {
  id: string;
  accountId: string;
  googleId: string;
  title: string;
  etag: string | null;
  deletedAt: string | null;
}

export interface TaskMutationTarget extends Record<string, unknown> {
  id: string;
  accountId: string;
  googleId: string;
  taskListId: string;
  taskListGoogleId: string;
  parentTaskId: string | null;
  parentGoogleId: string | null;
  title: string;
  notes: string | null;
  status: "needsAction" | "completed";
  dueAt: string | null;
  completedAt: string | null;
  position: string | null;
  etag: string | null;
  deletedAt: string | null;
}

export interface CalendarMutationTarget extends Record<string, unknown> {
  id: string;
  accountId: string;
  googleId: string;
  summary: string;
  timeZone: string | null;
}

export interface CalendarEventMutationTarget extends Record<string, unknown> {
  id: string;
  accountId: string;
  googleId: string;
  calendarId: string;
  calendarGoogleId: string;
  summary: string;
  description: string | null;
  location: string | null;
  startAt: string;
  startTimeZone: string | null;
  endAt: string;
  endTimeZone: string | null;
  isAllDay: boolean;
  attendeeEmails: string[];
  reminderMinutes: number[];
  etag: string | null;
  deletedAt: string | null;
}

export class GoogleSyncRepository {
  private readonly connection: SqliteConnection;

  constructor(connection: SqliteConnection) {
    this.connection = connection;
    this.ensureSchema();
  }

  ensureSchema(): void {
    this.connection.exec(GOOGLE_SYNC_SCHEMA);
    this.ensureTaskColumns();
    this.ensureEventColumns();
    this.ensureSearchIndexes();
  }

  private ensureTaskColumns(): void {
    const existingColumns = new Set(
      this.connection
        .query<{ name: string }>("PRAGMA table_info(google_tasks);")
        .map((row) => row.name)
    );

    if (!existingColumns.has("local_priority")) {
      this.connection.exec(
        "ALTER TABLE google_tasks ADD COLUMN local_priority TEXT NOT NULL DEFAULT 'none';"
      );
    }
  }

  private ensureEventColumns(): void {
    const existingColumns = new Set(
      this.connection
        .query<{ name: string }>("PRAGMA table_info(google_calendar_events);")
        .map((row) => row.name)
    );
    const addColumn = (name: string, definition: string) => {
      if (!existingColumns.has(name)) {
        this.connection.exec(`ALTER TABLE google_calendar_events ADD COLUMN ${definition};`);
      }
    };

    addColumn("attendee_emails_json", "attendee_emails_json TEXT NOT NULL DEFAULT '[]'");
    addColumn("reminder_minutes_json", "reminder_minutes_json TEXT NOT NULL DEFAULT '[]'");
  }

  private ensureSearchIndexes(): void {
    const stateName = "google-fts-v1";
    const current = this.connection.get<{ version: number }>(
      `SELECT version
       FROM local_search_index_state
       WHERE name = ?
       LIMIT 1;`,
      [stateName]
    );

    if (current?.version === 1) {
      return;
    }

    for (const table of [
      "google_task_lists_fts",
      "google_tasks_fts",
      "google_calendar_lists_fts",
      "google_calendar_events_fts"
    ]) {
      this.connection.run(`INSERT INTO ${table}(${table}) VALUES ('rebuild');`);
    }

    this.connection.run(
      `INSERT INTO local_search_index_state (name, version, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET
         version = excluded.version,
         updated_at = excluded.updated_at;`,
      [stateName, 1, new Date().toISOString()]
    );
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

  latestAccountStatus(): GoogleAccountConnectionStatusDto | null {
    const row = this.connection.get<{
      id: string;
      google_account_id: string | null;
      email: string | null;
      display_name: string | null;
      avatar_url: string | null;
      locale: string | null;
      time_zone: string | null;
      connection_state: GoogleAccountConnectionStatusDto["connectionState"];
      granted_scopes_json: string;
      last_authenticated_at: string | null;
      updated_at: string;
    }>(
      `SELECT
         id,
         google_account_id,
         email,
         display_name,
         avatar_url,
         locale,
         time_zone,
         connection_state,
         granted_scopes_json,
         last_authenticated_at,
         updated_at
       FROM google_accounts
       WHERE deleted_at IS NULL
       ORDER BY updated_at DESC
       LIMIT 1;`
    );

    return row === undefined ? null : accountStatusFromRow(row);
  }

  accountStatus(accountId: string): GoogleAccountConnectionStatusDto | null {
    const row = this.connection.get<{
      id: string;
      google_account_id: string | null;
      email: string | null;
      display_name: string | null;
      avatar_url: string | null;
      locale: string | null;
      time_zone: string | null;
      connection_state: GoogleAccountConnectionStatusDto["connectionState"];
      granted_scopes_json: string;
      last_authenticated_at: string | null;
      updated_at: string;
    }>(
      `SELECT
         id,
         google_account_id,
         email,
         display_name,
         avatar_url,
         locale,
         time_zone,
         connection_state,
         granted_scopes_json,
         last_authenticated_at,
         updated_at
       FROM google_accounts
       WHERE deleted_at IS NULL
         AND id = ?
       LIMIT 1;`,
      [accountId]
    );

    return row === undefined ? null : accountStatusFromRow(row);
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
          is_hidden, local_priority, etag, google_updated_at, created_at, updated_at, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
          "none",
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
      operations.push({
        kind: "run",
        sql: `UPDATE google_calendar_event_instances
              SET deleted_at = ?, updated_at = ?
              WHERE account_id = ? AND calendar_id = ? AND deleted_at IS NULL;`,
        params: [options.now, options.now, accountId, calendarId]
      });
    }

    for (const event of events) {
      const localEventId = eventLocalId(accountId, calendarGoogleId, event.id);

      operations.push({
        kind: "run",
        sql: `INSERT INTO google_calendar_events (
          id, account_id, calendar_id, google_id, recurring_event_id, original_start_at,
          status, summary, description, location, start_at, start_time_zone, end_at,
          end_time_zone, is_all_day, recurrence_rule, transparency, visibility, etag,
          sequence, attendee_emails_json, reminder_minutes_json, google_updated_at,
          created_at, updated_at, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
          attendee_emails_json = excluded.attendee_emails_json,
          reminder_minutes_json = excluded.reminder_minutes_json,
          google_updated_at = excluded.google_updated_at,
          updated_at = excluded.updated_at,
          deleted_at = excluded.deleted_at;`,
        params: [
          localEventId,
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
          JSON.stringify(normalizeGuestEmails(event.attendeeEmails)),
          JSON.stringify(normalizeReminderMinutes(event.reminderMinutes)),
          event.updatedAt ?? null,
          options.now,
          options.now,
          event.status === "cancelled" ? options.now : null
        ]
      });

      operations.push(...calendarEventInstanceOperations({
        accountId,
        calendarId,
        calendarGoogleId,
        event,
        eventId: localEventId,
        now: options.now
      }));
    }

    this.connection.executeTransaction(operations);
  }

  enqueuePendingMutation(input: {
    accountId: string | null;
    resourceType: "task" | "task_list" | "event";
    resourceId: string;
    operation: string;
    payload: JsonValue;
    now: string;
  }): { id: string; queued: true } {
    const id = `mutation:${input.resourceType}:${randomUUID()}`;

    this.connection.run(
      `INSERT INTO google_pending_mutations (
        id, account_id, resource_type, resource_id, operation, payload_json, status,
        attempt_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?);`,
      [
        id,
        input.accountId,
        input.resourceType,
        input.resourceId,
        input.operation,
        JSON.stringify(input.payload),
        input.now,
        input.now
      ]
    );

    return { id, queued: true };
  }

  listDuePendingMutations(options: {
    now: string;
    limit?: number;
  }): PendingGoogleMutation[] {
    const limit = Math.max(1, Math.min(100, options.limit ?? 25));

    return this.connection
      .query<PendingGoogleMutationRow>(
        `SELECT
           id,
           account_id AS accountId,
           resource_type AS resourceType,
           resource_id AS resourceId,
           operation,
           payload_json AS payloadJson,
           status,
           attempt_count AS attemptCount,
           next_retry_at AS nextRetryAt,
           last_error_code AS lastErrorCode,
           last_error_message AS lastErrorMessage,
           created_at AS createdAt,
           updated_at AS updatedAt,
           applied_at AS appliedAt
         FROM google_pending_mutations
         WHERE resource_type IN ('task', 'task_list', 'event')
           AND (
             (status = 'pending' AND (next_retry_at IS NULL OR next_retry_at <= ?))
             OR
             (status = 'failed' AND next_retry_at IS NOT NULL AND next_retry_at <= ?)
           )
         ORDER BY created_at ASC, id ASC
         LIMIT ?;`,
        [options.now, options.now, limit]
      )
      .map(pendingMutationFromRow);
  }

  pendingMutationById(id: string): PendingGoogleMutation | null {
    const row = this.connection.get<PendingGoogleMutationRow>(
      `SELECT
         id,
         account_id AS accountId,
         resource_type AS resourceType,
         resource_id AS resourceId,
         operation,
         payload_json AS payloadJson,
         status,
         attempt_count AS attemptCount,
         next_retry_at AS nextRetryAt,
         last_error_code AS lastErrorCode,
         last_error_message AS lastErrorMessage,
         created_at AS createdAt,
         updated_at AS updatedAt,
         applied_at AS appliedAt
       FROM google_pending_mutations
       WHERE id = ?
       LIMIT 1;`,
      [id]
    );

    return row === undefined ? null : pendingMutationFromRow(row);
  }

  claimPendingMutation(id: string, now: string): PendingGoogleMutation | null {
    const result = this.connection.run(
      `UPDATE google_pending_mutations
       SET status = 'applying',
           updated_at = ?
       WHERE id = ?
         AND status IN ('pending', 'failed', 'applying');`,
      [now, id]
    );

    return result.changes > 0 ? this.pendingMutationById(id) : null;
  }

  markMutationApplied(id: string, now: string): void {
    this.connection.run(
      `UPDATE google_pending_mutations
       SET status = 'applied',
           next_retry_at = NULL,
           last_error_code = NULL,
           last_error_message = NULL,
           updated_at = ?,
           applied_at = ?
       WHERE id = ?;`,
      [now, now, id]
    );
  }

  markMutationFailed(input: {
    id: string;
    attemptCount: number;
    errorCode: HcbErrorCode;
    errorMessage: string;
    nextRetryAt?: string | null;
    now: string;
  }): void {
    this.connection.run(
      `UPDATE google_pending_mutations
       SET status = 'failed',
           attempt_count = ?,
           next_retry_at = ?,
           last_error_code = ?,
           last_error_message = ?,
           updated_at = ?
       WHERE id = ?;`,
      [
        input.attemptCount,
        input.nextRetryAt ?? null,
        input.errorCode,
        input.errorMessage,
        input.now,
        input.id
      ]
    );
  }

  pauseAccountForMutationAuthFailure(input: {
    accountId: string;
    connectionState: "reauth_required" | "sync_paused";
    now: string;
  }): void {
    this.connection.run(
      `UPDATE google_accounts
       SET connection_state = ?,
           updated_at = ?
       WHERE id = ?
         AND deleted_at IS NULL;`,
      [input.connectionState, input.now, input.accountId]
    );
  }

  taskListMutationTarget(id: string): TaskListMutationTarget | null {
    return this.connection.get<TaskListMutationTarget>(
      `SELECT
         id,
         account_id AS accountId,
         google_id AS googleId,
         title,
         etag,
         deleted_at AS deletedAt
       FROM google_task_lists
       WHERE id = ?
       LIMIT 1;`,
      [id]
    ) ?? null;
  }

  taskMutationTarget(id: string): TaskMutationTarget | null {
    return this.connection.get<TaskMutationTarget>(
      `SELECT
         tasks.id AS id,
         tasks.account_id AS accountId,
         tasks.google_id AS googleId,
         tasks.task_list_id AS taskListId,
         lists.google_id AS taskListGoogleId,
         tasks.parent_task_id AS parentTaskId,
         parent.google_id AS parentGoogleId,
         tasks.title AS title,
         tasks.notes AS notes,
         tasks.status AS status,
         tasks.due_at AS dueAt,
         tasks.completed_at AS completedAt,
         tasks.position AS position,
         tasks.etag AS etag,
         tasks.deleted_at AS deletedAt
       FROM google_tasks tasks
       INNER JOIN google_task_lists lists ON lists.id = tasks.task_list_id
       LEFT JOIN google_tasks parent ON parent.id = tasks.parent_task_id
       WHERE tasks.id = ?
       LIMIT 1;`,
      [id]
    ) ?? null;
  }

  calendarMutationTarget(id: string): CalendarMutationTarget | null {
    return this.connection.get<CalendarMutationTarget>(
      `SELECT
         id,
         account_id AS accountId,
         google_id AS googleId,
         summary,
         time_zone AS timeZone
       FROM google_calendar_lists
       WHERE id = ?
       LIMIT 1;`,
      [id]
    ) ?? null;
  }

  calendarEventMutationTarget(id: string): CalendarEventMutationTarget | null {
    const row = this.connection.get<{
      id: string;
      accountId: string;
      googleId: string;
      calendarId: string;
      calendarGoogleId: string;
      summary: string;
      description: string | null;
      location: string | null;
      startAt: string;
      startTimeZone: string | null;
      endAt: string;
      endTimeZone: string | null;
      isAllDay: number;
      attendeeEmailsJson: string;
      reminderMinutesJson: string;
      etag: string | null;
      deletedAt: string | null;
    }>(
      `SELECT
         events.id AS id,
         events.account_id AS accountId,
         events.google_id AS googleId,
         events.calendar_id AS calendarId,
         calendars.google_id AS calendarGoogleId,
         events.summary AS summary,
         events.description AS description,
         events.location AS location,
         events.start_at AS startAt,
         events.start_time_zone AS startTimeZone,
         events.end_at AS endAt,
         events.end_time_zone AS endTimeZone,
         events.is_all_day AS isAllDay,
         events.attendee_emails_json AS attendeeEmailsJson,
         events.reminder_minutes_json AS reminderMinutesJson,
         events.etag AS etag,
         events.deleted_at AS deletedAt
       FROM google_calendar_events events
       INNER JOIN google_calendar_lists calendars ON calendars.id = events.calendar_id
       WHERE events.id = ?
       LIMIT 1;`,
      [id]
    );

    return row === undefined
      ? null
      : {
          id: row.id,
          accountId: row.accountId,
          googleId: row.googleId,
          calendarId: row.calendarId,
          calendarGoogleId: row.calendarGoogleId,
          summary: row.summary,
          description: row.description,
          location: row.location,
          startAt: row.startAt,
          startTimeZone: row.startTimeZone,
          endAt: row.endAt,
          endTimeZone: row.endTimeZone,
          isAllDay: row.isAllDay === 1,
          attendeeEmails: parseJsonStringArray(row.attendeeEmailsJson),
          reminderMinutes: parseJsonNumberArray(row.reminderMinutesJson),
          etag: row.etag,
          deletedAt: row.deletedAt
        };
  }

  updateTaskListFromRemote(input: {
    localId: string;
    remote: GoogleTaskListMirror;
    now: string;
  }): void {
    this.connection.run(
      `UPDATE google_task_lists
       SET google_id = ?,
           title = ?,
           etag = ?,
           sync_status = 'synced',
           google_updated_at = ?,
           updated_at = ?,
           deleted_at = NULL
       WHERE id = ?;`,
      [
        input.remote.id,
        input.remote.title,
        input.remote.etag ?? null,
        input.remote.updatedAt ?? null,
        input.now,
        input.localId
      ]
    );
  }

  updateTaskFromRemote(input: {
    localId: string;
    accountId: string;
    remote: GoogleTaskMirror;
    now: string;
  }): void {
    const taskListId = taskListLocalId(input.accountId, input.remote.taskListId);
    const parentTaskId = input.remote.parentId
      ? this.localTaskIdForGoogleId(input.accountId, input.remote.taskListId, input.remote.parentId)
      : null;

    this.connection.run(
      `UPDATE google_tasks
       SET task_list_id = ?,
           google_id = ?,
           parent_task_id = ?,
           title = ?,
           notes = ?,
           status = ?,
           due_at = ?,
           completed_at = ?,
           position = ?,
           is_hidden = ?,
           etag = ?,
           google_updated_at = ?,
           updated_at = ?,
           deleted_at = ?
       WHERE id = ?;`,
      [
        taskListId,
        input.remote.id,
        parentTaskId,
        input.remote.title,
        input.remote.notes ?? null,
        input.remote.status,
        input.remote.dueAt ?? null,
        input.remote.completedAt ?? null,
        input.remote.position ?? null,
        boolInt(input.remote.hidden),
        input.remote.etag ?? null,
        input.remote.updatedAt ?? null,
        input.now,
        input.remote.deleted ? input.now : null,
        input.localId
      ]
    );
  }

  updateCalendarEventFromRemote(input: {
    localId: string;
    accountId: string;
    remote: GoogleCalendarEventMirror;
    now: string;
  }): void {
    const calendarId = calendarLocalId(input.accountId, input.remote.calendarId);

    this.connection.executeTransaction([
      {
        kind: "run",
        sql: `UPDATE google_calendar_events
              SET calendar_id = ?,
                  google_id = ?,
                  recurring_event_id = ?,
                  original_start_at = ?,
                  status = ?,
                  summary = ?,
                  description = ?,
                  location = ?,
                  start_at = ?,
                  start_time_zone = ?,
                  end_at = ?,
                  end_time_zone = ?,
                  is_all_day = ?,
                  recurrence_rule = ?,
                  transparency = ?,
                  visibility = ?,
                  etag = ?,
                  sequence = ?,
                  attendee_emails_json = ?,
                  reminder_minutes_json = ?,
                  google_updated_at = ?,
                  updated_at = ?,
                  deleted_at = ?
              WHERE id = ?;`,
        params: [
          calendarId,
          input.remote.id,
          input.remote.recurringEventId ?? null,
          input.remote.originalStartAt ?? null,
          input.remote.status,
          input.remote.summary,
          input.remote.description ?? null,
          input.remote.location ?? null,
          input.remote.startAt,
          input.remote.startTimeZone ?? null,
          input.remote.endAt,
          input.remote.endTimeZone ?? null,
          boolInt(input.remote.isAllDay),
          input.remote.recurrenceRule ?? null,
          input.remote.transparency ?? null,
          input.remote.visibility ?? null,
          input.remote.etag ?? null,
          input.remote.sequence ?? null,
          JSON.stringify(normalizeGuestEmails(input.remote.attendeeEmails)),
          JSON.stringify(normalizeReminderMinutes(input.remote.reminderMinutes)),
          input.remote.updatedAt ?? null,
          input.now,
          input.remote.status === "cancelled" ? input.now : null,
          input.localId
        ]
      },
      ...calendarEventInstanceOperations({
        accountId: input.accountId,
        calendarId,
        calendarGoogleId: input.remote.calendarId,
        event: input.remote,
        eventId: input.localId,
        now: input.now
      })
    ]);
  }

  private localTaskIdForGoogleId(
    accountId: string,
    taskListGoogleId: string,
    taskGoogleId: string
  ): string {
    const taskListId = taskListLocalId(accountId, taskListGoogleId);
    const row = this.connection.get<{ id: string }>(
      `SELECT id
       FROM google_tasks
       WHERE account_id = ?
         AND task_list_id = ?
         AND google_id = ?
       LIMIT 1;`,
      [accountId, taskListId, taskGoogleId]
    );

    return row?.id ?? taskLocalId(accountId, taskListGoogleId, taskGoogleId);
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

  cacheDiagnostics(): GoogleCacheDiagnostics {
    return {
      taskListCount: countRows(
        this.connection,
        "SELECT COUNT(*) AS count FROM google_task_lists WHERE deleted_at IS NULL;"
      ),
      taskCount: countRows(
        this.connection,
        "SELECT COUNT(*) AS count FROM google_tasks WHERE deleted_at IS NULL;"
      ),
      calendarCount: countRows(
        this.connection,
        `SELECT COUNT(*) AS count
         FROM google_calendar_lists
         WHERE deleted_at IS NULL AND is_hidden = 0;`
      ),
      eventCount: countRows(
        this.connection,
        `SELECT COUNT(*) AS count
         FROM google_calendar_events
         WHERE deleted_at IS NULL AND status != 'cancelled';`
      ),
      noteCount: countRows(
        this.connection,
        "SELECT COUNT(*) AS count FROM local_notes WHERE deleted_at IS NULL;"
      ),
      performanceSampleCount: countRows(
        this.connection,
        "SELECT COUNT(*) AS count FROM local_performance_timings;"
      )
    };
  }

  checkpointDiagnostics(): GoogleCheckpointDiagnostics {
    const row = this.connection.get<{
      totalCount: number;
      tasksCount: number;
      calendarCount: number;
      lastUpdatedAt: string | null;
    }>(
      `SELECT
         COUNT(*) AS totalCount,
         COALESCE(SUM(CASE WHEN resource_type = 'tasks' OR resource_type = 'task_list' THEN 1 ELSE 0 END), 0) AS tasksCount,
         COALESCE(SUM(CASE WHEN resource_type = 'calendar' THEN 1 ELSE 0 END), 0) AS calendarCount,
         MAX(updated_at) AS lastUpdatedAt
       FROM google_sync_checkpoints;`
    );

    return {
      totalCount: row?.totalCount ?? 0,
      tasksCount: row?.tasksCount ?? 0,
      calendarCount: row?.calendarCount ?? 0,
      ...(row?.lastUpdatedAt ? { lastUpdatedAt: row.lastUpdatedAt } : {})
    };
  }

  pendingMutationDiagnostics(): PendingMutationDiagnostics {
    const totals = this.connection.get<{
      totalCount: number;
      pendingCount: number;
      applyingCount: number;
      failedCount: number;
      retryableCount: number;
      authPausedCount: number;
      nextRetryAt: string | null;
      lastErrorCode: HcbErrorCode | null;
    }>(
      `SELECT
         COUNT(*) AS totalCount,
         COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0) AS pendingCount,
         COALESCE(SUM(CASE WHEN status = 'applying' THEN 1 ELSE 0 END), 0) AS applyingCount,
         COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) AS failedCount,
         COALESCE(SUM(CASE WHEN status = 'failed' AND next_retry_at IS NOT NULL THEN 1 ELSE 0 END), 0) AS retryableCount,
         COALESCE(SUM(CASE WHEN status = 'failed' AND last_error_code IN ('UNAUTHORIZED', 'FORBIDDEN') THEN 1 ELSE 0 END), 0) AS authPausedCount,
         MIN(CASE WHEN status IN ('pending', 'failed') THEN next_retry_at ELSE NULL END) AS nextRetryAt,
         MAX(last_error_code) AS lastErrorCode
       FROM google_pending_mutations
       WHERE status IN ('pending', 'applying', 'failed');`
    );
    const byResourceType = this.connection.query<{ resourceType: string; count: number }>(
      `SELECT resource_type AS resourceType, COUNT(*) AS count
       FROM google_pending_mutations
       WHERE status IN ('pending', 'applying', 'failed')
       GROUP BY resource_type
       ORDER BY resource_type ASC
       LIMIT 20;`
    );

    return {
      totalCount: totals?.totalCount ?? 0,
      pendingCount: totals?.pendingCount ?? 0,
      applyingCount: totals?.applyingCount ?? 0,
      failedCount: totals?.failedCount ?? 0,
      retryableCount: totals?.retryableCount ?? 0,
      authPausedCount: totals?.authPausedCount ?? 0,
      ...(totals?.nextRetryAt ? { nextRetryAt: totals.nextRetryAt } : {}),
      ...(totals?.lastErrorCode ? { lastErrorCode: totals.lastErrorCode } : {}),
      byResourceType
    };
  }

  selectedResourceDiagnostics(settings: {
    selectedTaskListIds: readonly string[];
    selectedCalendarIds: readonly string[];
  }): SelectedResourceDiagnostics {
    const taskListSelection = new Set(settings.selectedTaskListIds);
    const calendarSelection = new Set(settings.selectedCalendarIds);
    const taskLists = this.connection
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
    const calendars = this.connection
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

  clearAllCheckpoints(): void {
    this.connection.run("DELETE FROM google_sync_checkpoints;");
  }

  clearLocalGoogleCache(now = new Date().toISOString()): void {
    this.connection.executeTransaction([
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
}

interface PendingGoogleMutationRow extends Record<string, unknown> {
  id: string;
  accountId: string | null;
  resourceType: string;
  resourceId: string;
  operation: string;
  payloadJson: string;
  status: string;
  attemptCount: number;
  nextRetryAt: string | null;
  lastErrorCode: HcbErrorCode | null;
  lastErrorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  appliedAt: string | null;
}

interface GoogleAccountRow extends Record<string, unknown> {
  id: string;
  google_account_id: string | null;
  email: string | null;
  display_name: string | null;
  avatar_url: string | null;
  locale: string | null;
  time_zone: string | null;
  connection_state: GoogleAccountConnectionStatusDto["connectionState"];
  granted_scopes_json: string;
  last_authenticated_at: string | null;
  updated_at: string;
}

function accountStatusFromRow(row: GoogleAccountRow): GoogleAccountConnectionStatusDto {
  return sanitizeGoogleAccountConnectionStatus({
    accountId: row.id,
    ...(row.google_account_id === null ? {} : { googleAccountId: row.google_account_id }),
    ...(row.email === null ? {} : { email: row.email }),
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    locale: row.locale,
    timeZone: row.time_zone,
    connectionState: row.connection_state,
    grantedScopes: parseJsonStringArray(row.granted_scopes_json),
    ...(row.last_authenticated_at === null ? {} : { lastAuthenticatedAt: row.last_authenticated_at }),
    updatedAt: row.updated_at
  });
}

function pendingMutationFromRow(row: PendingGoogleMutationRow): PendingGoogleMutation {
  return {
    id: row.id,
    accountId: row.accountId,
    resourceType: pendingMutationResourceType(row.resourceType),
    resourceId: row.resourceId,
    operation: row.operation,
    payload: parseJsonValue(row.payloadJson),
    status: pendingMutationStatus(row.status),
    attemptCount: row.attemptCount,
    nextRetryAt: row.nextRetryAt,
    lastErrorCode: row.lastErrorCode,
    lastErrorMessage: row.lastErrorMessage,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    appliedAt: row.appliedAt
  };
}

function pendingMutationResourceType(value: string): PendingGoogleMutationResourceType {
  return value === "task_list" || value === "event" ? value : "task";
}

function pendingMutationStatus(value: string): PendingGoogleMutationStatus {
  if (
    value === "applying" ||
    value === "failed" ||
    value === "applied" ||
    value === "cancelled"
  ) {
    return value;
  }

  return "pending";
}

function parseJsonValue(value: string): JsonValue {
  try {
    return JSON.parse(value) as JsonValue;
  } catch {
    return {};
  }
}

function parseJsonStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value);

    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function parseJsonNumberArray(value: string): number[] {
  try {
    const parsed = JSON.parse(value);

    return Array.isArray(parsed)
      ? parsed.filter((item): item is number => typeof item === "number" && Number.isFinite(item))
      : [];
  } catch {
    return [];
  }
}

function countRows(connection: SqliteConnection, sql: string): number {
  return connection.get<{ count: number }>(sql)?.count ?? 0;
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

interface CalendarEventInstanceInput {
  id: string;
  startAt: string;
  endAt: string;
  originalStartAt: string | null;
}

interface ParsedRRule {
  freq: "DAILY" | "WEEKLY" | "MONTHLY";
  interval: number;
  count?: number;
  until?: Date;
}

function calendarEventInstanceOperations(options: {
  accountId: string;
  calendarId: string;
  calendarGoogleId: string;
  event: GoogleCalendarEventMirror;
  eventId: string;
  now: string;
}): SqliteWriteOperation[] {
  const operations: SqliteWriteOperation[] = [
    {
      kind: "run",
      sql: `UPDATE google_calendar_event_instances
            SET deleted_at = ?, updated_at = ?
            WHERE event_id = ? AND deleted_at IS NULL;`,
      params: [options.now, options.now, options.eventId]
    }
  ];

  if (options.event.status === "cancelled") {
    return operations;
  }

  operations.push(
    ...materializedCalendarEventInstances(options.event, options.eventId).map((instance) => ({
      kind: "run" as const,
      sql: `INSERT INTO google_calendar_event_instances (
        id, account_id, calendar_id, event_id, google_event_id, recurring_event_id,
        original_start_at, start_at, end_at, is_all_day, status, updated_at, deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
      ON CONFLICT(id) DO UPDATE SET
        calendar_id = excluded.calendar_id,
        event_id = excluded.event_id,
        google_event_id = excluded.google_event_id,
        recurring_event_id = excluded.recurring_event_id,
        original_start_at = excluded.original_start_at,
        start_at = excluded.start_at,
        end_at = excluded.end_at,
        is_all_day = excluded.is_all_day,
        status = excluded.status,
        updated_at = excluded.updated_at,
        deleted_at = NULL;`,
      params: [
        instance.id,
        options.accountId,
        options.calendarId,
        options.eventId,
        options.event.id,
        options.event.recurringEventId ?? null,
        instance.originalStartAt,
        instance.startAt,
        instance.endAt,
        boolInt(options.event.isAllDay),
        options.event.status,
        options.now
      ]
    }))
  );

  return operations;
}

function materializedCalendarEventInstances(
  event: GoogleCalendarEventMirror,
  eventId: string
): CalendarEventInstanceInput[] {
  const singleInstance = {
    id: eventId,
    startAt: event.startAt,
    endAt: event.endAt,
    originalStartAt: event.originalStartAt ?? null
  };

  if (event.recurringEventId !== null && event.recurringEventId !== undefined) {
    return [singleInstance];
  }

  const rrule = parseRRule(event.recurrenceRule);

  if (rrule === null) {
    return [singleInstance];
  }

  const start = new Date(event.startAt);
  const end = new Date(event.endAt);
  const durationMs = end.getTime() - start.getTime();

  if (
    !Number.isFinite(start.getTime()) ||
    !Number.isFinite(end.getTime()) ||
    durationMs <= 0
  ) {
    return [singleInstance];
  }

  const hardLimit = Math.min(rrule.count ?? 730, 730);
  const boundedUntil = rrule.until ?? addUtcDays(start, 730);
  const instances: CalendarEventInstanceInput[] = [];
  let cursor = start;

  for (let index = 0; index < hardLimit; index += 1) {
    if (cursor.getTime() > boundedUntil.getTime()) {
      break;
    }

    const instanceStart = new Date(cursor.getTime());
    const instanceEnd = new Date(instanceStart.getTime() + durationMs);
    instances.push({
      id: index === 0 ? eventId : `${eventId}:instance:${instanceSuffix(instanceStart, event.isAllDay)}`,
      startAt: instanceStart.toISOString(),
      endAt: instanceEnd.toISOString(),
      originalStartAt: instanceStart.toISOString()
    });
    cursor = nextRecurrenceDate(cursor, rrule);
  }

  return instances.length > 0 ? instances : [singleInstance];
}

function parseRRule(value: string | null | undefined): ParsedRRule | null {
  if (value === undefined || value === null) {
    return null;
  }

  const line = value
    .split("\n")
    .map((candidate) => candidate.trim())
    .find((candidate) => candidate.startsWith("RRULE:"));

  if (line === undefined) {
    return null;
  }

  const parts = Object.fromEntries(
    line
      .slice("RRULE:".length)
      .split(";")
      .map((part) => part.split("=", 2))
      .filter((part): part is [string, string] => part.length === 2)
  );
  const freq = parts.FREQ;

  if (freq !== "DAILY" && freq !== "WEEKLY" && freq !== "MONTHLY") {
    return null;
  }

  return {
    freq,
    interval: Math.max(1, Number.parseInt(parts.INTERVAL ?? "1", 10) || 1),
    ...(parts.COUNT === undefined
      ? {}
      : { count: Math.max(1, Number.parseInt(parts.COUNT, 10) || 1) }),
    ...(parts.UNTIL === undefined ? {} : { until: parseRRuleUntil(parts.UNTIL) })
  };
}

function parseRRuleUntil(value: string): Date | undefined {
  const parsed =
    /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(value) ??
    /^(\d{4})(\d{2})(\d{2})$/.exec(value);

  if (parsed === null) {
    return undefined;
  }

  const [, year, month, day, hour = "00", minute = "00", second = "00"] = parsed;
  const date = new Date(
    Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second)
    )
  );

  return Number.isFinite(date.getTime()) ? date : undefined;
}

function nextRecurrenceDate(date: Date, rrule: ParsedRRule): Date {
  const next = new Date(date.getTime());

  if (rrule.freq === "DAILY") {
    next.setUTCDate(next.getUTCDate() + rrule.interval);
  } else if (rrule.freq === "WEEKLY") {
    next.setUTCDate(next.getUTCDate() + rrule.interval * 7);
  } else {
    next.setUTCMonth(next.getUTCMonth() + rrule.interval);
  }

  return next;
}

function instanceSuffix(startAt: Date, allDay: boolean): string {
  const compact = startAt.toISOString().replace(/[-:]/g, "").replace(".000", "");

  return allDay ? compact.slice(0, 8) : compact;
}

const GOOGLE_SYNC_SCHEMA = `
CREATE TABLE IF NOT EXISTS local_search_index_state (
  name TEXT PRIMARY KEY,
  version INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);

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

CREATE INDEX IF NOT EXISTS idx_google_task_lists_visible_sort
  ON google_task_lists(deleted_at, sort_order, title, id);

CREATE VIRTUAL TABLE IF NOT EXISTS google_task_lists_fts
  USING fts5(title, content='google_task_lists', content_rowid='rowid');

CREATE TRIGGER IF NOT EXISTS google_task_lists_fts_ai
AFTER INSERT ON google_task_lists
BEGIN
  INSERT INTO google_task_lists_fts(rowid, title)
  VALUES (new.rowid, new.title);
END;

CREATE TRIGGER IF NOT EXISTS google_task_lists_fts_ad
AFTER DELETE ON google_task_lists
BEGIN
  INSERT INTO google_task_lists_fts(google_task_lists_fts, rowid, title)
  VALUES ('delete', old.rowid, old.title);
END;

CREATE TRIGGER IF NOT EXISTS google_task_lists_fts_au
AFTER UPDATE ON google_task_lists
BEGIN
  INSERT INTO google_task_lists_fts(google_task_lists_fts, rowid, title)
  VALUES ('delete', old.rowid, old.title);
  INSERT INTO google_task_lists_fts(rowid, title)
  VALUES (new.rowid, new.title);
END;

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
  local_priority TEXT NOT NULL DEFAULT 'none',
  etag TEXT,
  google_updated_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE(account_id, task_list_id, google_id)
);

CREATE INDEX IF NOT EXISTS idx_google_tasks_list_status_due
  ON google_tasks(account_id, task_list_id, status, due_at, sort_order);

CREATE INDEX IF NOT EXISTS idx_google_tasks_visible_list_due
  ON google_tasks(task_list_id, deleted_at, is_hidden, status, due_at, sort_order, updated_at, id);

CREATE INDEX IF NOT EXISTS idx_google_tasks_counts_by_list
  ON google_tasks(task_list_id, deleted_at, is_hidden, status);

CREATE INDEX IF NOT EXISTS idx_google_tasks_parent_visible
  ON google_tasks(parent_task_id, deleted_at, sort_order, id);

CREATE INDEX IF NOT EXISTS idx_google_tasks_search_recent
  ON google_tasks(deleted_at, is_hidden, updated_at DESC, id);

CREATE VIRTUAL TABLE IF NOT EXISTS google_tasks_fts
  USING fts5(title, notes, content='google_tasks', content_rowid='rowid');

CREATE TRIGGER IF NOT EXISTS google_tasks_fts_ai
AFTER INSERT ON google_tasks
BEGIN
  INSERT INTO google_tasks_fts(rowid, title, notes)
  VALUES (new.rowid, new.title, COALESCE(new.notes, ''));
END;

CREATE TRIGGER IF NOT EXISTS google_tasks_fts_ad
AFTER DELETE ON google_tasks
BEGIN
  INSERT INTO google_tasks_fts(google_tasks_fts, rowid, title, notes)
  VALUES ('delete', old.rowid, old.title, COALESCE(old.notes, ''));
END;

CREATE TRIGGER IF NOT EXISTS google_tasks_fts_au
AFTER UPDATE ON google_tasks
BEGIN
  INSERT INTO google_tasks_fts(google_tasks_fts, rowid, title, notes)
  VALUES ('delete', old.rowid, old.title, COALESCE(old.notes, ''));
  INSERT INTO google_tasks_fts(rowid, title, notes)
  VALUES (new.rowid, new.title, COALESCE(new.notes, ''));
END;

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

CREATE INDEX IF NOT EXISTS idx_google_calendar_lists_visible
  ON google_calendar_lists(deleted_at, is_hidden, is_primary, summary, id);

CREATE VIRTUAL TABLE IF NOT EXISTS google_calendar_lists_fts
  USING fts5(summary, content='google_calendar_lists', content_rowid='rowid');

CREATE TRIGGER IF NOT EXISTS google_calendar_lists_fts_ai
AFTER INSERT ON google_calendar_lists
BEGIN
  INSERT INTO google_calendar_lists_fts(rowid, summary)
  VALUES (new.rowid, new.summary);
END;

CREATE TRIGGER IF NOT EXISTS google_calendar_lists_fts_ad
AFTER DELETE ON google_calendar_lists
BEGIN
  INSERT INTO google_calendar_lists_fts(google_calendar_lists_fts, rowid, summary)
  VALUES ('delete', old.rowid, old.summary);
END;

CREATE TRIGGER IF NOT EXISTS google_calendar_lists_fts_au
AFTER UPDATE ON google_calendar_lists
BEGIN
  INSERT INTO google_calendar_lists_fts(google_calendar_lists_fts, rowid, summary)
  VALUES ('delete', old.rowid, old.summary);
  INSERT INTO google_calendar_lists_fts(rowid, summary)
  VALUES (new.rowid, new.summary);
END;

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
  attendee_emails_json TEXT NOT NULL DEFAULT '[]',
  reminder_minutes_json TEXT NOT NULL DEFAULT '[]',
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

CREATE INDEX IF NOT EXISTS idx_google_calendar_events_visible_range
  ON google_calendar_events(calendar_id, deleted_at, status, start_at, end_at, id);

CREATE INDEX IF NOT EXISTS idx_google_calendar_events_search_recent
  ON google_calendar_events(deleted_at, status, updated_at DESC, id);

CREATE VIRTUAL TABLE IF NOT EXISTS google_calendar_events_fts
  USING fts5(summary, description, location, content='google_calendar_events', content_rowid='rowid');

CREATE TRIGGER IF NOT EXISTS google_calendar_events_fts_ai
AFTER INSERT ON google_calendar_events
BEGIN
  INSERT INTO google_calendar_events_fts(rowid, summary, description, location)
  VALUES (new.rowid, new.summary, COALESCE(new.description, ''), COALESCE(new.location, ''));
END;

CREATE TRIGGER IF NOT EXISTS google_calendar_events_fts_ad
AFTER DELETE ON google_calendar_events
BEGIN
  INSERT INTO google_calendar_events_fts(google_calendar_events_fts, rowid, summary, description, location)
  VALUES ('delete', old.rowid, old.summary, COALESCE(old.description, ''), COALESCE(old.location, ''));
END;

CREATE TRIGGER IF NOT EXISTS google_calendar_events_fts_au
AFTER UPDATE ON google_calendar_events
BEGIN
  INSERT INTO google_calendar_events_fts(google_calendar_events_fts, rowid, summary, description, location)
  VALUES ('delete', old.rowid, old.summary, COALESCE(old.description, ''), COALESCE(old.location, ''));
  INSERT INTO google_calendar_events_fts(rowid, summary, description, location)
  VALUES (new.rowid, new.summary, COALESCE(new.description, ''), COALESCE(new.location, ''));
END;

CREATE TABLE IF NOT EXISTS google_calendar_event_instances (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  calendar_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  google_event_id TEXT NOT NULL,
  recurring_event_id TEXT,
  original_start_at TEXT,
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  is_all_day INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE(account_id, calendar_id, event_id, start_at)
);

CREATE INDEX IF NOT EXISTS idx_google_calendar_event_instances_visible_range
  ON google_calendar_event_instances(calendar_id, deleted_at, status, start_at, end_at, id);

CREATE INDEX IF NOT EXISTS idx_google_calendar_event_instances_event
  ON google_calendar_event_instances(event_id, deleted_at);

CREATE TABLE IF NOT EXISTS local_scheduled_task_blocks (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  calendar_event_id TEXT NOT NULL,
  calendar_id TEXT NOT NULL,
  planned_start_at TEXT NOT NULL,
  planned_end_at TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE(task_id, calendar_event_id)
);

CREATE INDEX IF NOT EXISTS idx_local_scheduled_task_blocks_range
  ON local_scheduled_task_blocks(calendar_id, deleted_at, planned_start_at, planned_end_at, id);

CREATE INDEX IF NOT EXISTS idx_local_scheduled_task_blocks_task
  ON local_scheduled_task_blocks(task_id, deleted_at, planned_start_at);

CREATE INDEX IF NOT EXISTS idx_local_scheduled_task_blocks_event
  ON local_scheduled_task_blocks(calendar_event_id, deleted_at);

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

CREATE INDEX IF NOT EXISTS idx_google_sync_checkpoints_lookup
  ON google_sync_checkpoints(account_id, resource_type, resource_id, checkpoint_type);

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

CREATE INDEX IF NOT EXISTS idx_google_pending_mutations_resource
  ON google_pending_mutations(resource_type, resource_id, status, created_at);
`;
