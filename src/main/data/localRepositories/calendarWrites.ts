import {
  addUtcDaysIso,
  normalizeGuestEmails,
  normalizeReminderMinutes,
  startOfUtcDayIso
} from "@shared/domain/calendar";
import type { CalendarEventRecurrence } from "@shared/ipc/contracts";
import type { SqliteWriteOperation } from "../sqliteConnection";
import { boolInt, nullIfEmpty, validationFailed } from "./shared";

export interface NormalizedCalendarWrite {
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

export function normalizeCalendarWrite(input: NormalizedCalendarWrite): NormalizedCalendarWrite {
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

export interface ParsedLocalRRule {
  freq: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  interval: number;
  count?: number;
  until?: Date;
}

export interface LocalCalendarEventInstance {
  id: string;
  startsAt: string;
  endsAt: string;
  originalStartAt: string | null;
}

export function recurrenceRuleFromRequest(recurrence: CalendarEventRecurrence | null | undefined): string | null {
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

export function recurrenceFromRule(rule: string | null): CalendarEventRecurrence | null {
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

export function materializedLocalEventInstances(input: {
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

export function parseLocalRRule(value: string | null | undefined): ParsedLocalRRule | null {
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

export function parseLocalRRuleUntil(value: string): Date | undefined {
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

export function nextLocalRecurrenceDate(date: Date, rrule: ParsedLocalRRule): Date {
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

export function addUtcDaysDate(date: Date, days: number): Date {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export function instanceSuffix(startAt: Date, allDay: boolean): string {
  const compact = startAt.toISOString().replace(/[-:]/g, "").replace(".000", "");

  return allDay ? compact.slice(0, 8) : compact;
}

export function eventInsertOperation(input: {
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

export function eventUpdateOperation(input: {
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

export function instanceDeleteOperation(eventId: string, now: string) {
  return {
    kind: "run" as const,
    sql: `UPDATE google_calendar_event_instances
          SET deleted_at = ?, updated_at = ?
          WHERE event_id = ? AND deleted_at IS NULL;`,
    params: [now, now, eventId]
  };
}

export function eventInstanceInsertOperations(input: {
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

export function instanceInsertOperation(input: {
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

export function mutationInsertOperation(input: {
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

export function mutationPayload(input: NormalizedCalendarWrite): object {
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
