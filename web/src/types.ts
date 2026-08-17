export const GOOGLE_SCOPES = {
  identity: ["openid", "email", "profile"],
  tasks: "https://www.googleapis.com/auth/tasks",
  calendar: "https://www.googleapis.com/auth/calendar",
  driveMetadata: "https://www.googleapis.com/auth/drive.metadata.readonly"
} as const;

export const INITIAL_GOOGLE_SCOPES = [
  ...GOOGLE_SCOPES.identity,
  GOOGLE_SCOPES.tasks,
  GOOGLE_SCOPES.calendar
] as const;

export interface GoogleIdentity {
  readonly subject: string;
  readonly email?: string;
  readonly name?: string;
  readonly picture?: string;
}

export interface GoogleTaskList {
  readonly id: string;
  readonly title: string;
  readonly updated?: string;
}

export interface GoogleTask {
  readonly id: string;
  readonly listId: string;
  readonly title: string;
  readonly notes?: string;
  readonly status: "needsAction" | "completed";
  readonly due?: string;
  readonly completed?: string;
  readonly parent?: string;
  readonly position?: string;
  readonly updated?: string;
  readonly deleted?: boolean;
  readonly etag?: string;
}

export type TaskPriority = "none" | "low" | "medium" | "high";

/** Browser-local fields which Google Tasks cannot represent. */
export interface TaskMetadata {
  readonly taskId: string;
  readonly priority: TaskPriority;
  readonly dueTimeZone?: string;
  readonly updatedAt: string;
}

export interface ScheduledTaskBlock {
  readonly taskId: string;
  readonly calendarId: string;
  readonly eventId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface TaskInput {
  readonly title: string;
  readonly notes?: string;
  readonly due?: string;
  readonly parent?: string;
  readonly status?: GoogleTask["status"];
  readonly completed?: string;
}

export interface TaskMoveInput {
  readonly destinationListId?: string;
  readonly parent?: string;
  readonly previous?: string;
}

export interface GoogleCalendar {
  readonly id: string;
  readonly summary: string;
  readonly description?: string;
  readonly primary?: boolean;
  readonly backgroundColor?: string;
  readonly foregroundColor?: string;
  readonly timeZone?: string;
  readonly accessRole?: string;
  readonly deleted?: boolean;
}

export interface CalendarInput {
  readonly summary: string;
  readonly description?: string;
  readonly timeZone?: string;
}

export interface GoogleFreeBusyInterval {
  readonly start: string;
  readonly end: string;
}

export interface GoogleFreeBusyCalendar {
  readonly busy?: readonly GoogleFreeBusyInterval[];
  readonly errors?: readonly { readonly domain?: string; readonly reason?: string }[];
}

export interface GoogleFreeBusyResponse {
  readonly timeMin: string;
  readonly timeMax: string;
  readonly calendars: Readonly<Record<string, GoogleFreeBusyCalendar>>;
}

export interface GoogleEventDateTime {
  readonly date?: string;
  readonly dateTime?: string;
  readonly timeZone?: string;
}

export interface GoogleEventAttachment {
  readonly fileUrl: string;
  readonly title?: string;
  readonly mimeType?: string;
}

export interface GoogleCalendarEvent {
  readonly id: string;
  readonly calendarId: string;
  readonly summary: string;
  readonly description?: string;
  readonly location?: string;
  readonly start: GoogleEventDateTime;
  readonly end: GoogleEventDateTime;
  readonly status?: string;
  readonly updated?: string;
  readonly etag?: string;
  readonly recurrence?: readonly string[];
  readonly recurringEventId?: string;
  readonly originalStartTime?: GoogleEventDateTime;
  readonly attendees?: readonly GoogleEventAttendee[];
  readonly reminders?: GoogleEventReminders;
  readonly conferenceData?: GoogleConferenceData;
  readonly attachments?: readonly GoogleEventAttachment[];
  readonly transparency?: "opaque" | "transparent";
  readonly visibility?: "default" | "public" | "private" | "confidential";
  readonly colorId?: string;
  readonly guestsCanInviteOthers?: boolean;
  readonly guestsCanModify?: boolean;
  readonly guestsCanSeeOtherGuests?: boolean;
  readonly eventType?: GoogleEventType;
  readonly focusTimeProperties?: GoogleFocusTimeProperties;
  readonly outOfOfficeProperties?: GoogleOutOfOfficeProperties;
  readonly workingLocationProperties?: GoogleWorkingLocationProperties;
}

export interface GoogleEventAttendee {
  readonly email: string;
  readonly displayName?: string;
  readonly responseStatus?: string;
  readonly organizer?: boolean;
  readonly self?: boolean;
  readonly comment?: string;
}

export interface GoogleEventReminders {
  readonly useDefault: boolean;
  readonly overrides?: readonly { readonly method: "email" | "popup"; readonly minutes: number }[];
}

export interface GoogleConferenceData {
  readonly entryPoints?: readonly { readonly entryPointType?: string; readonly uri?: string }[];
}

export type GoogleEventType = "default" | "focusTime" | "outOfOffice" | "workingLocation";

export interface GoogleFocusTimeProperties {
  readonly autoDeclineMode?: "declineNone" | "declineAllConflictingInvitations" | "declineOnlyNewConflictingInvitations";
  readonly chatStatus?: "available" | "doNotDisturb";
  readonly declineMessage?: string;
}

export interface GoogleOutOfOfficeProperties {
  readonly autoDeclineMode?: "declineNone" | "declineAllConflictingInvitations" | "declineOnlyNewConflictingInvitations";
  readonly declineMessage?: string;
}

export interface GoogleWorkingLocationProperties {
  readonly type: "homeOffice" | "officeLocation" | "customLocation";
  readonly officeLocation?: {
    readonly buildingId?: string;
    readonly deskId?: string;
    readonly floorId?: string;
    readonly floorSectionId?: string;
    readonly label?: string;
  };
  readonly customLocation?: { readonly label?: string };
}

export type SendUpdates = "all" | "externalOnly" | "none";

export interface GoogleDriveFile {
  readonly id: string;
  readonly name: string;
  readonly mimeType?: string;
  readonly webViewLink?: string;
  readonly iconLink?: string;
}

export interface CalendarEventInput {
  readonly summary: string;
  readonly description?: string;
  readonly location?: string;
  readonly start: GoogleEventDateTime;
  readonly end: GoogleEventDateTime;
  readonly recurrence?: readonly string[];
  readonly attendees?: readonly { readonly email: string }[];
  readonly reminders?: GoogleEventReminders;
  readonly attachments?: readonly GoogleEventAttachment[];
  readonly createGoogleMeet?: boolean;
  readonly visibility?: GoogleCalendarEvent["visibility"];
  readonly transparency?: GoogleCalendarEvent["transparency"];
  readonly colorId?: string;
  readonly guestsCanInviteOthers?: boolean;
  readonly guestsCanModify?: boolean;
  readonly guestsCanSeeOtherGuests?: boolean;
  readonly eventType?: GoogleEventType;
  readonly focusTimeProperties?: GoogleFocusTimeProperties;
  readonly outOfOfficeProperties?: GoogleOutOfOfficeProperties;
  readonly workingLocationProperties?: GoogleWorkingLocationProperties;
  readonly sendUpdates?: SendUpdates;
}

export type NotesProjectionMode = "disabled" | "notes-only" | "mirrored";
export type ConflictPolicy = "prefer-google" | "prefer-local" | "ask";

export interface WorkspacePreferences {
  readonly schemaVersion: 1;
  readonly notesProjectionMode: NotesProjectionMode;
  readonly conflictPolicy: ConflictPolicy;
  readonly appearance: "system" | "light" | "dark";
  readonly density: "comfortable" | "compact";
  readonly accentColor: string;
  readonly fontFamily: "system" | "serif" | "monospace";
  readonly fontScale: number;
  readonly taskListPaneWidth: number;
  readonly weekStartsOn: 0 | 1 | 6;
  readonly hourCycle: "h12" | "h23";
  readonly displayTimeZone: string;
  readonly workdayStartHour: number;
  readonly workdayEndHour: number;
  readonly visibleCalendarIds: readonly string[];
  readonly undoRetentionDays: number;
  readonly undoMaximumEntries: number;
  readonly quickCapture: QuickCapturePreferences;
}

export interface QuickCapturePreferences {
  readonly defaultTaskListId?: string;
  readonly defaultCalendarId?: string;
  readonly defaultEventDurationMinutes: number;
  readonly removeRecognizedText: boolean;
  readonly taskAliases: readonly string[];
  readonly eventAliases: readonly string[];
  readonly highPriorityAliases: readonly string[];
  readonly mediumPriorityAliases: readonly string[];
  readonly lowPriorityAliases: readonly string[];
}

export interface SavedSearch {
  readonly id: string;
  readonly name: string;
  readonly query: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface WorkspaceConflict {
  readonly id: string;
  readonly resourceKind: "task" | "event";
  readonly operation: "update" | "delete" | "respond";
  readonly resourceId: string;
  readonly calendarId?: string;
  readonly localIntent: unknown;
  readonly latestRemote: unknown;
  readonly etag?: string;
  readonly createdAt: string;
  readonly retryState: "pending" | "resolved";
  readonly reason: "conflict" | "gone" | "authorization";
}

export interface UndoEntry {
  readonly id: string;
  readonly label: string;
  readonly resourceKind: "task" | "event";
  readonly before: unknown;
  readonly after: unknown;
  readonly mutationIds: readonly string[];
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly state: "undoable" | "redoable";
}

export interface ReminderState {
  readonly id: string;
  readonly calendarId: string;
  readonly eventId: string;
  readonly triggerAt: string;
  readonly state: "dismissed" | "snoozed" | "delivered";
  readonly updatedAt: string;
}

export interface SyncCheckpoint {
  readonly resource: string;
  readonly token?: string;
  readonly updatedAt: string;
}

export type PendingMutation =
  | {
      readonly id: string;
      readonly subject: string;
      readonly kind: "task-create";
      readonly createdAt: string;
      readonly payload: { readonly listId: string; readonly temporaryId: string; readonly task: TaskInput };
    }
  | {
      readonly id: string;
      readonly subject: string;
      readonly kind: "task-update";
      readonly createdAt: string;
      readonly payload: { readonly listId: string; readonly taskId: string; readonly patch: Partial<GoogleTask> };
    }
  | {
      readonly id: string;
      readonly subject: string;
      readonly kind: "task-delete";
      readonly createdAt: string;
      readonly payload: { readonly listId: string; readonly taskId: string };
    }
  | {
      readonly id: string;
      readonly subject: string;
      readonly kind: "task-move";
      readonly createdAt: string;
      readonly payload: { readonly listId: string; readonly taskId: string; readonly move: TaskMoveInput };
    }
  | {
      readonly id: string;
      readonly subject: string;
      readonly kind: "task-list-create";
      readonly createdAt: string;
      readonly payload: { readonly temporaryId: string; readonly title: string };
    }
  | {
      readonly id: string;
      readonly subject: string;
      readonly kind: "task-list-update";
      readonly createdAt: string;
      readonly payload: { readonly listId: string; readonly title: string };
    }
  | {
      readonly id: string;
      readonly subject: string;
      readonly kind: "task-list-delete";
      readonly createdAt: string;
      readonly payload: { readonly listId: string };
    }
  | {
      readonly id: string;
      readonly subject: string;
      readonly kind: "event-create";
      readonly createdAt: string;
      readonly payload: { readonly calendarId: string; readonly temporaryId: string; readonly event: CalendarEventInput };
    }
  | {
      readonly id: string;
      readonly subject: string;
      readonly kind: "event-update";
      readonly createdAt: string;
      readonly payload: {
        readonly calendarId: string;
        readonly eventId: string;
        readonly patch: CalendarEventInput;
        readonly etag?: string;
      };
    }
  | {
      readonly id: string;
      readonly subject: string;
      readonly kind: "event-delete";
      readonly createdAt: string;
      readonly payload: { readonly calendarId: string; readonly eventId: string; readonly etag?: string };
    };

export interface WorkspaceSnapshot {
  readonly identity: GoogleIdentity;
  readonly taskLists: readonly GoogleTaskList[];
  readonly tasks: readonly GoogleTask[];
  readonly calendars: readonly GoogleCalendar[];
  readonly events: readonly GoogleCalendarEvent[];
  readonly updatedAt: string;
}
