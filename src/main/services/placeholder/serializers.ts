import type {
  CalendarEventDetail,
  CalendarEventRecurrence,
  CalendarEventSummary,
  NoteDetail,
  NoteSummary,
  TaskDetail,
  TaskSummary
} from "@shared/ipc/contracts";
import type {
  DomainJsonObject,
  DomainJsonValue
} from "../domainInterfaces";
import type { CalendarRecord, TaskRecord } from "./state";

export function taskSummary(task: TaskRecord): TaskSummary {
  return {
    id: task.id,
    listId: task.listId,
    title: task.title,
    status: task.status,
    dueAt: task.dueAt,
    updatedAt: task.updatedAt,
    notes: task.notes,
    parentId: task.parentId,
    priority: "none",
    mutationState: "synced"
  };
}

export function taskDetail(task: TaskRecord): TaskDetail {
  return {
    ...taskSummary(task),
    notes: task.notes,
    parentId: task.parentId
  };
}

export function calendarSummary(event: CalendarRecord): CalendarEventSummary {
  return {
    id: event.id,
    eventId: event.eventId ?? event.id,
    calendarId: event.calendarId,
    title: event.title,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    allDay: event.allDay,
    updatedAt: event.updatedAt,
    completedAt: event.completedAt ?? null,
    location: event.location ?? "",
    notes: event.notes ?? "",
    guestEmails: event.guestEmails ?? [],
    reminderMinutes: event.reminderMinutes ?? [],
    attendees: event.attendees ?? event.guestEmails?.map((email) => ({ email })) ?? [],
    reminders: event.reminders ?? event.reminderMinutes?.map((minutes) => ({ method: "popup", minutes })) ?? [],
    remindersUseDefault: event.remindersUseDefault ?? false,
    transparency: event.transparency ?? null,
    visibility: event.visibility ?? null,
    timeZone: event.timeZone ?? null,
    recurrenceRule: event.recurrenceRule ?? null,
    recurringEventId: event.recurringEventId ?? null,
    originalStartAt: event.originalStartAt ?? null
  };
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

  if (recurrence.frequency === "monthly" && recurrence.bySetPos) {
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

export function calendarDetail(event: CalendarRecord): CalendarEventDetail {
  return {
    ...calendarSummary(event),
    calendarTitle: event.calendarTitle,
    deepLink: `hotcrossbuns://event/${event.id}`
  };
}

export function noteSummary(note: NoteDetail): NoteSummary {
  return {
    id: note.id,
    listId: note.listId,
    listTitle: note.listTitle,
    title: note.title,
    preview: note.preview,
    updatedAt: note.updatedAt
  };
}

export function taskJson(task: TaskRecord): DomainJsonObject {
  return {
    kind: "task",
    ...jsonObject(taskDetail(task)),
    listTitle: task.listTitle,
    deepLink: `hotcrossbuns://task/${task.id}`
  };
}

export function calendarJson(event: CalendarRecord): DomainJsonObject {
  return {
    kind: "event",
    ...jsonObject(calendarSummary(event)),
    calendarTitle: event.calendarTitle,
    location: event.location ?? "",
    notes: event.notes ?? "",
    deepLink: `hotcrossbuns://event/${event.id}`
  };
}

export function noteJson(note: NoteDetail): DomainJsonObject {
  return {
    kind: "note",
    ...jsonObject(note),
    deepLink: `hotcrossbuns://note/${note.id}`
  };
}

function jsonObject(value: Record<string, unknown>): DomainJsonObject {
  const output: DomainJsonObject = {};

  for (const [key, child] of Object.entries(value)) {
    output[key] = jsonValue(child);
  }

  return output;
}

function jsonValue(value: unknown): DomainJsonValue {
  if (value === undefined) {
    return null;
  }

  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(jsonValue);
  }

  if (typeof value === "object") {
    return jsonObject(value as Record<string, unknown>);
  }

  return null;
}
