import { randomUUID } from "node:crypto";
import type { JsonValue } from "@shared/domain/localData";
import type { HcbErrorCode } from "@shared/ipc/result";
import type { SqliteConnection } from "../../data/sqliteConnection";
import type {
  CalendarEventMutationTarget,
  CalendarMutationTarget,
  PendingGoogleMutation,
  PendingGoogleMutationResourceType,
  PendingGoogleMutationStatus,
  PendingMutationDiagnostics,
  TaskListMutationTarget,
  TaskMutationTarget
} from "./types";
import { parseJsonNumberArray, parseJsonStringArray, parseJsonValue } from "./json";

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

export function enqueuePendingMutation(
  connection: SqliteConnection,
  input: {
    accountId: string | null;
    resourceType: "task" | "task_list" | "event";
    resourceId: string;
    operation: string;
    payload: JsonValue;
    now: string;
  }
): { id: string; queued: true } {
  const id = `mutation:${input.resourceType}:${randomUUID()}`;

  connection.run(
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

export function listDuePendingMutations(
  connection: SqliteConnection,
  options: {
    now: string;
    limit?: number;
  }
): PendingGoogleMutation[] {
  const limit = Math.max(1, Math.min(100, options.limit ?? 25));

  return connection
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

export function listActivePendingMutations(
  connection: SqliteConnection,
  options: { limit?: number } = {}
): PendingGoogleMutation[] {
  const limit = Math.max(1, Math.min(200, options.limit ?? 100));

  return connection
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
         AND status IN ('pending', 'applying', 'failed')
       ORDER BY
         CASE status WHEN 'failed' THEN 0 WHEN 'applying' THEN 1 ELSE 2 END,
         created_at ASC,
         id ASC
       LIMIT ?;`,
      [limit]
    )
    .map(pendingMutationFromRow);
}

export function pendingMutationById(
  connection: SqliteConnection,
  id: string
): PendingGoogleMutation | null {
  const row = connection.get<PendingGoogleMutationRow>(
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

export function claimPendingMutation(
  connection: SqliteConnection,
  id: string,
  now: string
): PendingGoogleMutation | null {
  const result = connection.run(
    `UPDATE google_pending_mutations
     SET status = 'applying',
         updated_at = ?
     WHERE id = ?
       AND status IN ('pending', 'failed', 'applying');`,
    [now, id]
  );

  return result.changes > 0 ? pendingMutationById(connection, id) : null;
}

export function markMutationApplied(connection: SqliteConnection, id: string, now: string): void {
  connection.run(
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

export function markMutationFailed(
  connection: SqliteConnection,
  input: {
    id: string;
    attemptCount: number;
    errorCode: HcbErrorCode;
    errorMessage: string;
    nextRetryAt?: string | null;
    now: string;
  }
): void {
  connection.run(
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

export function retryPendingMutation(
  connection: SqliteConnection,
  id: string,
  now: string
): PendingGoogleMutation | null {
  const result = connection.run(
    `UPDATE google_pending_mutations
     SET status = 'pending',
         next_retry_at = NULL,
         last_error_code = NULL,
         last_error_message = NULL,
         updated_at = ?
     WHERE id = ?
       AND status = 'failed';`,
    [now, id]
  );

  return result.changes > 0 ? pendingMutationById(connection, id) : null;
}

export function cancelPendingMutation(
  connection: SqliteConnection,
  id: string,
  now: string
): PendingGoogleMutation | null {
  const current = pendingMutationById(connection, id);

  if (!current || !["pending", "applying", "failed"].includes(current.status)) {
    return null;
  }

  connection.run(
    `UPDATE google_pending_mutations
     SET status = 'cancelled',
         next_retry_at = NULL,
         updated_at = ?
     WHERE id = ?
       AND status IN ('pending', 'applying', 'failed');`,
    [now, id]
  );

  return {
    ...current,
    status: "cancelled",
    nextRetryAt: null,
    updatedAt: now
  };
}

export function pauseAccountForMutationAuthFailure(
  connection: SqliteConnection,
  input: {
    accountId: string;
    connectionState: "reauth_required" | "sync_paused";
    now: string;
  }
): void {
  connection.run(
    `UPDATE google_accounts
     SET connection_state = ?,
         updated_at = ?
     WHERE id = ?
       AND deleted_at IS NULL;`,
    [input.connectionState, input.now, input.accountId]
  );
}

export function taskListMutationTarget(
  connection: SqliteConnection,
  id: string
): TaskListMutationTarget | null {
  return (
    connection.get<TaskListMutationTarget>(
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
    ) ?? null
  );
}

export function taskMutationTarget(
  connection: SqliteConnection,
  id: string
): TaskMutationTarget | null {
  return (
    connection.get<TaskMutationTarget>(
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
    ) ?? null
  );
}

export function calendarMutationTarget(
  connection: SqliteConnection,
  id: string
): CalendarMutationTarget | null {
  return (
    connection.get<CalendarMutationTarget>(
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
    ) ?? null
  );
}

export function calendarEventMutationTarget(
  connection: SqliteConnection,
  id: string
): CalendarEventMutationTarget | null {
  const row = connection.get<{
    id: string;
    accountId: string;
    googleId: string;
    calendarId: string;
    calendarGoogleId: string;
    hcbKind: "birthday" | null;
    summary: string;
    description: string | null;
    location: string | null;
    startAt: string;
    startTimeZone: string | null;
    endAt: string;
    endTimeZone: string | null;
    isAllDay: number;
    recurrenceRule: string | null;
    colorId: string | null;
    transparency: string | null;
    visibility: string | null;
    attendeeEmailsJson: string;
    reminderMinutesJson: string;
    remindersJson: string;
    remindersUseDefault: number;
    etag: string | null;
    deletedAt: string | null;
  }>(
    `SELECT
       events.id AS id,
       events.account_id AS accountId,
       events.google_id AS googleId,
       events.calendar_id AS calendarId,
       calendars.google_id AS calendarGoogleId,
       events.hcb_kind AS hcbKind,
       events.summary AS summary,
       events.description AS description,
       events.location AS location,
       events.start_at AS startAt,
       events.start_time_zone AS startTimeZone,
       events.end_at AS endAt,
       events.end_time_zone AS endTimeZone,
       events.is_all_day AS isAllDay,
       events.recurrence_rule AS recurrenceRule,
       events.color_id AS colorId,
       events.transparency AS transparency,
       events.visibility AS visibility,
       events.attendee_emails_json AS attendeeEmailsJson,
       events.reminder_minutes_json AS reminderMinutesJson,
       events.reminders_json AS remindersJson,
       events.reminders_use_default AS remindersUseDefault,
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
        hcbKind: row.hcbKind === "birthday" ? "birthday" : null,
        summary: row.summary,
        description: row.description,
        location: row.location,
        startAt: row.startAt,
        startTimeZone: row.startTimeZone,
        endAt: row.endAt,
        endTimeZone: row.endTimeZone,
        isAllDay: row.isAllDay === 1,
        recurrenceRule: row.recurrenceRule,
        colorId: row.colorId,
        transparency: row.transparency,
        visibility: row.visibility,
        attendeeEmails: parseJsonStringArray(row.attendeeEmailsJson),
        reminderMinutes: parseJsonNumberArray(row.reminderMinutesJson),
        reminders: parseReminderObjects(row.remindersJson, parseJsonNumberArray(row.reminderMinutesJson)),
        remindersUseDefault: row.remindersUseDefault === 1,
        etag: row.etag,
        deletedAt: row.deletedAt
      };
}

export function pendingMutationDiagnostics(
  connection: SqliteConnection
): PendingMutationDiagnostics {
  const totals = connection.get<{
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
  const byResourceType = connection.query<{ resourceType: string; count: number }>(
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

function parseReminderObjects(
  value: string,
  fallbackMinutes: number[]
): Array<{ method: "popup" | "email"; minutes: number }> {
  const parsed = parseJsonValue(value);

  if (!Array.isArray(parsed)) {
    return fallbackMinutes.map((minutes) => ({ method: "popup", minutes }));
  }

  const reminders = parsed.flatMap((entry): Array<{ method: "popup" | "email"; minutes: number }> => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      return [];
    }

    const source = entry as Record<string, unknown>;
    const method = source.method;
    const minutes = source.minutes;

    if ((method !== "popup" && method !== "email") || typeof minutes !== "number" || !Number.isInteger(minutes)) {
      return [];
    }

    return minutes >= 0 && minutes <= 28 * 24 * 60 ? [{ method, minutes }] : [];
  });

  return reminders.length === 0 && fallbackMinutes.length > 0
    ? fallbackMinutes.map((minutes) => ({ method: "popup", minutes }))
    : reminders;
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
