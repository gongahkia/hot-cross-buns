import type {
  CalendarInput,
  CalendarEventInput,
  GoogleCalendar,
  GoogleCalendarEvent,
  GoogleDriveFile,
  GoogleEventAttachment,
  GoogleFreeBusyResponse,
  GoogleTask,
  GoogleTaskList,
  TaskInput,
  TaskMoveInput
} from "@/types";

const GOOGLE_API = "https://www.googleapis.com";

export class GoogleApiError extends Error {
  readonly status: number;
  readonly retryable: boolean;

  constructor(status: number, message: string) {
    super(message);
    this.name = "GoogleApiError";
    this.status = status;
    this.retryable = status === 408 || status === 429 || status >= 500;
  }
}

export class GoogleAuthorizationRequiredError extends Error {
  constructor() {
    super("Authorize Google again to continue syncing");
    this.name = "GoogleAuthorizationRequiredError";
  }
}

type TokenProvider = () => string | undefined;

export interface GoogleSyncPage<T> {
  readonly items: readonly T[];
  readonly nextSyncToken?: string;
}

export interface GooglePage<T> extends GoogleSyncPage<T> {
  readonly nextPageToken?: string;
}

interface GoogleListResponse<T> {
  readonly items?: readonly T[];
  readonly nextPageToken?: string;
  readonly nextSyncToken?: string;
}

interface RawTask {
  id: string;
  title?: string;
  notes?: string;
  status?: "needsAction" | "completed";
  due?: string;
  completed?: string;
  parent?: string;
  position?: string;
  updated?: string;
  deleted?: boolean;
  etag?: string;
}

interface RawCalendar {
  id: string;
  summary?: string;
  description?: string;
  primary?: boolean;
  backgroundColor?: string;
  foregroundColor?: string;
  timeZone?: string;
  accessRole?: string;
  deleted?: boolean;
  defaultReminders?: readonly { readonly method: "email" | "popup"; readonly minutes: number }[];
}

interface RawEvent extends Omit<GoogleCalendarEvent, "calendarId"> {
  readonly id: string;
}

function toTask(listId: string, task: RawTask): GoogleTask {
  return {
    id: task.id,
    listId,
    title: task.title ?? "",
    notes: task.notes,
    status: task.status ?? "needsAction",
    due: task.due,
    completed: task.completed,
    parent: task.parent,
    position: task.position,
    updated: task.updated,
    deleted: task.deleted,
    etag: task.etag
  };
}

function toCalendar(calendar: RawCalendar): GoogleCalendar {
  return {
    id: calendar.id,
    summary: calendar.summary ?? calendar.id,
    description: calendar.description,
    primary: calendar.primary,
    backgroundColor: calendar.backgroundColor,
    foregroundColor: calendar.foregroundColor,
    timeZone: calendar.timeZone,
    accessRole: calendar.accessRole,
    deleted: calendar.deleted,
    defaultReminders: calendar.defaultReminders
  };
}

function toEvent(calendarId: string, event: RawEvent): GoogleCalendarEvent {
  return { ...event, calendarId, summary: event.summary ?? "Untitled event" };
}

function escapeDriveQuery(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("'", "\\'");
}

function createEventPayload(input: CalendarEventInput): Record<string, unknown> {
  return {
    summary: input.summary,
    description: input.description,
    location: input.location,
    start: input.start,
    end: input.end,
    recurrence: input.recurrence,
    attendees: input.attendees,
    reminders: input.reminders,
    attachments: input.attachments,
    colorId: input.colorId,
    guestsCanInviteOthers: input.guestsCanInviteOthers,
    guestsCanModify: input.guestsCanModify,
    guestsCanSeeOtherGuests: input.guestsCanSeeOtherGuests,
    eventType: input.eventType,
    focusTimeProperties: input.focusTimeProperties,
    outOfOfficeProperties: input.outOfOfficeProperties,
    workingLocationProperties: input.workingLocationProperties,
    visibility: input.visibility,
    transparency: input.transparency,
    conferenceData: input.createGoogleMeet
      ? { createRequest: { requestId: crypto.randomUUID(), conferenceSolutionKey: { type: "hangoutsMeet" } } }
      : undefined
  };
}

export class GoogleApiClient {
  constructor(private readonly accessToken: TokenProvider) {}

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = this.accessToken();
    if (!token) {
      throw new GoogleAuthorizationRequiredError();
    }
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${token}`);
    if (init.body) {
      headers.set("Content-Type", "application/json");
    }
    const response = await fetch(`${GOOGLE_API}${path}`, { ...init, headers });
    if (response.status === 401) {
      throw new GoogleAuthorizationRequiredError();
    }
    if (!response.ok) {
      const body = (await response.json().catch(() => undefined)) as
        | { error?: { message?: string } }
        | undefined;
      throw new GoogleApiError(response.status, body?.error?.message ?? `Google API request failed (${response.status})`);
    }
    if (response.status === 204) {
      return undefined as T;
    }
    return (await response.json()) as T;
  }

  async listTaskLists(signal?: AbortSignal): Promise<GoogleTaskList[]> {
    const response = await this.listPages<GoogleTaskList>("/tasks/v1/users/@me/lists?maxResults=100", signal);
    return response.items.map((item) => ({ id: item.id, title: item.title, updated: item.updated }));
  }

  async createTaskList(title: string): Promise<GoogleTaskList> {
    return this.request<GoogleTaskList>("/tasks/v1/users/@me/lists", {
      method: "POST",
      body: JSON.stringify({ title })
    });
  }

  async updateTaskList(listId: string, title: string): Promise<GoogleTaskList> {
    return this.request<GoogleTaskList>(`/tasks/v1/users/@me/lists/${encodeURIComponent(listId)}`, {
      method: "PATCH",
      body: JSON.stringify({ title })
    });
  }

  async deleteTaskList(listId: string): Promise<void> {
    await this.request<void>(`/tasks/v1/users/@me/lists/${encodeURIComponent(listId)}`, { method: "DELETE" });
  }

  async listTasks(listId: string, updatedMin?: string): Promise<GoogleTask[]> {
    const parameters = new URLSearchParams({
      maxResults: "100",
      showCompleted: "true",
      showHidden: "true",
      showDeleted: "true"
    });
    if (updatedMin) {
      parameters.set("updatedMin", updatedMin);
    }
    const path = `/tasks/v1/lists/${encodeURIComponent(listId)}/tasks?${parameters.toString()}`;
    const response = await this.listPages<RawTask>(path);
    return response.items.map((item) => toTask(listId, item));
  }

  async listTasksPage(listId: string, updatedMin?: string, pageToken?: string, signal?: AbortSignal): Promise<GooglePage<GoogleTask>> {
    const parameters = new URLSearchParams({
      maxResults: "100",
      showCompleted: "true",
      showHidden: "true",
      showDeleted: "true"
    });
    if (updatedMin) {
      parameters.set("updatedMin", updatedMin);
    }
    if (pageToken) {
      parameters.set("pageToken", pageToken);
    }
    const response = await this.request<GoogleListResponse<RawTask>>(
      `/tasks/v1/lists/${encodeURIComponent(listId)}/tasks?${parameters.toString()}`,
      { signal }
    );
    return {
      items: (response.items ?? []).map((item) => toTask(listId, item)),
      nextPageToken: response.nextPageToken
    };
  }

  async createTask(listId: string, input: TaskInput): Promise<GoogleTask> {
    const task = await this.request<RawTask>(`/tasks/v1/lists/${encodeURIComponent(listId)}/tasks`, {
      method: "POST",
      body: JSON.stringify(input)
    });
    return toTask(listId, task);
  }

  async getTask(listId: string, taskId: string): Promise<GoogleTask> {
    const task = await this.request<RawTask>(`/tasks/v1/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`);
    return toTask(listId, task);
  }

  async updateTask(listId: string, taskId: string, patch: Partial<GoogleTask>, etag?: string): Promise<GoogleTask> {
    const task = await this.request<RawTask>(
      `/tasks/v1/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`,
      { method: "PATCH", headers: etag ? { "If-Match": etag } : undefined, body: JSON.stringify(patch) }
    );
    return toTask(listId, task);
  }

  async deleteTask(listId: string, taskId: string, etag?: string): Promise<void> {
    await this.request<void>(`/tasks/v1/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`, {
      method: "DELETE",
      headers: etag ? { "If-Match": etag } : undefined
    });
  }

  async moveTask(listId: string, taskId: string, move: TaskMoveInput): Promise<GoogleTask> {
    const parameters = new URLSearchParams();
    if (move.destinationListId) {
      parameters.set("destinationTasklist", move.destinationListId);
    }
    if (move.parent) {
      parameters.set("parent", move.parent);
    }
    if (move.previous) {
      parameters.set("previous", move.previous);
    }
    const suffix = parameters.size > 0 ? `?${parameters.toString()}` : "";
    const destinationListId = move.destinationListId ?? listId;
    const task = await this.request<RawTask>(
      `/tasks/v1/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}/move${suffix}`,
      { method: "POST" }
    );
    return toTask(destinationListId, task);
  }

  async listCalendars(): Promise<GoogleCalendar[]> {
    const response = await this.listCalendarChanges();
    return [...response.items];
  }

  async listCalendarChanges(syncToken?: string): Promise<GoogleSyncPage<GoogleCalendar>> {
    const parameters = new URLSearchParams({ maxResults: "250" });
    if (syncToken) {
      parameters.set("syncToken", syncToken);
    }
    const response = await this.listPages<RawCalendar>(`/calendar/v3/users/me/calendarList?${parameters.toString()}`);
    return {
      items: response.items.map(toCalendar),
      nextSyncToken: response.syncToken
    };
  }

  async listCalendarChangesPage(syncToken?: string, pageToken?: string, signal?: AbortSignal): Promise<GooglePage<GoogleCalendar>> {
    const parameters = new URLSearchParams({ maxResults: "250" });
    if (syncToken) {
      parameters.set("syncToken", syncToken);
    }
    if (pageToken) {
      parameters.set("pageToken", pageToken);
    }
    const response = await this.request<GoogleListResponse<RawCalendar>>(
      `/calendar/v3/users/me/calendarList?${parameters.toString()}`,
      { signal }
    );
    return {
      items: (response.items ?? []).map(toCalendar),
      nextPageToken: response.nextPageToken,
      nextSyncToken: response.nextSyncToken
    };
  }

  async listCalendarEventChanges(calendarId: string, syncToken?: string): Promise<GoogleSyncPage<GoogleCalendarEvent>> {
    const parameters = new URLSearchParams({
      maxResults: "2500",
      singleEvents: "false",
      showDeleted: "true"
    });
    if (syncToken) {
      parameters.set("syncToken", syncToken);
    }
    const response = await this.listPages<RawEvent>(
      `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${parameters.toString()}`
    );
    return {
      items: response.items.map((event) => toEvent(calendarId, event)),
      nextSyncToken: response.syncToken
    };
  }

  async listCalendarEventChangesPage(
    calendarId: string,
    syncToken?: string,
    pageToken?: string,
    signal?: AbortSignal
  ): Promise<GooglePage<GoogleCalendarEvent>> {
    const parameters = new URLSearchParams({
      maxResults: "2500",
      singleEvents: "false",
      showDeleted: "true"
    });
    if (syncToken) {
      parameters.set("syncToken", syncToken);
    }
    if (pageToken) {
      parameters.set("pageToken", pageToken);
    }
    const response = await this.request<GoogleListResponse<RawEvent>>(
      `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${parameters.toString()}`,
      { signal }
    );
    return {
      items: (response.items ?? []).map((event) => toEvent(calendarId, event)),
      nextPageToken: response.nextPageToken,
      nextSyncToken: response.nextSyncToken
    };
  }

  async listCalendarOccurrences(
    calendarId: string,
    timeMin: string,
    timeMax: string,
    signal?: AbortSignal
  ): Promise<GoogleCalendarEvent[]> {
    return this.listEvents(calendarId, timeMin, timeMax, signal);
  }

  async listEvents(
    calendarId: string,
    timeMin: string,
    timeMax: string,
    signal?: AbortSignal
  ): Promise<GoogleCalendarEvent[]> {
    const query = new URLSearchParams({
      timeMin,
      timeMax,
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "2500"
    });
    const response = await this.listPages<RawEvent>(
      `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${query.toString()}`,
      signal
    );
    return response.items.map((event) => toEvent(calendarId, event));
  }

  async createCalendar(input: CalendarInput): Promise<GoogleCalendar> {
    const calendar = await this.request<RawCalendar>("/calendar/v3/calendars", {
      method: "POST",
      body: JSON.stringify(input)
    });
    return toCalendar(calendar);
  }

  async subscribeCalendar(calendarId: string): Promise<GoogleCalendar> {
    const calendar = await this.request<RawCalendar>("/calendar/v3/users/me/calendarList", {
      method: "POST",
      body: JSON.stringify({ id: calendarId })
    });
    return toCalendar(calendar);
  }

  async removeCalendarFromList(calendarId: string): Promise<void> {
    await this.request<void>(`/calendar/v3/users/me/calendarList/${encodeURIComponent(calendarId)}`, { method: "DELETE" });
  }


  async getEvent(calendarId: string, eventId: string): Promise<GoogleCalendarEvent> {
    const event = await this.request<RawEvent>(
      `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`
    );
    return toEvent(calendarId, event);
  }

  async createEvent(calendarId: string, input: CalendarEventInput): Promise<GoogleCalendarEvent> {
    const parameters = new URLSearchParams({
      conferenceDataVersion: input.createGoogleMeet ? "1" : "0",
      supportsAttachments: input.attachments ? "true" : "false",
      sendUpdates: input.sendUpdates ?? "all"
    });
    const event = await this.request<RawEvent>(
      `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${parameters.toString()}`,
      { method: "POST", body: JSON.stringify(createEventPayload(input)) }
    );
    return toEvent(calendarId, event);
  }

  async updateEvent(
    calendarId: string,
    eventId: string,
    input: CalendarEventInput,
    etag?: string
  ): Promise<GoogleCalendarEvent> {
    const parameters = new URLSearchParams({
      conferenceDataVersion: input.createGoogleMeet ? "1" : "0",
      supportsAttachments: input.attachments ? "true" : "false",
      sendUpdates: input.sendUpdates ?? "all"
    });
    const event = await this.request<RawEvent>(
      `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?${parameters.toString()}`,
      {
        method: "PATCH",
        headers: etag ? { "If-Match": etag } : undefined,
        body: JSON.stringify(createEventPayload(input))
      }
    );
    return toEvent(calendarId, event);
  }

  async deleteEvent(calendarId: string, eventId: string, etag?: string, sendUpdates: "all" | "externalOnly" | "none" = "all"): Promise<void> {
    await this.request<void>(
      `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=${sendUpdates}`,
      { method: "DELETE", headers: etag ? { "If-Match": etag } : undefined }
    );
  }

  async updateAttendeeResponse(calendarId: string, eventId: string, responseStatus: string, comment?: string, etag?: string): Promise<GoogleCalendarEvent> {
    const event = await this.request<RawEvent>(
      `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      {
        method: "PATCH",
        headers: etag ? { "If-Match": etag } : undefined,
        body: JSON.stringify({ attendees: [{ self: true, responseStatus, comment: comment?.trim() || undefined }] })
      }
    );
    return toEvent(calendarId, event);
  }

  async queryFreeBusy(
    calendarIds: readonly string[],
    timeMin: string,
    timeMax: string,
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  ): Promise<GoogleFreeBusyResponse> {
    return this.request<GoogleFreeBusyResponse>("/calendar/v3/freeBusy", {
      method: "POST",
      body: JSON.stringify({ timeMin, timeMax, timeZone, items: calendarIds.map((id) => ({ id })) })
    });
  }

  async searchDriveMetadata(query: string): Promise<GoogleDriveFile[]> {
    const trimmed = query.trim();
    if (!trimmed) {
      return [];
    }
    const parameters = new URLSearchParams({
      q: `trashed = false and name contains '${escapeDriveQuery(trimmed)}'`,
      orderBy: "modifiedTime desc",
      pageSize: "25",
      fields: "files(id,name,mimeType,webViewLink,iconLink)"
    });
    const response = await this.request<{ files?: GoogleDriveFile[] }>(`/drive/v3/files?${parameters.toString()}`);
    return response.files ?? [];
  }

  private async listPages<T>(initialPath: string, signal?: AbortSignal): Promise<{ items: T[]; syncToken?: string }> {
    const items: T[] = [];
    let pageToken: string | undefined;
    let syncToken: string | undefined;
    do {
      const separator = initialPath.includes("?") ? "&" : "?";
      const path = pageToken ? `${initialPath}${separator}pageToken=${encodeURIComponent(pageToken)}` : initialPath;
      const page = await this.request<GoogleListResponse<T>>(path, { signal });
      items.push(...(page.items ?? []));
      syncToken = page.nextSyncToken ?? syncToken;
      pageToken = page.nextPageToken;
    } while (pageToken);
    return { items, syncToken };
  }
}

export function toDriveAttachment(file: GoogleDriveFile): GoogleEventAttachment | undefined {
  if (!file.webViewLink) {
    return undefined;
  }
  return { fileUrl: file.webViewLink, title: file.name, mimeType: file.mimeType };
}
