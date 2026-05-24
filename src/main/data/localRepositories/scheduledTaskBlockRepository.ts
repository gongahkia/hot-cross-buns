import { randomUUID } from "node:crypto";
import type {
  ScheduledTaskBlockCreateRequest,
  ScheduledTaskBlockListRequest,
  ScheduledTaskBlockListResponse,
  ScheduledTaskBlockMoveRequest,
  ScheduledTaskBlockSummary,
  ScheduledTaskBlockUnscheduleRequest
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
import type { ScheduledTaskBlockRow } from "./types";

export class ScheduledTaskBlockLocalRepository extends CalendarLocalRepository {
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
