import { randomUUID } from "node:crypto";
import type {
  AvailabilityExportRequest,
  AvailabilityExportResponse,
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

  protected findCalendarEventRow(id: string): CalendarEventRow | undefined {
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
