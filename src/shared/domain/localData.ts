export type ISODateTimeString = string;
export type JsonScalar = string | number | boolean | null;
export type JsonValue = JsonScalar | JsonValue[] | { [key: string]: JsonValue };

export interface AccountMetadata {
  id: string;
  googleAccountId: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  locale: string | null;
  timeZone: string | null;
  connectionStatus: "signed_out" | "connected" | "reauth_required" | "sync_paused";
  lastAuthenticatedAt: ISODateTimeString | null;
  createdAt: ISODateTimeString;
  updatedAt: ISODateTimeString;
  deletedAt: ISODateTimeString | null;
}

export interface NoteRecord {
  id: string;
  title: string;
  body: string;
  linkedTaskId: string | null;
  linkedEventId: string | null;
  linkedListId: string | null;
  linkedCalendarId: string | null;
  createdAt: ISODateTimeString;
  updatedAt: ISODateTimeString;
  deletedAt: ISODateTimeString | null;
}

export interface CreateNoteInput {
  id?: string;
  title: string;
  body?: string;
  linkedTaskId?: string | null;
  linkedEventId?: string | null;
  linkedListId?: string | null;
  linkedCalendarId?: string | null;
  now?: ISODateTimeString;
}

export interface UpdateNoteInput {
  title?: string;
  body?: string;
  linkedTaskId?: string | null;
  linkedEventId?: string | null;
  linkedListId?: string | null;
  linkedCalendarId?: string | null;
  now?: ISODateTimeString;
}

export type SettingScope =
  | "app"
  | "account"
  | "sync"
  | "appearance"
  | "hotkeys"
  | "tray"
  | "dock"
  | "notifications"
  | "sounds"
  | "filters"
  | "portable"
  | "backups"
  | "history"
  | "duplicates"
  | "templates"
  | "updates"
  | "mcp";

export interface SettingRecord<T extends JsonValue = JsonValue> {
  scope: SettingScope;
  key: string;
  value: T;
  updatedAt: ISODateTimeString;
}

export type SyncResourceType =
  | "tasks"
  | "task_list"
  | "calendar"
  | "calendar_list"
  | "calendar_event";

export type SyncCheckpointType = "sync_token" | "page_token" | "watermark" | "updated_min";

export interface SyncCheckpointRecord {
  id: string;
  accountId: string;
  resourceType: SyncResourceType;
  resourceId: string;
  checkpointType: SyncCheckpointType;
  checkpointValue: string;
  metadata: JsonValue;
  updatedAt: ISODateTimeString;
}

export interface SaveSyncCheckpointInput {
  id?: string;
  accountId: string;
  resourceType: SyncResourceType;
  resourceId?: string | null;
  checkpointType: SyncCheckpointType;
  checkpointValue: string;
  metadata?: JsonValue;
  now?: ISODateTimeString;
}

export type PendingMutationResourceType = "task" | "event" | "note" | "setting";
export type PendingMutationStatus = "pending" | "applying" | "failed" | "applied" | "cancelled";

export interface PendingMutationRecord {
  id: string;
  accountId: string | null;
  resourceType: PendingMutationResourceType;
  resourceId: string;
  operation: string;
  payload: JsonValue;
  status: PendingMutationStatus;
  attemptCount: number;
  nextRetryAt: ISODateTimeString | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  createdAt: ISODateTimeString;
  updatedAt: ISODateTimeString;
  appliedAt: ISODateTimeString | null;
}

export interface EnqueuePendingMutationInput {
  id?: string;
  accountId?: string | null;
  resourceType: PendingMutationResourceType;
  resourceId: string;
  operation: string;
  payload: JsonValue;
  nextRetryAt?: ISODateTimeString | null;
  now?: ISODateTimeString;
}

export interface TaskListMirrorRecord {
  id: string;
  accountId: string;
  googleId: string;
  title: string;
  etag: string | null;
  sortOrder: number;
  isSelected: boolean;
  syncStatus: string;
  googleUpdatedAt: ISODateTimeString | null;
  createdAt: ISODateTimeString;
  updatedAt: ISODateTimeString;
  deletedAt: ISODateTimeString | null;
}

export interface UpsertTaskListMirrorInput {
  id: string;
  accountId: string;
  googleId: string;
  title: string;
  etag?: string | null;
  sortOrder?: number;
  isSelected?: boolean;
  syncStatus?: string;
  googleUpdatedAt?: ISODateTimeString | null;
  now?: ISODateTimeString;
  deletedAt?: ISODateTimeString | null;
}

export type TaskMirrorStatus = "needsAction" | "completed";

export interface TaskMirrorRecord {
  id: string;
  accountId: string;
  taskListId: string;
  googleId: string;
  parentTaskId: string | null;
  title: string;
  notes: string | null;
  status: TaskMirrorStatus;
  dueAt: ISODateTimeString | null;
  dueTimeZone: string | null;
  completedAt: ISODateTimeString | null;
  position: string | null;
  sortOrder: number;
  isHidden: boolean;
  etag: string | null;
  googleUpdatedAt: ISODateTimeString | null;
  createdAt: ISODateTimeString;
  updatedAt: ISODateTimeString;
  deletedAt: ISODateTimeString | null;
}

export interface UpsertTaskMirrorInput {
  id: string;
  accountId: string;
  taskListId: string;
  googleId: string;
  parentTaskId?: string | null;
  title: string;
  notes?: string | null;
  status?: TaskMirrorStatus;
  dueAt?: ISODateTimeString | null;
  dueTimeZone?: string | null;
  completedAt?: ISODateTimeString | null;
  position?: string | null;
  sortOrder?: number;
  isHidden?: boolean;
  etag?: string | null;
  googleUpdatedAt?: ISODateTimeString | null;
  now?: ISODateTimeString;
  deletedAt?: ISODateTimeString | null;
}

export interface CalendarListMirrorRecord {
  id: string;
  accountId: string;
  googleId: string;
  summary: string;
  description: string | null;
  timeZone: string | null;
  backgroundColor: string | null;
  foregroundColor: string | null;
  accessRole: string | null;
  isSelected: boolean;
  isHidden: boolean;
  isPrimary: boolean;
  etag: string | null;
  googleUpdatedAt: ISODateTimeString | null;
  createdAt: ISODateTimeString;
  updatedAt: ISODateTimeString;
  deletedAt: ISODateTimeString | null;
}

export interface UpsertCalendarListMirrorInput {
  id: string;
  accountId: string;
  googleId: string;
  summary: string;
  description?: string | null;
  timeZone?: string | null;
  backgroundColor?: string | null;
  foregroundColor?: string | null;
  accessRole?: string | null;
  isSelected?: boolean;
  isHidden?: boolean;
  isPrimary?: boolean;
  etag?: string | null;
  googleUpdatedAt?: ISODateTimeString | null;
  now?: ISODateTimeString;
  deletedAt?: ISODateTimeString | null;
}

export type CalendarEventStatus = "confirmed" | "tentative" | "cancelled";

export interface CalendarEventMirrorRecord {
  id: string;
  accountId: string;
  calendarId: string;
  googleId: string;
  recurringEventId: string | null;
  originalStartAt: ISODateTimeString | null;
  status: CalendarEventStatus;
  summary: string;
  description: string | null;
  location: string | null;
  startAt: ISODateTimeString;
  startTimeZone: string | null;
  endAt: ISODateTimeString;
  endTimeZone: string | null;
  isAllDay: boolean;
  recurrenceRule: string | null;
  transparency: string | null;
  visibility: string | null;
  etag: string | null;
  sequence: number | null;
  googleUpdatedAt: ISODateTimeString | null;
  createdAt: ISODateTimeString;
  updatedAt: ISODateTimeString;
  deletedAt: ISODateTimeString | null;
}

export interface UpsertCalendarEventMirrorInput {
  id: string;
  accountId: string;
  calendarId: string;
  googleId: string;
  recurringEventId?: string | null;
  originalStartAt?: ISODateTimeString | null;
  status?: CalendarEventStatus;
  summary: string;
  description?: string | null;
  location?: string | null;
  startAt: ISODateTimeString;
  startTimeZone?: string | null;
  endAt: ISODateTimeString;
  endTimeZone?: string | null;
  isAllDay?: boolean;
  recurrenceRule?: string | null;
  transparency?: string | null;
  visibility?: string | null;
  etag?: string | null;
  sequence?: number | null;
  googleUpdatedAt?: ISODateTimeString | null;
  now?: ISODateTimeString;
  deletedAt?: ISODateTimeString | null;
}
