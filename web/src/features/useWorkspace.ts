import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { GoogleApiClient, GoogleApiError, GoogleAuthorizationRequiredError } from "@/api/googleApiClient";
import {
  fetchGoogleIdentity,
  requestGoogleAccessToken,
  revokeGoogleAccessToken,
  type BrowserAccessToken
} from "@/auth/googleIdentity";
import { TokenSession } from "@/auth/tokenSession";
import { localStore } from "@/data/localStore";
import {
  GOOGLE_SCOPES,
  INITIAL_GOOGLE_SCOPES,
  type CalendarEventInput,
  type GoogleCalendarEvent,
  type GoogleDriveFile,
  type GoogleTask,
  type GoogleTaskList,
  type TaskInput,
  type TaskMoveInput,
  type WorkspaceSnapshot
} from "@/types";

const emptyWorkspace: WorkspaceSnapshot | undefined = undefined;
const session = new TokenSession();

export interface EventConflict {
  readonly kind: "update" | "delete";
  readonly latest: GoogleCalendarEvent;
  readonly localInput?: CalendarEventInput;
}

export interface WorkspaceController {
  readonly clientId: string;
  readonly ready: boolean;
  readonly busy: boolean;
  readonly status: string;
  readonly workspace: WorkspaceSnapshot | undefined;
  readonly connected: boolean;
  readonly driveAuthorized: boolean;
  readonly eventConflict: EventConflict | undefined;
  saveClientId(clientId: string): Promise<void>;
  connect(): Promise<void>;
  sync(): Promise<void>;
  loadCalendarRange(timeMin: string, timeMax: string): Promise<void>;
  authorizeDrive(): Promise<void>;
  searchDrive(query: string): Promise<GoogleDriveFile[]>;
  createTaskList(title: string): Promise<void>;
  updateTaskList(taskList: GoogleTaskList, title: string): Promise<void>;
  deleteTaskList(taskList: GoogleTaskList): Promise<void>;
  createTask(listId: string, task: TaskInput): Promise<void>;
  updateTask(task: GoogleTask, patch: Partial<GoogleTask>): Promise<void>;
  toggleTask(task: GoogleTask): Promise<void>;
  deleteTask(task: GoogleTask): Promise<void>;
  moveTask(task: GoogleTask, move: TaskMoveInput): Promise<void>;
  createEvent(calendarId: string, event: CalendarEventInput): Promise<void>;
  updateEvent(event: GoogleCalendarEvent, input: CalendarEventInput): Promise<"updated" | "conflict">;
  deleteEvent(event: GoogleCalendarEvent): Promise<"deleted" | "conflict">;
  getEvent(calendarId: string, eventId: string): Promise<GoogleCalendarEvent>;
  resolveEventConflict(resolution: "keep-local" | "use-google"): Promise<void>;
  dismissEventConflict(): void;
  disconnect(): Promise<void>;
  clearLocalData(): Promise<void>;
}

function toIsoRange(): { start: string; end: string } {
  const now = new Date();
  const start = new Date(now);
  start.setDate(start.getDate() - 30);
  const end = new Date(now);
  end.setDate(end.getDate() + 90);
  return { start: start.toISOString(), end: end.toISOString() };
}

function eventTime(event: GoogleCalendarEvent, boundary: "start" | "end"): number {
  const value = event[boundary].dateTime ?? `${event[boundary].date ?? "1970-01-01"}T00:00:00`;
  return new Date(value).getTime();
}

function overlapsRange(event: GoogleCalendarEvent, timeMin: string, timeMax: string): boolean {
  return eventTime(event, "end") > new Date(timeMin).getTime() && eventTime(event, "start") < new Date(timeMax).getTime();
}

function eventFromInput(event: GoogleCalendarEvent, input: CalendarEventInput): GoogleCalendarEvent {
  return {
    ...event,
    summary: input.summary,
    description: input.description,
    location: input.location,
    start: input.start,
    end: input.end,
    recurrence: input.recurrence,
    attendees: input.attendees,
    reminders: input.reminders,
    attachments: input.attachments,
    visibility: input.visibility,
    transparency: input.transparency
  };
}

function normalizeTaskInput(input: TaskInput): TaskInput {
  const title = input.title.trim();
  if (!title) {
    throw new Error("Enter a task title");
  }
  return {
    title,
    notes: input.notes?.trim() || undefined,
    due: input.due,
    parent: input.parent,
    status: input.status,
    completed: input.completed
  };
}

function isLocalId(id: string): boolean {
  return id.startsWith("local-");
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  maximum: number,
  callback: (value: T) => Promise<R>
): Promise<R[]> {
  const result: R[] = [];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(maximum, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      result[index] = await callback(values[index]);
    }
  });
  await Promise.all(workers);
  return result;
}

function queueable(error: unknown): boolean {
  return (
    !navigator.onLine ||
    error instanceof GoogleAuthorizationRequiredError ||
    (error instanceof GoogleApiError && error.retryable)
  );
}

function asErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "An unexpected error occurred";
}

export function useWorkspace(): WorkspaceController {
  const [clientId, setClientId] = useState("");
  const [workspace, setWorkspace] = useState<WorkspaceSnapshot | undefined>(emptyWorkspace);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Configure your Google Web OAuth client to begin");
  const [eventConflict, setEventConflict] = useState<EventConflict | undefined>();
  const workspaceRef = useRef<WorkspaceSnapshot | undefined>(workspace);

  const replaceWorkspace = useCallback((next: WorkspaceSnapshot | undefined) => {
    workspaceRef.current = next;
    setWorkspace(next);
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const [storedClientId, activeSubject] = await Promise.all([localStore.getClientId(), localStore.getActiveSubject()]);
        if (storedClientId) {
          setClientId(storedClientId);
        }
        if (activeSubject) {
          const snapshot = await localStore.readSnapshot(activeSubject);
          if (snapshot) {
            replaceWorkspace(snapshot);
            setStatus("Showing browser-local data. Connect Google to sync.");
          }
        }
      } catch (error) {
        setStatus(`Browser storage is unavailable: ${asErrorMessage(error)}`);
      } finally {
        setReady(true);
      }
    })();
  }, [replaceWorkspace]);

  const api = useMemo(() => new GoogleApiClient(() => session.accessToken()), []);

  const saveClientId = useCallback(async (value: string) => {
    const normalized = value.trim();
    if (normalized.length < 10 || normalized.length > 500 || normalized.includes("\0")) {
      throw new Error("Enter a valid Google Web OAuth client ID");
    }
    await localStore.setClientId(normalized);
    setClientId(normalized);
    setStatus("Google Web OAuth client ID saved in this browser");
  }, []);

  const saveWorkspace = useCallback(async (next: WorkspaceSnapshot) => {
    replaceWorkspace(next);
    await localStore.saveSnapshot(next);
  }, [replaceWorkspace]);

  const updateCachedWorkspace = useCallback(async (update: (current: WorkspaceSnapshot) => WorkspaceSnapshot) => {
    const current = workspaceRef.current;
    if (!current) {
      throw new Error("Authorize Google before making changes");
    }
    await saveWorkspace(update(current));
  }, [saveWorkspace]);

  const replaceTask = useCallback(async (task: GoogleTask, previousId = task.id) => {
    await updateCachedWorkspace((snapshot) => ({
      ...snapshot,
      tasks: snapshot.tasks.map((item) => item.id === previousId ? task : item),
      updatedAt: new Date().toISOString()
    }));
  }, [updateCachedWorkspace]);

  const replaceEvent = useCallback(async (event: GoogleCalendarEvent, previousId = event.id) => {
    await updateCachedWorkspace((snapshot) => ({
      ...snapshot,
      events: snapshot.events.map((item) => item.id === previousId && item.calendarId === event.calendarId ? event : item),
      updatedAt: new Date().toISOString()
    }));
  }, [updateCachedWorkspace]);

  const saveConflict = useCallback(async (
    kind: EventConflict["kind"],
    calendarId: string,
    eventId: string,
    localInput?: CalendarEventInput
  ) => {
    const latest = await api.getEvent(calendarId, eventId);
    setEventConflict({ kind, latest, localInput });
    setStatus("This event changed in Google. Choose which version to keep.");
  }, [api]);

  const flushPending = useCallback(async (subject: string) => {
    const pending = await localStore.pendingMutations(subject);
    for (const mutation of pending) {
      try {
        switch (mutation.kind) {
          case "task-create": {
            const created = await api.createTask(mutation.payload.listId, mutation.payload.task);
            await replaceTask(created, mutation.payload.temporaryId);
            break;
          }
          case "task-update": {
            const updated = await api.updateTask(mutation.payload.listId, mutation.payload.taskId, mutation.payload.patch);
            await replaceTask(updated);
            break;
          }
          case "task-delete":
            await api.deleteTask(mutation.payload.listId, mutation.payload.taskId);
            break;
          case "task-move": {
            const moved = await api.moveTask(mutation.payload.listId, mutation.payload.taskId, mutation.payload.move);
            await replaceTask(moved);
            break;
          }
          case "task-list-create": {
            const created = await api.createTaskList(mutation.payload.title);
            await updateCachedWorkspace((snapshot) => ({
              ...snapshot,
              taskLists: snapshot.taskLists.map((list) => list.id === mutation.payload.temporaryId ? created : list),
              tasks: snapshot.tasks.map((task) => task.listId === mutation.payload.temporaryId ? { ...task, listId: created.id } : task),
              updatedAt: new Date().toISOString()
            }));
            break;
          }
          case "task-list-update": {
            const updated = await api.updateTaskList(mutation.payload.listId, mutation.payload.title);
            await updateCachedWorkspace((snapshot) => ({
              ...snapshot,
              taskLists: snapshot.taskLists.map((list) => list.id === updated.id ? updated : list),
              updatedAt: new Date().toISOString()
            }));
            break;
          }
          case "task-list-delete":
            await api.deleteTaskList(mutation.payload.listId);
            break;
          case "event-create": {
            const created = await api.createEvent(mutation.payload.calendarId, mutation.payload.event);
            await replaceEvent(created, mutation.payload.temporaryId);
            break;
          }
          case "event-update": {
            const updated = await api.updateEvent(
              mutation.payload.calendarId,
              mutation.payload.eventId,
              mutation.payload.patch,
              mutation.payload.etag
            );
            await replaceEvent(updated);
            break;
          }
          case "event-delete":
            await api.deleteEvent(mutation.payload.calendarId, mutation.payload.eventId, mutation.payload.etag);
            break;
        }
        await localStore.removeMutation(mutation.id);
      } catch (error) {
        if (error instanceof GoogleApiError && error.status === 412 && (mutation.kind === "event-update" || mutation.kind === "event-delete")) {
          await localStore.removeMutation(mutation.id);
          await saveConflict(
            mutation.kind === "event-update" ? "update" : "delete",
            mutation.payload.calendarId,
            mutation.payload.eventId,
            mutation.kind === "event-update" ? mutation.payload.patch : undefined
          );
          continue;
        }
        if (!queueable(error)) {
          throw error;
        }
        break;
      }
    }
  }, [api, replaceEvent, replaceTask, saveConflict, updateCachedWorkspace]);

  const synchronize = useCallback(async () => {
    const token = session.accessToken();
    if (!token) {
      throw new GoogleAuthorizationRequiredError();
    }
    const current = workspaceRef.current;
    if (!current) {
      throw new Error("Authorize Google before synchronizing");
    }
    await flushPending(current.identity.subject);
    const [taskLists, calendars] = await Promise.all([api.listTaskLists(), api.listCalendars()]);
    const range = toIsoRange();
    const [taskGroups, eventGroups] = await Promise.all([
      mapWithConcurrency(taskLists, 4, (taskList) => api.listTasks(taskList.id)),
      mapWithConcurrency(calendars, 4, (calendar) => api.listEvents(calendar.id, range.start, range.end))
    ]);
    const next: WorkspaceSnapshot = {
      identity: current.identity,
      taskLists,
      tasks: taskGroups.flat(),
      calendars,
      events: eventGroups.flat(),
      updatedAt: new Date().toISOString()
    };
    await saveWorkspace(next);
    setStatus(`Synced ${next.tasks.length} tasks and ${next.events.length} calendar events`);
  }, [api, flushPending, saveWorkspace]);

  const loadCalendarRange = useCallback(async (timeMin: string, timeMax: string) => {
    const current = workspaceRef.current;
    if (!current || !session.accessToken()) {
      return;
    }
    setBusy(true);
    try {
      const eventGroups = await mapWithConcurrency(
        current.calendars,
        4,
        (calendar) => api.listEvents(calendar.id, timeMin, timeMax)
      );
      const loaded = eventGroups.flat();
      await updateCachedWorkspace((snapshot) => ({
        ...snapshot,
        events: [
          ...snapshot.events.filter((event) => !overlapsRange(event, timeMin, timeMax)),
          ...loaded
        ],
        updatedAt: new Date().toISOString()
      }));
    } finally {
      setBusy(false);
    }
  }, [api, updateCachedWorkspace]);

  const connect = useCallback(async () => {
    if (!clientId) {
      throw new Error("Save your Google Web OAuth client ID first");
    }
    setBusy(true);
    setStatus("Waiting for Google authorization");
    try {
      const token = await requestGoogleAccessToken(clientId, INITIAL_GOOGLE_SCOPES);
      session.set(token);
      const identity = await fetchGoogleIdentity(token.value);
      await localStore.setActiveSubject(identity.subject);
      const cached = await localStore.readSnapshot(identity.subject);
      const initial: WorkspaceSnapshot = cached ?? {
        identity,
        taskLists: [],
        tasks: [],
        calendars: [],
        events: [],
        updatedAt: new Date().toISOString()
      };
      await saveWorkspace({ ...initial, identity });
      await synchronize();
    } catch (error) {
      setStatus(asErrorMessage(error));
      throw error;
    } finally {
      setBusy(false);
    }
  }, [clientId, saveWorkspace, synchronize]);

  const sync = useCallback(async () => {
    setBusy(true);
    try {
      await synchronize();
    } catch (error) {
      setStatus(asErrorMessage(error));
      throw error;
    } finally {
      setBusy(false);
    }
  }, [synchronize]);

  const authorizeDrive = useCallback(async () => {
    if (!clientId) {
      throw new Error("Save your Google Web OAuth client ID first");
    }
    setBusy(true);
    try {
      const token = await requestGoogleAccessToken(clientId, [...INITIAL_GOOGLE_SCOPES, GOOGLE_SCOPES.driveMetadata]);
      session.set(token);
      setStatus("Google Drive metadata access authorized for this browser session");
    } catch (error) {
      setStatus(asErrorMessage(error));
      throw error;
    } finally {
      setBusy(false);
    }
  }, [clientId]);

  const searchDrive = useCallback(async (query: string) => {
    if (!workspaceRef.current) {
      throw new Error("Authorize Google before searching Drive");
    }
    if (!session.hasScope(GOOGLE_SCOPES.driveMetadata)) {
      throw new GoogleAuthorizationRequiredError();
    }
    const files = await api.searchDriveMetadata(query);
    await localStore.saveDriveFiles(workspaceRef.current.identity.subject, files);
    return files;
  }, [api]);

  const createTaskList = useCallback(async (title: string) => {
    const current = workspaceRef.current;
    const normalized = title.trim();
    if (!current || !normalized) {
      throw new Error("Enter a task-list name after authorizing Google");
    }
    try {
      const created = await api.createTaskList(normalized);
      await updateCachedWorkspace((snapshot) => ({
        ...snapshot,
        taskLists: [...snapshot.taskLists, created],
        updatedAt: new Date().toISOString()
      }));
    } catch (error) {
      if (!queueable(error)) {
        throw error;
      }
      const temporaryId = `local-task-list-${crypto.randomUUID()}`;
      await localStore.queueMutation({
        id: crypto.randomUUID(),
        subject: current.identity.subject,
        kind: "task-list-create",
        createdAt: new Date().toISOString(),
        payload: { temporaryId, title: normalized }
      });
      await updateCachedWorkspace((snapshot) => ({
        ...snapshot,
        taskLists: [...snapshot.taskLists, { id: temporaryId, title: normalized }],
        updatedAt: new Date().toISOString()
      }));
      setStatus("Task list saved locally and will sync after you reconnect Google");
    }
  }, [api, updateCachedWorkspace]);

  const updateTaskList = useCallback(async (taskList: GoogleTaskList, title: string) => {
    const current = workspaceRef.current;
    const normalized = title.trim();
    if (!current || !normalized) {
      throw new Error("Enter a task-list name");
    }
    if (isLocalId(taskList.id)) {
      throw new Error("Reconnect Google before editing a task list that is still waiting to be created");
    }
    try {
      const updated = await api.updateTaskList(taskList.id, normalized);
      await updateCachedWorkspace((snapshot) => ({
        ...snapshot,
        taskLists: snapshot.taskLists.map((list) => list.id === taskList.id ? updated : list),
        updatedAt: new Date().toISOString()
      }));
    } catch (error) {
      if (!queueable(error)) {
        throw error;
      }
      await localStore.queueMutation({
        id: crypto.randomUUID(),
        subject: current.identity.subject,
        kind: "task-list-update",
        createdAt: new Date().toISOString(),
        payload: { listId: taskList.id, title: normalized }
      });
      await updateCachedWorkspace((snapshot) => ({
        ...snapshot,
        taskLists: snapshot.taskLists.map((list) => list.id === taskList.id ? { ...list, title: normalized } : list),
        updatedAt: new Date().toISOString()
      }));
      setStatus("Task-list name saved locally and will sync after you reconnect Google");
    }
  }, [api, updateCachedWorkspace]);

  const deleteTaskList = useCallback(async (taskList: GoogleTaskList) => {
    const current = workspaceRef.current;
    if (!current) {
      throw new Error("Authorize Google before making changes");
    }
    if (isLocalId(taskList.id)) {
      throw new Error("Reconnect Google before deleting a task list that is still waiting to be created");
    }
    const remove = async () => updateCachedWorkspace((snapshot) => ({
      ...snapshot,
      taskLists: snapshot.taskLists.filter((list) => list.id !== taskList.id),
      tasks: snapshot.tasks.filter((task) => task.listId !== taskList.id),
      updatedAt: new Date().toISOString()
    }));
    try {
      await api.deleteTaskList(taskList.id);
      await remove();
    } catch (error) {
      if (!queueable(error)) {
        throw error;
      }
      await localStore.queueMutation({
        id: crypto.randomUUID(),
        subject: current.identity.subject,
        kind: "task-list-delete",
        createdAt: new Date().toISOString(),
        payload: { listId: taskList.id }
      });
      await remove();
      setStatus("Task list deleted locally and will sync after you reconnect Google");
    }
  }, [api, updateCachedWorkspace]);

  const createTask = useCallback(async (listId: string, input: TaskInput) => {
    const current = workspaceRef.current;
    if (!current) {
      throw new Error("Authorize Google before making changes");
    }
    if (isLocalId(listId)) {
      throw new Error("Reconnect Google before adding tasks to a task list that is still waiting to be created");
    }
    const task = normalizeTaskInput(input);
    try {
      const created = await api.createTask(listId, task);
      await updateCachedWorkspace((snapshot) => ({
        ...snapshot,
        tasks: [...snapshot.tasks, created],
        updatedAt: new Date().toISOString()
      }));
    } catch (error) {
      if (!queueable(error)) {
        throw error;
      }
      const temporaryId = `local-task-${crypto.randomUUID()}`;
      await localStore.queueMutation({
        id: crypto.randomUUID(),
        subject: current.identity.subject,
        kind: "task-create",
        createdAt: new Date().toISOString(),
        payload: { listId, temporaryId, task }
      });
      await updateCachedWorkspace((snapshot) => ({
        ...snapshot,
        tasks: [...snapshot.tasks, { id: temporaryId, listId, status: "needsAction", ...task }],
        updatedAt: new Date().toISOString()
      }));
      setStatus("Task saved locally and will sync after you reconnect Google");
    }
  }, [api, updateCachedWorkspace]);

  const updateTask = useCallback(async (task: GoogleTask, patch: Partial<GoogleTask>) => {
    const current = workspaceRef.current;
    if (!current) {
      throw new Error("Authorize Google before making changes");
    }
    if (isLocalId(task.id)) {
      throw new Error("Reconnect Google before editing a task that is still waiting to be created");
    }
    try {
      const updated = await api.updateTask(task.listId, task.id, patch);
      await replaceTask(updated);
    } catch (error) {
      if (!queueable(error)) {
        throw error;
      }
      await localStore.queueMutation({
        id: crypto.randomUUID(),
        subject: current.identity.subject,
        kind: "task-update",
        createdAt: new Date().toISOString(),
        payload: { listId: task.listId, taskId: task.id, patch }
      });
      await replaceTask({ ...task, ...patch });
      setStatus("Task change saved locally and will sync after you reconnect Google");
    }
  }, [api, replaceTask]);

  const toggleTask = useCallback(async (task: GoogleTask) => {
    await updateTask(task, task.status === "completed"
      ? { status: "needsAction", completed: undefined }
      : { status: "completed", completed: new Date().toISOString() });
  }, [updateTask]);

  const deleteTask = useCallback(async (task: GoogleTask) => {
    const current = workspaceRef.current;
    if (!current) {
      throw new Error("Authorize Google before making changes");
    }
    if (isLocalId(task.id)) {
      throw new Error("Reconnect Google before deleting a task that is still waiting to be created");
    }
    const remove = async () => updateCachedWorkspace((snapshot) => ({
      ...snapshot,
      tasks: snapshot.tasks.filter((item) => item.id !== task.id),
      updatedAt: new Date().toISOString()
    }));
    try {
      await api.deleteTask(task.listId, task.id);
      await remove();
    } catch (error) {
      if (!queueable(error)) {
        throw error;
      }
      await localStore.queueMutation({
        id: crypto.randomUUID(),
        subject: current.identity.subject,
        kind: "task-delete",
        createdAt: new Date().toISOString(),
        payload: { listId: task.listId, taskId: task.id }
      });
      await remove();
      setStatus("Task deleted locally and will sync after you reconnect Google");
    }
  }, [api, updateCachedWorkspace]);

  const moveTask = useCallback(async (task: GoogleTask, move: TaskMoveInput) => {
    const current = workspaceRef.current;
    if (!current) {
      throw new Error("Authorize Google before making changes");
    }
    if (isLocalId(task.id)) {
      throw new Error("Reconnect Google before moving a task that is still waiting to be created");
    }
    if (move.destinationListId && move.destinationListId !== task.listId && move.parent) {
      throw new Error("Move a task to the destination list before making it a subtask");
    }
    const optimistic: GoogleTask = {
      ...task,
      listId: move.destinationListId ?? task.listId,
      parent: move.parent,
      position: undefined
    };
    try {
      const moved = await api.moveTask(task.listId, task.id, move);
      await replaceTask(moved);
    } catch (error) {
      if (!queueable(error)) {
        throw error;
      }
      await localStore.queueMutation({
        id: crypto.randomUUID(),
        subject: current.identity.subject,
        kind: "task-move",
        createdAt: new Date().toISOString(),
        payload: { listId: task.listId, taskId: task.id, move }
      });
      await replaceTask(optimistic);
      setStatus("Task move saved locally and will sync after you reconnect Google");
    }
  }, [api, replaceTask]);

  const createEvent = useCallback(async (calendarId: string, event: CalendarEventInput) => {
    const current = workspaceRef.current;
    if (!current) {
      throw new Error("Authorize Google before making changes");
    }
    try {
      const created = await api.createEvent(calendarId, event);
      await updateCachedWorkspace((snapshot) => ({
        ...snapshot,
        events: [...snapshot.events, created],
        updatedAt: new Date().toISOString()
      }));
    } catch (error) {
      if (!queueable(error)) {
        throw error;
      }
      const temporaryId = `local-event-${crypto.randomUUID()}`;
      const localEvent: GoogleCalendarEvent = {
        id: temporaryId,
        calendarId,
        summary: event.summary,
        description: event.description,
        location: event.location,
        start: event.start,
        end: event.end,
        recurrence: event.recurrence,
        attendees: event.attendees,
        reminders: event.reminders,
        attachments: event.attachments,
        visibility: event.visibility,
        transparency: event.transparency
      };
      await localStore.queueMutation({
        id: crypto.randomUUID(),
        subject: current.identity.subject,
        kind: "event-create",
        createdAt: new Date().toISOString(),
        payload: { calendarId, temporaryId, event }
      });
      await updateCachedWorkspace((snapshot) => ({
        ...snapshot,
        events: [...snapshot.events, localEvent],
        updatedAt: new Date().toISOString()
      }));
      setStatus("Event saved locally and will sync after you reconnect Google");
    }
  }, [api, updateCachedWorkspace]);

  const getEvent = useCallback(async (calendarId: string, eventId: string) => {
    if (!workspaceRef.current) {
      throw new Error("Authorize Google before viewing an event");
    }
    return api.getEvent(calendarId, eventId);
  }, [api]);

  const updateEvent = useCallback(async (event: GoogleCalendarEvent, input: CalendarEventInput): Promise<"updated" | "conflict"> => {
    const current = workspaceRef.current;
    if (!current) {
      throw new Error("Authorize Google before making changes");
    }
    if (isLocalId(event.id)) {
      throw new Error("Reconnect Google before editing an event that is still waiting to be created");
    }
    try {
      const updated = await api.updateEvent(event.calendarId, event.id, input, event.etag);
      await replaceEvent(updated);
      return "updated";
    } catch (error) {
      if (error instanceof GoogleApiError && error.status === 412) {
        await saveConflict("update", event.calendarId, event.id, input);
        return "conflict";
      }
      if (!queueable(error)) {
        throw error;
      }
      await localStore.queueMutation({
        id: crypto.randomUUID(),
        subject: current.identity.subject,
        kind: "event-update",
        createdAt: new Date().toISOString(),
        payload: { calendarId: event.calendarId, eventId: event.id, patch: input, etag: event.etag }
      });
      await replaceEvent(eventFromInput(event, input));
      setStatus("Event change saved locally and will sync after you reconnect Google");
      return "updated";
    }
  }, [api, replaceEvent, saveConflict]);

  const deleteEvent = useCallback(async (event: GoogleCalendarEvent): Promise<"deleted" | "conflict"> => {
    const current = workspaceRef.current;
    if (!current) {
      throw new Error("Authorize Google before making changes");
    }
    if (isLocalId(event.id)) {
      throw new Error("Reconnect Google before deleting an event that is still waiting to be created");
    }
    const remove = async () => updateCachedWorkspace((snapshot) => ({
      ...snapshot,
      events: snapshot.events.filter((item) => item.id !== event.id || item.calendarId !== event.calendarId),
      updatedAt: new Date().toISOString()
    }));
    try {
      await api.deleteEvent(event.calendarId, event.id, event.etag);
      await remove();
      return "deleted";
    } catch (error) {
      if (error instanceof GoogleApiError && error.status === 412) {
        await saveConflict("delete", event.calendarId, event.id);
        return "conflict";
      }
      if (!queueable(error)) {
        throw error;
      }
      await localStore.queueMutation({
        id: crypto.randomUUID(),
        subject: current.identity.subject,
        kind: "event-delete",
        createdAt: new Date().toISOString(),
        payload: { calendarId: event.calendarId, eventId: event.id, etag: event.etag }
      });
      await remove();
      setStatus("Event deleted locally and will sync after you reconnect Google");
      return "deleted";
    }
  }, [api, saveConflict, updateCachedWorkspace]);

  const resolveEventConflict = useCallback(async (resolution: "keep-local" | "use-google") => {
    const conflict = eventConflict;
    if (!conflict) {
      return;
    }
    setBusy(true);
    try {
      if (resolution === "use-google") {
        await replaceEvent(conflict.latest);
        setStatus("The Google version is now shown.");
        setEventConflict(undefined);
        return;
      }
      if (conflict.kind === "update" && conflict.localInput) {
        const updated = await api.updateEvent(
          conflict.latest.calendarId,
          conflict.latest.id,
          conflict.localInput,
          conflict.latest.etag
        );
        await replaceEvent(updated);
        setStatus("Your event changes were saved to Google.");
        setEventConflict(undefined);
        return;
      }
      await api.deleteEvent(conflict.latest.calendarId, conflict.latest.id, conflict.latest.etag);
      await updateCachedWorkspace((snapshot) => ({
        ...snapshot,
        events: snapshot.events.filter((event) => event.id !== conflict.latest.id || event.calendarId !== conflict.latest.calendarId),
        updatedAt: new Date().toISOString()
      }));
      setStatus("The event was deleted from Google.");
      setEventConflict(undefined);
    } catch (error) {
      if (error instanceof GoogleApiError && error.status === 412) {
        await saveConflict(conflict.kind, conflict.latest.calendarId, conflict.latest.id, conflict.localInput);
        return;
      }
      setStatus(asErrorMessage(error));
      throw error;
    } finally {
      setBusy(false);
    }
  }, [api, eventConflict, replaceEvent, saveConflict, updateCachedWorkspace]);

  const dismissEventConflict = useCallback(() => {
    setEventConflict(undefined);
    setStatus("The event was not changed. Review the Google version before trying again.");
  }, []);

  const disconnect = useCallback(async () => {
    const token: BrowserAccessToken | undefined = session.current();
    setBusy(true);
    try {
      if (token) {
        await revokeGoogleAccessToken(token.value);
      }
      session.clear();
      setStatus("Google access was disconnected. Browser-local data remains until you clear it.");
    } finally {
      setBusy(false);
    }
  }, []);

  const clearLocalData = useCallback(async () => {
    setBusy(true);
    try {
      await localStore.clearAll();
      session.clear();
      setClientId("");
      setEventConflict(undefined);
      replaceWorkspace(undefined);
      setStatus("Browser-local Hot Cross Buns data was cleared");
    } finally {
      setBusy(false);
    }
  }, [replaceWorkspace]);

  return {
    clientId,
    ready,
    busy,
    status,
    workspace,
    connected: Boolean(session.accessToken() && workspace),
    driveAuthorized: session.hasScope(GOOGLE_SCOPES.driveMetadata),
    eventConflict,
    saveClientId,
    connect,
    sync,
    loadCalendarRange,
    authorizeDrive,
    searchDrive,
    createTaskList,
    updateTaskList,
    deleteTaskList,
    createTask,
    updateTask,
    toggleTask,
    deleteTask,
    moveTask,
    createEvent,
    updateEvent,
    deleteEvent,
    getEvent,
    resolveEventConflict,
    dismissEventConflict,
    disconnect,
    clearLocalData
  };
}
