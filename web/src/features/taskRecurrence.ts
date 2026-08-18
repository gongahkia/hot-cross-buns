import type { TaskPriority } from "@/types";

export type TaskRecurrenceFrequency = "daily" | "weekly" | "monthly" | "yearly";
export type TaskRecurrenceEnd =
  | { readonly kind: "never" }
  | { readonly kind: "until"; readonly untilDate: string }
  | { readonly kind: "count"; readonly count: number };

/** This is the portable v2 marker used by the native client. */
export interface TaskRecurrenceMarker {
  readonly seriesId: string;
  readonly occurrenceId: string;
  readonly ordinal: number;
  readonly frequency: TaskRecurrenceFrequency;
  readonly interval: number;
  readonly anchorDate: string;
  readonly timeZone: string;
  readonly end: TaskRecurrenceEnd;
  readonly recurrenceRule: string;
  readonly exclusionDates: readonly string[];
  readonly additionDates: readonly string[];
  readonly templateTitle: string;
  readonly templateDueDate: string;
  readonly templatePriority: TaskPriority;
}

/** A single portable reminder bound to the task's own due date. */
export interface TaskReminder {
  readonly time: string;
  readonly timeZone: string;
}

export interface TaskRecurrenceNotes {
  readonly state: "unmanaged" | "managed" | "malformed" | "unsupported-version";
  readonly userNotes: string;
  readonly marker?: TaskRecurrenceMarker;
  readonly reminder?: TaskReminder;
  readonly diagnostic?: string;
}

const notesLimit = 8_192;
const markerPrefix = "[HCB-RECURRENCE v";
const markerSuffix = "\n[/HCB-RECURRENCE]";
const taskMarkerPrefix = "[HCB-TASK v";
const taskMarkerSuffix = "\n[/HCB-TASK]";
const frequencies = new Set<TaskRecurrenceFrequency>(["daily", "weekly", "monthly", "yearly"]);
const priorities = new Set<TaskPriority>(["none", "low", "medium", "high"]);
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

interface ParsedRule {
  readonly frequency: TaskRecurrenceFrequency;
  readonly interval: number;
  readonly weekdays: ReadonlySet<number>;
  readonly ordinalWeekdays: ReadonlyMap<number, ReadonlySet<number>>;
  readonly monthDays: ReadonlySet<number>;
  readonly months: ReadonlySet<number>;
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function isDate(value: unknown): value is string {
  if (typeof value !== "string" || !datePattern.test(value)) {
    return false;
  }
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

function dateAt(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function dateText(value: Date): string {
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;
}

function addDays(value: Date, amount: number): Date {
  const result = new Date(value);
  result.setUTCDate(result.getUTCDate() + amount);
  return result;
}

function addMonths(value: Date, amount: number): Date {
  const result = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + amount + 1, 0));
  result.setUTCDate(Math.min(value.getUTCDate(), result.getUTCDate()));
  return result;
}

function addYears(value: Date, amount: number): Date {
  return addMonths(value, amount * 12);
}

function weekday(value: Date): number {
  return value.getUTCDay() === 0 ? 7 : value.getUTCDay();
}

function validTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || !value || value.length > 128 || value.trim() !== value || value.includes("\0")) {
    return false;
  }
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

function validDateList(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.length <= 10_000 && value.every(isDate) && new Set(value).size === value.length;
}

function validTitle(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 500 && value.trim() === value && !value.includes("\0");
}

function validReminder(value: unknown): value is { readonly t: string; readonly z: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const reminder = value as Record<string, unknown>;
  return Object.keys(reminder).length === 2 && typeof reminder.t === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(reminder.t) && validTimeZone(reminder.z);
}

function integer(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && Number.isSafeInteger(value);
}

function ruleError(rule: string): string | undefined {
  return parseDateOnlyRule(rule) ? undefined : "date-only recurrence rule is invalid";
}

function validate(marker: TaskRecurrenceMarker): string | undefined {
  if (!uuidPattern.test(marker.seriesId)) return "series identifier is invalid";
  if (!integer(marker.ordinal) || marker.ordinal < 0 || marker.occurrenceId !== `${marker.seriesId}:${marker.ordinal}`) return "occurrence identity is invalid";
  if (!frequencies.has(marker.frequency) || !integer(marker.interval) || marker.interval < 1 || marker.interval > 1_000) return "rule is invalid";
  if (!isDate(marker.anchorDate) || !isDate(marker.templateDueDate) || !validTitle(marker.templateTitle) || !priorities.has(marker.templatePriority)) return "template is invalid";
  if (!validTimeZone(marker.timeZone)) return "timezone is invalid";
  if (marker.recurrenceRule && ruleError(marker.recurrenceRule)) return ruleError(marker.recurrenceRule);
  const parsedRule = marker.recurrenceRule ? parseDateOnlyRule(marker.recurrenceRule) : undefined;
  if (parsedRule && (parsedRule.frequency !== marker.frequency || parsedRule.interval !== marker.interval)) return "date-only recurrence rule is invalid";
  if (!validDateList(marker.exclusionDates) || !validDateList(marker.additionDates)) return "recurrence date exceptions are invalid";
  if (marker.exclusionDates.includes(marker.anchorDate) || marker.additionDates.some((date) => date < marker.anchorDate)) return "recurrence date exceptions are outside the series";
  if (marker.end.kind === "never") return undefined;
  if (marker.end.kind === "until") return isDate(marker.end.untilDate) && marker.end.untilDate >= marker.anchorDate ? undefined : "until end condition is invalid";
  return integer(marker.end.count) && marker.end.count >= 1 && marker.end.count <= 10_000 ? undefined : "count end condition is invalid";
}

function payloadToMarker(payload: unknown, version: number): TaskRecurrenceMarker | undefined {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined;
  const object = payload as Record<string, unknown>;
  const expected = version === 2 ? ["a", "d", "e", "i", "n", "o", "q", "r", "s", "t", "x", "z"] : ["a", "e", "i", "n", "o", "r", "s", "t", "z"];
  if (Object.keys(object).length !== expected.length || expected.some((key) => !(key in object))) return undefined;
  const end = object.e;
  const template = object.t;
  if (!end || typeof end !== "object" || Array.isArray(end) || !template || typeof template !== "object" || Array.isArray(template)) return undefined;
  const endObject = end as Record<string, unknown>;
  const templateObject = template as Record<string, unknown>;
  let endCondition: TaskRecurrenceEnd;
  if (endObject.k === "never" && Object.keys(endObject).length === 1) {
    endCondition = { kind: "never" };
  } else if (endObject.k === "until" && Object.keys(endObject).length === 2 && isDate(endObject.u)) {
    endCondition = { kind: "until", untilDate: endObject.u };
  } else if (endObject.k === "count" && Object.keys(endObject).length === 2 && integer(endObject.c)) {
    endCondition = { kind: "count", count: endObject.c };
  } else {
    return undefined;
  }
  if (Object.keys(templateObject).length !== 3 || !("d" in templateObject) || !("p" in templateObject) || !("t" in templateObject)) return undefined;
  if (!isDate(templateObject.d) || !validTitle(templateObject.t) || typeof templateObject.p !== "string" || !priorities.has(templateObject.p as TaskPriority)) return undefined;
  if (!isDate(object.a) || !integer(object.i) || !integer(object.n) || typeof object.o !== "string" || typeof object.r !== "string" || !frequencies.has(object.r as TaskRecurrenceFrequency) || typeof object.s !== "string" || !validTimeZone(object.z)) return undefined;
  if (version === 2 && (typeof object.q !== "string" || !validDateList(object.d) || !validDateList(object.x))) return undefined;
  const marker: TaskRecurrenceMarker = {
    anchorDate: object.a,
    additionDates: version === 2 ? object.d as readonly string[] : [],
    end: endCondition,
    exclusionDates: version === 2 ? object.x as readonly string[] : [],
    frequency: object.r as TaskRecurrenceFrequency,
    interval: object.i,
    occurrenceId: object.o,
    ordinal: object.n,
    recurrenceRule: version === 2 ? object.q as string : "",
    seriesId: object.s,
    templateDueDate: templateObject.d,
    templatePriority: templateObject.p as TaskPriority,
    templateTitle: templateObject.t,
    timeZone: object.z
  };
  return validate(marker) ? undefined : marker;
}

function parseLegacyRecurrenceNotes(notes: string): TaskRecurrenceNotes {
  const start = notes.indexOf(markerPrefix);
  if (start < 0) return { state: "unmanaged", userNotes: notes };
  if (notes.indexOf(markerPrefix, start + markerPrefix.length) >= 0) return { state: "malformed", userNotes: notes, diagnostic: "HCB recurrence marker is malformed: multiple marker headers exist" };
  const headerEnd = notes.indexOf("]\n", start + markerPrefix.length);
  if (start < 2 || notes.slice(start - 2, start) !== "\n\n" || headerEnd < 0) return { state: "malformed", userNotes: notes, diagnostic: "HCB recurrence marker is malformed: marker boundary is invalid" };
  const versionText = notes.slice(start + markerPrefix.length, headerEnd);
  const version = Number(versionText);
  const end = notes.indexOf(markerSuffix, headerEnd + 2);
  if (!Number.isInteger(version) || version < 1 || end < 0 || end + markerSuffix.length !== notes.length) return { state: "malformed", userNotes: notes, diagnostic: "HCB recurrence marker is malformed: marker envelope is invalid" };
  if (version !== 1 && version !== 2) return { state: "unsupported-version", userNotes: notes, diagnostic: "HCB recurrence marker version is unsupported" };
  const payloadText = notes.slice(headerEnd + 2, end);
  if (!payloadText || payloadText.includes("\n") || utf8Bytes(payloadText) > notesLimit) return { state: "malformed", userNotes: notes, diagnostic: "HCB recurrence marker is malformed: marker payload is invalid" };
  try {
    const marker = payloadToMarker(JSON.parse(payloadText), version);
    if (!marker) return { state: "malformed", userNotes: notes, diagnostic: "HCB recurrence marker is malformed: payload fields are invalid" };
    return { state: "managed", userNotes: notes.slice(0, start - 2), marker };
  } catch {
    return { state: "malformed", userNotes: notes, diagnostic: "HCB recurrence marker is malformed: marker payload is not a JSON object" };
  }
}

function parseTaskEnvelope(notes: string): TaskRecurrenceNotes {
  const start = notes.indexOf(taskMarkerPrefix);
  if (start < 0) return parseLegacyRecurrenceNotes(notes);
  if (notes.indexOf(taskMarkerPrefix, start + taskMarkerPrefix.length) >= 0) return { state: "malformed", userNotes: notes, diagnostic: "HCB task marker is malformed: multiple marker headers exist" };
  const headerEnd = notes.indexOf("]\n", start + taskMarkerPrefix.length);
  if (start < 2 || notes.slice(start - 2, start) !== "\n\n" || headerEnd < 0) return { state: "malformed", userNotes: notes, diagnostic: "HCB task marker is malformed: marker boundary is invalid" };
  const version = Number(notes.slice(start + taskMarkerPrefix.length, headerEnd));
  const end = notes.indexOf(taskMarkerSuffix, headerEnd + 2);
  if (!Number.isInteger(version) || version < 1 || end < 0 || end + taskMarkerSuffix.length !== notes.length) return { state: "malformed", userNotes: notes, diagnostic: "HCB task marker is malformed: marker envelope is invalid" };
  if (version !== 1) return { state: "unsupported-version", userNotes: notes, diagnostic: "HCB task marker version is unsupported" };
  const payloadText = notes.slice(headerEnd + 2, end);
  if (!payloadText || payloadText.includes("\n") || utf8Bytes(payloadText) > notesLimit) return { state: "malformed", userNotes: notes, diagnostic: "HCB task marker is malformed: marker payload is invalid" };
  try {
    const payload = JSON.parse(payloadText) as Record<string, unknown>;
    if (!payload || typeof payload !== "object" || Array.isArray(payload) || Object.keys(payload).some((key) => key !== "m" && key !== "r") || (!("m" in payload) && !("r" in payload))) {
      return { state: "malformed", userNotes: notes, diagnostic: "HCB task marker is malformed: payload fields are invalid" };
    }
    const reminder = "m" in payload ? validReminder(payload.m) ? { time: payload.m.t, timeZone: payload.m.z } : undefined : undefined;
    const marker = "r" in payload ? payloadToMarker(payload.r, 2) : undefined;
    if (("m" in payload && !reminder) || ("r" in payload && !marker)) return { state: "malformed", userNotes: notes, diagnostic: "HCB task marker is malformed: payload fields are invalid" };
    return marker ? { state: "managed", userNotes: notes.slice(0, start - 2), marker, reminder } : { state: "unmanaged", userNotes: notes.slice(0, start - 2), reminder };
  } catch {
    return { state: "malformed", userNotes: notes, diagnostic: "HCB task marker is malformed: marker payload is not a JSON object" };
  }
}

export function parseTaskRecurrenceNotes(notes = ""): TaskRecurrenceNotes {
  return notes.includes(taskMarkerPrefix) ? parseTaskEnvelope(notes) : parseLegacyRecurrenceNotes(notes);
}

function recurrencePayload(marker: TaskRecurrenceMarker): Record<string, unknown> {
  const end = marker.end.kind === "never" ? { k: "never" } : marker.end.kind === "until" ? { k: "until", u: marker.end.untilDate } : { c: marker.end.count, k: "count" };
  return { a: marker.anchorDate, d: marker.additionDates, e: end, i: marker.interval, n: marker.ordinal, o: marker.occurrenceId, q: marker.recurrenceRule, r: marker.frequency, s: marker.seriesId, t: { d: marker.templateDueDate, p: marker.templatePriority, t: marker.templateTitle }, x: marker.exclusionDates, z: marker.timeZone };
}

export function serializeTaskRecurrenceNotes(userNotes: string, marker: TaskRecurrenceMarker): { readonly notes?: string; readonly error?: string } {
  if (userNotes.includes("\0")) return { error: "Task notes contain a null character" };
  const error = validate(marker);
  if (error) return { error: `HCB recurrence marker is invalid: ${error}` };
  const notes = `${userNotes}\n\n${markerPrefix}2]\n${JSON.stringify(recurrencePayload(marker))}${markerSuffix}`;
  return utf8Bytes(notes) <= notesLimit ? { notes } : { error: "Task notes and recurrence marker exceed Google Tasks limit" };
}

/**
 * Saves recurrence and reminder metadata together only when a task needs a reminder.
 * Existing recurrence-only tasks retain their v2 envelope for backward compatibility.
 */
export function serializeTaskNotes(userNotes: string, marker?: TaskRecurrenceMarker, reminder?: TaskReminder): { readonly notes?: string; readonly error?: string } {
  if (!reminder) return marker ? serializeTaskRecurrenceNotes(userNotes, marker) : { notes: userNotes || undefined };
  if (userNotes.includes("\0")) return { error: "Task notes contain a null character" };
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(reminder.time) || !validTimeZone(reminder.timeZone)) return { error: "Task reminder time or time zone is invalid" };
  const recurrenceError = marker ? validate(marker) : undefined;
  if (recurrenceError) return { error: `HCB recurrence marker is invalid: ${recurrenceError}` };
  const payload = marker ? { m: { t: reminder.time, z: reminder.timeZone }, r: recurrencePayload(marker) } : { m: { t: reminder.time, z: reminder.timeZone } };
  const notes = `${userNotes}\n\n${taskMarkerPrefix}1]\n${JSON.stringify(payload)}${taskMarkerSuffix}`;
  return utf8Bytes(notes) <= notesLimit ? { notes } : { error: "Task notes and reminder marker exceed Google Tasks limit" };
}

function parseDateOnlyRule(rule: string): ParsedRule | undefined {
  if (!rule || rule.length > 512 || rule.trim() !== rule || rule.includes("\0")) return undefined;
  const values = new Map<string, string>();
  for (const part of rule.split(";")) {
    const [key, value, ...extra] = part.split("=");
    if (!key || !value || extra.length > 0 || key !== key.toUpperCase() || value !== value.toUpperCase() || values.has(key) || !["FREQ", "INTERVAL", "BYDAY", "BYMONTHDAY", "BYMONTH"].includes(key)) return undefined;
    values.set(key, value);
  }
  const frequency = values.get("FREQ")?.toLowerCase() as TaskRecurrenceFrequency | undefined;
  if (!frequency || !frequencies.has(frequency)) return undefined;
  const interval = Number(values.get("INTERVAL") ?? "1");
  if (!Number.isInteger(interval) || interval < 1 || interval > 1_000) return undefined;
  const weekdays = new Set<number>();
  const ordinalWeekdays = new Map<number, Set<number>>();
  const dayNames: Record<string, number> = { MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6, SU: 7 };
  for (const token of (values.get("BYDAY")?.split(",") ?? [])) {
    const match = /^(-?[1-5])?(MO|TU|WE|TH|FR|SA|SU)$/.exec(token);
    if (!match) return undefined;
    const day = dayNames[match[2]!];
    if (match[1]) {
      const ordinal = Number(match[1]);
      const days = ordinalWeekdays.get(ordinal) ?? new Set<number>();
      days.add(day);
      ordinalWeekdays.set(ordinal, days);
    } else weekdays.add(day);
  }
  const monthDays = new Set<number>();
  for (const token of (values.get("BYMONTHDAY")?.split(",") ?? [])) {
    const value = Number(token);
    if (!Number.isInteger(value) || value === 0 || value < -31 || value > 31) return undefined;
    monthDays.add(value);
  }
  const months = new Set<number>();
  for (const token of (values.get("BYMONTH")?.split(",") ?? [])) {
    const value = Number(token);
    if (!Number.isInteger(value) || value < 1 || value > 12) return undefined;
    months.add(value);
  }
  return { frequency, interval, weekdays, ordinalWeekdays, monthDays, months };
}

function matchesRule(date: Date, anchor: Date, rule: ParsedRule): boolean {
  if (date < anchor || (rule.months.size > 0 && !rule.months.has(date.getUTCMonth() + 1))) return false;
  const days = Math.floor((date.getTime() - anchor.getTime()) / 86_400_000);
  const months = (date.getUTCFullYear() - anchor.getUTCFullYear()) * 12 + date.getUTCMonth() - anchor.getUTCMonth();
  const years = date.getUTCFullYear() - anchor.getUTCFullYear();
  if (rule.frequency === "daily" && days % rule.interval !== 0) return false;
  if (rule.frequency === "weekly") {
    const anchorWeek = addDays(anchor, 1 - weekday(anchor));
    const dateWeek = addDays(date, 1 - weekday(date));
    if (Math.floor((dateWeek.getTime() - anchorWeek.getTime()) / 604_800_000) % rule.interval !== 0) return false;
  }
  if (rule.frequency === "monthly" && (months < 0 || months % rule.interval !== 0)) return false;
  if (rule.frequency === "yearly" && (years < 0 || years % rule.interval !== 0)) return false;
  if (rule.weekdays.size > 0 && !rule.weekdays.has(weekday(date))) return false;
  if (rule.ordinalWeekdays.size > 0) {
    const fromStart = Math.floor((date.getUTCDate() - 1) / 7) + 1;
    const monthEnd = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    const fromEnd = -(Math.floor((monthEnd - date.getUTCDate()) / 7) + 1);
    if (!rule.ordinalWeekdays.get(fromStart)?.has(weekday(date)) && !rule.ordinalWeekdays.get(fromEnd)?.has(weekday(date))) return false;
  }
  const day = date.getUTCDate();
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  if (rule.monthDays.size > 0 && !rule.monthDays.has(day) && !rule.monthDays.has(day - lastDay - 1)) return false;
  if (rule.weekdays.size === 0 && rule.ordinalWeekdays.size === 0 && rule.monthDays.size === 0) {
    if (rule.frequency === "weekly" && weekday(date) !== weekday(anchor)) return false;
    if (rule.frequency === "monthly" && dateText(date) !== dateText(addMonths(anchor, months))) return false;
    if (rule.frequency === "yearly" && dateText(date) !== dateText(addYears(anchor, years))) return false;
  }
  return true;
}

export function taskRecurrenceDate(marker: TaskRecurrenceMarker, ordinal: number): string | undefined {
  if (!integer(ordinal) || ordinal < 0 || validate(marker)) return undefined;
  const anchor = dateAt(marker.anchorDate);
  if (marker.recurrenceRule) {
    const rule = parseDateOnlyRule(marker.recurrenceRule);
    if (!rule) return undefined;
    const excluded = new Set(marker.exclusionDates);
    const additions = new Set(marker.additionDates);
    let seen = 0;
    const horizon = addYears(anchor, 1_000);
    for (let current = anchor; current <= horizon; current = addDays(current, 1)) {
      const text = dateText(current);
      if (excluded.has(text) || (!additions.has(text) && !matchesRule(current, anchor, rule))) continue;
      if (seen === ordinal) return text;
      seen += 1;
      if (seen > 10_000) return undefined;
    }
    return undefined;
  }
  if (marker.frequency === "daily") return dateText(addDays(anchor, marker.interval * ordinal));
  if (marker.frequency === "weekly") return dateText(addDays(anchor, marker.interval * ordinal * 7));
  if (marker.frequency === "monthly") return dateText(addMonths(anchor, marker.interval * ordinal));
  return dateText(addYears(anchor, marker.interval * ordinal));
}

export function taskRecurrenceSuccessor(marker: TaskRecurrenceMarker): TaskRecurrenceMarker | undefined {
  if (marker.ordinal >= 2_147_483_647 || validate(marker)) return undefined;
  const ordinal = marker.ordinal + 1;
  const templateDueDate = taskRecurrenceDate(marker, ordinal);
  if (!templateDueDate || (marker.end.kind === "until" && templateDueDate > marker.end.untilDate) || (marker.end.kind === "count" && ordinal >= marker.end.count)) return undefined;
  return { ...marker, ordinal, occurrenceId: `${marker.seriesId}:${ordinal}`, templateDueDate };
}

export function taskRecurrenceSummary(marker: TaskRecurrenceMarker): string {
  if (marker.recurrenceRule) return `Custom: ${marker.recurrenceRule}${marker.exclusionDates.length ? ` · skips ${marker.exclusionDates.length} date(s)` : ""}${marker.additionDates.length ? ` · adds ${marker.additionDates.length} date(s)` : ""}`;
  const plural = marker.frequency === "daily" ? "days" : `${marker.frequency}s`;
  let summary = marker.interval === 1 ? `Every ${marker.frequency}` : `Every ${marker.interval} ${plural}`;
  if (marker.end.kind === "until") summary += ` until ${marker.end.untilDate}`;
  if (marker.end.kind === "count") summary += ` for ${marker.end.count} occurrences`;
  return summary;
}
