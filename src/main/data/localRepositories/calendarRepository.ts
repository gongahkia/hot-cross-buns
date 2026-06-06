import { randomUUID } from "node:crypto";
import type {
  AvailabilityExportRequest,
  AvailabilityExportResponse,
  CalendarEventCompletionRequest,
  CalendarEventCompletionScope,
  CalendarEventCreateRequest,
  CalendarEventDeleteRequest,
  CalendarEventDetail,
  CalendarEventUpdateRequest,
  CalendarListRequest,
  CalendarListResponse,
  CalendarRangeRequest,
  CalendarRangeResponse
} from "@shared/ipc/contracts";
import {
  eventInsertOperation,
  eventInstanceInsertOperations,
  eventUpdateOperation,
  instanceDeleteOperation,
  mutationInsertOperation,
  mutationPayload,
  normalizeCalendarWrite,
  recurrenceRuleFromRequest
} from "./calendarWrites";
import { googleTaskIdFromCalendarDescription } from "./googleTaskProjection";
import { availabilityLine, calendarEventDetail, calendarEventSummary, calendarListSummary } from "./mappers";
import {
  countRows,
  googleEventIdFromLocalEventId,
  notFound,
  pageBounds,
  pageFromRows,
  parseNumberArray,
  parseStringArray,
  systemTimeZone
} from "./shared";
import { TaskLocalRepository } from "./taskRepository";
import type { CalendarEventRow, CalendarListRow, CalendarRow } from "./types";

export class CalendarLocalRepository extends TaskLocalRepository {
  listCalendars(request: CalendarListRequest): CalendarListResponse {
    return this.measureSqlite("calendar.listCalendars", () => {
      const { limit, offset } = pageBounds(request.cursor, request.limit, 50, 100);
      const rows = this.connection.query<CalendarListRow>(
        `SELECT
           calendars.id AS id,
           calendars.summary AS title,
           calendars.is_selected AS selected,
           calendars.time_zone AS timeZone,
           calendars.background_color AS backgroundColor,
           calendars.foreground_color AS foregroundColor,
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
           events.hcb_kind AS hcbKind,
           events.account_id AS accountId,
           instances.calendar_id AS calendarId,
           calendars.summary AS calendarTitle,
           events.summary AS title,
           instances.start_at AS startsAt,
           instances.end_at AS endsAt,
           instances.is_all_day AS allDay,
           instances.completed_at AS completedAt,
           instances.updated_at AS updatedAt,
           events.location AS location,
           events.description AS notes,
           events.attendee_emails_json AS guestEmailsJson,
           events.reminder_minutes_json AS reminderMinutesJson,
           events.conference_json AS conferenceJson,
           pending.status AS pendingMutationStatus,
           events.local_time_zone AS timeZone,
           events.recurrence_rule AS recurrenceRule,
           events.color_id AS colorId,
           events.local_tags_json AS tagsJson,
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

      return pageFromRows(this.withLinkedTaskIds(rows).map(calendarEventSummary), limit, offset, totalKnown);
    });
  }

  getCalendarEvent(id: string): CalendarEventDetail {
    return this.measureSqlite("calendar.getEvent", () => {
      const row = this.findCalendarEventRow(id);

      if (!row) {
        throw notFound("Calendar event was not found.");
      }

      return calendarEventDetail(this.withLinkedTaskId(row));
    });
  }

  createCalendarEvent(request: CalendarEventCreateRequest): CalendarEventDetail {
    return this.measureSqlite("calendar.create", () => {
      const calendar = this.requireCalendar(request.calendarId);
      const now = new Date().toISOString();
      const googleId = `local-${randomUUID()}`;
      const id = `${calendar.accountId}:event:${calendar.googleId}:${googleId}`;
      const timeZone = request.timeZone ?? calendar.timeZone ?? systemTimeZone();
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
        colorId: request.colorId ?? null,
        recurrenceRule: recurrenceRuleFromRequest(request.recurrence ?? null)
      });
      const localTagsJson = JSON.stringify(request.tags ?? []);
      const mutationId = `mutation:event:${randomUUID()}`;

      this.connection.executeTransaction([
        eventInsertOperation({
          id,
          accountId: calendar.accountId,
          googleId,
          hcbKind: request.hcbKind ?? null,
          localTagsJson,
          timeZone,
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
          payload: mutationPayload(normalized, request.hcbKind ?? null),
          now
        })
      ]);
      this.recordHistory({
        kind: "event.create",
        resourceId: id,
        summary: "Created calendar event",
        metadata: { queued: true, calendarId: calendar.id }
      });

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
      const timeZone = request.timeZone ?? existing.timeZone ?? targetCalendar.timeZone ?? systemTimeZone();
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
        colorId: request.colorId === undefined ? existing.colorId : request.colorId,
        recurrenceRule:
          request.recurrence === undefined
            ? existing.recurrenceRule
            : recurrenceRuleFromRequest(request.recurrence)
      });
      const localTagsJson =
        request.tags === undefined ? existing.tagsJson ?? "[]" : JSON.stringify(request.tags);
      const mutationId = `mutation:event:${randomUUID()}`;

      this.connection.executeTransaction([
        eventUpdateOperation({
          id: existing.eventId,
          hcbKind: request.hcbKind ?? null,
          localTagsJson,
          timeZone,
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
          payload: mutationPayload(normalized, request.hcbKind ?? existing.hcbKind ?? null),
          now
        })
      ]);
      this.recordHistory({
        kind: "event.edit",
        resourceId: existing.eventId,
        summary: "Edited calendar event",
        metadata: { queued: true, calendarId: targetCalendar.id }
      });

      return this.getCalendarEvent(existing.eventId);
    });
  }

  completeCalendarEvent(request: CalendarEventCompletionRequest): CalendarEventDetail {
    return this.setCalendarEventCompletion(request, true);
  }

  reopenCalendarEvent(request: CalendarEventCompletionRequest): CalendarEventDetail {
    return this.setCalendarEventCompletion(request, false);
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
      this.recordHistory({
        kind: "event.delete",
        resourceId: existing.eventId,
        summary: "Deleted calendar event",
        metadata: { queued: true, calendarId: existing.calendarId }
      });

      return {
        id: existing.eventId,
        queued: true,
        revision: now
      };
    });
  }

  private setCalendarEventCompletion(
    request: CalendarEventCompletionRequest,
    completed: boolean
  ): CalendarEventDetail {
    return this.measureSqlite(completed ? "calendar.complete" : "calendar.reopen", () => {
      const existing = this.findCalendarEventRow(request.id);

      if (!existing) {
        throw notFound("Calendar event was not found.");
      }

      const now = new Date().toISOString();
      const scope = request.scope ?? "occurrence";
      const predicate = calendarEventCompletionPredicate(scope);
      const params =
        scope === "seriesFuture"
          ? [completed ? now : null, now, existing.eventId, existing.startsAt]
          : scope === "seriesAll"
            ? [completed ? now : null, now, existing.eventId]
            : [completed ? now : null, now, existing.id];

      this.connection.run(
        `UPDATE google_calendar_event_instances
         SET completed_at = ?, updated_at = ?
         WHERE ${predicate}
           AND deleted_at IS NULL
           AND status != 'cancelled';`,
        params
      );
      this.recordHistory({
        kind: completed ? "event.complete" : "event.reopen",
        resourceId: existing.eventId,
        summary: completed ? "Completed calendar event" : "Reopened calendar event",
        metadata: { queued: false, calendarId: existing.calendarId, scope }
      });

      return {
        ...this.getCalendarEvent(existing.id),
        completionScopeApplied: scope
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
      const busyEvents = events.filter((event) => event.completedAt === null || event.completedAt === undefined);
      const busyLines = busyEvents.map((event) => availabilityLine(event));

      return {
        format: "text",
        text: [
          `Availability from ${request.start} to ${request.end}`,
          busyLines.length === 0 ? "No busy blocks in selected calendars." : "Busy:",
          ...busyLines
        ].join("\n"),
        generatedAt,
        busyBlockCount: busyEvents.length
      };
    });
  }

  protected findCalendarEventRow(id: string): CalendarEventRow | undefined {
    return this.connection.get<CalendarEventRow>(
        `SELECT
           COALESCE(instances.id, events.id) AS id,
           events.id AS eventId,
           events.hcb_kind AS hcbKind,
           events.account_id AS accountId,
           events.calendar_id AS calendarId,
           calendars.summary AS calendarTitle,
           events.summary AS title,
           COALESCE(instances.start_at, events.start_at) AS startsAt,
           COALESCE(instances.end_at, events.end_at) AS endsAt,
           COALESCE(instances.is_all_day, events.is_all_day) AS allDay,
           instances.completed_at AS completedAt,
           COALESCE(instances.updated_at, events.updated_at) AS updatedAt,
           events.location AS location,
           events.description AS notes,
           events.attendee_emails_json AS guestEmailsJson,
           events.reminder_minutes_json AS reminderMinutesJson,
           events.conference_json AS conferenceJson,
           pending.status AS pendingMutationStatus,
           events.local_time_zone AS timeZone,
           events.recurrence_rule AS recurrenceRule,
           events.color_id AS colorId,
           events.local_tags_json AS tagsJson,
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

  private withLinkedTaskId(row: CalendarEventRow): CalendarEventRow {
    return this.withLinkedTaskIds([row])[0] ?? row;
  }

  private withLinkedTaskIds(rows: CalendarEventRow[]): CalendarEventRow[] {
    const pairs = new Map<string, { accountId: string; googleId: string }>();

    for (const row of rows) {
      const googleId = googleTaskIdFromCalendarDescription(row.notes);

      if (googleId) {
        pairs.set(`${row.accountId}\u0000${googleId}`, { accountId: row.accountId, googleId });
      }
    }

    if (pairs.size === 0) {
      return rows;
    }

    const predicates: string[] = [];
    const params: string[] = [];

    for (const pair of pairs.values()) {
      predicates.push("(account_id = ? AND google_id = ?)");
      params.push(pair.accountId, pair.googleId);
    }

    const taskRows = this.connection.query<{ id: string; accountId: string; googleId: string }>(
      `SELECT id, account_id AS accountId, google_id AS googleId
       FROM google_tasks
       WHERE deleted_at IS NULL
         AND (${predicates.join(" OR ")});`,
      params
    );
    const taskIdByGoogleId = new Map(
      taskRows.map((task) => [`${task.accountId}\u0000${task.googleId}`, task.id])
    );

    return rows.map((row) => {
      const googleId = googleTaskIdFromCalendarDescription(row.notes);
      const linkedTaskId = googleId ? taskIdByGoogleId.get(`${row.accountId}\u0000${googleId}`) : undefined;

      return linkedTaskId ? { ...row, linkedTaskId } : row;
    });
  }

  protected requireCalendar(id: string): CalendarRow {
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
}

function calendarEventCompletionPredicate(scope: CalendarEventCompletionScope): string {
  if (scope === "seriesFuture") {
    return "event_id = ? AND start_at >= ?";
  }

  if (scope === "seriesAll") {
    return "event_id = ?";
  }

  return "id = ?";
}
