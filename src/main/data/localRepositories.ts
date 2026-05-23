import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import {
  addUtcDaysIso,
  normalizeGuestEmails,
  normalizeReminderMinutes,
  startOfUtcDayIso
} from "@shared/domain/calendar";
import type {
  AvailabilityExportRequest,
  AvailabilityExportResponse,
  CalendarEventCreateRequest,
  CalendarEventDeleteRequest,
  CalendarEventDetail,
  CalendarEventRecurrence,
  CalendarEventSummary,
  CalendarEventUpdateRequest,
  CalendarListRequest,
  CalendarListResponse,
  CalendarListSummary,
  CalendarRangeRequest,
  CalendarRangeResponse,
  LocalPerformanceTiming,
  NoteCreateRequest,
  NoteDeleteRequest,
  NoteDetail,
  NoteBrokenLinksRequest,
  NoteBrokenLinksResponse,
  NoteLinkSuggestRequest,
  NoteLinkSuggestResponse,
  NoteListRequest,
  NoteListResponse,
  NoteSummary,
  NoteUpdateRequest,
  SearchQueryRequest,
  SearchQueryResponse,
  SearchResultItem,
  ScheduledTaskBlockCreateRequest,
  ScheduledTaskBlockListRequest,
  ScheduledTaskBlockListResponse,
  ScheduledTaskBlockMoveRequest,
  ScheduledTaskBlockSummary,
  ScheduledTaskBlockUnscheduleRequest,
  SettingsSnapshot,
  SettingsUpdateRequest,
  TaskCompletionRequest,
  TaskCreateRequest,
  TaskDeleteRequest,
  TaskDetail,
  TaskListCreateRequest,
  TaskListDeleteRequest,
  TaskListRenameRequest,
  TaskMoveRequest,
  TaskListsRequest,
  TaskListsResponse,
  TaskListRequest,
  TaskListResponse,
  TaskListSummary,
  TaskPriority,
  TaskSummary,
  TaskUpdateRequest
} from "@shared/ipc/contracts";
import { HcbPublicError } from "@shared/ipc/result";
import { redactMetadata } from "@shared/redaction";
import {
  hasRunnableLocalSearch,
  parseLocalSearchQuery,
  resolveLocalSearchDomains,
  type LocalSearchDateFilter,
  type ParsedLocalSearchQuery
} from "@shared/search/localSearch";
import type { SqliteConnection, SqliteParams, SqliteWriteOperation } from "./sqliteConnection";

interface PageWindow<T> {
  items: T[];
  page: {
    limit: number;
    nextCursor?: string;
    totalKnown: number;
  };
}

type SearchDomain = SearchResultItem["domain"];

interface TaskListRow extends Record<string, unknown> {
  id: string;
  accountId?: string;
  googleId?: string;
  title: string;
  updatedAt: string;
  taskCount: number;
  activeTaskCount: number;
  sortOrder?: number;
  etag?: string | null;
}

interface TaskRow extends Record<string, unknown> {
  id: string;
  accountId?: string;
  googleId?: string;
  listId: string;
  listGoogleId?: string;
  listTitle: string;
  title: string;
  status: "needsAction" | "completed";
  notes: string | null;
  dueAt: string | null;
  parentId: string | null;
  deletedAt?: string | null;
  isHidden?: number;
  priority?: TaskPriority | null;
  sortOrder?: number;
  etag?: string | null;
  pendingMutationStatus?: "pending" | "applying" | "failed" | null;
  updatedAt: string;
  plannedStart?: string | null;
  plannedEnd?: string | null;
  durationMinutes?: number | null;
  lockedSchedule?: number | null;
  snoozeUntil?: string | null;
  tagsJson?: string | null;
}

interface CalendarListRow extends Record<string, unknown> {
  id: string;
  title: string;
  selected: number;
  timeZone: string | null;
  updatedAt: string;
  eventCount: number;
}

interface CalendarEventRow extends Record<string, unknown> {
  id: string;
  eventId: string;
  accountId: string;
  calendarId: string;
  calendarTitle: string;
  title: string;
  startsAt: string;
  endsAt: string;
  allDay: number;
  updatedAt: string;
  location: string | null;
  notes: string | null;
  guestEmailsJson: string | null;
  reminderMinutesJson: string | null;
  pendingMutationStatus?: "pending" | "applying" | "failed" | null;
  timeZone: string | null;
  recurrenceRule: string | null;
  recurringEventId: string | null;
  originalStartAt: string | null;
}

interface CalendarRow extends Record<string, unknown> {
  id: string;
  accountId: string;
  googleId: string;
  title: string;
  timeZone: string | null;
  accessRole: string | null;
}

interface ScheduledTaskBlockRow extends Record<string, unknown> {
  id: string;
  taskId: string;
  calendarEventId: string;
  calendarId: string;
  title: string | null;
  startsAt: string;
  endsAt: string;
  durationMinutes: number;
  status: "scheduled" | "orphaned";
  pendingMutationStatus?: "pending" | "applying" | "failed" | null;
  updatedAt: string;
}

interface NoteRow extends Record<string, unknown> {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

const DEFAULT_SETTINGS: SettingsSnapshot = {
  theme: "system",
  colorTheme: "notion",
  uiFontName: null,
  uiTextSizePoints: 13,
  startOnLogin: false,
  quickCaptureShortcut: "Ctrl+Space",
  selectedTaskListIds: [],
  selectedCalendarIds: [],
  setupCompletedAt: null,
  syncMode: "balanced",
  showTrayIcon: true,
  trayClickAction: "open-menu",
  menuBarPanelStyle: "adaptive",
  showMenuBarBadge: true,
  notificationsEnabled: false,
  notificationLeadMinutes: 10,
  mcpEnabled: false,
  mcpPermissionMode: "confirm-writes",
  mcpPort: 0,
  defaultTimeZone: systemTimeZone(),
  todayCapacityMinutes: 480,
  todayWorkingHoursStart: 6,
  todayWorkingHoursEnd: 22,
  diagnosticsIncludePerformance: true,
  savedSearchViews: [],
  savedTaskViews: []
};

export class LocalPerformanceRepository {
  constructor(private readonly connection: SqliteConnection) {}

  record(timing: {
    kind: LocalPerformanceTiming["kind"];
    name: string;
    durationMs: number;
    metadata?: Record<string, string | number | boolean | null>;
    createdAt?: string;
  }): void {
    try {
      this.connection.run(
        `INSERT INTO local_performance_timings
          (kind, name, duration_ms, metadata_json, created_at)
         VALUES (?, ?, ?, ?, ?);`,
        [
          timing.kind,
          timing.name,
          Math.max(0, Math.round(timing.durationMs * 100) / 100),
          JSON.stringify(redactMetadata(timing.metadata)),
          timing.createdAt ?? new Date().toISOString()
        ]
      );
    } catch {
      // Diagnostics must not break the user-facing read path.
    }
  }

  listRecent(limit = 50): LocalPerformanceTiming[] {
    const safeLimit = Math.max(1, Math.min(100, limit));
    return this.connection.query<{
      id: number;
      kind: LocalPerformanceTiming["kind"];
      name: string;
      durationMs: number;
      createdAt: string;
    }>(
      `SELECT id, kind, name, duration_ms AS durationMs, created_at AS createdAt
       FROM local_performance_timings
       ORDER BY created_at DESC, id DESC
       LIMIT ?;`,
      [safeLimit]
    );
  }

  listSlowSqliteQueries(limit = 10): Array<{ name: string; durationMs: number; createdAt: string }> {
    const safeLimit = Math.max(1, Math.min(10, limit));

    return this.connection.query<{ name: string; durationMs: number; createdAt: string }>(
      `SELECT name, duration_ms AS durationMs, created_at AS createdAt
       FROM local_performance_timings
       WHERE kind = 'sqlite_query'
       ORDER BY duration_ms DESC, created_at DESC, id DESC
       LIMIT ?;`,
      [safeLimit]
    );
  }
}

export class LocalPlannerRepository {
  constructor(
    private readonly connection: SqliteConnection,
    private readonly timings?: LocalPerformanceRepository
  ) {}

  listTaskLists(request: TaskListsRequest): TaskListsResponse {
    return this.measureSqlite("tasks.listTaskLists", () => {
      const { limit, offset } = pageBounds(request.cursor, request.limit, 50, 100);
      const rows = this.connection.query<TaskListRow>(
        `SELECT
           lists.id AS id,
           lists.title AS title,
           lists.updated_at AS updatedAt,
           COUNT(tasks.id) AS taskCount,
           COALESCE(SUM(CASE WHEN tasks.status != 'completed'
                              AND tasks.deleted_at IS NULL
                              AND tasks.is_hidden = 0
                              THEN 1 ELSE 0 END), 0) AS activeTaskCount
         FROM google_task_lists lists
         LEFT JOIN google_tasks tasks
           ON tasks.task_list_id = lists.id
          AND tasks.deleted_at IS NULL
         WHERE lists.deleted_at IS NULL
         GROUP BY lists.id
         ORDER BY lists.sort_order ASC, lists.title COLLATE NOCASE ASC, lists.id ASC
         LIMIT ? OFFSET ?;`,
        [limit, offset]
      );
      const totalKnown = countRows(
        this.connection,
        "SELECT COUNT(*) AS count FROM google_task_lists WHERE deleted_at IS NULL;"
      );

      return pageFromRows(rows.map(taskListSummary), limit, offset, totalKnown);
    });
  }

  listTasks(request: TaskListRequest): TaskListResponse {
    return this.measureSqlite("tasks.list", () => {
      const { limit, offset } = pageBounds(request.cursor, request.limit, 50, 100);
      const predicates = ["lists.deleted_at IS NULL"];
      const params: Array<string | number | boolean | null> = [];

      if (request.listId !== undefined) {
        predicates.push("tasks.task_list_id = ?");
        params.push(request.listId);
      }

      if ((request.status ?? "active") === "active") {
        predicates.push("tasks.deleted_at IS NULL");
        predicates.push("tasks.is_hidden = 0");
        predicates.push("tasks.status != 'completed'");
      } else if (request.status === "completed") {
        predicates.push("tasks.deleted_at IS NULL");
        predicates.push("tasks.is_hidden = 0");
        predicates.push("tasks.status = 'completed'");
      } else if (request.status === "hidden") {
        predicates.push("tasks.deleted_at IS NULL");
        predicates.push("tasks.is_hidden = 1");
      } else if (request.status === "deleted") {
        predicates.push("tasks.deleted_at IS NOT NULL");
      } else {
        predicates.push("tasks.deleted_at IS NULL");
        predicates.push("tasks.is_hidden = 0");
      }

      const where = predicates.join(" AND ");
      const rows = this.connection.query<TaskRow>(
        `SELECT
           tasks.id AS id,
           tasks.account_id AS accountId,
           tasks.google_id AS googleId,
           tasks.task_list_id AS listId,
           lists.google_id AS listGoogleId,
           lists.title AS listTitle,
           tasks.title AS title,
           tasks.status AS status,
           tasks.notes AS notes,
           tasks.due_at AS dueAt,
           tasks.parent_task_id AS parentId,
           tasks.deleted_at AS deletedAt,
           tasks.is_hidden AS isHidden,
           COALESCE(tasks.local_priority, 'none') AS priority,
           tasks.sort_order AS sortOrder,
           tasks.etag AS etag,
           pending.status AS pendingMutationStatus,
           tasks.updated_at AS updatedAt,
           tasks.local_planned_start AS plannedStart,
           tasks.local_planned_end AS plannedEnd,
           tasks.local_duration_minutes AS durationMinutes,
           tasks.local_locked_schedule AS lockedSchedule,
           tasks.local_snooze_until AS snoozeUntil,
           tasks.local_tags_json AS tagsJson
         FROM google_tasks tasks
         INNER JOIN google_task_lists lists ON lists.id = tasks.task_list_id
         LEFT JOIN (
           SELECT resource_id, MAX(status) AS status
           FROM google_pending_mutations
           WHERE status IN ('pending', 'applying', 'failed')
           GROUP BY resource_id
         ) pending ON pending.resource_id = tasks.id
         WHERE ${where}
         ORDER BY
           CASE WHEN tasks.due_at IS NULL THEN 1 ELSE 0 END,
           tasks.due_at ASC,
           tasks.sort_order ASC,
           tasks.updated_at DESC,
           tasks.id ASC
         LIMIT ? OFFSET ?;`,
        [...params, limit, offset]
      );
      const totalKnown = countRows(
        this.connection,
        `SELECT COUNT(*) AS count
         FROM google_tasks tasks
         INNER JOIN google_task_lists lists ON lists.id = tasks.task_list_id
         WHERE ${where};`,
        params
      );

      return pageFromRows(rows.map(taskSummary), limit, offset, totalKnown);
    });
  }

  getTask(id: string): TaskDetail {
    return this.measureSqlite("tasks.get", () => {
      const row = this.connection.get<TaskRow>(
        `SELECT
           tasks.id AS id,
           tasks.account_id AS accountId,
           tasks.google_id AS googleId,
           tasks.task_list_id AS listId,
           lists.google_id AS listGoogleId,
           lists.title AS listTitle,
           tasks.title AS title,
           tasks.status AS status,
           tasks.notes AS notes,
           tasks.due_at AS dueAt,
           tasks.parent_task_id AS parentId,
           tasks.deleted_at AS deletedAt,
           tasks.is_hidden AS isHidden,
           COALESCE(tasks.local_priority, 'none') AS priority,
           tasks.sort_order AS sortOrder,
           tasks.etag AS etag,
           pending.status AS pendingMutationStatus,
           tasks.updated_at AS updatedAt,
           tasks.local_planned_start AS plannedStart,
           tasks.local_planned_end AS plannedEnd,
           tasks.local_duration_minutes AS durationMinutes,
           tasks.local_locked_schedule AS lockedSchedule,
           tasks.local_snooze_until AS snoozeUntil,
           tasks.local_tags_json AS tagsJson
         FROM google_tasks tasks
         INNER JOIN google_task_lists lists ON lists.id = tasks.task_list_id
         LEFT JOIN (
           SELECT resource_id, MAX(status) AS status
           FROM google_pending_mutations
           WHERE status IN ('pending', 'applying', 'failed')
           GROUP BY resource_id
         ) pending ON pending.resource_id = tasks.id
         WHERE tasks.id = ?
           AND tasks.deleted_at IS NULL
           AND lists.deleted_at IS NULL
         LIMIT 1;`,
        [id]
      );

      if (!row) {
        throw notFound("Task was not found.");
      }

      return taskDetail(row);
    });
  }

  createTask(request: TaskCreateRequest): TaskDetail {
    return this.measureSqlite("tasks.create", () => {
      const list = this.requireTaskListForMutation(request.listId);
      const parent = request.parentId ? this.requireTaskForMutation(request.parentId) : null;

      if (parent && parent.listId !== list.id) {
        throw validationFailure("Subtasks must stay in the same task list as their parent.");
      }

      if (parent?.parentId) {
        throw validationFailure("Google Tasks supports one subtask level in this app.");
      }

      const now = new Date().toISOString();
      const id = `pending:task:${randomUUID()}`;
      const sortOrder = this.nextTaskSortOrder(list.id, parent?.id ?? null);
      const notes = request.notes ?? "";
      const payload = {
        localId: id,
        title: request.title.trim(),
        notes,
        dueDate: request.dueDate ?? null,
        taskListId: list.id,
        taskListGoogleId: list.googleId ?? null,
        parentId: parent?.id ?? null,
        parentGoogleId: parent?.googleId ?? null,
        previousSiblingId: request.previousSiblingId ?? null
      };

      const tagsJson = JSON.stringify(request.tags ?? []);
      this.connection.executeTransaction([
        {
          kind: "run",
          sql: `INSERT INTO google_tasks (
            id, account_id, task_list_id, google_id, parent_task_id, title, notes,
            status, due_at, due_time_zone, completed_at, position, sort_order,
            is_hidden, local_priority, local_planned_start, local_planned_end,
            local_duration_minutes, local_locked_schedule, local_snooze_until,
            local_tags_json, etag, google_updated_at, created_at, updated_at, deleted_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'needsAction', ?, NULL, NULL, NULL, ?, 0, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, NULL);`,
          params: [
            id,
            list.accountId,
            list.id,
            id,
            parent?.id ?? null,
            request.title.trim(),
            notes,
            dateOnlyToIso(request.dueDate ?? null),
            sortOrder,
            request.priority ?? "none",
            request.plannedStart ?? null,
            request.plannedEnd ?? null,
            request.durationMinutes ?? null,
            request.lockedSchedule ? 1 : 0,
            request.snoozeUntil ?? null,
            tagsJson,
            now,
            now
          ]
        },
        this.pendingMutationOperation({
          id: `mutation:${randomUUID()}`,
          accountId: list.accountId,
          resourceType: "task",
          resourceId: id,
          operation: "task.create",
          payload,
          now
        })
      ]);

      return this.getTask(id);
    });
  }

  updateTask(request: TaskUpdateRequest): TaskDetail {
    return this.measureSqlite("tasks.update", () => {
      const existing = this.requireTaskForMutation(request.id);
      const targetList =
        request.listId === undefined
          ? this.requireTaskListForMutation(existing.listId)
          : this.requireTaskListForMutation(request.listId);
      const targetParent =
        request.parentId === undefined || request.parentId === null
          ? null
          : this.requireTaskForMutation(request.parentId);

      if (request.parentId === request.id) {
        throw validationFailure("A task cannot be its own parent.");
      }

      if (targetParent && targetParent.listId !== targetList.id) {
        throw validationFailure("Subtasks must stay in the same task list as their parent.");
      }

      if (targetParent?.parentId) {
        throw validationFailure("Google Tasks supports one subtask level in this app.");
      }

      const now = new Date().toISOString();
      const title = request.title?.trim() ?? existing.title;
      const notes = request.notes ?? existing.notes ?? "";
      const dueAt =
        request.dueDate === undefined ? existing.dueAt ?? null : dateOnlyToIso(request.dueDate);
      const priority = request.priority ?? existing.priority ?? "none";
      const parentId = request.parentId === undefined ? existing.parentId : targetParent?.id ?? null;
      const sortOrder =
        request.previousSiblingId !== undefined ||
        request.parentId !== undefined ||
        request.listId !== undefined
          ? this.nextTaskSortOrder(targetList.id, parentId)
          : existing.sortOrder ?? 0;
      const plannedStart =
        request.plannedStart === undefined ? existing.plannedStart ?? null : request.plannedStart;
      const plannedEnd =
        request.plannedEnd === undefined ? existing.plannedEnd ?? null : request.plannedEnd;
      const durationMinutes =
        request.durationMinutes === undefined
          ? existing.durationMinutes ?? null
          : request.durationMinutes;
      const lockedSchedule =
        request.lockedSchedule === undefined
          ? existing.lockedSchedule === 1
          : request.lockedSchedule;
      const snoozeUntil =
        request.snoozeUntil === undefined ? existing.snoozeUntil ?? null : request.snoozeUntil;
      const tagsJson =
        request.tags === undefined ? existing.tagsJson ?? "[]" : JSON.stringify(request.tags);
      const googleBackedPatch =
        request.title !== undefined ||
        request.notes !== undefined ||
        request.dueDate !== undefined ||
        request.listId !== undefined ||
        request.parentId !== undefined ||
        request.previousSiblingId !== undefined;
      const operations: SqliteWriteOperation[] = [
        {
          kind: "run",
          sql: `UPDATE google_tasks
                SET task_list_id = ?,
                    parent_task_id = ?,
                    title = ?,
                    notes = ?,
                    due_at = ?,
                    local_priority = ?,
                    sort_order = ?,
                    local_planned_start = ?,
                    local_planned_end = ?,
                    local_duration_minutes = ?,
                    local_locked_schedule = ?,
                    local_snooze_until = ?,
                    local_tags_json = ?,
                    updated_at = ?
                WHERE id = ? AND deleted_at IS NULL;`,
          params: [
            targetList.id,
            parentId,
            title,
            notes,
            dueAt,
            priority,
            sortOrder,
            plannedStart,
            plannedEnd,
            durationMinutes,
            lockedSchedule ? 1 : 0,
            snoozeUntil,
            tagsJson,
            now,
            request.id
          ]
        }
      ];

      if (googleBackedPatch) {
        operations.push(
          this.pendingMutationOperation({
            id: `mutation:${randomUUID()}`,
            accountId: existing.accountId ?? targetList.accountId,
            resourceType: "task",
            resourceId: request.id,
            operation: targetList.id !== existing.listId
              ? "task.move_list"
              : request.parentId !== undefined || request.previousSiblingId !== undefined
                ? "task.move"
                : "task.update",
            payload: {
              id: request.id,
              googleId: existing.googleId ?? null,
              fromTaskListId: existing.listId,
              toTaskListId: targetList.id,
              toTaskListGoogleId: targetList.googleId ?? null,
              title,
              notes,
              dueDate: isoToDateOnly(dueAt),
              parentId,
              parentGoogleId: targetParent?.googleId ?? null,
              previousSiblingId: request.previousSiblingId ?? null
            },
            now
          })
        );
      }

      this.connection.executeTransaction(operations);

      return this.getTask(request.id);
    });
  }

  completeTask(request: TaskCompletionRequest): TaskDetail {
    return this.setTaskCompletion(request.id, true);
  }

  reopenTask(request: TaskCompletionRequest): TaskDetail {
    return this.setTaskCompletion(request.id, false);
  }

  moveTask(request: TaskMoveRequest): TaskDetail {
    return this.updateTask({
      id: request.id,
      ...(request.listId === undefined ? {} : { listId: request.listId }),
      ...(request.parentId === undefined ? {} : { parentId: request.parentId }),
      ...(request.previousSiblingId === undefined
        ? {}
        : { previousSiblingId: request.previousSiblingId })
    });
  }

  deleteTask(request: TaskDeleteRequest): { id: string; queued: boolean; revision: string } {
    return this.measureSqlite("tasks.delete", () => {
      const existing = this.requireTaskForMutation(request.id);
      const now = new Date().toISOString();

      this.connection.executeTransaction([
        {
          kind: "run",
          sql: `UPDATE google_tasks
                SET deleted_at = ?, updated_at = ?
                WHERE id = ? AND deleted_at IS NULL;`,
          params: [now, now, request.id]
        },
        this.pendingMutationOperation({
          id: `mutation:${randomUUID()}`,
          accountId: existing.accountId ?? null,
          resourceType: "task",
          resourceId: request.id,
          operation: "task.delete",
          payload: {
            id: request.id,
            googleId: existing.googleId ?? null,
            taskListId: existing.listId,
            taskListGoogleId: existing.listGoogleId ?? null,
            etag: existing.etag ?? null
          },
          now
        })
      ]);

      return { id: request.id, queued: true, revision: now };
    });
  }

  createTaskList(request: TaskListCreateRequest): TaskListSummary {
    return this.measureSqlite("tasks.createTaskList", () => {
      const now = new Date().toISOString();
      const accountId = this.latestAccountId() ?? this.ensureLocalQueueAccount(now);
      const id = `${accountId}:task-list:pending:${randomUUID()}`;
      const sortOrder = this.nextTaskListSortOrder();

      this.connection.executeTransaction([
        {
          kind: "run",
          sql: `INSERT INTO google_task_lists (
            id, account_id, google_id, title, etag, sort_order, is_selected,
            sync_status, google_updated_at, created_at, updated_at, deleted_at
          ) VALUES (?, ?, ?, ?, NULL, ?, 1, 'queued', NULL, ?, ?, NULL);`,
          params: [id, accountId, id, request.title.trim(), sortOrder, now, now]
        },
        this.pendingMutationOperation({
          id: `mutation:${randomUUID()}`,
          accountId,
          resourceType: "task_list",
          resourceId: id,
          operation: "task_list.create",
          payload: {
            localId: id,
            title: request.title.trim()
          },
          now
        })
      ]);

      return this.requireTaskListSummary(id);
    });
  }

  renameTaskList(request: TaskListRenameRequest): TaskListSummary {
    return this.measureSqlite("tasks.renameTaskList", () => {
      const existing = this.requireTaskListForMutation(request.id);
      const now = new Date().toISOString();

      this.connection.executeTransaction([
        {
          kind: "run",
          sql: `UPDATE google_task_lists
                SET title = ?, updated_at = ?
                WHERE id = ? AND deleted_at IS NULL;`,
          params: [request.title.trim(), now, request.id]
        },
        this.pendingMutationOperation({
          id: `mutation:${randomUUID()}`,
          accountId: existing.accountId,
          resourceType: "task_list",
          resourceId: request.id,
          operation: "task_list.rename",
          payload: {
            id: request.id,
            googleId: existing.googleId ?? null,
            title: request.title.trim(),
            etag: existing.etag ?? null
          },
          now
        })
      ]);

      return this.requireTaskListSummary(request.id);
    });
  }

  deleteTaskList(request: TaskListDeleteRequest): { id: string; queued: boolean; revision: string } {
    return this.measureSqlite("tasks.deleteTaskList", () => {
      const existing = this.requireTaskListForMutation(request.id);
      const now = new Date().toISOString();

      this.connection.executeTransaction([
        {
          kind: "run",
          sql: `UPDATE google_task_lists
                SET deleted_at = ?, updated_at = ?
                WHERE id = ? AND deleted_at IS NULL;`,
          params: [now, now, request.id]
        },
        {
          kind: "run",
          sql: `UPDATE google_tasks
                SET deleted_at = ?, updated_at = ?
                WHERE task_list_id = ? AND deleted_at IS NULL;`,
          params: [now, now, request.id]
        },
        this.pendingMutationOperation({
          id: `mutation:${randomUUID()}`,
          accountId: existing.accountId,
          resourceType: "task_list",
          resourceId: request.id,
          operation: "task_list.delete",
          payload: {
            id: request.id,
            googleId: existing.googleId ?? null,
            etag: existing.etag ?? null
          },
          now
        })
      ]);

      return { id: request.id, queued: true, revision: now };
    });
  }

  listCalendars(request: CalendarListRequest): CalendarListResponse {
    return this.measureSqlite("calendar.listCalendars", () => {
      const { limit, offset } = pageBounds(request.cursor, request.limit, 50, 100);
      const rows = this.connection.query<CalendarListRow>(
        `SELECT
           calendars.id AS id,
           calendars.summary AS title,
           calendars.is_selected AS selected,
           calendars.time_zone AS timeZone,
           calendars.updated_at AS updatedAt,
           COUNT(events.id) AS eventCount
         FROM google_calendar_lists calendars
         LEFT JOIN google_calendar_events events
           ON events.calendar_id = calendars.id
          AND events.deleted_at IS NULL
          AND events.status != 'cancelled'
         WHERE calendars.deleted_at IS NULL
           AND calendars.is_hidden = 0
         GROUP BY calendars.id
         ORDER BY calendars.is_primary DESC, calendars.summary COLLATE NOCASE ASC, calendars.id ASC
         LIMIT ? OFFSET ?;`,
        [limit, offset]
      );
      const totalKnown = countRows(
        this.connection,
        `SELECT COUNT(*) AS count
         FROM google_calendar_lists
         WHERE deleted_at IS NULL AND is_hidden = 0;`
      );

      return pageFromRows(rows.map(calendarListSummary), limit, offset, totalKnown);
    });
  }

  listCalendarEvents(request: CalendarRangeRequest): CalendarRangeResponse {
    return this.measureSqlite("calendar.listEvents", () => {
      const { limit, offset } = pageBounds(request.cursor, request.limit, 100, 500);
      const params: Array<string | number | boolean | null> = [request.end, request.start];
      const predicates = [
        "instances.deleted_at IS NULL",
        "instances.status != 'cancelled'",
        "calendars.deleted_at IS NULL",
        "events.deleted_at IS NULL",
        "instances.start_at < ?",
        "instances.end_at > ?"
      ];

      if (request.calendarIds !== undefined && request.calendarIds.length > 0) {
        predicates.push(`instances.calendar_id IN (${request.calendarIds.map(() => "?").join(", ")})`);
        params.push(...request.calendarIds);
      }

      const where = predicates.join(" AND ");
      const rows = this.connection.query<CalendarEventRow>(
        `SELECT
           instances.id AS id,
           events.id AS eventId,
           events.account_id AS accountId,
           instances.calendar_id AS calendarId,
           calendars.summary AS calendarTitle,
           events.summary AS title,
           instances.start_at AS startsAt,
           instances.end_at AS endsAt,
           instances.is_all_day AS allDay,
           instances.updated_at AS updatedAt,
           events.location AS location,
           events.description AS notes,
           events.attendee_emails_json AS guestEmailsJson,
           events.reminder_minutes_json AS reminderMinutesJson,
           pending.status AS pendingMutationStatus,
           events.local_time_zone AS timeZone,
           events.recurrence_rule AS recurrenceRule,
           instances.recurring_event_id AS recurringEventId,
           instances.original_start_at AS originalStartAt
         FROM google_calendar_event_instances instances
         INNER JOIN google_calendar_events events ON events.id = instances.event_id
         INNER JOIN google_calendar_lists calendars ON calendars.id = instances.calendar_id
         LEFT JOIN (
           SELECT resource_id, MAX(status) AS status
           FROM google_pending_mutations
           WHERE resource_type = 'event'
             AND status IN ('pending', 'applying', 'failed')
           GROUP BY resource_id
         ) pending ON pending.resource_id = events.id
         WHERE ${where}
         ORDER BY instances.start_at ASC, instances.end_at ASC, instances.id ASC
         LIMIT ? OFFSET ?;`,
        [...params, limit, offset]
      );
      const totalKnown = countRows(
        this.connection,
        `SELECT COUNT(*) AS count
         FROM google_calendar_event_instances instances
         INNER JOIN google_calendar_events events ON events.id = instances.event_id
         INNER JOIN google_calendar_lists calendars ON calendars.id = instances.calendar_id
         WHERE ${where};`,
        params
      );

      return pageFromRows(rows.map(calendarEventSummary), limit, offset, totalKnown);
    });
  }

  getCalendarEvent(id: string): CalendarEventDetail {
    return this.measureSqlite("calendar.getEvent", () => {
      const row = this.findCalendarEventRow(id);

      if (!row) {
        throw notFound("Calendar event was not found.");
      }

      return calendarEventDetail(row);
    });
  }

  createCalendarEvent(request: CalendarEventCreateRequest): CalendarEventDetail {
    return this.measureSqlite("calendar.create", () => {
      const calendar = this.requireCalendar(request.calendarId);
      const now = new Date().toISOString();
      const googleId = `local-${randomUUID()}`;
      const id = `${calendar.accountId}:event:${calendar.googleId}:${googleId}`;
      const normalized = normalizeCalendarWrite({
        title: request.title,
        calendarId: calendar.id,
        startsAt: request.startsAt,
        endsAt: request.endsAt,
        allDay: request.allDay ?? false,
        location: request.location ?? "",
        notes: request.notes ?? "",
        guestEmails: request.guestEmails ?? [],
        reminderMinutes: request.reminderMinutes ?? [],
        recurrenceRule: recurrenceRuleFromRequest(request.recurrence ?? null)
      });
      const mutationId = `mutation:event:${randomUUID()}`;

      this.connection.executeTransaction([
        eventInsertOperation({
          id,
          accountId: calendar.accountId,
          googleId,
          timeZone: calendar.timeZone ?? systemTimeZone(),
          now,
          ...normalized,
          calendarId: calendar.id
        }),
        instanceDeleteOperation(id, now),
        ...eventInstanceInsertOperations({
          id,
          accountId: calendar.accountId,
          calendarId: calendar.id,
          eventId: id,
          googleEventId: googleId,
          startsAt: normalized.startsAt,
          endsAt: normalized.endsAt,
          allDay: normalized.allDay,
          recurrenceRule: normalized.recurrenceRule,
          status: "confirmed",
          updatedAt: now
        }),
        mutationInsertOperation({
          id: mutationId,
          accountId: calendar.accountId,
          resourceId: id,
          operation: "calendar.events.create",
          payload: mutationPayload(normalized),
          now
        })
      ]);

      return this.getCalendarEvent(id);
    });
  }

  updateCalendarEvent(request: CalendarEventUpdateRequest): CalendarEventDetail {
    return this.measureSqlite("calendar.update", () => {
      const existing = this.findCalendarEventRow(request.id);

      if (!existing) {
        throw notFound("Calendar event was not found.");
      }

      const targetCalendar = this.requireCalendar(request.calendarId ?? existing.calendarId);
      const now = new Date().toISOString();
      const normalized = normalizeCalendarWrite({
        title: request.title ?? existing.title,
        calendarId: targetCalendar.id,
        startsAt: request.startsAt ?? existing.startsAt,
        endsAt: request.endsAt ?? existing.endsAt,
        allDay: request.allDay ?? existing.allDay === 1,
        location: request.location ?? existing.location ?? "",
        notes: request.notes ?? existing.notes ?? "",
        guestEmails: request.guestEmails ?? parseStringArray(existing.guestEmailsJson),
        reminderMinutes: request.reminderMinutes ?? parseNumberArray(existing.reminderMinutesJson),
        recurrenceRule:
          request.recurrence === undefined
            ? existing.recurrenceRule
            : recurrenceRuleFromRequest(request.recurrence)
      });
      const mutationId = `mutation:event:${randomUUID()}`;

      this.connection.executeTransaction([
        eventUpdateOperation({
          id: existing.eventId,
          timeZone: existing.timeZone ?? targetCalendar.timeZone ?? systemTimeZone(),
          now,
          ...normalized,
          calendarId: targetCalendar.id
        }),
        instanceDeleteOperation(existing.eventId, now),
        ...eventInstanceInsertOperations({
          id: existing.eventId,
          accountId: targetCalendar.accountId,
          calendarId: targetCalendar.id,
          eventId: existing.eventId,
          googleEventId: googleEventIdFromLocalEventId(existing.eventId),
          startsAt: normalized.startsAt,
          endsAt: normalized.endsAt,
          allDay: normalized.allDay,
          recurrenceRule: normalized.recurrenceRule,
          status: "confirmed",
          updatedAt: now
        }),
        mutationInsertOperation({
          id: mutationId,
          accountId: targetCalendar.accountId,
          resourceId: existing.eventId,
          operation: "calendar.events.update",
          payload: mutationPayload(normalized),
          now
        })
      ]);

      return this.getCalendarEvent(existing.eventId);
    });
  }

  deleteCalendarEvent(request: CalendarEventDeleteRequest): { id: string; queued: boolean; revision: string } {
    return this.measureSqlite("calendar.delete", () => {
      const existing = this.findCalendarEventRow(request.id);

      if (!existing) {
        throw notFound("Calendar event was not found.");
      }

      const now = new Date().toISOString();
      const mutationId = `mutation:event:${randomUUID()}`;

      this.connection.executeTransaction([
        {
          kind: "run",
          sql: `UPDATE google_calendar_events
                SET status = 'cancelled', deleted_at = ?, updated_at = ?
                WHERE id = ? AND deleted_at IS NULL;`,
          params: [now, now, existing.eventId]
        },
        instanceDeleteOperation(existing.eventId, now),
        mutationInsertOperation({
          id: mutationId,
          accountId: existing.accountId,
          resourceId: existing.eventId,
          operation: "calendar.events.delete",
          payload: {
            id: existing.eventId,
            calendarId: existing.calendarId
          },
          now
        })
      ]);

      return {
        id: existing.eventId,
        queued: true,
        revision: now
      };
    });
  }

  listScheduledTaskBlocks(request: ScheduledTaskBlockListRequest): ScheduledTaskBlockListResponse {
    return this.measureSqlite("calendar.listScheduledTaskBlocks", () => {
      const { limit, offset } = pageBounds(request.cursor, request.limit, 100, 500);
      const params: Array<string | number | boolean | null> = [request.end, request.start];
      const predicates = [
        "blocks.deleted_at IS NULL",
        "COALESCE(instances.start_at, events.start_at, blocks.planned_start_at) < ?",
        "COALESCE(instances.end_at, events.end_at, blocks.planned_end_at) > ?"
      ];

      if (request.calendarIds !== undefined && request.calendarIds.length > 0) {
        predicates.push(`blocks.calendar_id IN (${request.calendarIds.map(() => "?").join(", ")})`);
        params.push(...request.calendarIds);
      }

      const where = predicates.join(" AND ");
      const rows = this.connection.query<ScheduledTaskBlockRow>(
        `SELECT
           blocks.id AS id,
           blocks.task_id AS taskId,
           blocks.calendar_event_id AS calendarEventId,
           COALESCE(instances.calendar_id, events.calendar_id, blocks.calendar_id) AS calendarId,
           tasks.title AS title,
           COALESCE(instances.start_at, events.start_at, blocks.planned_start_at) AS startsAt,
           COALESCE(instances.end_at, events.end_at, blocks.planned_end_at) AS endsAt,
           blocks.duration_minutes AS durationMinutes,
           CASE
             WHEN tasks.id IS NULL
               OR events.id IS NULL
               OR events.deleted_at IS NOT NULL
               OR events.status = 'cancelled'
             THEN 'orphaned'
             ELSE 'scheduled'
           END AS status,
           pending.status AS pendingMutationStatus,
           blocks.updated_at AS updatedAt
         FROM local_scheduled_task_blocks blocks
         LEFT JOIN google_tasks tasks
           ON tasks.id = blocks.task_id
          AND tasks.deleted_at IS NULL
         LEFT JOIN google_calendar_events events
           ON events.id = blocks.calendar_event_id
         LEFT JOIN google_calendar_event_instances instances
           ON instances.event_id = events.id
          AND instances.deleted_at IS NULL
         LEFT JOIN (
           SELECT resource_id, MAX(status) AS status
           FROM google_pending_mutations
           WHERE status IN ('pending', 'applying', 'failed')
           GROUP BY resource_id
         ) pending ON pending.resource_id = blocks.calendar_event_id
         WHERE ${where}
         ORDER BY startsAt ASC, endsAt ASC, blocks.id ASC
         LIMIT ? OFFSET ?;`,
        [...params, limit, offset]
      );
      const totalKnown = countRows(
        this.connection,
        `SELECT COUNT(*) AS count
         FROM local_scheduled_task_blocks blocks
         LEFT JOIN google_calendar_events events
           ON events.id = blocks.calendar_event_id
         LEFT JOIN google_calendar_event_instances instances
           ON instances.event_id = events.id
          AND instances.deleted_at IS NULL
         WHERE ${where};`,
        params
      );

      return pageFromRows(rows.map(scheduledTaskBlockSummary), limit, offset, totalKnown);
    });
  }

  scheduleTaskBlock(request: ScheduledTaskBlockCreateRequest): ScheduledTaskBlockSummary {
    return this.measureSqlite("calendar.scheduleTaskBlock", () => {
      const task = this.requireTaskForMutation(request.taskId);
      const calendar = this.requireCalendar(request.calendarId);
      const now = new Date().toISOString();
      const startsAt = new Date(request.startsAt).toISOString();
      const durationMinutes = request.durationMinutes ?? 30;
      const endsAt = addMinutesIso(startsAt, durationMinutes);
      const existingBlock = this.findScheduledTaskBlockRowForTask(task.id);

      if (existingBlock) {
        const existing = scheduledTaskBlockSummary(existingBlock);

        if (
          existing.status === "scheduled" &&
          existing.calendarId === calendar.id &&
          existing.startsAt === startsAt &&
          existing.endsAt === endsAt
        ) {
          return existing;
        }

        throw validationFailure(
          "Task already has a scheduled block. Move, repair, or unschedule it before scheduling again."
        );
      }

      const googleId = `local-${randomUUID()}`;
      const eventId = `${calendar.accountId}:event:${calendar.googleId}:${googleId}`;
      const blockId = `block:${randomUUID()}`;
      const normalized = normalizeCalendarWrite({
        title: task.title,
        calendarId: calendar.id,
        startsAt,
        endsAt,
        allDay: false,
        location: "Scheduled task",
        notes: scheduledTaskNotes(task),
        guestEmails: [],
        reminderMinutes: [],
        recurrenceRule: null
      });

      this.connection.executeTransaction([
        eventInsertOperation({
          id: eventId,
          accountId: calendar.accountId,
          googleId,
          timeZone: calendar.timeZone ?? systemTimeZone(),
          now,
          ...normalized,
          calendarId: calendar.id
        }),
        instanceDeleteOperation(eventId, now),
        instanceInsertOperation({
          id: eventId,
          accountId: calendar.accountId,
          calendarId: calendar.id,
          eventId,
          googleEventId: googleId,
          startsAt: normalized.startsAt,
          endsAt: normalized.endsAt,
          allDay: false,
          status: "confirmed",
          updatedAt: now
        }),
        mutationInsertOperation({
          id: `mutation:event:${randomUUID()}`,
          accountId: calendar.accountId,
          resourceId: eventId,
          operation: "calendar.events.create",
          payload: mutationPayload(normalized),
          now
        }),
        scheduledTaskBlockInsertOperation({
          id: blockId,
          taskId: task.id,
          calendarEventId: eventId,
          calendarId: calendar.id,
          startsAt: normalized.startsAt,
          endsAt: normalized.endsAt,
          durationMinutes,
          now
        })
      ]);

      return this.requireScheduledTaskBlock(blockId);
    });
  }

  moveScheduledTaskBlock(request: ScheduledTaskBlockMoveRequest): ScheduledTaskBlockSummary {
    return this.measureSqlite("calendar.moveScheduledTaskBlock", () => {
      const block = this.requireScheduledTaskBlock(request.id);
      const event = this.findCalendarEventRow(block.calendarEventId);
      const now = new Date().toISOString();
      const durationMinutes = request.durationMinutes ?? block.durationMinutes;
      const startsAt = request.startsAt ?? block.startsAt;
      const endsAt = addMinutesIso(startsAt, durationMinutes);

      if (!event) {
        const task = this.requireTaskForMutation(block.taskId);
        const targetCalendar = this.requireCalendar(request.calendarId ?? block.calendarId);
        const googleId = `local-${randomUUID()}`;
        const eventId = `${targetCalendar.accountId}:event:${targetCalendar.googleId}:${googleId}`;
        const normalized = normalizeCalendarWrite({
          title: task.title,
          calendarId: targetCalendar.id,
          startsAt,
          endsAt,
          allDay: false,
          location: "Scheduled task",
          notes: scheduledTaskNotes(task),
          guestEmails: [],
          reminderMinutes: [],
          recurrenceRule: null
        });

        this.connection.executeTransaction([
          eventInsertOperation({
            id: eventId,
            accountId: targetCalendar.accountId,
            googleId,
            timeZone: targetCalendar.timeZone ?? systemTimeZone(),
            now,
            ...normalized,
            calendarId: targetCalendar.id
          }),
          instanceDeleteOperation(eventId, now),
          instanceInsertOperation({
            id: eventId,
            accountId: targetCalendar.accountId,
            calendarId: targetCalendar.id,
            eventId,
            googleEventId: googleId,
            startsAt: normalized.startsAt,
            endsAt: normalized.endsAt,
            allDay: false,
            status: "confirmed",
            updatedAt: now
          }),
          mutationInsertOperation({
            id: `mutation:event:${randomUUID()}`,
            accountId: targetCalendar.accountId,
            resourceId: eventId,
            operation: "calendar.events.create",
            payload: mutationPayload(normalized),
            now
          }),
          {
            kind: "run",
            sql: `UPDATE local_scheduled_task_blocks
                  SET calendar_event_id = ?,
                      calendar_id = ?,
                      planned_start_at = ?,
                      planned_end_at = ?,
                      duration_minutes = ?,
                      status = 'scheduled',
                      updated_at = ?
                  WHERE id = ? AND deleted_at IS NULL;`,
            params: [
              eventId,
              targetCalendar.id,
              normalized.startsAt,
              normalized.endsAt,
              durationMinutes,
              now,
              request.id
            ]
          }
        ]);

        return this.requireScheduledTaskBlock(request.id);
      }

      const targetCalendar = this.requireCalendar(request.calendarId ?? event.calendarId);
      const normalized = normalizeCalendarWrite({
        title: event.title,
        calendarId: targetCalendar.id,
        startsAt,
        endsAt,
        allDay: false,
        location: event.location ?? "",
        notes: event.notes ?? "",
        guestEmails: parseStringArray(event.guestEmailsJson),
        reminderMinutes: parseNumberArray(event.reminderMinutesJson),
        recurrenceRule: event.recurrenceRule
      });

      this.connection.executeTransaction([
        eventUpdateOperation({
          id: event.eventId,
          timeZone: event.timeZone ?? targetCalendar.timeZone ?? systemTimeZone(),
          now,
          ...normalized,
          calendarId: targetCalendar.id
        }),
        instanceDeleteOperation(event.eventId, now),
        instanceInsertOperation({
          id: event.eventId,
          accountId: targetCalendar.accountId,
          calendarId: targetCalendar.id,
          eventId: event.eventId,
          googleEventId: googleEventIdFromLocalEventId(event.eventId),
          startsAt: normalized.startsAt,
          endsAt: normalized.endsAt,
          allDay: false,
          status: "confirmed",
          updatedAt: now
        }),
        mutationInsertOperation({
          id: `mutation:event:${randomUUID()}`,
          accountId: targetCalendar.accountId,
          resourceId: event.eventId,
          operation: "calendar.events.update",
          payload: mutationPayload(normalized),
          now
        }),
        {
          kind: "run",
          sql: `UPDATE local_scheduled_task_blocks
                SET calendar_id = ?,
                    planned_start_at = ?,
                    planned_end_at = ?,
                    duration_minutes = ?,
                    status = 'scheduled',
                    updated_at = ?
                WHERE id = ? AND deleted_at IS NULL;`,
          params: [
            targetCalendar.id,
            normalized.startsAt,
            normalized.endsAt,
            durationMinutes,
            now,
            request.id
          ]
        }
      ]);

      return this.requireScheduledTaskBlock(request.id);
    });
  }

  unscheduleTaskBlock(
    request: ScheduledTaskBlockUnscheduleRequest
  ): { id: string; queued: boolean; revision: string } {
    return this.measureSqlite("calendar.unscheduleTaskBlock", () => {
      const block = this.requireScheduledTaskBlock(request.id);
      const event = this.findCalendarEventRow(block.calendarEventId);
      const now = new Date().toISOString();
      const deleteCalendarEvent = request.deleteCalendarEvent ?? true;
      const operations: SqliteWriteOperation[] = [
        {
          kind: "run",
          sql: `UPDATE local_scheduled_task_blocks
                SET status = 'unscheduled',
                    deleted_at = ?,
                    updated_at = ?
                WHERE id = ? AND deleted_at IS NULL;`,
          params: [now, now, request.id]
        }
      ];

      if (deleteCalendarEvent && event) {
        operations.push(
          {
            kind: "run",
            sql: `UPDATE google_calendar_events
                  SET status = 'cancelled', deleted_at = ?, updated_at = ?
                  WHERE id = ? AND deleted_at IS NULL;`,
            params: [now, now, event.eventId]
          },
          instanceDeleteOperation(event.eventId, now),
          mutationInsertOperation({
            id: `mutation:event:${randomUUID()}`,
            accountId: event.accountId,
            resourceId: event.eventId,
            operation: "calendar.events.delete",
            payload: {
              id: event.eventId,
              calendarId: event.calendarId
            },
            now
          })
        );
      }

      this.connection.executeTransaction(operations);

      return {
        id: request.id,
        queued: deleteCalendarEvent && event !== undefined,
        revision: now
      };
    });
  }

  exportAvailability(request: AvailabilityExportRequest): AvailabilityExportResponse {
    return this.measureSqlite("calendar.exportAvailability", () => {
      const generatedAt = new Date().toISOString();
      const events = this.listCalendarEvents({
        start: request.start,
        end: request.end,
        ...(request.calendarIds === undefined ? {} : { calendarIds: request.calendarIds }),
        limit: 500
      }).items;
      const busyLines = events.map((event) => availabilityLine(event));

      return {
        format: "text",
        text: [
          `Availability from ${request.start} to ${request.end}`,
          busyLines.length === 0 ? "No busy blocks in selected calendars." : "Busy:",
          ...busyLines
        ].join("\n"),
        generatedAt,
        busyBlockCount: events.length
      };
    });
  }

  private requireScheduledTaskBlock(id: string): ScheduledTaskBlockSummary {
    const row = this.findScheduledTaskBlockRow(id);

    if (!row) {
      throw notFound("Scheduled task block was not found.");
    }

    return scheduledTaskBlockSummary(row);
  }

  private findScheduledTaskBlockRow(id: string): ScheduledTaskBlockRow | undefined {
    return this.connection.get<ScheduledTaskBlockRow>(
      `SELECT
         blocks.id AS id,
         blocks.task_id AS taskId,
         blocks.calendar_event_id AS calendarEventId,
         COALESCE(instances.calendar_id, events.calendar_id, blocks.calendar_id) AS calendarId,
         tasks.title AS title,
         COALESCE(instances.start_at, events.start_at, blocks.planned_start_at) AS startsAt,
         COALESCE(instances.end_at, events.end_at, blocks.planned_end_at) AS endsAt,
         blocks.duration_minutes AS durationMinutes,
         CASE
           WHEN tasks.id IS NULL
             OR events.id IS NULL
             OR events.deleted_at IS NOT NULL
             OR events.status = 'cancelled'
           THEN 'orphaned'
           ELSE 'scheduled'
         END AS status,
         pending.status AS pendingMutationStatus,
         blocks.updated_at AS updatedAt
       FROM local_scheduled_task_blocks blocks
       LEFT JOIN google_tasks tasks
         ON tasks.id = blocks.task_id
        AND tasks.deleted_at IS NULL
       LEFT JOIN google_calendar_events events
         ON events.id = blocks.calendar_event_id
       LEFT JOIN google_calendar_event_instances instances
         ON instances.event_id = events.id
        AND instances.deleted_at IS NULL
       LEFT JOIN (
         SELECT resource_id, MAX(status) AS status
         FROM google_pending_mutations
         WHERE status IN ('pending', 'applying', 'failed')
         GROUP BY resource_id
       ) pending ON pending.resource_id = blocks.calendar_event_id
       WHERE blocks.id = ?
         AND blocks.deleted_at IS NULL
       LIMIT 1;`,
      [id]
    );
  }

  private findScheduledTaskBlockRowForTask(taskId: string): ScheduledTaskBlockRow | undefined {
    return this.connection.get<ScheduledTaskBlockRow>(
      `SELECT
         blocks.id AS id,
         blocks.task_id AS taskId,
         blocks.calendar_event_id AS calendarEventId,
         COALESCE(instances.calendar_id, events.calendar_id, blocks.calendar_id) AS calendarId,
         tasks.title AS title,
         COALESCE(instances.start_at, events.start_at, blocks.planned_start_at) AS startsAt,
         COALESCE(instances.end_at, events.end_at, blocks.planned_end_at) AS endsAt,
         blocks.duration_minutes AS durationMinutes,
         CASE
           WHEN tasks.id IS NULL
             OR events.id IS NULL
             OR events.deleted_at IS NOT NULL
             OR events.status = 'cancelled'
           THEN 'orphaned'
           ELSE 'scheduled'
         END AS status,
         pending.status AS pendingMutationStatus,
         blocks.updated_at AS updatedAt
       FROM local_scheduled_task_blocks blocks
       LEFT JOIN google_tasks tasks
         ON tasks.id = blocks.task_id
        AND tasks.deleted_at IS NULL
       LEFT JOIN google_calendar_events events
         ON events.id = blocks.calendar_event_id
       LEFT JOIN google_calendar_event_instances instances
         ON instances.event_id = events.id
        AND instances.deleted_at IS NULL
       LEFT JOIN (
         SELECT resource_id, MAX(status) AS status
         FROM google_pending_mutations
         WHERE status IN ('pending', 'applying', 'failed')
         GROUP BY resource_id
       ) pending ON pending.resource_id = blocks.calendar_event_id
       WHERE blocks.task_id = ?
         AND blocks.deleted_at IS NULL
       ORDER BY blocks.updated_at DESC, blocks.id ASC
       LIMIT 1;`,
      [taskId]
    );
  }

  private findCalendarEventRow(id: string): CalendarEventRow | undefined {
    return this.connection.get<CalendarEventRow>(
        `SELECT
           COALESCE(instances.id, events.id) AS id,
           events.id AS eventId,
           events.account_id AS accountId,
           events.calendar_id AS calendarId,
           calendars.summary AS calendarTitle,
           events.summary AS title,
           COALESCE(instances.start_at, events.start_at) AS startsAt,
           COALESCE(instances.end_at, events.end_at) AS endsAt,
           COALESCE(instances.is_all_day, events.is_all_day) AS allDay,
           COALESCE(instances.updated_at, events.updated_at) AS updatedAt,
           events.location AS location,
           events.description AS notes,
           events.attendee_emails_json AS guestEmailsJson,
           events.reminder_minutes_json AS reminderMinutesJson,
           pending.status AS pendingMutationStatus,
           events.local_time_zone AS timeZone,
           events.recurrence_rule AS recurrenceRule,
           COALESCE(instances.recurring_event_id, events.recurring_event_id) AS recurringEventId,
           instances.original_start_at AS originalStartAt
         FROM google_calendar_events events
         LEFT JOIN google_calendar_event_instances instances
           ON instances.event_id = events.id
          AND instances.deleted_at IS NULL
          AND instances.id = ?
         INNER JOIN google_calendar_lists calendars ON calendars.id = events.calendar_id
         LEFT JOIN (
           SELECT resource_id, MAX(status) AS status
           FROM google_pending_mutations
           WHERE resource_type = 'event'
             AND status IN ('pending', 'applying', 'failed')
           GROUP BY resource_id
         ) pending ON pending.resource_id = events.id
         WHERE (events.id = ? OR instances.id = ?)
           AND events.deleted_at IS NULL
           AND calendars.deleted_at IS NULL
         LIMIT 1;`,
      [id, id, id]
      );
  }

  private requireCalendar(id: string): CalendarRow {
    const row = this.connection.get<CalendarRow>(
      `SELECT
         id,
         account_id AS accountId,
         google_id AS googleId,
         summary AS title,
         time_zone AS timeZone,
         access_role AS accessRole
       FROM google_calendar_lists
       WHERE id = ?
         AND deleted_at IS NULL
         AND is_hidden = 0
       LIMIT 1;`,
      [id]
    );

    if (!row) {
      throw notFound("Calendar was not found.");
    }

    return row;
  }

  listNotes(request: NoteListRequest): NoteListResponse {
    return this.measureSqlite("notes.list", () => {
      const { limit, offset } = pageBounds(request.cursor, request.limit, 50, 100);
      const rows = this.connection.query<NoteRow>(
        `SELECT id, title, body, created_at AS createdAt, updated_at AS updatedAt
         FROM local_notes
         WHERE deleted_at IS NULL
         ORDER BY updated_at DESC, id ASC
         LIMIT ? OFFSET ?;`,
        [limit, offset]
      );
      const totalKnown = countRows(
        this.connection,
        "SELECT COUNT(*) AS count FROM local_notes WHERE deleted_at IS NULL;"
      );

      return pageFromRows(rows.map(noteSummary), limit, offset, totalKnown);
    });
  }

  getNote(id: string): NoteDetail {
    return this.measureSqlite("notes.get", () => {
      const row = this.connection.get<NoteRow>(
        `SELECT id, title, body, created_at AS createdAt, updated_at AS updatedAt
         FROM local_notes
         WHERE id = ? AND deleted_at IS NULL
         LIMIT 1;`,
        [id]
      );

      if (!row) {
        throw notFound("Note was not found.");
      }

      return noteDetail(row);
    });
  }

  createNote(request: NoteCreateRequest): NoteDetail {
    return this.measureSqlite("notes.create", () => {
      const now = new Date().toISOString();
      const id = `note:${randomUUID()}`;
      const body = request.body ?? "";

      this.connection.run(
        `INSERT INTO local_notes (id, title, body, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?);`,
        [id, request.title.trim(), body, now, now]
      );

      this.reindexNoteLinksAndProperties(id, body, now);

      return this.getNote(id);
    });
  }

  updateNote(request: NoteUpdateRequest): NoteDetail {
    return this.measureSqlite("notes.update", () => {
      const existing = this.getNote(request.id);
      const now = new Date().toISOString();
      const nextBody = request.body ?? existing.body;

      this.connection.run(
        `UPDATE local_notes
         SET title = ?, body = ?, updated_at = ?
         WHERE id = ? AND deleted_at IS NULL;`,
        [
          request.title?.trim() ?? existing.title,
          nextBody,
          now,
          request.id
        ]
      );

      this.reindexNoteLinksAndProperties(request.id, nextBody, now);

      return this.getNote(request.id);
    });
  }

  suggestLinkTargets(request: NoteLinkSuggestRequest): NoteLinkSuggestResponse {
    return this.measureSqlite("notes.linkSuggest", () => {
      const query = `%${request.query}%`;
      const kinds = new Set(request.kinds ?? ["note", "task", "event"]);
      const limit = request.limit ?? 8;
      const items: NoteLinkSuggestResponse["items"] = [];

      if (kinds.has("note")) {
        const rows = this.connection.query<{ id: string; label: string }>(
          `SELECT id, title AS label
           FROM local_notes
           WHERE deleted_at IS NULL AND title LIKE ? COLLATE NOCASE
           ORDER BY updated_at DESC, id ASC
           LIMIT ?;`,
          [query, limit]
        );
        items.push(...rows.map((row) => ({ kind: "note" as const, id: row.id, label: row.label })));
      }

      if (kinds.has("task") && items.length < limit) {
        const rows = this.connection.query<{ id: string; label: string }>(
          `SELECT id, title AS label
           FROM google_tasks
           WHERE deleted_at IS NULL AND title LIKE ? COLLATE NOCASE
           ORDER BY updated_at DESC, id ASC
           LIMIT ?;`,
          [query, limit]
        );
        items.push(...rows.map((row) => ({ kind: "task" as const, id: row.id, label: row.label })));
      }

      if (kinds.has("event") && items.length < limit) {
        const rows = this.connection.query<{ id: string; label: string }>(
          `SELECT id, summary AS label
           FROM google_calendar_events
           WHERE deleted_at IS NULL AND summary LIKE ? COLLATE NOCASE
           ORDER BY updated_at DESC, id ASC
           LIMIT ?;`,
          [query, limit]
        );
        items.push(...rows.map((row) => ({ kind: "event" as const, id: row.id, label: row.label })));
      }

      return { items: items.slice(0, limit) };
    });
  }

  listBrokenNoteLinks(request: NoteBrokenLinksRequest): NoteBrokenLinksResponse {
    return this.measureSqlite("notes.listBrokenLinks", () => {
      this.getNote(request.noteId);
      const rows = this.connection.query<{ linkText: string }>(
        `SELECT link_text AS linkText
         FROM local_note_links
         WHERE source_note_id = ? AND is_broken = 1
         ORDER BY id ASC;`,
        [request.noteId]
      );

      return { items: rows.map((row) => ({ linkText: row.linkText })) };
    });
  }

  private reindexNoteLinksAndProperties(noteId: string, body: string, now: string): void {
    const links = extractPlannerLinks(body);
    const properties = extractNoteProperties(body);
    const operations: SqliteWriteOperation[] = [
      { kind: "run", sql: `DELETE FROM local_note_links WHERE source_note_id = ?;`, params: [noteId] },
      { kind: "run", sql: `DELETE FROM local_note_properties WHERE note_id = ?;`, params: [noteId] }
    ];

    for (const link of links) {
      const resolvedTargetId = this.resolveLinkTargetId(link);
      operations.push({
        kind: "run",
        sql: `INSERT INTO local_note_links
              (source_note_id, target_kind, target_id, link_text, is_broken, created_at)
              VALUES (?, ?, ?, ?, ?, ?);`,
        params: [
          noteId,
          link.kind,
          resolvedTargetId,
          link.raw,
          resolvedTargetId === null ? 1 : 0,
          now
        ]
      });
    }

    for (const property of properties) {
      operations.push({
        kind: "run",
        sql: `INSERT INTO local_note_properties
              (note_id, property_key, property_value, updated_at)
              VALUES (?, ?, ?, ?)
              ON CONFLICT(note_id, property_key) DO UPDATE SET
                property_value = excluded.property_value,
                updated_at = excluded.updated_at;`,
        params: [noteId, property.key, property.value, now]
      });
    }

    this.connection.executeTransaction(operations);
  }

  private resolveLinkTargetId(link: PlannerLinkReference): string | null {
    if (link.kind === "note") {
      const row = this.connection.get<{ id: string }>(
        `SELECT id FROM local_notes
         WHERE deleted_at IS NULL AND LOWER(title) = LOWER(?)
         LIMIT 1;`,
        [link.label]
      );
      return row?.id ?? null;
    }

    if (link.kind === "task") {
      const row = this.connection.get<{ id: string }>(
        `SELECT id FROM google_tasks
         WHERE deleted_at IS NULL AND (id = ? OR LOWER(title) = LOWER(?))
         LIMIT 1;`,
        [link.label, link.label]
      );
      return row?.id ?? null;
    }

    if (link.kind === "event") {
      const row = this.connection.get<{ id: string }>(
        `SELECT id FROM google_calendar_events
         WHERE deleted_at IS NULL AND (id = ? OR LOWER(title) = LOWER(?))
         LIMIT 1;`,
        [link.label, link.label]
      );
      return row?.id ?? null;
    }

    return null;
  }

  deleteNote(request: NoteDeleteRequest): { id: string; queued: boolean; revision: string } {
    return this.measureSqlite("notes.delete", () => {
      const now = new Date().toISOString();
      const result = this.connection.run(
        `UPDATE local_notes
         SET deleted_at = ?, updated_at = ?
         WHERE id = ? AND deleted_at IS NULL;`,
        [now, now, request.id]
      );

      if (result.changes === 0) {
        throw notFound("Note was not found.");
      }

      return {
        id: request.id,
        queued: false,
        revision: now
      };
    });
  }

  search(request: SearchQueryRequest): SearchQueryResponse {
    const startedAt = performance.now();

    try {
      const result = this.measureSqlite("search.query.sqlite", () => {
        const parsed = parseLocalSearchQuery(request.query);
        const parseError = parsed.errors[0];

        if (parseError !== undefined) {
          throw new HcbPublicError({
            code: "VALIDATION_ERROR",
            message: parseError.message,
            recoverable: true
          });
        }

        const domains = new Set<SearchDomain>(resolveLocalSearchDomains(parsed, request.domains));
        const limit = Math.max(1, Math.min(50, request.limit ?? 20));
        const ftsQuery = ftsMatchQuery(parsed.text);
        const results: SearchResultItem[] = [];

        if (!hasRunnableLocalSearch(parsed) || (!ftsQuery && parsed.chips.length === 0)) {
          return {
            items: [],
            page: {
              limit,
              totalKnown: 0
            }
          };
        }

        if (
          parsed.chips.length === 0 &&
          ftsQuery &&
          domains.size === 3 &&
          domains.has("tasks") &&
          domains.has("calendar") &&
          domains.has("notes")
        ) {
          const items = this.searchAllDomains(ftsQuery, limit);

          return {
            items,
            page: {
              limit,
              totalKnown: items.length
            }
          };
        }

        if (domains.has("tasks")) {
          results.push(...this.searchTasks(parsed, ftsQuery, limit));
        }

        if (domains.has("calendar")) {
          results.push(...this.searchEvents(parsed, ftsQuery, limit));
        }

        if (domains.has("notes")) {
          results.push(...this.searchNotes(parsed, ftsQuery, limit));
        }

        const sorted = results
          .sort((left, right) => (right.updatedAt ?? "").localeCompare(left.updatedAt ?? ""))
          .slice(0, limit);

        return {
          items: sorted,
          page: {
            limit,
            totalKnown: results.length
          }
        };
      });

      this.timings?.record({
        kind: "search",
        name: "search.query",
        durationMs: performance.now() - startedAt,
        metadata: {
          resultCount: result.items.length
        }
      });

      return result;
    } catch (error) {
      this.timings?.record({
        kind: "search",
        name: "search.query",
        durationMs: performance.now() - startedAt,
        metadata: {
          failed: true
        }
      });
      throw error;
    }
  }

  private setTaskCompletion(id: string, completed: boolean): TaskDetail {
    return this.measureSqlite(completed ? "tasks.complete" : "tasks.reopen", () => {
      const existing = this.requireTaskForMutation(id);
      const now = new Date().toISOString();
      const completedAt = completed ? now : null;
      const status = completed ? "completed" : "needsAction";

      this.connection.executeTransaction([
        {
          kind: "run",
          sql: `UPDATE google_tasks
                SET status = ?, completed_at = ?, updated_at = ?
                WHERE id = ? AND deleted_at IS NULL;`,
          params: [status, completedAt, now, id]
        },
        this.pendingMutationOperation({
          id: `mutation:${randomUUID()}`,
          accountId: existing.accountId ?? null,
          resourceType: "task",
          resourceId: id,
          operation: completed ? "task.complete" : "task.reopen",
          payload: {
            id,
            googleId: existing.googleId ?? null,
            taskListId: existing.listId,
            taskListGoogleId: existing.listGoogleId ?? null,
            completed,
            etag: existing.etag ?? null
          },
          now
        })
      ]);

      return this.getTask(id);
    });
  }

  private requireTaskForMutation(id: string): TaskRow {
    const row = this.connection.get<TaskRow>(
      `SELECT
         tasks.id AS id,
         tasks.account_id AS accountId,
         tasks.google_id AS googleId,
         tasks.task_list_id AS listId,
         lists.google_id AS listGoogleId,
         lists.title AS listTitle,
         tasks.title AS title,
         tasks.status AS status,
         tasks.notes AS notes,
         tasks.due_at AS dueAt,
         tasks.parent_task_id AS parentId,
         tasks.deleted_at AS deletedAt,
         tasks.is_hidden AS isHidden,
         COALESCE(tasks.local_priority, 'none') AS priority,
         tasks.sort_order AS sortOrder,
         tasks.etag AS etag,
         tasks.updated_at AS updatedAt,
         tasks.local_planned_start AS plannedStart,
         tasks.local_planned_end AS plannedEnd,
         tasks.local_duration_minutes AS durationMinutes,
         tasks.local_locked_schedule AS lockedSchedule,
         tasks.local_snooze_until AS snoozeUntil,
         tasks.local_tags_json AS tagsJson
       FROM google_tasks tasks
       INNER JOIN google_task_lists lists ON lists.id = tasks.task_list_id
       WHERE tasks.id = ?
         AND tasks.deleted_at IS NULL
         AND lists.deleted_at IS NULL
       LIMIT 1;`,
      [id]
    );

    if (!row) {
      throw notFound("Task was not found.");
    }

    return row;
  }

  private requireTaskListForMutation(id: string): Required<Pick<TaskListRow, "id" | "accountId" | "googleId" | "title" | "updatedAt">> & TaskListRow {
    const row = this.connection.get<TaskListRow>(
      `SELECT
         id,
         account_id AS accountId,
         google_id AS googleId,
         title,
         sort_order AS sortOrder,
         etag,
         updated_at AS updatedAt,
         0 AS taskCount,
         0 AS activeTaskCount
       FROM google_task_lists
       WHERE id = ? AND deleted_at IS NULL
       LIMIT 1;`,
      [id]
    );

    if (!row || !row.accountId || !row.googleId) {
      throw notFound("Task list was not found.");
    }

    return row as Required<Pick<TaskListRow, "id" | "accountId" | "googleId" | "title" | "updatedAt">> & TaskListRow;
  }

  private requireTaskListSummary(id: string): TaskListSummary {
    const row = this.connection.get<TaskListRow>(
      `SELECT
         lists.id AS id,
         lists.title AS title,
         lists.updated_at AS updatedAt,
         COUNT(tasks.id) AS taskCount,
         COALESCE(SUM(CASE WHEN tasks.status != 'completed'
                            AND tasks.deleted_at IS NULL
                            AND tasks.is_hidden = 0
                            THEN 1 ELSE 0 END), 0) AS activeTaskCount
       FROM google_task_lists lists
       LEFT JOIN google_tasks tasks
         ON tasks.task_list_id = lists.id
        AND tasks.deleted_at IS NULL
       WHERE lists.id = ? AND lists.deleted_at IS NULL
       GROUP BY lists.id
       LIMIT 1;`,
      [id]
    );

    if (!row) {
      throw notFound("Task list was not found.");
    }

    return taskListSummary(row);
  }

  private latestAccountId(): string | null {
    return (
      this.connection.get<{ id: string }>(
        `SELECT id
         FROM google_accounts
         WHERE deleted_at IS NULL
         ORDER BY
           CASE WHEN connection_state = 'connected' THEN 0 ELSE 1 END,
           updated_at DESC
         LIMIT 1;`
      )?.id ?? null
    );
  }

  private ensureLocalQueueAccount(now: string): string {
    const accountId = "local-google-account";

    this.connection.run(
      `INSERT INTO google_accounts (
        id, connection_state, granted_scopes_json, missing_scopes_json, updated_at
      ) VALUES (?, 'signed_out', '[]', '[]', ?)
      ON CONFLICT(id) DO UPDATE SET
        updated_at = excluded.updated_at,
        deleted_at = NULL;`,
      [accountId, now]
    );

    return accountId;
  }

  private nextTaskListSortOrder(): number {
    return (
      (this.connection.get<{ maxSort: number | null }>(
        `SELECT MAX(sort_order) AS maxSort
         FROM google_task_lists
         WHERE deleted_at IS NULL;`
      )?.maxSort ?? -1) + 1
    );
  }

  private nextTaskSortOrder(listId: string, parentId: string | null): number {
    return (
      (this.connection.get<{ maxSort: number | null }>(
        `SELECT MAX(sort_order) AS maxSort
         FROM google_tasks
         WHERE task_list_id = ?
           AND (${parentId === null ? "parent_task_id IS NULL" : "parent_task_id = ?"})
           AND deleted_at IS NULL;`,
        parentId === null ? [listId] : [listId, parentId]
      )?.maxSort ?? -1) + 1
    );
  }

  private pendingMutationOperation(input: {
    id: string;
    accountId: string | null;
    resourceType: string;
    resourceId: string;
    operation: string;
    payload: unknown;
    now: string;
  }): SqliteWriteOperation {
    return {
      kind: "run",
      sql: `INSERT INTO google_pending_mutations (
        id, account_id, resource_type, resource_id, operation, payload_json, status,
        attempt_count, next_retry_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, NULL, ?, ?);`,
      params: [
        input.id,
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

  private searchAllDomains(ftsQuery: string, limit: number): SearchResultItem[] {
    return this.connection
      .query<{
        id: string;
        domain: SearchDomain;
        title: string;
        snippet: string | null;
        updatedAt: string;
      }>(
        `WITH task_matches AS (
           SELECT tasks.rowid AS taskRowid, bm25(google_tasks_fts) AS rank
           FROM google_tasks_fts
           INNER JOIN google_tasks tasks ON tasks.rowid = google_tasks_fts.rowid
           WHERE google_tasks_fts MATCH ?

           UNION ALL

           SELECT tasks.rowid AS taskRowid, bm25(google_task_lists_fts) + 2.0 AS rank
           FROM google_task_lists_fts
           INNER JOIN google_task_lists lists ON lists.rowid = google_task_lists_fts.rowid
           INNER JOIN google_tasks tasks ON tasks.task_list_id = lists.id
           WHERE google_task_lists_fts MATCH ?
         ),
         task_ranked AS (
           SELECT taskRowid, MIN(rank) AS rank
           FROM task_matches
           GROUP BY taskRowid
         ),
         event_matches AS (
           SELECT events.rowid AS eventRowid, bm25(google_calendar_events_fts) AS rank
           FROM google_calendar_events_fts
           INNER JOIN google_calendar_events events ON events.rowid = google_calendar_events_fts.rowid
           WHERE google_calendar_events_fts MATCH ?

           UNION ALL

           SELECT events.rowid AS eventRowid, bm25(google_calendar_lists_fts) + 2.0 AS rank
           FROM google_calendar_lists_fts
           INNER JOIN google_calendar_lists calendars ON calendars.rowid = google_calendar_lists_fts.rowid
           INNER JOIN google_calendar_events events ON events.calendar_id = calendars.id
           WHERE google_calendar_lists_fts MATCH ?
         ),
         event_ranked AS (
           SELECT eventRowid, MIN(rank) AS rank
           FROM event_matches
           GROUP BY eventRowid
         )
         SELECT
           tasks.id AS id,
           'tasks' AS domain,
           tasks.title AS title,
           COALESCE(tasks.notes, lists.title) AS snippet,
           tasks.updated_at AS updatedAt
         FROM task_ranked
         INNER JOIN google_tasks tasks ON tasks.rowid = task_ranked.taskRowid
         INNER JOIN google_task_lists lists ON lists.id = tasks.task_list_id
         WHERE tasks.deleted_at IS NULL
           AND tasks.is_hidden = 0
           AND lists.deleted_at IS NULL

         UNION ALL

         SELECT
           events.id AS id,
           'calendar' AS domain,
           events.summary AS title,
           COALESCE(events.description, events.location, calendars.summary) AS snippet,
           events.updated_at AS updatedAt
         FROM event_ranked
         INNER JOIN google_calendar_events events ON events.rowid = event_ranked.eventRowid
         INNER JOIN google_calendar_lists calendars ON calendars.id = events.calendar_id
         WHERE events.deleted_at IS NULL
           AND events.status != 'cancelled'
           AND calendars.deleted_at IS NULL

         UNION ALL

         SELECT
           notes.id AS id,
           'notes' AS domain,
           notes.title AS title,
           notes.body AS snippet,
           notes.updated_at AS updatedAt
         FROM local_notes_fts
         INNER JOIN local_notes notes ON notes.rowid = local_notes_fts.rowid
         WHERE local_notes_fts MATCH ?
           AND notes.deleted_at IS NULL

         ORDER BY updatedAt DESC, id ASC
         LIMIT ?;`,
        [ftsQuery, ftsQuery, ftsQuery, ftsQuery, ftsQuery, limit]
      )
      .map((row) => ({
        id: row.id,
        domain: row.domain,
        title: row.title,
        snippet: row.domain === "notes" ? preview(row.snippet ?? "") : row.snippet ?? undefined,
        updatedAt: row.updatedAt
      }));
  }

  private searchTasks(
    parsed: ParsedLocalSearchQuery,
    ftsQuery: string,
    limit: number
  ): SearchResultItem[] {
    const { predicates, params } = taskSearchPredicates(parsed);
    const where = predicates.join(" AND ");

    if (!ftsQuery) {
      return this.connection
        .query<{
          id: string;
          title: string;
          snippet: string | null;
          updatedAt: string;
        }>(
          `SELECT
             tasks.id AS id,
             tasks.title AS title,
             COALESCE(tasks.notes, lists.title) AS snippet,
             tasks.updated_at AS updatedAt
           FROM google_tasks tasks
           INNER JOIN google_task_lists lists ON lists.id = tasks.task_list_id
           WHERE ${where}
           ORDER BY
             CASE WHEN tasks.due_at IS NULL THEN 1 ELSE 0 END,
             tasks.due_at ASC,
             tasks.updated_at DESC,
             tasks.id ASC
           LIMIT ?;`,
          [...params, limit]
        )
        .map((row) => ({
          id: row.id,
          domain: "tasks" as const,
          title: row.title,
          snippet: row.snippet ?? undefined,
          updatedAt: row.updatedAt
        }));
    }

    return this.connection
      .query<{
        id: string;
        title: string;
        snippet: string | null;
        updatedAt: string;
      }>(
        `WITH matches AS (
           SELECT tasks.rowid AS taskRowid, bm25(google_tasks_fts) AS rank
           FROM google_tasks_fts
           INNER JOIN google_tasks tasks ON tasks.rowid = google_tasks_fts.rowid
           WHERE google_tasks_fts MATCH ?

           UNION ALL

           SELECT tasks.rowid AS taskRowid, bm25(google_task_lists_fts) + 2.0 AS rank
           FROM google_task_lists_fts
           INNER JOIN google_task_lists lists ON lists.rowid = google_task_lists_fts.rowid
           INNER JOIN google_tasks tasks ON tasks.task_list_id = lists.id
           WHERE google_task_lists_fts MATCH ?
         ),
         ranked AS (
           SELECT taskRowid, MIN(rank) AS rank
           FROM matches
           GROUP BY taskRowid
         )
         SELECT
           tasks.id AS id,
           tasks.title AS title,
           COALESCE(tasks.notes, lists.title) AS snippet,
           tasks.updated_at AS updatedAt
         FROM ranked
         INNER JOIN google_tasks tasks ON tasks.rowid = ranked.taskRowid
         INNER JOIN google_task_lists lists ON lists.id = tasks.task_list_id
         WHERE ${where}
         ORDER BY ranked.rank ASC, tasks.updated_at DESC, tasks.id ASC
         LIMIT ?;`,
        [ftsQuery, ftsQuery, ...params, limit]
      )
      .map((row) => ({
        id: row.id,
        domain: "tasks" as const,
        title: row.title,
        snippet: row.snippet ?? undefined,
        updatedAt: row.updatedAt
      }));
  }

  private searchEvents(
    parsed: ParsedLocalSearchQuery,
    ftsQuery: string,
    limit: number
  ): SearchResultItem[] {
    const { predicates, params } = eventSearchPredicates(parsed);
    const where = predicates.join(" AND ");

    if (!ftsQuery) {
      return this.connection
        .query<{
          id: string;
          title: string;
          snippet: string | null;
          updatedAt: string;
        }>(
          `SELECT
             events.id AS id,
             events.summary AS title,
             COALESCE(events.description, events.location, calendars.summary) AS snippet,
             events.updated_at AS updatedAt
           FROM google_calendar_events events
           INNER JOIN google_calendar_lists calendars ON calendars.id = events.calendar_id
           WHERE ${where}
           ORDER BY events.start_at ASC, events.updated_at DESC, events.id ASC
           LIMIT ?;`,
          [...params, limit]
        )
        .map((row) => ({
          id: row.id,
          domain: "calendar" as const,
          title: row.title,
          snippet: row.snippet ?? undefined,
          updatedAt: row.updatedAt
        }));
    }

    return this.connection
      .query<{
        id: string;
        title: string;
        snippet: string | null;
        updatedAt: string;
      }>(
        `WITH matches AS (
           SELECT events.rowid AS eventRowid, bm25(google_calendar_events_fts) AS rank
           FROM google_calendar_events_fts
           INNER JOIN google_calendar_events events ON events.rowid = google_calendar_events_fts.rowid
           WHERE google_calendar_events_fts MATCH ?

           UNION ALL

           SELECT events.rowid AS eventRowid, bm25(google_calendar_lists_fts) + 2.0 AS rank
           FROM google_calendar_lists_fts
           INNER JOIN google_calendar_lists calendars ON calendars.rowid = google_calendar_lists_fts.rowid
           INNER JOIN google_calendar_events events ON events.calendar_id = calendars.id
           WHERE google_calendar_lists_fts MATCH ?
         ),
         ranked AS (
           SELECT eventRowid, MIN(rank) AS rank
           FROM matches
           GROUP BY eventRowid
         )
         SELECT
           events.id AS id,
           events.summary AS title,
           COALESCE(events.description, events.location, calendars.summary) AS snippet,
           events.updated_at AS updatedAt
         FROM ranked
         INNER JOIN google_calendar_events events ON events.rowid = ranked.eventRowid
         INNER JOIN google_calendar_lists calendars ON calendars.id = events.calendar_id
         WHERE ${where}
         ORDER BY ranked.rank ASC, events.updated_at DESC, events.id ASC
         LIMIT ?;`,
        [ftsQuery, ftsQuery, ...params, limit]
      )
      .map((row) => ({
        id: row.id,
        domain: "calendar" as const,
        title: row.title,
        snippet: row.snippet ?? undefined,
        updatedAt: row.updatedAt
      }));
  }

  private searchNotes(
    parsed: ParsedLocalSearchQuery,
    ftsQuery: string,
    limit: number
  ): SearchResultItem[] {
    const { predicates, params } = noteSearchPredicates(parsed);
    const where = predicates.join(" AND ");

    if (!ftsQuery) {
      return this.connection
        .query<{
          id: string;
          title: string;
          body: string;
          updatedAt: string;
        }>(
          `SELECT notes.id AS id, notes.title AS title, notes.body AS body, notes.updated_at AS updatedAt
           FROM local_notes notes
           WHERE ${where}
           ORDER BY notes.updated_at DESC, notes.id ASC
           LIMIT ?;`,
          [...params, limit]
        )
        .map((row) => ({
          id: row.id,
          domain: "notes" as const,
          title: row.title,
          snippet: preview(row.body),
          updatedAt: row.updatedAt
        }));
    }

    return this.connection
      .query<{
        id: string;
        title: string;
        body: string;
        updatedAt: string;
      }>(
        `SELECT notes.id AS id, notes.title AS title, notes.body AS body, notes.updated_at AS updatedAt
         FROM local_notes_fts
         INNER JOIN local_notes notes ON notes.rowid = local_notes_fts.rowid
         WHERE local_notes_fts MATCH ?
           AND ${where}
         ORDER BY bm25(local_notes_fts) ASC, notes.updated_at DESC, notes.id ASC
         LIMIT ?;`,
        [ftsQuery, ...params, limit]
      )
      .map((row) => ({
        id: row.id,
        domain: "notes" as const,
        title: row.title,
        snippet: preview(row.body),
        updatedAt: row.updatedAt
      }));
  }

  private measureSqlite<T>(name: string, operation: () => T): T {
    const startedAt = performance.now();

    try {
      return operation();
    } finally {
      this.timings?.record({
        kind: "sqlite_query",
        name,
        durationMs: performance.now() - startedAt
      });
    }
  }
}

export class LocalSettingsRepository {
  constructor(private readonly connection: SqliteConnection) {}

  get(): SettingsSnapshot {
    return {
      theme: this.readSetting("appearance", "theme", DEFAULT_SETTINGS.theme),
      colorTheme: this.readSetting("appearance", "colorTheme", DEFAULT_SETTINGS.colorTheme),
      uiFontName: this.readSetting("appearance", "uiFontName", DEFAULT_SETTINGS.uiFontName),
      uiTextSizePoints: this.readSetting(
        "appearance",
        "uiTextSizePoints",
        DEFAULT_SETTINGS.uiTextSizePoints
      ),
      startOnLogin: this.readSetting("app", "startOnLogin", DEFAULT_SETTINGS.startOnLogin),
      quickCaptureShortcut: this.readSetting(
        "hotkeys",
        "quickCaptureShortcut",
        DEFAULT_SETTINGS.quickCaptureShortcut
      ),
      selectedTaskListIds: this.readSetting(
        "google",
        "selectedTaskListIds",
        this.defaultSelectedTaskListIds()
      ),
      selectedCalendarIds: this.readSetting(
        "google",
        "selectedCalendarIds",
        this.defaultSelectedCalendarIds()
      ),
      setupCompletedAt: this.readSetting(
        "app",
        "setupCompletedAt",
        DEFAULT_SETTINGS.setupCompletedAt
      ),
      syncMode: this.readSetting("sync", "mode", DEFAULT_SETTINGS.syncMode),
      showTrayIcon: this.readSetting("tray", "showIcon", DEFAULT_SETTINGS.showTrayIcon),
      trayClickAction: this.readSetting(
        "tray",
        "clickAction",
        DEFAULT_SETTINGS.trayClickAction
      ),
      menuBarPanelStyle: this.readSetting(
        "tray",
        "panelStyle",
        DEFAULT_SETTINGS.menuBarPanelStyle
      ),
      showMenuBarBadge: this.readSetting("tray", "showBadge", DEFAULT_SETTINGS.showMenuBarBadge),
      notificationsEnabled: this.readSetting(
        "notifications",
        "enabled",
        DEFAULT_SETTINGS.notificationsEnabled
      ),
      notificationLeadMinutes: this.readSetting(
        "notifications",
        "leadMinutes",
        DEFAULT_SETTINGS.notificationLeadMinutes
      ),
      mcpEnabled: this.readSetting("mcp", "enabled", DEFAULT_SETTINGS.mcpEnabled),
      mcpPermissionMode: this.readSetting(
        "mcp",
        "permissionMode",
        DEFAULT_SETTINGS.mcpPermissionMode
      ),
      mcpPort: this.readSetting("mcp", "port", DEFAULT_SETTINGS.mcpPort),
      defaultTimeZone: this.readSetting(
        "calendar",
        "defaultTimeZone",
        DEFAULT_SETTINGS.defaultTimeZone
      ),
      todayCapacityMinutes: this.readSetting(
        "today",
        "capacityMinutes",
        DEFAULT_SETTINGS.todayCapacityMinutes
      ),
      todayWorkingHoursStart: this.readSetting(
        "today",
        "workingHoursStart",
        DEFAULT_SETTINGS.todayWorkingHoursStart
      ),
      todayWorkingHoursEnd: this.readSetting(
        "today",
        "workingHoursEnd",
        DEFAULT_SETTINGS.todayWorkingHoursEnd
      ),
      diagnosticsIncludePerformance: this.readSetting(
        "diagnostics",
        "includePerformance",
        DEFAULT_SETTINGS.diagnosticsIncludePerformance
      ),
      savedSearchViews: this.readSetting(
        "search",
        "savedViews",
        DEFAULT_SETTINGS.savedSearchViews
      ),
      savedTaskViews: this.readSetting(
        "tasks",
        "savedViews",
        DEFAULT_SETTINGS.savedTaskViews
      )
    };
  }

  update(request: SettingsUpdateRequest): SettingsSnapshot {
    const now = new Date().toISOString();

    if (request.theme !== undefined) {
      this.writeSetting("appearance", "theme", request.theme, now);
    }

    if (request.colorTheme !== undefined) {
      this.writeSetting("appearance", "colorTheme", request.colorTheme, now);
    }

    if (request.uiFontName !== undefined) {
      this.writeSetting("appearance", "uiFontName", request.uiFontName, now);
    }

    if (request.uiTextSizePoints !== undefined) {
      this.writeSetting("appearance", "uiTextSizePoints", request.uiTextSizePoints, now);
    }

    if (request.startOnLogin !== undefined) {
      this.writeSetting("app", "startOnLogin", request.startOnLogin, now);
    }

    if (request.quickCaptureShortcut !== undefined) {
      this.writeSetting("hotkeys", "quickCaptureShortcut", request.quickCaptureShortcut, now);
    }

    if (request.selectedTaskListIds !== undefined) {
      this.writeSetting("google", "selectedTaskListIds", uniqueIds(request.selectedTaskListIds), now);
    }

    if (request.selectedCalendarIds !== undefined) {
      this.writeSetting("google", "selectedCalendarIds", uniqueIds(request.selectedCalendarIds), now);
    }

    if (request.setupCompletedAt !== undefined) {
      this.writeSetting("app", "setupCompletedAt", request.setupCompletedAt, now);
    }

    if (request.syncMode !== undefined) {
      this.writeSetting("sync", "mode", request.syncMode, now);
    }

    if (request.showTrayIcon !== undefined) {
      this.writeSetting("tray", "showIcon", request.showTrayIcon, now);
    }

    if (request.trayClickAction !== undefined) {
      this.writeSetting("tray", "clickAction", request.trayClickAction, now);
    }

    if (request.menuBarPanelStyle !== undefined) {
      this.writeSetting("tray", "panelStyle", request.menuBarPanelStyle, now);
    }

    if (request.showMenuBarBadge !== undefined) {
      this.writeSetting("tray", "showBadge", request.showMenuBarBadge, now);
    }

    if (request.notificationsEnabled !== undefined) {
      this.writeSetting("notifications", "enabled", request.notificationsEnabled, now);
    }

    if (request.notificationLeadMinutes !== undefined) {
      this.writeSetting("notifications", "leadMinutes", request.notificationLeadMinutes, now);
    }

    if (request.mcpEnabled !== undefined) {
      this.writeSetting("mcp", "enabled", request.mcpEnabled, now);
    }

    if (request.mcpPermissionMode !== undefined) {
      this.writeSetting("mcp", "permissionMode", request.mcpPermissionMode, now);
    }

    if (request.mcpPort !== undefined) {
      this.writeSetting("mcp", "port", request.mcpPort, now);
    }

    if (request.defaultTimeZone !== undefined) {
      this.writeSetting("calendar", "defaultTimeZone", request.defaultTimeZone, now);
    }

    if (request.todayCapacityMinutes !== undefined) {
      this.writeSetting("today", "capacityMinutes", request.todayCapacityMinutes, now);
    }

    if (request.todayWorkingHoursStart !== undefined) {
      this.writeSetting("today", "workingHoursStart", request.todayWorkingHoursStart, now);
    }

    if (request.todayWorkingHoursEnd !== undefined) {
      this.writeSetting("today", "workingHoursEnd", request.todayWorkingHoursEnd, now);
    }

    if (request.diagnosticsIncludePerformance !== undefined) {
      this.writeSetting(
        "diagnostics",
        "includePerformance",
        request.diagnosticsIncludePerformance,
        now
      );
    }

    if (request.savedSearchViews !== undefined) {
      this.writeSetting("search", "savedViews", request.savedSearchViews, now);
    }

    if (request.savedTaskViews !== undefined) {
      this.writeSetting("tasks", "savedViews", request.savedTaskViews, now);
    }

    return this.get();
  }

  resetMcpTokenRevision(now = new Date().toISOString()): { tokenState: "rotated"; resetAt: string } {
    this.writeSetting("mcp", "tokenRevision", `rev:${randomUUID()}`, now);
    this.writeSetting("mcp", "tokenResetAt", now, now);

    return {
      tokenState: "rotated",
      resetAt: now
    };
  }

  mcpTokenState(): {
    tokenState: "not_configured" | "configured" | "rotated";
    lastTokenResetAt?: string;
  } {
    const tokenRevision = this.readSetting<string | null>("mcp", "tokenRevision", null);
    const lastTokenResetAt = this.readSetting<string | null>("mcp", "tokenResetAt", null);

    if (lastTokenResetAt) {
      return {
        tokenState: "rotated",
        lastTokenResetAt
      };
    }

    return {
      tokenState: tokenRevision ? "configured" : "not_configured"
    };
  }

  private readSetting<T>(scope: string, key: string, fallback: T): T {
    const row = this.connection.get<{ valueJson: string }>(
      `SELECT value_json AS valueJson
       FROM local_settings
       WHERE scope = ? AND key = ?
       LIMIT 1;`,
      [scope, key]
    );

    if (!row) {
      return fallback;
    }

    try {
      return JSON.parse(row.valueJson) as T;
    } catch {
      return fallback;
    }
  }

  private writeSetting(scope: string, key: string, value: unknown, now: string): void {
    this.connection.run(
      `INSERT INTO local_settings (scope, key, value_json, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(scope, key) DO UPDATE SET
         value_json = excluded.value_json,
         updated_at = excluded.updated_at;`,
      [scope, key, JSON.stringify(value), now]
    );
  }

  private defaultSelectedTaskListIds(): string[] {
    const rows = this.connection.query<{ id: string }>(
      `SELECT id
       FROM google_task_lists
       WHERE deleted_at IS NULL
       ORDER BY sort_order ASC, title COLLATE NOCASE ASC, id ASC
       LIMIT 100;`
    );

    return rows.map((row) => row.id);
  }

  private defaultSelectedCalendarIds(): string[] {
    const rows = this.connection.query<{ id: string }>(
      `SELECT id
       FROM google_calendar_lists
       WHERE deleted_at IS NULL
         AND is_hidden = 0
         AND is_selected = 1
       ORDER BY is_primary DESC, summary COLLATE NOCASE ASC, id ASC
       LIMIT 100;`
    );

    return rows.map((row) => row.id);
  }
}

interface NormalizedCalendarWrite {
  title: string;
  calendarId: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  location: string;
  notes: string;
  guestEmails: string[];
  reminderMinutes: number[];
  recurrenceRule: string | null;
}

function normalizeCalendarWrite(input: NormalizedCalendarWrite): NormalizedCalendarWrite {
  const startsAt = input.allDay ? startOfUtcDayIso(input.startsAt) : new Date(input.startsAt).toISOString();
  let endsAt = input.allDay ? startOfUtcDayIso(input.endsAt) : new Date(input.endsAt).toISOString();

  if (input.allDay && Date.parse(endsAt) <= Date.parse(startsAt)) {
    endsAt = addUtcDaysIso(startsAt, 1);
  }

  if (Date.parse(endsAt) <= Date.parse(startsAt)) {
    throw validationFailed("Event end must be after start.");
  }

  return {
    title: input.title.trim(),
    calendarId: input.calendarId,
    startsAt,
    endsAt,
    allDay: input.allDay,
    location: input.location.trim(),
    notes: input.notes,
    guestEmails: normalizeGuestEmails(input.guestEmails),
    reminderMinutes: normalizeReminderMinutes(input.reminderMinutes),
    recurrenceRule: input.recurrenceRule
  };
}

interface ParsedLocalRRule {
  freq: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  interval: number;
  count?: number;
  until?: Date;
}

interface LocalCalendarEventInstance {
  id: string;
  startsAt: string;
  endsAt: string;
  originalStartAt: string | null;
}

function recurrenceRuleFromRequest(recurrence: CalendarEventRecurrence | null | undefined): string | null {
  if (!recurrence) {
    return null;
  }

  const parts = [
    `FREQ=${recurrence.frequency.toUpperCase()}`,
    `INTERVAL=${recurrence.interval}`
  ];

  if (recurrence.endsOn) {
    parts.push(`UNTIL=${recurrence.endsOn.replace(/-/g, "")}`);
  }

  if (recurrence.count !== undefined && recurrence.count !== null) {
    parts.push(`COUNT=${recurrence.count}`);
  }

  return `RRULE:${parts.join(";")}`;
}

function recurrenceFromRule(rule: string | null): CalendarEventRecurrence | null {
  const parsed = parseLocalRRule(rule);

  if (!parsed) {
    return null;
  }

  return {
    frequency: parsed.freq.toLowerCase() as CalendarEventRecurrence["frequency"],
    interval: parsed.interval,
    endsOn: parsed.until ? parsed.until.toISOString().slice(0, 10) : null,
    count: parsed.count ?? null
  };
}

function materializedLocalEventInstances(input: {
  id: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  recurrenceRule: string | null;
}): LocalCalendarEventInstance[] {
  const singleInstance: LocalCalendarEventInstance = {
    id: input.id,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    originalStartAt: null
  };
  const rrule = parseLocalRRule(input.recurrenceRule);

  if (!rrule) {
    return [singleInstance];
  }

  const start = new Date(input.startsAt);
  const end = new Date(input.endsAt);
  const durationMs = end.getTime() - start.getTime();

  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || durationMs <= 0) {
    return [singleInstance];
  }

  const hardLimit = Math.min(rrule.count ?? 366, 366);
  const boundedUntil = rrule.until ?? addUtcDaysDate(start, 366);
  const instances: LocalCalendarEventInstance[] = [];
  let cursor = start;

  for (let index = 0; index < hardLimit; index += 1) {
    if (cursor.getTime() > boundedUntil.getTime()) {
      break;
    }

    const instanceStart = new Date(cursor.getTime());
    const instanceEnd = new Date(instanceStart.getTime() + durationMs);
    instances.push({
      id: index === 0 ? input.id : `${input.id}:instance:${instanceSuffix(instanceStart, input.allDay)}`,
      startsAt: instanceStart.toISOString(),
      endsAt: instanceEnd.toISOString(),
      originalStartAt: instanceStart.toISOString()
    });
    cursor = nextLocalRecurrenceDate(cursor, rrule);
  }

  return instances.length > 0 ? instances : [singleInstance];
}

function parseLocalRRule(value: string | null | undefined): ParsedLocalRRule | null {
  const line = value
    ?.split("\n")
    .map((candidate) => candidate.trim())
    .find((candidate) => candidate.startsWith("RRULE:"));

  if (!line) {
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

  if (freq !== "DAILY" && freq !== "WEEKLY" && freq !== "MONTHLY" && freq !== "YEARLY") {
    return null;
  }

  return {
    freq,
    interval: Math.min(366, Math.max(1, Number.parseInt(parts.INTERVAL ?? "1", 10) || 1)),
    ...(parts.COUNT === undefined
      ? {}
      : { count: Math.min(366, Math.max(1, Number.parseInt(parts.COUNT, 10) || 1)) }),
    ...(parts.UNTIL === undefined ? {} : { until: parseLocalRRuleUntil(parts.UNTIL) })
  };
}

function parseLocalRRuleUntil(value: string): Date | undefined {
  const parsed =
    /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(value) ??
    /^(\d{4})(\d{2})(\d{2})$/.exec(value);

  if (!parsed) {
    return undefined;
  }

  const [, year, month, day, hour = "23", minute = "59", second = "59"] = parsed;
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

function nextLocalRecurrenceDate(date: Date, rrule: ParsedLocalRRule): Date {
  const next = new Date(date.getTime());

  if (rrule.freq === "DAILY") {
    next.setUTCDate(next.getUTCDate() + rrule.interval);
  } else if (rrule.freq === "WEEKLY") {
    next.setUTCDate(next.getUTCDate() + rrule.interval * 7);
  } else if (rrule.freq === "MONTHLY") {
    next.setUTCMonth(next.getUTCMonth() + rrule.interval);
  } else {
    next.setUTCFullYear(next.getUTCFullYear() + rrule.interval);
  }

  return next;
}

function addUtcDaysDate(date: Date, days: number): Date {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function instanceSuffix(startAt: Date, allDay: boolean): string {
  const compact = startAt.toISOString().replace(/[-:]/g, "").replace(".000", "");

  return allDay ? compact.slice(0, 8) : compact;
}

function eventInsertOperation(input: {
  id: string;
  accountId: string;
  calendarId: string;
  googleId: string;
  timeZone: string;
  now: string;
} & NormalizedCalendarWrite) {
  return {
    kind: "run" as const,
    sql: `INSERT INTO google_calendar_events (
      id, account_id, calendar_id, google_id, status, summary, description, location,
      start_at, start_time_zone, end_at, end_time_zone, is_all_day, recurrence_rule, local_time_zone,
      attendee_emails_json, reminder_minutes_json,
      created_at, updated_at, deleted_at
    ) VALUES (?, ?, ?, ?, 'confirmed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL);`,
    params: [
      input.id,
      input.accountId,
      input.calendarId,
      input.googleId,
      input.title,
      nullIfEmpty(input.notes),
      nullIfEmpty(input.location),
      input.startsAt,
      input.timeZone,
      input.endsAt,
      input.timeZone,
      boolInt(input.allDay),
      input.recurrenceRule,
      input.timeZone,
      JSON.stringify(input.guestEmails),
      JSON.stringify(input.reminderMinutes),
      input.now,
      input.now
    ]
  };
}

function eventUpdateOperation(input: {
  id: string;
  calendarId: string;
  timeZone: string;
  now: string;
} & NormalizedCalendarWrite) {
  return {
    kind: "run" as const,
    sql: `UPDATE google_calendar_events
          SET calendar_id = ?,
              summary = ?,
              description = ?,
              location = ?,
              start_at = ?,
              start_time_zone = ?,
              end_at = ?,
              end_time_zone = ?,
              is_all_day = ?,
              recurrence_rule = ?,
              local_time_zone = ?,
              attendee_emails_json = ?,
              reminder_minutes_json = ?,
              updated_at = ?
          WHERE id = ? AND deleted_at IS NULL;`,
    params: [
      input.calendarId,
      input.title,
      nullIfEmpty(input.notes),
      nullIfEmpty(input.location),
      input.startsAt,
      input.timeZone,
      input.endsAt,
      input.timeZone,
      boolInt(input.allDay),
      input.recurrenceRule,
      input.timeZone,
      JSON.stringify(input.guestEmails),
      JSON.stringify(input.reminderMinutes),
      input.now,
      input.id
    ]
  };
}

function instanceDeleteOperation(eventId: string, now: string) {
  return {
    kind: "run" as const,
    sql: `UPDATE google_calendar_event_instances
          SET deleted_at = ?, updated_at = ?
          WHERE event_id = ? AND deleted_at IS NULL;`,
    params: [now, now, eventId]
  };
}

function eventInstanceInsertOperations(input: {
  id: string;
  accountId: string;
  calendarId: string;
  eventId: string;
  googleEventId: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  recurrenceRule: string | null;
  status: string;
  updatedAt: string;
}): SqliteWriteOperation[] {
  return materializedLocalEventInstances(input).map((instance) =>
    instanceInsertOperation({
      id: instance.id,
      accountId: input.accountId,
      calendarId: input.calendarId,
      eventId: input.eventId,
      googleEventId: input.googleEventId,
      recurringEventId: null,
      originalStartAt: instance.originalStartAt,
      startsAt: instance.startsAt,
      endsAt: instance.endsAt,
      allDay: input.allDay,
      status: input.status,
      updatedAt: input.updatedAt
    })
  );
}

function instanceInsertOperation(input: {
  id: string;
  accountId: string;
  calendarId: string;
  eventId: string;
  googleEventId: string;
  recurringEventId?: string | null;
  originalStartAt?: string | null;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  status: string;
  updatedAt: string;
}) {
  return {
    kind: "run" as const,
    sql: `INSERT INTO google_calendar_event_instances (
      id, account_id, calendar_id, event_id, google_event_id, start_at, end_at,
      recurring_event_id, original_start_at, is_all_day, status, updated_at, deleted_at
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
      input.id,
      input.accountId,
      input.calendarId,
      input.eventId,
      input.googleEventId,
      input.startsAt,
      input.endsAt,
      input.recurringEventId ?? null,
      input.originalStartAt ?? null,
      boolInt(input.allDay),
      input.status,
      input.updatedAt
    ]
  };
}

function mutationInsertOperation(input: {
  id: string;
  accountId: string | null;
  resourceId: string;
  operation: string;
  payload: object;
  now: string;
}) {
  return {
    kind: "run" as const,
    sql: `INSERT INTO google_pending_mutations (
      id, account_id, resource_type, resource_id, operation, payload_json, status,
      attempt_count, created_at, updated_at
    ) VALUES (?, ?, 'event', ?, ?, ?, 'pending', 0, ?, ?);`,
    params: [
      input.id,
      input.accountId,
      input.resourceId,
      input.operation,
      JSON.stringify(input.payload),
      input.now,
      input.now
    ]
  };
}

function mutationPayload(input: NormalizedCalendarWrite): object {
  return {
    title: input.title,
    calendarId: input.calendarId,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    allDay: input.allDay,
    location: input.location,
    notes: input.notes,
    guestEmails: input.guestEmails,
    reminderMinutes: input.reminderMinutes,
    recurrence: recurrenceFromRule(input.recurrenceRule),
    recurrenceRule: input.recurrenceRule
  };
}

function scheduledTaskBlockInsertOperation(input: {
  id: string;
  taskId: string;
  calendarEventId: string;
  calendarId: string;
  startsAt: string;
  endsAt: string;
  durationMinutes: number;
  now: string;
}): SqliteWriteOperation {
  return {
    kind: "run",
    sql: `INSERT INTO local_scheduled_task_blocks (
      id, task_id, calendar_event_id, calendar_id, planned_start_at, planned_end_at,
      duration_minutes, status, created_at, updated_at, deleted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'scheduled', ?, ?, NULL);`,
    params: [
      input.id,
      input.taskId,
      input.calendarEventId,
      input.calendarId,
      input.startsAt,
      input.endsAt,
      input.durationMinutes,
      input.now,
      input.now
    ]
  };
}

function scheduledTaskNotes(task: TaskRow): string {
  const notes = task.notes?.trim();
  const marker = `Hot Cross Buns scheduled task: ${task.id}`;

  return notes ? `${notes}\n\n${marker}` : marker;
}

function addMinutesIso(startsAt: string, durationMinutes: number): string {
  const startMs = Date.parse(startsAt);

  if (!Number.isFinite(startMs)) {
    throw validationFailure("Scheduled task start must be a valid date-time.");
  }

  const endMs = startMs + durationMinutes * 60 * 1000;

  if (!Number.isFinite(endMs) || endMs <= startMs) {
    throw validationFailure("Scheduled task duration must produce a valid end time.");
  }

  return new Date(endMs).toISOString();
}

function nullIfEmpty(value: string): string | null {
  const trimmed = value.trim();

  return trimmed.length === 0 ? null : trimmed;
}

function uniqueIds(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
}

function googleEventIdFromLocalEventId(id: string): string {
  return id.split(":").at(-1) ?? id;
}

function boolInt(value: boolean): number {
  return value ? 1 : 0;
}

function pageBounds(
  cursor: string | undefined,
  requestedLimit: number | undefined,
  defaultLimit: number,
  maxLimit: number
): { limit: number; offset: number } {
  const limit = Math.max(1, Math.min(maxLimit, requestedLimit ?? defaultLimit));
  const parsed = cursor === undefined ? 0 : Number.parseInt(cursor, 10);

  return {
    limit,
    offset: Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
  };
}

function pageFromRows<T>(
  items: T[],
  limit: number,
  offset: number,
  totalKnown: number
): PageWindow<T> {
  const nextOffset = offset + items.length;

  return {
    items,
    page: {
      limit,
      ...(nextOffset < totalKnown ? { nextCursor: String(nextOffset) } : {}),
      totalKnown
    }
  };
}

function countRows(connection: SqliteConnection, sql: string, params?: SqliteParams): number {
  return connection.get<{ count: number }>(sql, params)?.count ?? 0;
}

type PlannerLinkKind = "note" | "task" | "event";

interface PlannerLinkReference {
  kind: PlannerLinkKind;
  label: string;
  raw: string;
}

interface NotePropertyEntry {
  key: string;
  value: string;
}

function extractPlannerLinks(body: string): PlannerLinkReference[] {
  const pattern = /\[\[([^\]]{1,160})\]\]/g;
  const seen = new Map<string, PlannerLinkReference>();
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(body)) !== null) {
    const raw = match[1]?.trim();
    if (!raw) {
      continue;
    }
    const [maybeKind, ...rest] = raw.split(":");
    const kindToken = maybeKind.toLowerCase();
    const isExplicit = (kindToken === "note" || kindToken === "task" || kindToken === "event") && rest.length > 0;
    const reference: PlannerLinkReference = isExplicit
      ? { kind: kindToken as PlannerLinkKind, label: rest.join(":").trim(), raw }
      : { kind: "note", label: raw, raw };

    const key = `${reference.kind}::${reference.label.toLowerCase()}`;
    if (!seen.has(key)) {
      seen.set(key, reference);
    }
  }

  return Array.from(seen.values());
}

function extractNoteProperties(body: string): NotePropertyEntry[] {
  const supportedKeys = new Set(["status", "tags", "project", "date", "source"]);
  const entries: NotePropertyEntry[] = [];
  const seenKeys = new Set<string>();

  for (const line of body.split(/\r?\n/).slice(0, 12)) {
    const match = /^([a-zA-Z][\w-]{1,24}):\s*(.+)$/.exec(line.trim());
    if (!match) {
      continue;
    }
    const key = match[1].toLowerCase();
    const value = match[2].trim();
    if (supportedKeys.has(key) && value && !seenKeys.has(key)) {
      entries.push({ key, value });
      seenKeys.add(key);
    }
  }

  return entries;
}

function taskListSummary(row: TaskListRow): TaskListSummary {
  return {
    id: row.id,
    title: row.title,
    updatedAt: row.updatedAt,
    taskCount: row.taskCount,
    activeTaskCount: row.activeTaskCount
  };
}

function taskSummary(row: TaskRow): TaskSummary {
  const status = taskStatusFromRow(row);

  return {
    id: row.id,
    listId: row.listId,
    title: row.title,
    status,
    dueAt: row.dueAt,
    updatedAt: row.updatedAt,
    notes: row.notes ?? undefined,
    parentId: row.parentId,
    priority: row.priority ?? "none",
    sortOrder: row.sortOrder,
    mutationState: mutationState(row.pendingMutationStatus),
    plannedStart: row.plannedStart ?? null,
    plannedEnd: row.plannedEnd ?? null,
    durationMinutes: row.durationMinutes ?? null,
    lockedSchedule: row.lockedSchedule === 1,
    snoozeUntil: row.snoozeUntil ?? null,
    tags: parseTagsJson(row.tagsJson)
  };
}

function parseTagsJson(value: string | null | undefined): string[] {
  if (!value) {
    return [];
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((entry): entry is string => typeof entry === "string");
  } catch {
    return [];
  }
}

function taskDetail(row: TaskRow): TaskDetail {
  return {
    ...taskSummary(row)
  };
}

function calendarListSummary(row: CalendarListRow): CalendarListSummary {
  return {
    id: row.id,
    title: row.title,
    selected: row.selected === 1,
    timeZone: row.timeZone,
    updatedAt: row.updatedAt,
    eventCount: row.eventCount
  };
}

function calendarEventSummary(row: CalendarEventRow): CalendarEventSummary {
  return {
    id: row.id,
    eventId: row.eventId,
    calendarId: row.calendarId,
    title: row.title,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    allDay: row.allDay === 1,
    updatedAt: row.updatedAt,
    location: row.location ?? "",
    notes: row.notes ?? "",
    guestEmails: parseStringArray(row.guestEmailsJson),
    reminderMinutes: parseNumberArray(row.reminderMinutesJson),
    mutationState: mutationState(row.pendingMutationStatus),
    timeZone: row.timeZone,
    recurrenceRule: row.recurrenceRule,
    recurringEventId: row.recurringEventId,
    originalStartAt: row.originalStartAt
  };
}

function calendarEventDetail(row: CalendarEventRow): CalendarEventDetail {
  return {
    ...calendarEventSummary(row),
    calendarTitle: row.calendarTitle,
    deepLink: `hotcrossbuns://event/${row.eventId}`
  };
}

function scheduledTaskBlockSummary(row: ScheduledTaskBlockRow): ScheduledTaskBlockSummary {
  return {
    id: row.id,
    taskId: row.taskId,
    calendarEventId: row.calendarEventId,
    calendarId: row.calendarId,
    title: row.title ?? "Scheduled task",
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    durationMinutes: blockDurationMinutes(row),
    status: row.status,
    mutationState: mutationState(row.pendingMutationStatus),
    updatedAt: row.updatedAt
  };
}

function blockDurationMinutes(row: ScheduledTaskBlockRow): number {
  const startMs = Date.parse(row.startsAt);
  const endMs = Date.parse(row.endsAt);

  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return row.durationMinutes;
  }

  return Math.max(1, Math.round((endMs - startMs) / 60_000));
}

function availabilityLine(event: CalendarEventSummary): string {
  const label = event.allDay ? "All day" : `${event.startsAt} to ${event.endsAt}`;

  return `- ${label}: ${event.title}`;
}

function noteSummary(row: NoteRow): NoteSummary {
  return {
    id: row.id,
    title: row.title,
    preview: preview(row.body),
    updatedAt: row.updatedAt
  };
}

function noteDetail(row: NoteRow): NoteDetail {
  return {
    ...noteSummary(row),
    body: row.body
  };
}

function preview(body: string): string {
  const trimmed = body.trim();

  if (!trimmed) {
    return "Empty local note";
  }

  return trimmed.length > 120 ? `${trimmed.slice(0, 117)}...` : trimmed;
}

function ftsMatchQuery(value: string): string {
  const tokens = value
    .normalize("NFKD")
    .toLowerCase()
    .match(/[a-z0-9]+/g)
    ?.slice(0, 8) ?? [];

  return tokens.map((token) => `${token}*`).join(" ");
}

function taskSearchPredicates(parsed: ParsedLocalSearchQuery): {
  predicates: string[];
  params: Array<string | number | boolean | null>;
} {
  const predicates = ["lists.deleted_at IS NULL"];
  const params: Array<string | number | boolean | null> = [];
  const status = parsed.filters.taskStatus;

  if (status === "deleted") {
    predicates.push("tasks.deleted_at IS NOT NULL");
  } else {
    predicates.push("tasks.deleted_at IS NULL");

    if (status === "hidden") {
      predicates.push("tasks.is_hidden = 1");
    } else {
      predicates.push("tasks.is_hidden = 0");
    }

    if (status === "active") {
      predicates.push("tasks.status != 'completed'");
    } else if (status === "completed") {
      predicates.push("tasks.status = 'completed'");
    }
  }

  if (parsed.filters.priority !== undefined) {
    predicates.push("COALESCE(tasks.local_priority, 'none') = ?");
    params.push(parsed.filters.priority);
  }

  if (parsed.filters.listTitle !== undefined) {
    predicates.push("LOWER(lists.title) LIKE ? ESCAPE '\\'");
    params.push(likeContainsParam(parsed.filters.listTitle));
  }

  if (parsed.filters.hasBody !== undefined) {
    predicates.push(
      parsed.filters.hasBody
        ? "TRIM(COALESCE(tasks.notes, '')) != ''"
        : "TRIM(COALESCE(tasks.notes, '')) = ''"
    );
  }

  addDatePredicate(predicates, params, "tasks.due_at", parsed.filters.due);

  return { predicates, params };
}

function eventSearchPredicates(parsed: ParsedLocalSearchQuery): {
  predicates: string[];
  params: Array<string | number | boolean | null>;
} {
  const predicates = [
    "events.deleted_at IS NULL",
    "events.status != 'cancelled'",
    "calendars.deleted_at IS NULL"
  ];
  const params: Array<string | number | boolean | null> = [];

  if (parsed.filters.calendarTitle !== undefined) {
    predicates.push("LOWER(calendars.summary) LIKE ? ESCAPE '\\'");
    params.push(likeContainsParam(parsed.filters.calendarTitle));
  }

  if (parsed.filters.hasBody !== undefined) {
    predicates.push(
      parsed.filters.hasBody
        ? "TRIM(COALESCE(events.description, '')) != ''"
        : "TRIM(COALESCE(events.description, '')) = ''"
    );
  }

  addDatePredicate(predicates, params, "events.start_at", parsed.filters.start);

  return { predicates, params };
}

function noteSearchPredicates(parsed: ParsedLocalSearchQuery): {
  predicates: string[];
  params: Array<string | number | boolean | null>;
} {
  const predicates = ["notes.deleted_at IS NULL"];
  const params: Array<string | number | boolean | null> = [];

  if (parsed.filters.hasBody !== undefined) {
    predicates.push(
      parsed.filters.hasBody
        ? "TRIM(notes.body) != ''"
        : "TRIM(notes.body) = ''"
    );
  }

  return { predicates, params };
}

function addDatePredicate(
  predicates: string[],
  params: Array<string | number | boolean | null>,
  column: string,
  filter: LocalSearchDateFilter | undefined
): void {
  if (filter === undefined) {
    return;
  }

  if (filter.mode === "present") {
    predicates.push(`${column} IS NOT NULL`);
    return;
  }

  if (filter.mode === "missing") {
    predicates.push(`${column} IS NULL`);
    return;
  }

  if (filter.from !== undefined) {
    predicates.push(`${column} >= ?`);
    params.push(filter.from);
  }

  if (filter.to !== undefined) {
    predicates.push(`${column} < ?`);
    params.push(filter.to);
  }
}

function likeContainsParam(value: string): string {
  return `%${value.toLowerCase().replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}

function taskStatusFromRow(row: TaskRow): TaskSummary["status"] {
  if (row.deletedAt !== undefined && row.deletedAt !== null) {
    return "deleted";
  }

  if (row.isHidden === 1) {
    return "hidden";
  }

  return row.status === "completed" ? "completed" : "active";
}

function mutationState(
  status: TaskRow["pendingMutationStatus"] | CalendarEventRow["pendingMutationStatus"]
): TaskSummary["mutationState"] {
  if (status === "failed") {
    return "failed";
  }

  if (status === "pending" || status === "applying") {
    return "queued";
  }

  return undefined;
}

function dateOnlyToIso(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  return `${value}T00:00:00.000Z`;
}

function isoToDateOnly(value: string | null | undefined): string | null {
  return value ? value.slice(0, 10) : null;
}

function systemTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function validationFailure(message: string): HcbPublicError {
  return new HcbPublicError({
    code: "VALIDATION_ERROR",
    message,
    recoverable: true
  });
}

function notFound(message: string): HcbPublicError {
  return new HcbPublicError({
    code: "VALIDATION_ERROR",
    message,
    recoverable: true
  });
}

function validationFailed(message: string): HcbPublicError {
  return new HcbPublicError({
    code: "VALIDATION_ERROR",
    message,
    recoverable: true
  });
}

function parseStringArray(value: string | null): string[] {
  if (value === null || value.length === 0) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);

    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function parseNumberArray(value: string | null): number[] {
  if (value === null || value.length === 0) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);

    return Array.isArray(parsed)
      ? parsed.filter((item): item is number => Number.isInteger(item))
      : [];
  } catch {
    return [];
  }
}
