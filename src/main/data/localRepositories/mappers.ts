import type {
  CalendarConference,
  CalendarEventDetail,
  CalendarEventSummary,
  CalendarListSummary,
  NoteDetail,
  NoteListSummary,
  NoteSummary,
  ScheduledTaskBlockSummary,
  TaskDetail,
  TaskListSummary,
  TaskSummary
} from "@shared/ipc/contracts";
import type { CalendarEventRow, CalendarListRow, NoteListRow, NoteRow, ScheduledTaskBlockRow, TaskListRow, TaskRow } from "./types";
import { parseNumberArray, parseStringArray } from "./shared";

const textLimits = {
  calendarTitle: 500,
  calendarColor: 32,
  eventTitle: 500,
  eventLocation: 1_000,
  eventNotes: 20_000,
  recurrenceRule: 1_000,
  timeZone: 120
} as const;

function parseConference(value: string | null | undefined): CalendarConference | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return null;
    }

    const source = parsed as Record<string, unknown>;
    const conference: CalendarConference = {};

    for (const key of [
      "solutionName",
      "videoUri",
      "videoLabel",
      "phoneUri",
      "phoneLabel",
      "phonePin",
      "moreUri",
      "moreLabel"
    ] as const) {
      const item = source[key];
      if (typeof item === "string" && item.trim().length > 0) {
        conference[key] = item.slice(0, conferenceTextLimit(key));
      }
    }

    return Object.keys(conference).length > 0 ? conference : null;
  } catch {
    return null;
  }
}

function conferenceTextLimit(key: keyof CalendarConference & string): number {
  if (key.endsWith("Uri")) {
    return 1_300;
  }

  if (key === "phonePin") {
    return 128;
  }

  return key === "solutionName" ? 200 : 512;
}

export function taskListSummary(row: TaskListRow): TaskListSummary {
  return {
    id: row.id,
    title: row.title,
    updatedAt: row.updatedAt,
    taskCount: row.taskCount,
    activeTaskCount: row.activeTaskCount
  };
}

export function taskSummary(row: TaskRow): TaskSummary {
  const status = taskStatusFromRow(row);

  return {
    id: row.id,
    listId: row.listId,
    title: row.title,
    status,
    dueAt: row.dueAt,
    updatedAt: row.updatedAt,
    notes: row.notes ?? undefined,
    parentId: row.parentId,
    priority: row.priority ?? "none",
    sortOrder: row.sortOrder,
    mutationState: mutationState(row.pendingMutationStatus),
    plannedStart: row.plannedStart ?? null,
    plannedEnd: row.plannedEnd ?? null,
    durationMinutes: row.durationMinutes ?? null,
    lockedSchedule: row.lockedSchedule === 1,
    snoozeUntil: row.snoozeUntil ?? null,
    tags: parseTagsJson(row.tagsJson)
  };
}

export function parseTagsJson(value: string | null | undefined): string[] {
  if (!value) {
    return [];
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((entry): entry is string => typeof entry === "string");
  } catch {
    return [];
  }
}

export function taskDetail(row: TaskRow): TaskDetail {
  return {
    ...taskSummary(row)
  };
}

export function calendarListSummary(row: CalendarListRow): CalendarListSummary {
  return {
    id: row.id,
    title: truncateText(row.title, textLimits.calendarTitle),
    selected: row.selected === 1,
    timeZone: truncateNullableText(row.timeZone, textLimits.timeZone),
    backgroundColor: googleColor(row.backgroundColor),
    foregroundColor: googleColor(row.foregroundColor),
    updatedAt: row.updatedAt,
    eventCount: row.eventCount
  };
}

export function calendarEventSummary(row: CalendarEventRow): CalendarEventSummary {
  return {
    id: row.id,
    eventId: row.eventId,
    linkedTaskId: row.linkedTaskId ?? undefined,
    calendarId: row.calendarId,
    title: truncateText(row.title, textLimits.eventTitle),
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    allDay: row.allDay === 1,
    updatedAt: row.updatedAt,
    completedAt: row.completedAt ?? null,
    location: truncateText(row.location ?? "", textLimits.eventLocation),
    notes: truncateText(row.notes ?? "", textLimits.eventNotes),
    guestEmails: parseStringArray(row.guestEmailsJson).slice(0, 50),
    reminderMinutes: parseNumberArray(row.reminderMinutesJson)
      .filter((minutes) => minutes >= 0 && minutes <= 28 * 24 * 60)
      .slice(0, 10),
    conference: parseConference(row.conferenceJson),
    mutationState: mutationState(row.pendingMutationStatus),
    timeZone: truncateNullableText(row.timeZone, textLimits.timeZone),
    recurrenceRule: truncateNullableText(row.recurrenceRule, textLimits.recurrenceRule),
    colorId: truncateNullableText(row.colorId, textLimits.calendarColor),
    recurringEventId: row.recurringEventId,
    originalStartAt: row.originalStartAt
  };
}

export function calendarEventDetail(row: CalendarEventRow): CalendarEventDetail {
  return {
    ...calendarEventSummary(row),
    calendarTitle: truncateText(row.calendarTitle, textLimits.calendarTitle),
    deepLink: `hotcrossbuns://event/${row.eventId}`
  };
}

export function scheduledTaskBlockSummary(row: ScheduledTaskBlockRow): ScheduledTaskBlockSummary {
  return {
    id: row.id,
    taskId: row.taskId,
    calendarEventId: row.calendarEventId,
    calendarId: row.calendarId,
    title: row.title ?? "Scheduled task",
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    durationMinutes: blockDurationMinutes(row),
    status: row.status,
    mutationState: mutationState(row.pendingMutationStatus),
    updatedAt: row.updatedAt
  };
}

export function blockDurationMinutes(row: ScheduledTaskBlockRow): number {
  const startMs = Date.parse(row.startsAt);
  const endMs = Date.parse(row.endsAt);

  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return row.durationMinutes;
  }

  return Math.max(1, Math.round((endMs - startMs) / 60_000));
}

export function availabilityLine(event: CalendarEventSummary): string {
  const label = event.allDay ? "All day" : `${event.startsAt} to ${event.endsAt}`;

  return `- ${label}: ${event.title}`;
}

export function noteSummary(row: NoteRow): NoteSummary {
  return {
    id: row.id,
    listId: row.listId,
    listTitle: row.listTitle,
    title: row.title,
    preview: preview(row.body),
    updatedAt: row.updatedAt
  };
}

export function noteDetail(row: NoteRow): NoteDetail {
  return {
    ...noteSummary(row),
    body: row.body
  };
}

export function noteListSummary(row: NoteListRow): NoteListSummary {
  return {
    id: row.id,
    title: row.title,
    noteCount: row.noteCount,
    updatedAt: row.updatedAt
  };
}

export function preview(body: string): string {
  const trimmed = body.trim();

  if (!trimmed) {
    return "Empty local note";
  }

  return trimmed.length > 120 ? `${trimmed.slice(0, 117)}...` : trimmed;
}

export function taskStatusFromRow(row: TaskRow): TaskSummary["status"] {
  if (row.deletedAt !== undefined && row.deletedAt !== null) {
    return "deleted";
  }

  if (row.status === "completed") {
    return "completed";
  }

  return row.isHidden === 1 ? "hidden" : "active";
}

export function mutationState(
  status: TaskRow["pendingMutationStatus"] | CalendarEventRow["pendingMutationStatus"]
): TaskSummary["mutationState"] {
  if (status === "failed") {
    return "failed";
  }

  if (status === "pending" || status === "applying") {
    return "queued";
  }

  return undefined;
}

function truncateNullableText(value: string | null | undefined, maxLength: number): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  return truncateText(value, maxLength);
}

function googleColor(value: string | null | undefined): string | null {
  const color = truncateNullableText(value, textLimits.calendarColor)?.trim() ?? null;

  if (!color || !/^#[0-9A-Fa-f]{6}$/.test(color)) {
    return null;
  }

  return color;
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  if (maxLength <= 3) {
    return value.slice(0, maxLength);
  }

  return `${value.slice(0, maxLength - 3).trimEnd()}...`;
}
