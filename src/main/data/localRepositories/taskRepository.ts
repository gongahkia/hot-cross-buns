import { randomUUID } from "node:crypto";
import type {
  TaskCompletionRequest,
  TaskCreateRequest,
  TaskDeleteRequest,
  TaskDetail,
  TaskListCreateRequest,
  TaskListDeleteRequest,
  TaskListRenameRequest,
  TaskListRequest,
  TaskListResponse,
  TaskListsRequest,
  TaskListsResponse,
  TaskListSummary,
  TaskMoveRequest,
  TaskUpdateRequest
} from "@shared/ipc/contracts";
import type { SqliteWriteOperation } from "../sqliteConnection";
import { taskDetail, taskListSummary, taskSummary } from "./mappers";
import { PlannerRepositoryBase } from "./plannerBase";
import {
  countRows,
  dateOnlyToIso,
  isoToDateOnly,
  notFound,
  pageBounds,
  pageFromRows,
  validationFailure
} from "./shared";
import type { TaskListRow, TaskRow } from "./types";

export class TaskLocalRepository extends PlannerRepositoryBase {
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

  listCalendarBootstrapTasks(request: {
    start: string;
    end: string;
    listIds?: string[];
    taskIds?: string[];
    cursor?: string;
    limit?: number;
  }): TaskListResponse {
    return this.measureSqlite("tasks.listCalendarBootstrap", () => {
      const { limit, offset } = pageBounds(request.cursor, request.limit, 100, 100);
      const listIds = [...new Set(request.listIds ?? [])].filter((id) => id.length > 0);
      const taskIds = [...new Set(request.taskIds ?? [])].filter((id) => id.length > 0);
      const params: Array<string | number | boolean | null> = [];
      const visibilityPredicates = [
        "lists.deleted_at IS NULL",
        "tasks.deleted_at IS NULL",
        "tasks.is_hidden = 0"
      ];
      const duePredicates = [
        "tasks.parent_task_id IS NULL",
        "tasks.due_at IS NOT NULL"
      ];
      if (listIds.length > 0) {
        duePredicates.push(`tasks.task_list_id IN (${listIds.map(() => "?").join(", ")})`);
        params.push(...listIds);
      }
      duePredicates.push("tasks.due_at >= ?", "tasks.due_at < ?");
      params.push(request.start, request.end);
      const calendarPredicates = [`(${duePredicates.join(" AND ")})`];

      if (taskIds.length > 0) {
        calendarPredicates.push(`tasks.id IN (${taskIds.map(() => "?").join(", ")})`);
        params.push(...taskIds);
      }

      const where = `${visibilityPredicates.join(" AND ")} AND (${calendarPredicates.join(" OR ")})`;
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
      const created = this.requireTaskForMutation(id);
      if (isHistoryNoteTask(created)) {
        this.recordNoteHistory("note.create", created, "Created note");
      } else {
        this.recordHistory({
          kind: "task.create",
          resourceId: id,
          summary: "Created task",
          metadata: { queued: true, taskListId: list.id }
        });
      }

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
      const updated = this.requireTaskForMutation(request.id);
      if (!this.recordNoteUpdateHistory(existing, updated)) {
        this.recordHistory({
          kind: "task.edit",
          resourceId: request.id,
          summary: "Edited task",
          metadata: { queued: googleBackedPatch, taskListId: targetList.id }
        });
      }

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
      if (isHistoryNoteTask(existing)) {
        this.recordNoteHistory("note.delete", existing, "Deleted note");
      } else {
        this.recordHistory({
          kind: "task.delete",
          resourceId: request.id,
          summary: "Deleted task",
          metadata: { queued: true, taskListId: existing.listId }
        });
      }

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
      this.recordHistory({
        kind: "task_list.create",
        resourceId: id,
        summary: "Created task list",
        metadata: { queued: true }
      });

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
      this.recordHistory({
        kind: "task_list.rename",
        resourceId: request.id,
        summary: "Renamed task list",
        metadata: { queued: true }
      });

      return this.requireTaskListSummary(request.id);
    });
  }

  deleteTaskList(request: TaskListDeleteRequest): { id: string; queued: boolean; revision: string } {
    return this.measureSqlite("tasks.deleteTaskList", () => {
      const existing = this.requireTaskListForMutation(request.id);
      const noteRows = this.noteHistoryRowsForList(request.id);
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
      this.recordHistory({
        kind: "task_list.delete",
        resourceId: request.id,
        summary: "Deleted task list",
        metadata: { queued: true }
      });
      for (const note of noteRows) {
        this.recordNoteHistory("note.delete", note, "Deleted note");
      }

      return { id: request.id, queued: true, revision: now };
    });
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
      this.recordHistory({
        kind: completed ? "task.complete" : "task.reopen",
        resourceId: id,
        summary: completed ? "Completed task" : "Reopened task",
        metadata: { queued: true, taskListId: existing.listId }
      });

      return this.getTask(id);
    });
  }

  private recordNoteUpdateHistory(before: TaskRow, after: TaskRow): boolean {
    const wasNote = isHistoryNoteTask(before);
    const isNote = isHistoryNoteTask(after);

    if (!wasNote && isNote) {
      this.recordNoteHistory("note.create", after, "Created note");
      return true;
    }

    if (wasNote && !isNote) {
      this.recordNoteHistory("note.delete", before, "Deleted note");
      return true;
    }

    if (wasNote && isNote && noteFieldsChanged(before, after)) {
      this.recordNoteHistory("note.edit", after, "Edited note");
      return true;
    }

    return wasNote || isNote;
  }

  private recordNoteHistory(kind: "note.create" | "note.edit" | "note.delete", row: TaskRow, summary: string): void {
    this.recordHistory({
      kind,
      resourceId: row.id,
      summary: `${summary} "${row.title}"`,
      metadata: {
        queued: true,
        title: row.title,
        taskListId: row.listId,
        taskListTitle: row.listTitle
      }
    });
  }

  private noteHistoryRowsForList(listId: string): TaskRow[] {
    return this.connection.query<TaskRow>(
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
       WHERE tasks.task_list_id = ?
         AND tasks.deleted_at IS NULL
         AND lists.deleted_at IS NULL
       ORDER BY tasks.sort_order ASC, tasks.id ASC;`,
      [listId]
    ).filter(isHistoryNoteTask);
  }

  protected requireTaskForMutation(id: string): TaskRow {
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
}

function isHistoryNoteTask(row: TaskRow): boolean {
  return row.deletedAt == null &&
    row.isHidden !== 1 &&
    row.status !== "completed" &&
    row.parentId === null &&
    row.dueAt === null;
}

function noteFieldsChanged(before: TaskRow, after: TaskRow): boolean {
  return before.title !== after.title ||
    (before.notes ?? "") !== (after.notes ?? "") ||
    before.listId !== after.listId ||
    (before.tagsJson ?? "[]") !== (after.tagsJson ?? "[]");
}
