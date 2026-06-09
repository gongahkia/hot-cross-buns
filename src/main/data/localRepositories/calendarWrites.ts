import {
  addUtcDaysIso,
  normalizeCalendarReminders,
  normalizeGuestEmails,
  normalizeReminderMinutes,
  startOfUtcDayIso
} from "@shared/domain/calendar";
import type {
  CalendarConferenceCreateRequest,
  CalendarEventRecurrence,
  CalendarEventReminder,
  CalendarEventTransparency,
  CalendarEventVisibility
} from "@shared/ipc/contracts";
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
  reminders?: CalendarEventReminder[];
  remindersUseDefault?: boolean;
  colorId?: string | null;
  transparency?: CalendarEventTransparency | null;
  visibility?: CalendarEventVisibility | null;
  conferenceCreateRequest?: CalendarConferenceCreateRequest | null;
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

  const reminders = normalizeCalendarReminders(
    input.reminders ?? input.reminderMinutes.map((minutes) => ({ method: "popup", minutes }))
  );

  return {
    title: input.title.trim(),
    calendarId: input.calendarId,
    startsAt,
    endsAt,
    allDay: input.allDay,
    location: input.location.trim(),
    notes: input.notes,
    guestEmails: normalizeGuestEmails(input.guestEmails),
    reminderMinutes: normalizeReminderMinutes(reminders.map((reminder) => reminder.minutes)),
    reminders,
    remindersUseDefault: input.remindersUseDefault ?? false,
    colorId: normalizeColorId(input.colorId),
    transparency: normalizeTransparency(input.transparency),
    visibility: normalizeVisibility(input.visibility),
    conferenceCreateRequest: input.conferenceCreateRequest ?? null,
    recurrenceRule: input.recurrenceRule
  };
}

export interface ParsedLocalRRule {
  freq: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  interval: number;
  byDay?: CalendarEventRecurrence["byDay"];
  byMonthDay?: number;
  bySetPos?: number;
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

  if ((recurrence.frequency === "weekly" || recurrence.bySetPos) && recurrence.byDay?.length) {
    parts.push(`BYDAY=${recurrence.byDay.join(",")}`);
  }

  if (recurrence.frequency === "monthly" && recurrence.byMonthDay) {
    parts.push(`BYMONTHDAY=${recurrence.byMonthDay}`);
  }

  if (recurrence.frequency === "monthly" && recurrence.bySetPos && recurrence.byDay?.length) {
    parts.push(`BYSETPOS=${recurrence.bySetPos}`);
  }

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
    ...(parsed.byDay === undefined ? {} : { byDay: parsed.byDay }),
    ...(parsed.byMonthDay === undefined ? {} : { byMonthDay: parsed.byMonthDay }),
    ...(parsed.bySetPos === undefined ? {} : { bySetPos: parsed.bySetPos }),
    endsOn: parsed.until ? parsed.until.toISOString().slice(0, 10) : null,
    count: parsed.count ?? null
  };
}

export function recurringInstanceStarts(rule: string | null, input: {
  id: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
}): string[] {
  return materializedLocalEventInstances({
    ...input,
    recurrenceRule: rule
  }).map((instance) => instance.startsAt);
}

export function splitRecurrenceRuleAt(rule: string, selectedStartsAt: string, input: {
  id: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
}): { beforeRule: string | null; futureRule: string; beforeCount: number; futureCount: number } | null {
  const starts = recurringInstanceStarts(rule, input);
  const selectedMs = Date.parse(selectedStartsAt);

  if (!Number.isFinite(selectedMs) || starts.length === 0) {
    return null;
  }

  const beforeCount = starts.filter((startsAt) => Date.parse(startsAt) < selectedMs).length;
  const futureCount = starts.length - beforeCount;

  if (beforeCount <= 0 || futureCount <= 0) {
    return null;
  }

  return {
    beforeRule: setRRuleLimit(rule, { count: beforeCount }),
    futureRule: setRRuleLimit(rule, { count: futureCount }),
    beforeCount,
    futureCount
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
  let cursor = firstLocalRecurrenceDate(start, rrule);

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
    cursor = nextLocalRecurrenceDate(cursor, rrule, start);
  }

  return instances.length > 0 ? instances : [singleInstance];
}

function setRRuleLimit(rule: string, limit: { count: number }): string {
  const lines = rule.split("\n");
  let replaced = false;
  const nextLines = lines.map((candidate) => {
    const line = candidate.trim();

    if (!line.startsWith("RRULE:")) {
      return candidate;
    }

    replaced = true;
    const parts = line
      .slice("RRULE:".length)
      .split(";")
      .filter((part) => !part.startsWith("COUNT=") && !part.startsWith("UNTIL="));

    parts.push(`COUNT=${Math.max(1, Math.min(366, Math.floor(limit.count)))}`);
    return `RRULE:${parts.join(";")}`;
  });

  return replaced ? nextLines.join("\n") : rule;
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
    ...(parts.BYDAY === undefined ? {} : { byDay: parseRRuleByDay(parts.BYDAY) }),
    ...(parts.BYMONTHDAY === undefined
      ? {}
      : { byMonthDay: Math.min(31, Math.max(1, Number.parseInt(parts.BYMONTHDAY, 10) || 1)) }),
    ...(parts.BYSETPOS === undefined
      ? {}
      : { bySetPos: Math.min(5, Math.max(-5, Number.parseInt(parts.BYSETPOS, 10) || 1)) }),
    ...(parts.COUNT === undefined
      ? {}
      : { count: Math.min(366, Math.max(1, Number.parseInt(parts.COUNT, 10) || 1)) }),
    ...(parts.UNTIL === undefined ? {} : { until: parseLocalRRuleUntil(parts.UNTIL) })
  };
}

function parseRRuleByDay(value: string): CalendarEventRecurrence["byDay"] {
  return value
    .split(",")
    .map((day) => day.replace(/^[+-]?\d+/, ""))
    .filter((day): day is NonNullable<CalendarEventRecurrence["byDay"]>[number] =>
      day === "SU" || day === "MO" || day === "TU" || day === "WE" || day === "TH" || day === "FR" || day === "SA"
    );
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

function firstLocalRecurrenceDate(start: Date, rrule: ParsedLocalRRule): Date {
  if (rrule.freq === "MONTHLY" && (rrule.byMonthDay || rrule.bySetPos)) {
    return monthlyRuleMatches(start, rrule, start)
      ? start
      : nextMonthlyRuleDate(addUtcDaysDate(start, -1), rrule, start);
  }

  if (rrule.freq !== "WEEKLY" || !rrule.byDay?.length || rrule.byDay.includes(weekdayCode(start))) {
    return start;
  }

  return nextLocalRecurrenceDate(addUtcDaysDate(start, -1), rrule, start);
}

export function nextLocalRecurrenceDate(date: Date, rrule: ParsedLocalRRule, seriesStart = date): Date {
  if (rrule.freq === "WEEKLY" && rrule.byDay?.length) {
    return nextWeeklyByDayDate(date, rrule, seriesStart);
  }

  if (rrule.freq === "MONTHLY" && (rrule.byMonthDay || rrule.bySetPos)) {
    return nextMonthlyRuleDate(date, rrule, seriesStart);
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

function nextWeeklyByDayDate(date: Date, rrule: ParsedLocalRRule, seriesStart: Date): Date {
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

function nextMonthlyRuleDate(date: Date, rrule: ParsedLocalRRule, seriesStart: Date): Date {
  const next = new Date(date.getTime());

  for (let offset = 1; offset <= 370; offset += 1) {
    next.setUTCDate(next.getUTCDate() + 1);
    next.setUTCHours(
      seriesStart.getUTCHours(),
      seriesStart.getUTCMinutes(),
      seriesStart.getUTCSeconds(),
      seriesStart.getUTCMilliseconds()
    );

    if (monthlyRuleMatches(next, rrule, seriesStart)) {
      return next;
    }
  }

  const fallback = new Date(date.getTime());
  fallback.setUTCMonth(fallback.getUTCMonth() + rrule.interval);
  return fallback;
}

function monthlyRuleMatches(date: Date, rrule: ParsedLocalRRule, seriesStart: Date): boolean {
  if (!recurrenceMonthMatches(seriesStart, date, rrule.interval)) {
    return false;
  }

  if (rrule.byMonthDay) {
    return date.getUTCDate() === rrule.byMonthDay;
  }

  if (rrule.bySetPos && rrule.byDay?.length) {
    return rrule.byDay.includes(weekdayCode(date)) &&
      monthlyWeekdayPositionMatches(date, rrule.bySetPos);
  }

  return date.getUTCDate() === seriesStart.getUTCDate();
}

function recurrenceMonthMatches(seriesStart: Date, date: Date, interval: number): boolean {
  const months =
    (date.getUTCFullYear() - seriesStart.getUTCFullYear()) * 12 +
    date.getUTCMonth() -
    seriesStart.getUTCMonth();

  return months >= 0 && months % interval === 0;
}

function monthlyWeekdayPositionMatches(date: Date, position: number): boolean {
  const day = date.getUTCDate();

  if (position > 0) {
    return Math.floor((day - 1) / 7) + 1 === position;
  }

  const nextWeek = new Date(date.getTime());
  let fromEnd = 1;
  nextWeek.setUTCDate(day + 7);

  while (nextWeek.getUTCMonth() === date.getUTCMonth()) {
    fromEnd += 1;
    nextWeek.setUTCDate(nextWeek.getUTCDate() + 7);
  }

  return -fromEnd === position;
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

function weekdayCode(date: Date): NonNullable<CalendarEventRecurrence["byDay"]>[number] {
  return (["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const)[date.getUTCDay()];
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
  hcbKind?: "birthday" | null;
  localTagsJson?: string;
  timeZone: string;
  now: string;
} & NormalizedCalendarWrite) {
  return {
    kind: "run" as const,
    sql: `INSERT INTO google_calendar_events (
      id, account_id, calendar_id, google_id, status, summary, description, location,
      start_at, start_time_zone, end_at, end_time_zone, is_all_day, recurrence_rule, local_time_zone,
      hcb_kind, local_tags_json, color_id, transparency, visibility, attendee_emails_json,
      attendee_details_json, reminder_minutes_json, reminders_json, reminders_use_default,
      created_at, updated_at, deleted_at
    ) VALUES (?, ?, ?, ?, 'confirmed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL);`,
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
      input.hcbKind ?? null,
      input.localTagsJson ?? "[]",
      input.colorId ?? null,
      input.transparency ?? null,
      input.visibility ?? null,
      JSON.stringify(input.guestEmails),
      JSON.stringify(input.guestEmails.map((email) => ({ email }))),
      JSON.stringify(input.reminderMinutes),
      JSON.stringify(input.reminders ?? []),
      boolInt(input.remindersUseDefault === true),
      input.now,
      input.now
    ]
  };
}

export function eventUpdateOperation(input: {
  id: string;
  calendarId: string;
  hcbKind?: "birthday" | null;
  localTagsJson?: string;
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
              hcb_kind = COALESCE(?, hcb_kind),
              local_tags_json = ?,
              color_id = ?,
              transparency = ?,
              visibility = ?,
              attendee_emails_json = ?,
              attendee_details_json = ?,
              reminder_minutes_json = ?,
              reminders_json = ?,
              reminders_use_default = ?,
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
      input.hcbKind ?? null,
      input.localTagsJson ?? "[]",
      input.colorId ?? null,
      input.transparency ?? null,
      input.visibility ?? null,
      JSON.stringify(input.guestEmails),
      JSON.stringify(input.guestEmails.map((email) => ({ email }))),
      JSON.stringify(input.reminderMinutes),
      JSON.stringify(input.reminders ?? []),
      boolInt(input.remindersUseDefault === true),
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

export function mutationPayload(input: NormalizedCalendarWrite, hcbKind?: "birthday" | null): object {
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
    reminders: input.reminders ?? [],
    remindersUseDefault: input.remindersUseDefault ?? false,
    colorId: input.colorId ?? null,
    transparency: input.transparency ?? null,
    visibility: input.visibility ?? null,
    conferenceCreateRequest: input.conferenceCreateRequest ?? null,
    hcbKind: hcbKind ?? null,
    recurrence: recurrenceFromRule(input.recurrenceRule),
    recurrenceRule: input.recurrenceRule
  };
}

function normalizeColorId(value: string | null | undefined): string | null {
  const colorId = value?.trim() ?? "";
  return colorId.length > 0 && colorId.length <= 32 ? colorId : null;
}

function normalizeTransparency(value: CalendarEventTransparency | null | undefined): CalendarEventTransparency | null {
  return value === "opaque" || value === "transparent" ? value : null;
}

function normalizeVisibility(value: CalendarEventVisibility | null | undefined): CalendarEventVisibility | null {
  return value === "default" || value === "public" || value === "private" ? value : null;
}
