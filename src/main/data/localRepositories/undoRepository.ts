import { randomUUID } from "node:crypto";
import type { JsonValue } from "@shared/domain/localData";
import { HcbPublicError } from "@shared/ipc/result";
import type {
  UndoApplyResponse,
  UndoStackStatusResponse
} from "@shared/ipc/contracts";
import type { SqliteConnection, SqliteWriteOperation } from "../sqliteConnection";

type UndoStack = "undo" | "redo";
type UndoResourceKind = NonNullable<UndoApplyResponse["resourceKind"]>;

const STALE_UNDO_ENTRY_CUTOFF_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_CURRENT_SESSION_UNDO_ENTRIES = 200;
const MAX_STALE_SESSION_UNDO_ENTRIES = 1000;

interface UndoEntryRow extends Record<string, unknown> {
  id: string;
  stack: UndoStack;
  actionKind: string;
  label: string;
  resourceKind: UndoResourceKind;
  resourceId: string;
  undoPayloadJson: string;
  redoPayloadJson: string;
  createdAt: string;
}

interface UndoPayload {
  version: 1;
  actionKind: string;
  resourceKind: UndoResourceKind;
  resourceId: string;
  target: JsonValue;
  opposite: JsonValue;
}

interface TaskSnapshot extends Record<string, JsonValue> {
  id: string;
  accountId: string;
  googleId: string;
  taskListId: string;
  taskListGoogleId: string | null;
  parentTaskId: string | null;
  parentGoogleId: string | null;
  title: string;
  notes: string | null;
  status: string;
  dueAt: string | null;
  dueTimeZone: string | null;
  completedAt: string | null;
  position: string | null;
  sortOrder: number;
  isHidden: number;
  localPriority: string;
  localPlannedStart: string | null;
  localPlannedEnd: string | null;
  localDurationMinutes: number | null;
  localLockedSchedule: number;
  localSnoozeUntil: string | null;
  localTagsJson: string;
  etag: string | null;
  googleUpdatedAt: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

interface TaskListSnapshot extends Record<string, JsonValue> {
  id: string;
  accountId: string;
  googleId: string;
  title: string;
  etag: string | null;
  sortOrder: number;
  isSelected: number;
  syncStatus: string;
  googleUpdatedAt: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  tasks: TaskSnapshot[];
}

interface CalendarEventInstanceSnapshot extends Record<string, JsonValue> {
  id: string;
  accountId: string;
  calendarId: string;
  eventId: string;
  googleEventId: string;
  recurringEventId: string | null;
  originalStartAt: string | null;
  startAt: string;
  endAt: string;
  isAllDay: number;
  status: string;
  completedAt: string | null;
  updatedAt: string;
  deletedAt: string | null;
}

interface CalendarEventSnapshot extends Record<string, JsonValue> {
  id: string;
  accountId: string;
  calendarId: string;
  calendarGoogleId: string | null;
  googleId: string;
  recurringEventId: string | null;
  originalStartAt: string | null;
  status: string;
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
  localTimeZone: string | null;
  hcbKind: string | null;
  attendeeEmailsJson: string;
  reminderMinutesJson: string;
  conferenceJson: string | null;
  etag: string | null;
  sequence: number | null;
  googleUpdatedAt: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  instances: CalendarEventInstanceSnapshot[];
}

interface ScheduledTaskBlockSnapshot extends Record<string, JsonValue> {
  id: string;
  taskId: string;
  calendarEventId: string;
  calendarId: string;
  plannedStartAt: string;
  plannedEndAt: string;
  durationMinutes: number;
  status: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  event: CalendarEventSnapshot | null;
}

export interface UndoChangeInput {
  actionKind: string;
  label: string;
  resourceKind: UndoResourceKind;
  resourceId: string;
  before: JsonValue;
  after: JsonValue;
}

export class LocalUndoRepository {
  readonly sessionId = `session:${randomUUID()}`;

  constructor(private readonly connection: SqliteConnection) {}

  status(): UndoStackStatusResponse {
    const undo = this.topEntry("undo");
    const redo = this.topEntry("redo");

    return {
      canUndo: undo !== null,
      canRedo: redo !== null,
      ...(undo === null ? {} : { undoLabel: undo.label }),
      ...(redo === null ? {} : { redoLabel: redo.label })
    };
  }

  recordChange(input: UndoChangeInput): void {
    if (JSON.stringify(input.before) === JSON.stringify(input.after)) {
      return;
    }

    const now = new Date().toISOString();
    const undoPayload = payloadFromChange(input, input.before, input.after);
    const redoPayload = payloadFromChange(input, input.after, input.before);

    this.connection.executeTransaction([
      {
        kind: "run",
        sql: "DELETE FROM local_undo_entries WHERE session_id = ? AND stack = 'redo';",
        params: [this.sessionId]
      },
      {
        kind: "run",
        sql: `INSERT INTO local_undo_entries (
          id, session_id, stack, action_kind, label, resource_kind, resource_id,
          undo_payload_json, redo_payload_json, created_at, applied_at
        ) VALUES (?, ?, 'undo', ?, ?, ?, ?, ?, ?, ?, NULL);`,
        params: [
          `undo:${Date.parse(now)}:${randomUUID()}`,
          this.sessionId,
          input.actionKind,
          input.label,
          input.resourceKind,
          input.resourceId,
          JSON.stringify(undoPayload),
          JSON.stringify(redoPayload),
          now
        ]
      },
      ...this.cleanupOperations(now)
    ]);
  }

  private cleanupOperations(now: string): SqliteWriteOperation[] {
    const staleBefore = new Date(Date.parse(now) - STALE_UNDO_ENTRY_CUTOFF_MS).toISOString();

    return [
      {
        kind: "run",
        sql: `DELETE FROM local_undo_entries
              WHERE session_id = ?
                AND id NOT IN (
                  SELECT id
                  FROM local_undo_entries
                  WHERE session_id = ?
                  ORDER BY created_at DESC, id DESC
                  LIMIT ?
                );`,
        params: [this.sessionId, this.sessionId, MAX_CURRENT_SESSION_UNDO_ENTRIES]
      },
      {
        kind: "run",
        sql: "DELETE FROM local_undo_entries WHERE session_id <> ? AND created_at < ?;",
        params: [this.sessionId, staleBefore]
      },
      {
        kind: "run",
        sql: `DELETE FROM local_undo_entries
              WHERE session_id <> ?
                AND id NOT IN (
                  SELECT id
                  FROM local_undo_entries
                  WHERE session_id <> ?
                  ORDER BY created_at DESC, id DESC
                  LIMIT ?
                );`,
        params: [this.sessionId, this.sessionId, MAX_STALE_SESSION_UNDO_ENTRIES]
      }
    ];
  }

  undo(): UndoApplyResponse {
    return this.applyTop("undo");
  }

  redo(): UndoApplyResponse {
    return this.applyTop("redo");
  }

  taskSnapshot(id: string): TaskSnapshot | null {
    return this.connection.get<TaskSnapshot>(
      `SELECT
         tasks.id,
         tasks.account_id AS accountId,
         tasks.google_id AS googleId,
         tasks.task_list_id AS taskListId,
         lists.google_id AS taskListGoogleId,
         tasks.parent_task_id AS parentTaskId,
         parent.google_id AS parentGoogleId,
         tasks.title,
         tasks.notes,
         tasks.status,
         tasks.due_at AS dueAt,
         tasks.due_time_zone AS dueTimeZone,
         tasks.completed_at AS completedAt,
         tasks.position,
         tasks.sort_order AS sortOrder,
         tasks.is_hidden AS isHidden,
         tasks.local_priority AS localPriority,
         tasks.local_planned_start AS localPlannedStart,
         tasks.local_planned_end AS localPlannedEnd,
         tasks.local_duration_minutes AS localDurationMinutes,
         tasks.local_locked_schedule AS localLockedSchedule,
         tasks.local_snooze_until AS localSnoozeUntil,
         tasks.local_tags_json AS localTagsJson,
         tasks.etag,
         tasks.google_updated_at AS googleUpdatedAt,
         tasks.created_at AS createdAt,
         tasks.updated_at AS updatedAt,
         tasks.deleted_at AS deletedAt
       FROM google_tasks tasks
       INNER JOIN google_task_lists lists ON lists.id = tasks.task_list_id
       LEFT JOIN google_tasks parent ON parent.id = tasks.parent_task_id
       WHERE tasks.id = ?
       LIMIT 1;`,
      [id]
    ) ?? null;
  }

  taskListSnapshot(id: string): TaskListSnapshot | null {
    const list = this.connection.get<Record<string, unknown>>(
      `SELECT
         id,
         account_id AS accountId,
         google_id AS googleId,
         title,
         etag,
         sort_order AS sortOrder,
         is_selected AS isSelected,
         sync_status AS syncStatus,
         google_updated_at AS googleUpdatedAt,
         created_at AS createdAt,
         updated_at AS updatedAt,
         deleted_at AS deletedAt
       FROM google_task_lists
       WHERE id = ?
       LIMIT 1;`,
      [id]
    );

    if (!list) {
      return null;
    }

    const tasks = this.connection.query<{ id: string }>(
      "SELECT id FROM google_tasks WHERE task_list_id = ? ORDER BY sort_order ASC, id ASC;",
      [id]
    ).flatMap((row) => {
      const task = this.taskSnapshot(row.id);
      return task === null ? [] : [task];
    });

    return { ...(list as Omit<TaskListSnapshot, "tasks">), tasks } as TaskListSnapshot;
  }

  calendarEventSnapshot(id: string): CalendarEventSnapshot | null {
    const event = this.connection.get<Record<string, unknown>>(
      `SELECT
         events.id,
         events.account_id AS accountId,
         events.calendar_id AS calendarId,
         calendars.google_id AS calendarGoogleId,
         events.google_id AS googleId,
         events.recurring_event_id AS recurringEventId,
         events.original_start_at AS originalStartAt,
         events.status,
         events.summary,
         events.description,
         events.location,
         events.start_at AS startAt,
         events.start_time_zone AS startTimeZone,
         events.end_at AS endAt,
         events.end_time_zone AS endTimeZone,
         events.is_all_day AS isAllDay,
         events.recurrence_rule AS recurrenceRule,
         events.color_id AS colorId,
         events.transparency,
         events.visibility,
         events.local_time_zone AS localTimeZone,
         events.hcb_kind AS hcbKind,
         events.attendee_emails_json AS attendeeEmailsJson,
         events.reminder_minutes_json AS reminderMinutesJson,
         events.conference_json AS conferenceJson,
         events.etag,
         events.sequence,
         events.google_updated_at AS googleUpdatedAt,
         events.created_at AS createdAt,
         events.updated_at AS updatedAt,
         events.deleted_at AS deletedAt
       FROM google_calendar_events events
       INNER JOIN google_calendar_lists calendars ON calendars.id = events.calendar_id
       WHERE events.id = ?
       LIMIT 1;`,
      [id]
    );

    if (!event) {
      return null;
    }

    return {
      ...(event as Omit<CalendarEventSnapshot, "instances">),
      instances: this.connection.query<CalendarEventInstanceSnapshot>(
        `SELECT
           id,
           account_id AS accountId,
           calendar_id AS calendarId,
           event_id AS eventId,
           google_event_id AS googleEventId,
           recurring_event_id AS recurringEventId,
           original_start_at AS originalStartAt,
           start_at AS startAt,
           end_at AS endAt,
           is_all_day AS isAllDay,
           status,
           completed_at AS completedAt,
           updated_at AS updatedAt,
           deleted_at AS deletedAt
         FROM google_calendar_event_instances
         WHERE event_id = ?
         ORDER BY start_at ASC, id ASC;`,
        [id]
      )
    } as CalendarEventSnapshot;
  }

  scheduledTaskBlockSnapshot(id: string): ScheduledTaskBlockSnapshot | null {
    const block = this.connection.get<Record<string, unknown>>(
      `SELECT
         id,
         task_id AS taskId,
         calendar_event_id AS calendarEventId,
         calendar_id AS calendarId,
         planned_start_at AS plannedStartAt,
         planned_end_at AS plannedEndAt,
         duration_minutes AS durationMinutes,
         status,
         created_at AS createdAt,
         updated_at AS updatedAt,
         deleted_at AS deletedAt
       FROM local_scheduled_task_blocks
       WHERE id = ?
       LIMIT 1;`,
      [id]
    );

    if (!block) {
      return null;
    }

    return {
      ...(block as Omit<ScheduledTaskBlockSnapshot, "event">),
      event: this.calendarEventSnapshot(String(block.calendarEventId))
    } as ScheduledTaskBlockSnapshot;
  }

  private applyTop(stack: UndoStack): UndoApplyResponse {
    const entry = this.topEntry(stack);

    if (!entry) {
      throw new HcbPublicError({
        code: "VALIDATION_ERROR",
        message: stack === "undo" ? "Nothing to undo." : "Nothing to redo.",
        recoverable: true
      });
    }

    const payload = parsePayload(stack === "undo" ? entry.undoPayloadJson : entry.redoPayloadJson);
    this.assertNoConflict(payload, stack);

    const now = new Date().toISOString();
    const nextStack: UndoStack = stack === "undo" ? "redo" : "undo";
    const operations = [
      ...this.operationsForPayload(payload, now),
      {
        kind: "run" as const,
        sql: `UPDATE local_undo_entries
              SET stack = ?, applied_at = ?, created_at = ?
              WHERE id = ? AND session_id = ?;`,
        params: [nextStack, now, now, entry.id, this.sessionId]
      }
    ];

    this.connection.executeTransaction(operations);

    return {
      action: stack,
      applied: true,
      label: entry.label,
      resourceKind: entry.resourceKind,
      resourceId: entry.resourceId
    };
  }

  private operationsForPayload(payload: UndoPayload, now: string): SqliteWriteOperation[] {
    switch (payload.resourceKind) {
      case "task":
        return taskOperations(
          snapshotOrNull<TaskSnapshot>(payload.target),
          snapshotOrNull<TaskSnapshot>(payload.opposite),
          now
        );
      case "taskList":
        return taskListOperations(
          snapshotOrNull<TaskListSnapshot>(payload.target),
          snapshotOrNull<TaskListSnapshot>(payload.opposite),
          now
        );
      case "calendarEvent":
        return calendarEventOperations(
          snapshotOrNull<CalendarEventSnapshot>(payload.target),
          snapshotOrNull<CalendarEventSnapshot>(payload.opposite),
          now
        );
      case "scheduledTaskBlock":
        return scheduledTaskBlockOperations(
          snapshotOrNull<ScheduledTaskBlockSnapshot>(payload.target),
          snapshotOrNull<ScheduledTaskBlockSnapshot>(payload.opposite),
          now
        );
      default:
        return [];
    }
  }

  private assertNoConflict(payload: UndoPayload, stack: UndoStack): void {
    const current = conflictFingerprint(
      payload.resourceKind,
      payload.actionKind,
      this.currentSnapshot(payload)
    );
    const expected = conflictFingerprint(payload.resourceKind, payload.actionKind, payload.opposite);

    if (sameJson(current, expected)) {
      return;
    }

    throw new HcbPublicError({
      code: "CONFLICT",
      message: `${stack === "undo" ? "Undo" : "Redo"} is unavailable because this item changed after ${payload.actionKind}.`,
      recoverable: true,
      details: {
        action: stack,
        resourceKind: payload.resourceKind,
        resourceId: payload.resourceId
      }
    });
  }

  private currentSnapshot(payload: UndoPayload): JsonValue {
    switch (payload.resourceKind) {
      case "task":
        return this.taskSnapshot(payload.resourceId);
      case "taskList":
        return this.taskListSnapshot(payload.resourceId);
      case "calendarEvent":
        return this.calendarEventSnapshot(payload.resourceId);
      case "scheduledTaskBlock":
        return this.scheduledTaskBlockSnapshot(payload.resourceId);
      default:
        return null;
    }
  }

  private topEntry(stack: UndoStack): UndoEntryRow | null {
    return this.connection.get<UndoEntryRow>(
      `SELECT
         id,
         stack,
         action_kind AS actionKind,
         label,
         resource_kind AS resourceKind,
         resource_id AS resourceId,
         undo_payload_json AS undoPayloadJson,
         redo_payload_json AS redoPayloadJson,
         created_at AS createdAt
       FROM local_undo_entries
       WHERE session_id = ? AND stack = ?
       ORDER BY created_at DESC, id DESC
       LIMIT 1;`,
      [this.sessionId, stack]
    ) ?? null;
  }
}

function payloadFromChange(input: UndoChangeInput, target: JsonValue, opposite: JsonValue): UndoPayload {
  return {
    version: 1,
    actionKind: input.actionKind,
    resourceKind: input.resourceKind,
    resourceId: input.resourceId,
    target,
    opposite
  };
}

function parsePayload(value: string): UndoPayload {
  const parsed = JSON.parse(value) as UndoPayload;

  if (parsed.version !== 1) {
    throw new HcbPublicError({
      code: "VALIDATION_ERROR",
      message: "Undo entry version is unsupported.",
      recoverable: true
    });
  }

  return parsed;
}

function snapshotOrNull<T>(value: JsonValue): T | null {
  return value === null ? null : value as T;
}

function sameJson(left: JsonValue, right: JsonValue): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function conflictFingerprint(
  resourceKind: UndoResourceKind,
  actionKind: string,
  value: JsonValue
): JsonValue {
  const snapshot = activeSnapshot(value);

  if (snapshot === null) {
    return null;
  }

  switch (resourceKind) {
    case "task":
      return pickJson(snapshot, [
        "id",
        "taskListId",
        "parentTaskId",
        "title",
        "notes",
        "status",
        "dueAt",
        "dueTimeZone",
        "completedAt",
        "position",
        "sortOrder",
        "isHidden",
        "localPriority",
        "localPlannedStart",
        "localPlannedEnd",
        "localDurationMinutes",
        "localLockedSchedule",
        "localSnoozeUntil",
        "localTagsJson"
      ]);
    case "taskList": {
      const output = pickJson(snapshot, ["id", "title", "sortOrder", "isSelected"]);
      if (actionKind !== "task_list.rename") {
        output.tasks = arrayFingerprints(snapshot.tasks, "task", "task.update");
      }
      return output;
    }
    case "calendarEvent": {
      const output = pickJson(snapshot, [
        "id",
        "calendarId",
        "recurringEventId",
        "originalStartAt",
        "status",
        "summary",
        "description",
        "location",
        "startAt",
        "startTimeZone",
        "endAt",
        "endTimeZone",
        "isAllDay",
        "recurrenceRule",
        "colorId",
        "transparency",
        "visibility",
        "localTimeZone",
        "attendeeEmailsJson",
        "reminderMinutesJson",
        "conferenceJson"
      ]);
      output.instances = arrayFingerprints(snapshot.instances, "calendarEventInstance", actionKind);
      return output;
    }
    case "scheduledTaskBlock": {
      const output = pickJson(snapshot, [
        "id",
        "taskId",
        "calendarEventId",
        "calendarId",
        "plannedStartAt",
        "plannedEndAt",
        "durationMinutes",
        "status"
      ]);
      output.event = conflictFingerprint("calendarEvent", "calendar.events.update", snapshot.event ?? null);
      return output;
    }
    default:
      return null;
  }
}

function arrayFingerprints(
  value: JsonValue | undefined,
  resourceKind: UndoResourceKind | "calendarEventInstance",
  actionKind: string
): JsonValue {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => {
    if (resourceKind === "calendarEventInstance") {
      const snapshot = activeSnapshot(item);
      return snapshot === null
        ? null
        : pickJson(snapshot, [
            "id",
            "eventId",
            "recurringEventId",
            "originalStartAt",
            "startAt",
            "endAt",
            "isAllDay",
            "status"
          ]);
    }

    return conflictFingerprint(resourceKind, actionKind, item);
  });
}

function activeSnapshot(value: JsonValue | undefined): Record<string, JsonValue> | null {
  if (value === undefined || value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const deletedAt = value.deletedAt;
  if (typeof deletedAt === "string" && deletedAt.length > 0) {
    return null;
  }

  return value;
}

function pickJson(
  value: Record<string, JsonValue>,
  keys: readonly string[]
): Record<string, JsonValue> {
  const output: Record<string, JsonValue> = {};

  for (const key of keys) {
    output[key] = value[key] ?? null;
  }

  return output;
}

function taskOperations(
  target: TaskSnapshot | null,
  opposite: TaskSnapshot | null,
  now: string
): SqliteWriteOperation[] {
  if (!target) {
    if (!opposite) {
      return [];
    }

    return [
      {
        kind: "run",
        sql: `UPDATE google_tasks
              SET deleted_at = ?, updated_at = ?
              WHERE id = ?;`,
        params: [now, now, opposite.id]
      },
      pendingMutationOperation({
        accountId: opposite.accountId,
        resourceType: "task",
        resourceId: opposite.id,
        operation: "task.delete",
        payload: {
          id: opposite.id,
          googleId: opposite.googleId,
          taskListId: opposite.taskListId,
          taskListGoogleId: opposite.taskListGoogleId,
          etag: opposite.etag
        },
        now
      })
    ];
  }

  const operations = [upsertTaskOperation(target, now)];
  const mutation = taskMutationForTarget(target, opposite, now);

  if (mutation) {
    operations.push(mutation);
  }

  return operations;
}

function upsertTaskOperation(task: TaskSnapshot, now: string): SqliteWriteOperation {
  return {
    kind: "run",
    sql: `INSERT INTO google_tasks (
      id, account_id, task_list_id, google_id, parent_task_id, title, notes,
      status, due_at, due_time_zone, completed_at, position, sort_order,
      is_hidden, local_priority, local_planned_start, local_planned_end,
      local_duration_minutes, local_locked_schedule, local_snooze_until,
      local_tags_json, etag, google_updated_at, created_at, updated_at, deleted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      account_id = excluded.account_id,
      task_list_id = excluded.task_list_id,
      google_id = excluded.google_id,
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
      local_priority = excluded.local_priority,
      local_planned_start = excluded.local_planned_start,
      local_planned_end = excluded.local_planned_end,
      local_duration_minutes = excluded.local_duration_minutes,
      local_locked_schedule = excluded.local_locked_schedule,
      local_snooze_until = excluded.local_snooze_until,
      local_tags_json = excluded.local_tags_json,
      etag = excluded.etag,
      google_updated_at = excluded.google_updated_at,
      updated_at = excluded.updated_at,
      deleted_at = excluded.deleted_at;`,
    params: [
      task.id,
      task.accountId,
      task.taskListId,
      task.googleId,
      task.parentTaskId,
      task.title,
      task.notes,
      task.status,
      task.dueAt,
      task.dueTimeZone,
      task.completedAt,
      task.position,
      task.sortOrder,
      task.isHidden,
      task.localPriority,
      task.localPlannedStart,
      task.localPlannedEnd,
      task.localDurationMinutes,
      task.localLockedSchedule,
      task.localSnoozeUntil,
      task.localTagsJson,
      task.etag,
      task.googleUpdatedAt,
      task.createdAt,
      now,
      task.deletedAt
    ]
  };
}

function taskMutationForTarget(
  target: TaskSnapshot,
  opposite: TaskSnapshot | null,
  now: string
): SqliteWriteOperation | null {
  if (target.deletedAt !== null) {
    return null;
  }

  if (!opposite) {
    return pendingMutationOperation({
      accountId: target.accountId,
      resourceType: "task",
      resourceId: target.id,
      operation: "task.create",
      payload: taskCreatePayload(target),
      now
    });
  }

  if (!taskGoogleFieldsChanged(target, opposite)) {
    return null;
  }

  const operation = target.taskListId !== opposite.taskListId
    ? "task.move_list"
    : target.parentTaskId !== opposite.parentTaskId || target.sortOrder !== opposite.sortOrder
      ? "task.move"
      : target.status !== opposite.status
        ? target.status === "completed" ? "task.complete" : "task.reopen"
        : "task.update";

  return pendingMutationOperation({
    accountId: target.accountId,
    resourceType: "task",
    resourceId: target.id,
    operation,
    payload: {
      id: target.id,
      googleId: target.googleId,
      fromTaskListId: opposite.taskListId,
      toTaskListId: target.taskListId,
      toTaskListGoogleId: target.taskListGoogleId,
      title: target.title,
      notes: target.notes ?? "",
      dueDate: dateOnlyFromIso(target.dueAt),
      parentId: target.parentTaskId,
      parentGoogleId: target.parentGoogleId,
      previousSiblingId: null,
      taskListId: target.taskListId,
      taskListGoogleId: target.taskListGoogleId,
      completed: target.status === "completed",
      etag: target.etag
    },
    now
  });
}

function taskGoogleFieldsChanged(target: TaskSnapshot, opposite: TaskSnapshot): boolean {
  return target.title !== opposite.title ||
    target.notes !== opposite.notes ||
    target.dueAt !== opposite.dueAt ||
    target.taskListId !== opposite.taskListId ||
    target.parentTaskId !== opposite.parentTaskId ||
    target.sortOrder !== opposite.sortOrder ||
    target.status !== opposite.status ||
    target.deletedAt !== opposite.deletedAt;
}

function taskCreatePayload(task: TaskSnapshot): JsonValue {
  return {
    localId: task.id,
    title: task.title,
    notes: task.notes ?? "",
    dueDate: dateOnlyFromIso(task.dueAt),
    taskListId: task.taskListId,
    taskListGoogleId: task.taskListGoogleId,
    parentId: task.parentTaskId,
    parentGoogleId: task.parentGoogleId,
    previousSiblingId: null
  };
}

function taskListOperations(
  target: TaskListSnapshot | null,
  opposite: TaskListSnapshot | null,
  now: string
): SqliteWriteOperation[] {
  if (!target) {
    if (!opposite) {
      return [];
    }

    return [
      {
        kind: "run",
        sql: "UPDATE google_task_lists SET deleted_at = ?, updated_at = ? WHERE id = ?;",
        params: [now, now, opposite.id]
      },
      {
        kind: "run",
        sql: "UPDATE google_tasks SET deleted_at = ?, updated_at = ? WHERE task_list_id = ?;",
        params: [now, now, opposite.id]
      },
      pendingMutationOperation({
        accountId: opposite.accountId,
        resourceType: "task_list",
        resourceId: opposite.id,
        operation: "task_list.delete",
        payload: {
          id: opposite.id,
          googleId: opposite.googleId,
          etag: opposite.etag
        },
        now
      })
    ];
  }

  const operations = [
    upsertTaskListOperation(target, now),
    ...target.tasks.map((task) => upsertTaskOperation(task, now))
  ];

  if (!opposite) {
    operations.push(
      pendingMutationOperation({
        accountId: target.accountId,
        resourceType: "task_list",
        resourceId: target.id,
        operation: "task_list.create",
        payload: { localId: target.id, title: target.title },
        now
      }),
      ...target.tasks
        .filter((task) => task.deletedAt === null)
        .map((task, index) =>
          pendingMutationOperation({
            accountId: task.accountId,
            resourceType: "task",
            resourceId: task.id,
            operation: "task.create",
            payload: taskCreatePayload(task),
            now: plusMs(now, index + 1)
          })
        )
    );
    return operations;
  }

  if (target.title !== opposite.title || target.deletedAt !== opposite.deletedAt) {
    operations.push(
      pendingMutationOperation({
        accountId: target.accountId,
        resourceType: "task_list",
        resourceId: target.id,
        operation: "task_list.rename",
        payload: {
          id: target.id,
          googleId: target.googleId,
          title: target.title,
          etag: target.etag
        },
        now
      })
    );
  }

  return operations;
}

function upsertTaskListOperation(list: TaskListSnapshot, now: string): SqliteWriteOperation {
  return {
    kind: "run",
    sql: `INSERT INTO google_task_lists (
      id, account_id, google_id, title, etag, sort_order, is_selected,
      sync_status, google_updated_at, created_at, updated_at, deleted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      account_id = excluded.account_id,
      google_id = excluded.google_id,
      title = excluded.title,
      etag = excluded.etag,
      sort_order = excluded.sort_order,
      is_selected = excluded.is_selected,
      sync_status = excluded.sync_status,
      google_updated_at = excluded.google_updated_at,
      updated_at = excluded.updated_at,
      deleted_at = excluded.deleted_at;`,
    params: [
      list.id,
      list.accountId,
      list.googleId,
      list.title,
      list.etag,
      list.sortOrder,
      list.isSelected,
      list.syncStatus,
      list.googleUpdatedAt,
      list.createdAt,
      now,
      list.deletedAt
    ]
  };
}

function scheduledTaskBlockOperations(
  target: ScheduledTaskBlockSnapshot | null,
  opposite: ScheduledTaskBlockSnapshot | null,
  now: string
): SqliteWriteOperation[] {
  const eventOps = calendarEventOperations(target?.event ?? null, opposite?.event ?? null, now);

  if (!target) {
    return [
      ...eventOps,
      ...(opposite
        ? [{
            kind: "run" as const,
            sql: "UPDATE local_scheduled_task_blocks SET deleted_at = ?, updated_at = ? WHERE id = ?;",
            params: [now, now, opposite.id]
          }]
        : [])
    ];
  }

  return [
    ...eventOps,
    {
      kind: "run",
      sql: `INSERT INTO local_scheduled_task_blocks (
        id, task_id, calendar_event_id, calendar_id, planned_start_at, planned_end_at,
        duration_minutes, status, created_at, updated_at, deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        task_id = excluded.task_id,
        calendar_event_id = excluded.calendar_event_id,
        calendar_id = excluded.calendar_id,
        planned_start_at = excluded.planned_start_at,
        planned_end_at = excluded.planned_end_at,
        duration_minutes = excluded.duration_minutes,
        status = excluded.status,
        updated_at = excluded.updated_at,
        deleted_at = excluded.deleted_at;`,
      params: [
        target.id,
        target.taskId,
        target.calendarEventId,
        target.calendarId,
        target.plannedStartAt,
        target.plannedEndAt,
        target.durationMinutes,
        target.status,
        target.createdAt,
        now,
        target.deletedAt
      ]
    }
  ];
}

function calendarEventOperations(
  target: CalendarEventSnapshot | null,
  opposite: CalendarEventSnapshot | null,
  now: string
): SqliteWriteOperation[] {
  if (!target) {
    if (!opposite) {
      return [];
    }

    return [
      {
        kind: "run",
        sql: `UPDATE google_calendar_events
              SET status = 'cancelled', deleted_at = ?, updated_at = ?
              WHERE id = ?;`,
        params: [now, now, opposite.id]
      },
      {
        kind: "run",
        sql: `UPDATE google_calendar_event_instances
              SET deleted_at = ?, updated_at = ?
              WHERE event_id = ? AND deleted_at IS NULL;`,
        params: [now, now, opposite.id]
      },
      pendingMutationOperation({
        accountId: opposite.accountId,
        resourceType: "event",
        resourceId: opposite.id,
        operation: "calendar.events.delete",
        payload: {
          id: opposite.id,
          calendarId: opposite.calendarId
        },
        now
      })
    ];
  }

  const operations = [
    upsertCalendarEventOperation(target, now),
    {
      kind: "run" as const,
      sql: `UPDATE google_calendar_event_instances
            SET deleted_at = ?, updated_at = ?
            WHERE event_id = ?;`,
      params: [now, now, target.id]
    },
    ...target.instances.map((instance) => upsertCalendarEventInstanceOperation(instance, now))
  ];

  if (!opposite || eventGoogleFieldsChanged(target, opposite)) {
    operations.push(
      pendingMutationOperation({
        accountId: target.accountId,
        resourceType: "event",
        resourceId: target.id,
        operation: opposite ? "calendar.events.update" : "calendar.events.create",
        payload: calendarMutationPayload(target),
        now
      })
    );
  }

  return operations;
}

function upsertCalendarEventOperation(event: CalendarEventSnapshot, now: string): SqliteWriteOperation {
  return {
    kind: "run",
    sql: `INSERT INTO google_calendar_events (
      id, account_id, calendar_id, google_id, recurring_event_id, original_start_at,
      status, summary, description, location, start_at, start_time_zone, end_at,
      end_time_zone, is_all_day, recurrence_rule, color_id, transparency,
      visibility, local_time_zone, hcb_kind, attendee_emails_json, reminder_minutes_json,
      conference_json, etag, sequence, google_updated_at, created_at, updated_at, deleted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      account_id = excluded.account_id,
      calendar_id = excluded.calendar_id,
      google_id = excluded.google_id,
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
      local_time_zone = excluded.local_time_zone,
      hcb_kind = excluded.hcb_kind,
      attendee_emails_json = excluded.attendee_emails_json,
      reminder_minutes_json = excluded.reminder_minutes_json,
      conference_json = excluded.conference_json,
      etag = excluded.etag,
      sequence = excluded.sequence,
      google_updated_at = excluded.google_updated_at,
      updated_at = excluded.updated_at,
      deleted_at = excluded.deleted_at;`,
    params: [
      event.id,
      event.accountId,
      event.calendarId,
      event.googleId,
      event.recurringEventId,
      event.originalStartAt,
      event.status,
      event.summary,
      event.description,
      event.location,
      event.startAt,
      event.startTimeZone,
      event.endAt,
      event.endTimeZone,
      event.isAllDay,
      event.recurrenceRule,
      event.colorId,
      event.transparency,
      event.visibility,
      event.localTimeZone,
      event.hcbKind,
      event.attendeeEmailsJson,
      event.reminderMinutesJson,
      event.conferenceJson,
      event.etag,
      event.sequence,
      event.googleUpdatedAt,
      event.createdAt,
      now,
      event.deletedAt
    ]
  };
}

function upsertCalendarEventInstanceOperation(
  instance: CalendarEventInstanceSnapshot,
  now: string
): SqliteWriteOperation {
  return {
    kind: "run",
    sql: `INSERT INTO google_calendar_event_instances (
      id, account_id, calendar_id, event_id, google_event_id, recurring_event_id,
      original_start_at, start_at, end_at, is_all_day, status, completed_at,
      updated_at, deleted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      account_id = excluded.account_id,
      calendar_id = excluded.calendar_id,
      event_id = excluded.event_id,
      google_event_id = excluded.google_event_id,
      recurring_event_id = excluded.recurring_event_id,
      original_start_at = excluded.original_start_at,
      start_at = excluded.start_at,
      end_at = excluded.end_at,
      is_all_day = excluded.is_all_day,
      status = excluded.status,
      completed_at = excluded.completed_at,
      updated_at = excluded.updated_at,
      deleted_at = excluded.deleted_at;`,
    params: [
      instance.id,
      instance.accountId,
      instance.calendarId,
      instance.eventId,
      instance.googleEventId,
      instance.recurringEventId,
      instance.originalStartAt,
      instance.startAt,
      instance.endAt,
      instance.isAllDay,
      instance.status,
      instance.completedAt,
      now,
      instance.deletedAt
    ]
  };
}

function eventGoogleFieldsChanged(target: CalendarEventSnapshot, opposite: CalendarEventSnapshot): boolean {
  return target.calendarId !== opposite.calendarId ||
    target.summary !== opposite.summary ||
    target.description !== opposite.description ||
    target.location !== opposite.location ||
    target.startAt !== opposite.startAt ||
    target.endAt !== opposite.endAt ||
    target.isAllDay !== opposite.isAllDay ||
    target.recurrenceRule !== opposite.recurrenceRule ||
    target.colorId !== opposite.colorId ||
    target.attendeeEmailsJson !== opposite.attendeeEmailsJson ||
    target.reminderMinutesJson !== opposite.reminderMinutesJson ||
    target.deletedAt !== opposite.deletedAt ||
    target.status !== opposite.status;
}

function calendarMutationPayload(event: CalendarEventSnapshot): JsonValue {
  return {
    title: event.summary,
    calendarId: event.calendarId,
    startsAt: event.startAt,
    endsAt: event.endAt,
    allDay: event.isAllDay === 1,
    location: event.location ?? "",
    notes: event.description ?? "",
    guestEmails: parseJsonArray(event.attendeeEmailsJson),
    reminderMinutes: parseJsonArray(event.reminderMinutesJson),
    colorId: event.colorId,
    hcbKind: event.hcbKind === "birthday" ? "birthday" : null,
    recurrence: null,
    recurrenceRule: event.recurrenceRule
  };
}

function pendingMutationOperation(input: {
  accountId: string | null;
  resourceType: "task" | "task_list" | "event";
  resourceId: string;
  operation: string;
  payload: JsonValue;
  now: string;
}): SqliteWriteOperation {
  return {
    kind: "run",
    sql: `INSERT INTO google_pending_mutations (
      id, account_id, resource_type, resource_id, operation, payload_json, status,
      attempt_count, next_retry_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, NULL, ?, ?);`,
    params: [
      `mutation:${input.resourceType}:${randomUUID()}`,
      input.accountId,
      input.resourceType,
      input.resourceId,
      input.operation,
      JSON.stringify(input.payload),
      input.now,
      input.now
    ]
  };
}

function parseJsonArray(value: string): JsonValue[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter(isJsonValue) : [];
  } catch {
    return [];
  }
}

function isJsonValue(value: unknown): value is JsonValue {
  return value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    Array.isArray(value) ||
    (typeof value === "object" && value !== null);
}

function dateOnlyFromIso(value: string | null): string | null {
  return value === null ? null : value.slice(0, 10);
}

function plusMs(value: string, ms: number): string {
  return new Date(Date.parse(value) + ms).toISOString();
}
