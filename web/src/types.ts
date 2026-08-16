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
}

export interface GoogleEventAttendee {
  readonly email: string;
  readonly displayName?: string;
  readonly responseStatus?: string;
  readonly organizer?: boolean;
  readonly self?: boolean;
}

export interface GoogleEventReminders {
  readonly useDefault: boolean;
  readonly overrides?: readonly { readonly method: "email" | "popup"; readonly minutes: number }[];
}

export interface GoogleConferenceData {
  readonly entryPoints?: readonly { readonly entryPointType?: string; readonly uri?: string }[];
}

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
