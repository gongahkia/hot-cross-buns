import type { JsonValue } from "@shared/domain/localData";
import type { HcbErrorCode } from "@shared/ipc/result";

export interface TaskWriteOptions {
  fullSync: boolean;
  now: string;
}

export interface CalendarEventWriteOptions {
  fullSync: boolean;
  now: string;
  defaultTimeZone?: string | null;
}

export interface GoogleSyncRepositoryOptions {
  defaultTimeZone?: string | null;
}

export interface GoogleCacheDiagnostics {
  taskListCount: number;
  taskCount: number;
  calendarCount: number;
  eventCount: number;
  noteCount: number;
  performanceSampleCount: number;
}

export interface GoogleCheckpointDiagnostics {
  totalCount: number;
  tasksCount: number;
  calendarCount: number;
  lastUpdatedAt?: string;
}

export interface PendingMutationDiagnostics {
  totalCount: number;
  pendingCount: number;
  applyingCount: number;
  failedCount: number;
  retryableCount: number;
  authPausedCount: number;
  nextRetryAt?: string;
  lastErrorCode?: HcbErrorCode;
  byResourceType: Array<{ resourceType: string; count: number }>;
}

export interface SelectedResourceDiagnostics {
  taskLists: Array<{ id: string; title: string; selected: boolean }>;
  calendars: Array<{ id: string; title: string; selected: boolean }>;
}

export type PendingGoogleMutationResourceType = "task" | "task_list" | "event";
export type PendingGoogleMutationStatus = "pending" | "applying" | "failed" | "applied" | "cancelled";

export interface PendingGoogleMutation {
  id: string;
  accountId: string | null;
  resourceType: PendingGoogleMutationResourceType;
  resourceId: string;
  operation: string;
  payload: JsonValue;
  status: PendingGoogleMutationStatus;
  attemptCount: number;
  nextRetryAt: string | null;
  lastErrorCode: HcbErrorCode | null;
  lastErrorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  appliedAt: string | null;
}

export interface TaskListMutationTarget extends Record<string, unknown> {
  id: string;
  accountId: string;
  googleId: string;
  title: string;
  etag: string | null;
  deletedAt: string | null;
}

export interface TaskMutationTarget extends Record<string, unknown> {
  id: string;
  accountId: string;
  googleId: string;
  taskListId: string;
  taskListGoogleId: string;
  parentTaskId: string | null;
  parentGoogleId: string | null;
  title: string;
  notes: string | null;
  status: "needsAction" | "completed";
  dueAt: string | null;
  completedAt: string | null;
  position: string | null;
  etag: string | null;
  deletedAt: string | null;
}

export interface CalendarMutationTarget extends Record<string, unknown> {
  id: string;
  accountId: string;
  googleId: string;
  summary: string;
  timeZone: string | null;
}

export interface CalendarEventMutationTarget extends Record<string, unknown> {
  id: string;
  accountId: string;
  googleId: string;
  calendarId: string;
  calendarGoogleId: string;
  hcbKind: "birthday" | null;
  summary: string;
  description: string | null;
  location: string | null;
  startAt: string;
  startTimeZone: string | null;
  endAt: string;
  endTimeZone: string | null;
  isAllDay: boolean;
  recurrenceRule: string | null;
  colorId: string | null;
  transparency: string | null;
  visibility: string | null;
  attendeeEmails: string[];
  reminderMinutes: number[];
  reminders: Array<{ method: "popup" | "email"; minutes: number }>;
  remindersUseDefault: boolean;
  etag: string | null;
  deletedAt: string | null;
}
