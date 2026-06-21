import {
  normalizeCalendarAttendees,
  normalizeCalendarReminders,
  normalizeGuestEmails,
  normalizeReminderMinutes
} from "@shared/domain/calendar";
import type { SqliteConnection, SqliteWriteOperation } from "../../data/sqliteConnection";
import type {
  GoogleCalendarEventMirror,
  GoogleCalendarListMirror,
  GoogleTaskListMirror,
  GoogleTaskMirror
} from "../../google";
import type { CalendarEventWriteOptions, TaskWriteOptions } from "./types";
import { boolInt, calendarLocalId, eventLocalId, taskListLocalId, taskLocalId } from "./ids";
import { calendarEventInstanceOperations } from "./recurrence";
import { eventTimeZone } from "./timeZone";

export function writeTaskLists(
  connection: SqliteConnection,
  accountId: string,
  taskLists: readonly GoogleTaskListMirror[],
  now: string
): void {
  connection.executeTransaction(
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

export function writeTasks(
  connection: SqliteConnection,
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

  connection.executeTransaction(operations);
}

export function writeCalendarLists(
  connection: SqliteConnection,
  accountId: string,
  calendars: readonly GoogleCalendarListMirror[],
  now: string
): void {
  connection.executeTransaction(
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

export function writeCalendarEvents(
  connection: SqliteConnection,
  defaultTimeZone: string,
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
    const localTimeZone = eventTimeZone(event, options.defaultTimeZone ?? defaultTimeZone);

    operations.push({
      kind: "run",
      sql: `INSERT INTO google_calendar_events (
        id, account_id, calendar_id, google_id, recurring_event_id, original_start_at,
        status, summary, description, location, start_at, start_time_zone, end_at,
        end_time_zone, is_all_day, recurrence_rule, color_id, transparency, visibility, etag,
        sequence, local_time_zone, hcb_kind, attendee_emails_json, attendee_details_json,
        reminder_minutes_json, reminders_json, reminders_use_default, conference_json, google_updated_at,
        created_at, updated_at, deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        color_id = excluded.color_id,
        transparency = excluded.transparency,
        visibility = excluded.visibility,
        etag = excluded.etag,
        sequence = excluded.sequence,
        local_time_zone = excluded.local_time_zone,
        hcb_kind = COALESCE(excluded.hcb_kind, google_calendar_events.hcb_kind),
        attendee_emails_json = excluded.attendee_emails_json,
        attendee_details_json = excluded.attendee_details_json,
        reminder_minutes_json = excluded.reminder_minutes_json,
        reminders_json = excluded.reminders_json,
        reminders_use_default = excluded.reminders_use_default,
        conference_json = excluded.conference_json,
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
        event.colorId ?? null,
        event.transparency ?? null,
        event.visibility ?? null,
        event.etag ?? null,
        event.sequence ?? null,
        localTimeZone,
        event.hcbKind ?? null,
        JSON.stringify(normalizeGuestEmails(event.attendeeEmails)),
        JSON.stringify(normalizeCalendarAttendees(event.attendees)),
        JSON.stringify(normalizeReminderMinutes(event.reminderMinutes)),
        JSON.stringify(normalizeCalendarReminders(event.reminders)),
        boolInt(event.remindersUseDefault === true),
        event.conference ? JSON.stringify(event.conference) : null,
        event.updatedAt ?? null,
        options.now,
        options.now,
        event.status === "cancelled" ? options.now : null
      ]
    });

    operations.push(
      ...calendarEventInstanceOperations({
        accountId,
        calendarId,
        calendarGoogleId,
        event,
        eventId: localEventId,
        now: options.now
      })
    );
  }

  connection.executeTransaction(operations);
}

export function updateTaskListFromRemote(
  connection: SqliteConnection,
  input: {
    localId: string;
    remote: GoogleTaskListMirror;
    now: string;
  }
): void {
  connection.run(
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

export function updateTaskFromRemote(
  connection: SqliteConnection,
  input: {
    localId: string;
    accountId: string;
    remote: GoogleTaskMirror;
    now: string;
  }
): void {
  const taskListId = taskListLocalId(input.accountId, input.remote.taskListId);
  const parentTaskId = input.remote.parentId
    ? localTaskIdForGoogleId(connection, input.accountId, input.remote.taskListId, input.remote.parentId)
    : null;

  connection.run(
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

export function updateCalendarEventFromRemote(
  connection: SqliteConnection,
  defaultTimeZone: string,
  input: {
    localId: string;
    accountId: string;
    remote: GoogleCalendarEventMirror;
    now: string;
  }
): void {
  const calendarId = calendarLocalId(input.accountId, input.remote.calendarId);

  connection.executeTransaction([
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
                color_id = ?,
                transparency = ?,
                visibility = ?,
                etag = ?,
                sequence = ?,
                local_time_zone = ?,
                hcb_kind = COALESCE(?, hcb_kind),
                attendee_emails_json = ?,
                attendee_details_json = ?,
                reminder_minutes_json = ?,
                reminders_json = ?,
                reminders_use_default = ?,
                conference_json = ?,
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
        input.remote.colorId ?? null,
        input.remote.transparency ?? null,
        input.remote.visibility ?? null,
        input.remote.etag ?? null,
        input.remote.sequence ?? null,
        eventTimeZone(input.remote, defaultTimeZone),
        input.remote.hcbKind ?? null,
        JSON.stringify(normalizeGuestEmails(input.remote.attendeeEmails)),
        JSON.stringify(normalizeCalendarAttendees(input.remote.attendees)),
        JSON.stringify(normalizeReminderMinutes(input.remote.reminderMinutes)),
        JSON.stringify(normalizeCalendarReminders(input.remote.reminders)),
        boolInt(input.remote.remindersUseDefault === true),
        input.remote.conference ? JSON.stringify(input.remote.conference) : null,
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

function localTaskIdForGoogleId(
  connection: SqliteConnection,
  accountId: string,
  taskListGoogleId: string,
  taskGoogleId: string
): string {
  const taskListId = taskListLocalId(accountId, taskListGoogleId);
  const row = connection.get<{ id: string }>(
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
