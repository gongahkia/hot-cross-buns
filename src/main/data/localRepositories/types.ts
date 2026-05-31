import type { SearchResultItem, TaskPriority } from "@shared/ipc/contracts";

export interface PageWindow<T> {
  items: T[];
  page: {
    limit: number;
    nextCursor?: string;
    totalKnown: number;
  };
}

export type SearchDomain = SearchResultItem["domain"];

export interface TaskListRow extends Record<string, unknown> {
  id: string;
  accountId?: string;
  googleId?: string;
  title: string;
  updatedAt: string;
  taskCount: number;
  activeTaskCount: number;
  sortOrder?: number;
  etag?: string | null;
}

export interface TaskRow extends Record<string, unknown> {
  id: string;
  accountId?: string;
  googleId?: string;
  listId: string;
  listGoogleId?: string;
  listTitle: string;
  title: string;
  status: "needsAction" | "completed";
  notes: string | null;
  dueAt: string | null;
  parentId: string | null;
  deletedAt?: string | null;
  isHidden?: number;
  priority?: TaskPriority | null;
  sortOrder?: number;
  etag?: string | null;
  pendingMutationStatus?: "pending" | "applying" | "failed" | null;
  updatedAt: string;
  plannedStart?: string | null;
  plannedEnd?: string | null;
  durationMinutes?: number | null;
  lockedSchedule?: number | null;
  snoozeUntil?: string | null;
  tagsJson?: string | null;
}

export interface CalendarListRow extends Record<string, unknown> {
  id: string;
  title: string;
  selected: number;
  timeZone: string | null;
  backgroundColor: string | null;
  foregroundColor: string | null;
  updatedAt: string;
  eventCount: number;
}

export interface CalendarEventRow extends Record<string, unknown> {
  id: string;
  eventId: string;
  accountId: string;
  calendarId: string;
  calendarTitle: string;
  title: string;
  startsAt: string;
  endsAt: string;
  allDay: number;
  updatedAt: string;
  location: string | null;
  notes: string | null;
  guestEmailsJson: string | null;
  reminderMinutesJson: string | null;
  pendingMutationStatus?: "pending" | "applying" | "failed" | null;
  timeZone: string | null;
  recurrenceRule: string | null;
  colorId: string | null;
  recurringEventId: string | null;
  originalStartAt: string | null;
}

export interface CalendarRow extends Record<string, unknown> {
  id: string;
  accountId: string;
  googleId: string;
  title: string;
  timeZone: string | null;
  accessRole: string | null;
}

export interface ScheduledTaskBlockRow extends Record<string, unknown> {
  id: string;
  taskId: string;
  calendarEventId: string;
  calendarId: string;
  title: string | null;
  startsAt: string;
  endsAt: string;
  durationMinutes: number;
  status: "scheduled" | "orphaned";
  pendingMutationStatus?: "pending" | "applying" | "failed" | null;
  updatedAt: string;
}

export interface NoteRow extends Record<string, unknown> {
  id: string;
  listId: string;
  listTitle: string;
  title: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface NoteListRow extends Record<string, unknown> {
  id: string;
  title: string;
  updatedAt: string;
  noteCount: number;
}
