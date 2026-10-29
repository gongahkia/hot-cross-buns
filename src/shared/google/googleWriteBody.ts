import { CoreStoreError } from "../core/coreStoreError";
import { googleCalendarEventColorIdForApi } from "@shared/ipc/contracts";
import { googleTaskNotesMaxLength, googleTaskTitleMaxLength, withHcbTaskMetadata } from "../core/hcbTaskMetadata";
import { googleSyncFields, type GoogleEntityKind, type SyncFields } from "./syncMerge";

type JsonRecord = Record<string, any>;

/** Projection only: local persistence must remain possible even over API limits. */
export function localGoogleSyncFields(kind: GoogleEntityKind, record: JsonRecord, fallback?: SyncFields): SyncFields {
  const body = kind === "task" ? googleTaskBody(record, false) : kind === "event" ? googleEventBody(record) : { title: record.title };
  if (kind === "task") body.notes = withHcbTaskMetadata(record.notes, record, { includeDefaults: true });
  return googleSyncFields(kind, body, fallback);
}

/** Overlay editable fields while retaining local IDs, ordering and commands. */
export function localRecordWithGoogleFields(kind: GoogleEntityKind, record: JsonRecord, fields: SyncFields): JsonRecord {
  if (kind === "taskList") return { ...record, title: fields.title };
  if (kind === "task") return {
    ...record, title: fields.title, notes: fields.notes, dueAt: fields.due,
    status: fields.status === "completed" ? "completed" : "active",
    priority: fields.priority, tags: fields.tags, ...fields.planning, snoozeUntil: fields.snoozeUntil
  };
  const start = fields.time.start, end = fields.time.end;
  return {
    ...record, title: fields.summary, description: fields.description, location: fields.location, colorId: fields.colorId,
    startsAt: start.date ? `${start.date}T00:00:00.000Z` : start.dateTime,
    endsAt: end.date ? `${end.date}T00:00:00.000Z` : end.dateTime,
    allDay: Boolean(start.date), timeZone: start.timeZone ?? null,
    recurrenceLines: fields.recurrence, googleRecurrence: fields.recurrence,
    attendees: fields.attendees, remindersUseDefault: fields.reminders.useDefault,
    reminders: fields.reminders.overrides ?? [], transparency: fields.transparency, visibility: fields.visibility,
    eventType: fields.eventType.type, focusTimeProperties: fields.eventType.focusTimeProperties,
    outOfOfficeProperties: fields.eventType.outOfOfficeProperties, workingLocationProperties: fields.eventType.workingLocationProperties,
    attachments: fields.attachments
  };
}

export function googleTaskBody(task: JsonRecord, validate = true): JsonRecord {
  const due = googleTaskDue(task.dueAt);
  const notes = withHcbTaskMetadata(task.notes, task);
  if (validate) validateGoogleTaskBody({ title: task.title, notes });
  return {
    title: task.title,
    notes,
    // Google Tasks accepts an RFC 3339 timestamp here (although it only
    // retains the calendar-date portion). HCB intentionally stores task
    // dates as date-only values, so normalize those before writing. PATCH
    // removes an optional field only when explicitly set to null.
    ...(due ? { due } : task.googleId ? { due: null } : {}),
    status: task.status === "completed" ? "completed" : "needsAction"
  };
}

export function validateGoogleTaskBody(body: JsonRecord): void {
  if (String(body.title ?? "").length > googleTaskTitleMaxLength) {
    throw new CoreStoreError(`Google Tasks titles are limited to ${googleTaskTitleMaxLength} characters.`);
  }
  if (String(body.notes ?? "").length > googleTaskNotesMaxLength) {
    throw new CoreStoreError(`Google Tasks notes, including HCB planning metadata, are limited to ${googleTaskNotesMaxLength} characters.`);
  }
}

function googleTaskDue(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const normalized = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return `${normalized}T00:00:00.000Z`;
  return Number.isFinite(Date.parse(normalized)) ? new Date(normalized).toISOString() : undefined;
}

export function googleEventBody(event: JsonRecord, createId?: string): JsonRecord {
  // RFC 5545 lines are HCB's canonical Calendar recurrence value. The
  // structured recurrence remains only for old local records and is promoted
  // during the next write; no imported Google recurrence is projected down.
  const recurrence = preservedGoogleRecurrence(event.recurrenceLines)
    ?? preservedGoogleRecurrence(event.googleRecurrence)
    ?? googleRecurrence(event.recurrence);
  const eventType = event.eventType === "focusTime" || event.eventType === "outOfOffice" || event.eventType === "workingLocation"
    ? event.eventType
    : "default";
  return {
    ...(createId ? { id: createId, extendedProperties: { private: { hcbLocalEventId: event.id } } } : {}),
    summary: event.title,
    // An empty editor is an explicit clear. Omitting it from PATCH preserves
    // Google's old description and brings it back on the following pull.
    description: event.description ?? "",
    location: event.location || undefined,
    colorId: googleCalendarEventColorIdForApi(event.colorId),
    start: googleEventTime(event.startsAt, Boolean(event.allDay), event.timeZone),
    end: googleEventTime(event.endsAt, Boolean(event.allDay), event.timeZone),
    recurrence: recurrence ?? [],
    attendees: normalizeAttendees(event.attendees),
    reminders: {
      useDefault: Boolean(event.remindersUseDefault),
      ...(event.remindersUseDefault ? {} : { overrides: safeArray(event.reminders) })
    },
    transparency: event.transparency || "opaque",
    visibility: event.visibility || "default",
    ...(eventType !== "default" ? { eventType } : {}),
    ...(eventType === "focusTime" && event.focusTimeProperties ? { focusTimeProperties: event.focusTimeProperties } : {}),
    ...(eventType === "outOfOffice" && event.outOfOfficeProperties ? { outOfOfficeProperties: event.outOfOfficeProperties } : {}),
    ...(eventType === "workingLocation" && event.workingLocationProperties ? { workingLocationProperties: event.workingLocationProperties } : {}),
    ...(event.attachmentsManaged ? { attachments: calendarAttachments(event.attachments) } : {}),
    ...(event.conferenceCreateRequested && !event.conference?.videoUri ? {
      conferenceData: {
        createRequest: {
          requestId: `hcb-${String(event.id).replace(/[^a-zA-Z0-9-]/g, "").slice(0, 100)}`,
          conferenceSolutionKey: { type: "hangoutsMeet" }
        }
      }
    } : {})
  };
}

function calendarAttachments(value: unknown): JsonRecord[] {
  return safeArray(value)
    .filter((attachment) => typeof attachment.fileUrl === "string" && /^https:\/\//i.test(attachment.fileUrl))
    .map((attachment) => ({
      fileUrl: attachment.fileUrl,
      title: typeof attachment.title === "string" && attachment.title ? attachment.title : attachment.fileUrl,
      ...(typeof attachment.mimeType === "string" ? { mimeType: attachment.mimeType } : {})
    }));
}

function googleEventTime(value: string, allDay: boolean, timeZone: unknown): JsonRecord {
  const zone = typeof timeZone === "string" && timeZone ? { timeZone } : {};
  if (!allDay) return { dateTime: value, ...zone };
  return { date: value.slice(0, 10), ...zone };
}

function googleRecurrence(value: unknown): string[] | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as JsonRecord;
  const frequency = String(record.frequency ?? "").toUpperCase();
  if (!new Set(["DAILY", "WEEKLY", "MONTHLY", "YEARLY"]).has(frequency)) return undefined;
  const fields = [`FREQ=${frequency}`, `INTERVAL=${Math.max(1, Number(record.interval) || 1)}`];
  if (Array.isArray(record.byDay) && record.byDay.length) fields.push(`BYDAY=${record.byDay.join(",")}`);
  if (record.byMonthDay) fields.push(`BYMONTHDAY=${record.byMonthDay}`);
  if (record.bySetPos) fields.push(`BYSETPOS=${record.bySetPos}`);
  if (record.endsOn) fields.push(`UNTIL=${String(record.endsOn).replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")}`);
  if (record.count) fields.push(`COUNT=${record.count}`);
  return [`RRULE:${fields.join(";")}`];
}

function preservedGoogleRecurrence(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const lines = value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
  return lines.length > 0 ? lines : [];
}

function normalizeAttendees(value: unknown): JsonRecord[] | undefined {
  const entries = safeArray(value)
    .map((entry) => typeof entry === "string" ? { email: entry } : entry)
    .filter((entry): entry is JsonRecord => Boolean(entry) && typeof entry === "object" && typeof entry.email === "string");
  return entries.length ? entries : undefined;
}


function safeArray(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.filter((entry): entry is JsonRecord => Boolean(entry) && typeof entry === "object") : [];
}
