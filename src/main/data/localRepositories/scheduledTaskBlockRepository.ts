import { randomUUID } from "node:crypto";
import type {
  ScheduledTaskBlockCreateRequest,
  ScheduledTaskBlockListRequest,
  ScheduledTaskBlockListResponse,
  ScheduledTaskBlockMoveRequest,
  ScheduledTaskBlockSummary,
  ScheduledTaskBlockUnscheduleRequest,
  SmartRescheduleRequest,
  SmartRescheduleResponse,
  SmartRescheduleSuggestion
} from "@shared/ipc/contracts";
import type { SqliteWriteOperation } from "../sqliteConnection";
import {
  eventInsertOperation,
  eventUpdateOperation,
  instanceDeleteOperation,
  instanceInsertOperation,
  mutationInsertOperation,
  mutationPayload,
  normalizeCalendarWrite
} from "./calendarWrites";
import { CalendarLocalRepository } from "./calendarRepository";
import { scheduledTaskBlockSummary } from "./mappers";
import {
  addMinutesIso,
  scheduledTaskBlockInsertOperation,
  scheduledTaskNotes
} from "./scheduledTaskBlockHelpers";
import {
  countRows,
  googleEventIdFromLocalEventId,
  notFound,
  pageBounds,
  pageFromRows,
  parseNumberArray,
  parseStringArray,
  systemTimeZone,
  validationFailure
} from "./shared";
import type { ScheduledTaskBlockRow, TaskRow } from "./types";

interface SmartBusyRange {
  startsAt: string;
  endsAt: string;
  eventId?: string;
}

export class ScheduledTaskBlockLocalRepository extends CalendarLocalRepository {
  smartReschedule(request: SmartRescheduleRequest): SmartRescheduleResponse {
    return this.measureSqlite("calendar.smartReschedule", () => {
      const preview = this.previewSmartReschedule(request);

      if (!(request.apply ?? false)) {
        return preview;
      }

      const appliedBlocks = preview.suggestions.map((suggestion) =>
        suggestion.action === "move" && suggestion.scheduledTaskBlockId
          ? this.moveScheduledTaskBlock({
              id: suggestion.scheduledTaskBlockId,
              calendarId: suggestion.calendarId,
              startsAt: suggestion.startsAt,
              durationMinutes: suggestion.durationMinutes
            })
          : this.scheduleTaskBlock({
              taskId: suggestion.taskId,
              calendarId: suggestion.calendarId,
              startsAt: suggestion.startsAt,
              durationMinutes: suggestion.durationMinutes
            })
      );

      this.recordHistory({
        kind: "schedule.smart_reschedule",
        summary: "Applied smart reschedule",
        metadata: { queued: appliedBlocks.length > 0, count: appliedBlocks.length, calendarId: request.calendarId }
      });

      return {
        ...preview,
        applied: true,
        appliedBlocks
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
      const queued = this.shouldQueueRemoteMutations();
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
        ...this.remoteMutationOperations(mutationInsertOperation({
          id: `mutation:event:${randomUUID()}`,
          accountId: calendar.accountId,
          resourceId: eventId,
          operation: "calendar.events.create",
          payload: mutationPayload(normalized),
          now
        })),
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
      this.recordHistory({
        kind: "schedule.create",
        resourceId: blockId,
        summary: "Scheduled task block",
        metadata: { queued, taskId: task.id, calendarId: calendar.id }
      });

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
        const queued = this.shouldQueueRemoteMutations();
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
          ...this.remoteMutationOperations(mutationInsertOperation({
            id: `mutation:event:${randomUUID()}`,
            accountId: targetCalendar.accountId,
            resourceId: eventId,
            operation: "calendar.events.create",
            payload: mutationPayload(normalized),
            now
          })),
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
        this.recordHistory({
          kind: "schedule.repair",
          resourceId: request.id,
          summary: "Repaired scheduled task block",
          metadata: { queued, taskId: task.id, calendarId: targetCalendar.id }
        });

        return this.requireScheduledTaskBlock(request.id);
      }

      const targetCalendar = this.requireCalendar(request.calendarId ?? event.calendarId);
      const queued = this.shouldQueueRemoteMutations();
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
        ...this.remoteMutationOperations(mutationInsertOperation({
          id: `mutation:event:${randomUUID()}`,
          accountId: targetCalendar.accountId,
          resourceId: event.eventId,
          operation: "calendar.events.update",
          payload: mutationPayload(normalized),
          now
        })),
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
      this.recordHistory({
        kind: "schedule.move",
        resourceId: request.id,
        summary: "Moved scheduled task block",
        metadata: { queued, calendarId: targetCalendar.id }
      });

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
      const queued = deleteCalendarEvent && event !== undefined && this.shouldQueueRemoteMutations();
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
          ...this.remoteMutationOperations(mutationInsertOperation({
            id: `mutation:event:${randomUUID()}`,
            accountId: event.accountId,
            resourceId: event.eventId,
            operation: "calendar.events.delete",
            payload: {
              id: event.eventId,
              calendarId: event.calendarId
            },
            now
          }))
        );
      }

      this.connection.executeTransaction(operations);
      this.recordHistory({
        kind: "schedule.delete",
        resourceId: request.id,
        summary: "Unscheduled task block",
        metadata: { queued }
      });

      return {
        id: request.id,
        queued,
        revision: now
      };
    });
  }

  private previewSmartReschedule(request: SmartRescheduleRequest): SmartRescheduleResponse {
    const calendar = this.requireCalendar(request.calendarId);
    const dayStart = `${request.date}T00:00:00.000Z`;
    const dayStartMs = Date.parse(dayStart);
    const dayEnd = new Date(dayStartMs + 24 * 60 * 60 * 1000).toISOString();
    const workStartMs = dayStartMs + (request.workingHours?.start ?? 6) * 60 * 60 * 1000;
    const workEndMs = dayStartMs + (request.workingHours?.end ?? 22) * 60 * 60 * 1000;
    const taskIds = new Set(request.taskIds ?? []);
    const tasks = this.smartRescheduleTasks(taskIds);
    const existingBusy = this.busyRangesForSmartReschedule(calendar.id, dayStart, dayEnd);
    const reserved = [...existingBusy];
    const suggestions: SmartRescheduleSuggestion[] = [];
    const skipped: SmartRescheduleResponse["skipped"] = [];
    let usedMinutes = 0;
    const capacityMinutes = request.capacityMinutes ?? 480;

    for (const task of tasks.sort(compareSmartRescheduleTasks)) {
      const existingBlock = this.findScheduledTaskBlockRowForTask(task.id);
      const durationMinutes = smartTaskDurationMinutes(task);
      const conflicts = existingBlock
        ? rangesConflict(existingBlock, existingBusy.filter((range) => range.eventId !== existingBlock.calendarEventId))
        : false;
      const reason = smartRescheduleReason(task, existingBlock, dayStartMs, taskIds.size > 0, conflicts);

      if (reason === null) {
        continue;
      }

      if (task.lockedSchedule === 1) {
        skipped.push({ taskId: task.id, reason: "Task has a locked schedule." });
        continue;
      }

      if (usedMinutes + durationMinutes > capacityMinutes) {
        skipped.push({ taskId: task.id, reason: "No remaining capacity in the selected day." });
        continue;
      }

      const ignoredEventId = existingBlock?.calendarEventId;
      const startsAtMs = firstFreeSmartStart(
        reserved.filter((range) => range.eventId !== ignoredEventId),
        workStartMs,
        workEndMs,
        durationMinutes
      );

      if (startsAtMs === null) {
        skipped.push({ taskId: task.id, reason: "No free slot inside working hours." });
        continue;
      }

      const startsAt = new Date(startsAtMs).toISOString();
      const endsAt = addMinutesIso(startsAt, durationMinutes);
      suggestions.push({
        taskId: task.id,
        calendarId: calendar.id,
        ...(existingBlock ? { scheduledTaskBlockId: existingBlock.id } : {}),
        action: existingBlock ? "move" : "create",
        startsAt,
        endsAt,
        durationMinutes,
        reason
      });
      reserved.push({ startsAt, endsAt });
      usedMinutes += durationMinutes;
    }

    return {
      suggestions,
      skipped,
      applied: false,
      appliedBlocks: []
    };
  }

  private smartRescheduleTasks(taskIds: Set<string>): TaskRow[] {
    const params: string[] = [];
    const predicates = [
      "tasks.deleted_at IS NULL",
      "tasks.is_hidden = 0",
      "tasks.status = 'needsAction'",
      "lists.deleted_at IS NULL"
    ];

    if (taskIds.size > 0) {
      predicates.push(`tasks.id IN (${Array.from(taskIds).map(() => "?").join(", ")})`);
      params.push(...taskIds);
    }

    return this.connection.query<TaskRow>(
      `SELECT
         tasks.id,
         tasks.account_id AS accountId,
         tasks.google_id AS googleId,
         tasks.task_list_id AS listId,
         lists.google_id AS listGoogleId,
         lists.title AS listTitle,
         tasks.title,
         tasks.status,
         tasks.notes,
         tasks.due_at AS dueAt,
         tasks.parent_task_id AS parentId,
         tasks.is_hidden AS isHidden,
         tasks.local_priority AS priority,
         tasks.sort_order AS sortOrder,
         tasks.etag,
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
         WHERE resource_type = 'task'
           AND status IN ('pending', 'applying', 'failed')
         GROUP BY resource_id
       ) pending ON pending.resource_id = tasks.id
       WHERE ${predicates.join(" AND ")}
       ORDER BY tasks.local_priority ASC, tasks.due_at ASC, tasks.updated_at DESC
       LIMIT 500;`,
      params
    );
  }

  private busyRangesForSmartReschedule(calendarId: string, start: string, end: string): SmartBusyRange[] {
    return this.listCalendarEvents({
      calendarIds: [calendarId],
      start,
      end,
      limit: 500
    }).items
      .filter((event) => event.completedAt === null || event.completedAt === undefined)
      .filter((event) => event.transparency !== "transparent")
      .map((event) => ({ startsAt: event.startsAt, endsAt: event.endsAt, eventId: event.eventId ?? event.id }));
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
}

const smartPriorityRank: Record<string, number> = {
  high: 0,
  medium: 1,
  low: 2,
  none: 3
};

function compareSmartRescheduleTasks(left: TaskRow, right: TaskRow): number {
  return (smartPriorityRank[left.priority ?? "none"] ?? 3) - (smartPriorityRank[right.priority ?? "none"] ?? 3) ||
    (left.dueAt ?? "9999").localeCompare(right.dueAt ?? "9999") ||
    right.updatedAt.localeCompare(left.updatedAt) ||
    left.id.localeCompare(right.id);
}

function smartTaskDurationMinutes(task: TaskRow): number {
  if (typeof task.durationMinutes === "number" && task.durationMinutes > 0) {
    return Math.min(24 * 60, Math.max(5, task.durationMinutes));
  }

  if (task.plannedStart && task.plannedEnd) {
    const duration = Math.round((Date.parse(task.plannedEnd) - Date.parse(task.plannedStart)) / 60_000);

    if (Number.isFinite(duration) && duration > 0) {
      return Math.min(24 * 60, Math.max(5, duration));
    }
  }

  return 30;
}

function smartRescheduleReason(
  task: TaskRow,
  existingBlock: ScheduledTaskBlockRow | undefined,
  dayStartMs: number,
  explicitTaskIds: boolean,
  conflicts: boolean
): string | null {
  if (explicitTaskIds) {
    return existingBlock ? "Selected task will move to the first open slot." : "Selected task will get a scheduled block.";
  }

  if (task.dueAt && Date.parse(task.dueAt) < dayStartMs) {
    return "Overdue task scheduled before newer work.";
  }

  if (!existingBlock && !task.plannedStart) {
    return "Unscheduled task placed in the first open slot.";
  }

  if (existingBlock?.status === "orphaned") {
    return "Orphaned scheduled block will be repaired into a free slot.";
  }

  if (existingBlock && conflicts) {
    return "Conflicted scheduled block will move to a free slot.";
  }

  return null;
}

function firstFreeSmartStart(
  ranges: SmartBusyRange[],
  workStartMs: number,
  workEndMs: number,
  durationMinutes: number
): number | null {
  let cursor = workStartMs;
  const durationMs = durationMinutes * 60 * 1000;
  const sorted = ranges
    .map((range) => ({ start: Date.parse(range.startsAt), end: Date.parse(range.endsAt) }))
    .filter((range) => Number.isFinite(range.start) && Number.isFinite(range.end) && range.end > range.start)
    .sort((left, right) => left.start - right.start || left.end - right.end);

  for (const range of sorted) {
    if (range.end <= cursor) {
      continue;
    }

    if (range.start >= cursor + durationMs) {
      return cursor;
    }

    cursor = Math.max(cursor, range.end);
  }

  return cursor + durationMs <= workEndMs ? cursor : null;
}

function rangesConflict(range: SmartBusyRange, others: SmartBusyRange[]): boolean {
  return others.some((other) => range.startsAt < other.endsAt && range.endsAt > other.startsAt);
}
