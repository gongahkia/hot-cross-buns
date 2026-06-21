import { addUtcDays } from "@shared/domain/calendar";
import type { GoogleCalendarEventMirror } from "../../google";
import type { SqliteWriteOperation } from "../../data/sqliteConnection";
import { boolInt } from "./ids";

interface CalendarEventInstanceInput {
  id: string;
  startAt: string;
  endAt: string;
  originalStartAt: string | null;
}

interface ParsedRRule {
  freq: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  interval: number;
  byDay?: Array<"SU" | "MO" | "TU" | "WE" | "TH" | "FR" | "SA">;
  count?: number;
  until?: Date;
}

export function calendarEventInstanceOperations(options: {
  accountId: string;
  calendarId: string;
  calendarGoogleId: string;
  event: GoogleCalendarEventMirror;
  eventId: string;
  now: string;
}): SqliteWriteOperation[] {
  const operations: SqliteWriteOperation[] = [
    {
      kind: "run",
      sql: `UPDATE google_calendar_event_instances
            SET deleted_at = ?, updated_at = ?
            WHERE event_id = ? AND deleted_at IS NULL;`,
      params: [options.now, options.now, options.eventId]
    }
  ];

  if (options.event.status === "cancelled") {
    return operations;
  }

  operations.push(
    ...materializedCalendarEventInstances(options.event, options.eventId).map((instance) => ({
      kind: "run" as const,
      sql: `INSERT INTO google_calendar_event_instances (
        id, account_id, calendar_id, event_id, google_event_id, recurring_event_id,
        original_start_at, start_at, end_at, is_all_day, status, updated_at, deleted_at
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
        instance.id,
        options.accountId,
        options.calendarId,
        options.eventId,
        options.event.id,
        options.event.recurringEventId ?? null,
        instance.originalStartAt,
        instance.startAt,
        instance.endAt,
        boolInt(options.event.isAllDay),
        options.event.status,
        options.now
      ]
    }))
  );

  return operations;
}

function materializedCalendarEventInstances(
  event: GoogleCalendarEventMirror,
  eventId: string
): CalendarEventInstanceInput[] {
  const singleInstance = {
    id: eventId,
    startAt: event.startAt,
    endAt: event.endAt,
    originalStartAt: event.originalStartAt ?? null
  };

  if (event.recurringEventId !== null && event.recurringEventId !== undefined) {
    return [singleInstance];
  }

  const rrule = parseRRule(event.recurrenceRule);

  if (rrule === null) {
    return [singleInstance];
  }

  const start = new Date(event.startAt);
  const end = new Date(event.endAt);
  const durationMs = end.getTime() - start.getTime();

  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || durationMs <= 0) {
    return [singleInstance];
  }

  const hardLimit = Math.min(rrule.count ?? 730, 730);
  const boundedUntil = rrule.until ?? addUtcDays(start, 730);
  const instances: CalendarEventInstanceInput[] = [];
  let cursor = firstRecurrenceDate(start, rrule);

  for (let index = 0; index < hardLimit; index += 1) {
    if (cursor.getTime() > boundedUntil.getTime()) {
      break;
    }

    const instanceStart = new Date(cursor.getTime());
    const instanceEnd = new Date(instanceStart.getTime() + durationMs);
    instances.push({
      id: index === 0 ? eventId : `${eventId}:instance:${instanceSuffix(instanceStart, event.isAllDay)}`,
      startAt: instanceStart.toISOString(),
      endAt: instanceEnd.toISOString(),
      originalStartAt: instanceStart.toISOString()
    });
    cursor = nextRecurrenceDate(cursor, rrule, start);
  }

  return instances.length > 0 ? instances : [singleInstance];
}

function parseRRule(value: string | null | undefined): ParsedRRule | null {
  if (value === undefined || value === null) {
    return null;
  }

  const line = value
    .split("\n")
    .map((candidate) => candidate.trim())
    .find((candidate) => candidate.startsWith("RRULE:"));

  if (line === undefined) {
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
    interval: Math.max(1, Number.parseInt(parts.INTERVAL ?? "1", 10) || 1),
    ...(parts.BYDAY === undefined ? {} : { byDay: parseRRuleByDay(parts.BYDAY) }),
    ...(parts.COUNT === undefined
      ? {}
      : { count: Math.max(1, Number.parseInt(parts.COUNT, 10) || 1) }),
    ...(parts.UNTIL === undefined ? {} : { until: parseRRuleUntil(parts.UNTIL) })
  };
}

function parseRRuleByDay(value: string): ParsedRRule["byDay"] {
  return value
    .split(",")
    .filter((day): day is NonNullable<ParsedRRule["byDay"]>[number] =>
      day === "SU" || day === "MO" || day === "TU" || day === "WE" || day === "TH" || day === "FR" || day === "SA"
    );
}

function parseRRuleUntil(value: string): Date | undefined {
  const parsed =
    /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(value) ??
    /^(\d{4})(\d{2})(\d{2})$/.exec(value);

  if (parsed === null) {
    return undefined;
  }

  const [, year, month, day, hour = "00", minute = "00", second = "00"] = parsed;
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

function firstRecurrenceDate(start: Date, rrule: ParsedRRule): Date {
  if (rrule.freq !== "WEEKLY" || !rrule.byDay?.length || rrule.byDay.includes(weekdayCode(start))) {
    return start;
  }

  const previous = new Date(start.getTime());
  previous.setUTCDate(previous.getUTCDate() - 1);
  return nextRecurrenceDate(previous, rrule, start);
}

function nextRecurrenceDate(date: Date, rrule: ParsedRRule, seriesStart = date): Date {
  if (rrule.freq === "WEEKLY" && rrule.byDay?.length) {
    return nextWeeklyByDayDate(date, rrule, seriesStart);
  }

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

function nextWeeklyByDayDate(date: Date, rrule: ParsedRRule, seriesStart: Date): Date {
  const selected = new Set(rrule.byDay ?? []);
  const next = new Date(date.getTime());

  for (let offset = 1; offset <= rrule.interval * 7 + 7; offset += 1) {
    next.setUTCDate(next.getUTCDate() + 1);

    if (selected.has(weekdayCode(next)) && recurrenceWeekMatches(seriesStart, next, rrule.interval)) {
      return next;
    }
  }

  const fallback = new Date(date.getTime());
  fallback.setUTCDate(fallback.getUTCDate() + rrule.interval * 7);
  return fallback;
}

function recurrenceWeekMatches(seriesStart: Date, date: Date, interval: number): boolean {
  const start = startOfUtcWeek(seriesStart).getTime();
  const current = startOfUtcWeek(date).getTime();
  const weeks = Math.floor((current - start) / (7 * 24 * 60 * 60 * 1000));

  return weeks >= 0 && weeks % interval === 0;
}

function startOfUtcWeek(date: Date): Date {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - start.getUTCDay());
  return start;
}

function weekdayCode(date: Date): NonNullable<ParsedRRule["byDay"]>[number] {
  return (["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const)[date.getUTCDay()];
}

function instanceSuffix(startAt: Date, allDay: boolean): string {
  const compact = startAt.toISOString().replace(/[-:]/g, "").replace(".000", "");

  return allDay ? compact.slice(0, 8) : compact;
}
