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
  type PendingMutation,
  type WorkspaceSnapshot
} from "@/types";

const emptyWorkspace: WorkspaceSnapshot | undefined = undefined;
const session = new TokenSession();

export interface WorkspaceController {
  readonly clientId: string;
  readonly ready: boolean;
  readonly busy: boolean;
  readonly status: string;
  readonly workspace: WorkspaceSnapshot | undefined;
  readonly connected: boolean;
  readonly driveAuthorized: boolean;
  saveClientId(clientId: string): Promise<void>;
  connect(): Promise<void>;
  sync(): Promise<void>;
  authorizeDrive(): Promise<void>;
  searchDrive(query: string): Promise<GoogleDriveFile[]>;
  createTask(listId: string, title: string, notes?: string): Promise<void>;
  toggleTask(task: GoogleTask): Promise<void>;
  createEvent(calendarId: string, event: CalendarEventInput): Promise<void>;
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

  const flushPending = useCallback(async (subject: string) => {
    const pending = await localStore.pendingMutations(subject);
    for (const mutation of pending) {
      try {
        switch (mutation.kind) {
          case "task-create":
            await api.createTask(mutation.payload.listId, mutation.payload);
            break;
          case "task-update":
            await api.updateTask(mutation.payload.listId, mutation.payload.taskId, mutation.payload.patch);
            break;
          case "event-create":
            await api.createEvent(mutation.payload.calendarId, mutation.payload.event);
            break;
          case "event-update":
            await api.updateEvent(mutation.payload.calendarId, mutation.payload.eventId, mutation.payload.patch);
            break;
          case "event-delete":
            await api.deleteEvent(mutation.payload.calendarId, mutation.payload.eventId);
            break;
        }
        await localStore.removeMutation(mutation.id);
      } catch (error) {
        if (!queueable(error)) {
          throw error;
        }
        break;
      }
    }
  }, [api]);

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
    const [taskGroups, eventGroups] = await Promise.all([
      mapWithConcurrency(taskLists, 4, (taskList) => api.listTasks(taskList.id)),
      mapWithConcurrency(calendars, 4, (calendar) => {
        const range = toIsoRange();
        return api.listEvents(calendar.id, range.start, range.end);
      })
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

  const updateCachedWorkspace = useCallback(async (update: (current: WorkspaceSnapshot) => WorkspaceSnapshot) => {
    const current = workspaceRef.current;
    if (!current) {
      throw new Error("Authorize Google before making changes");
    }
    await saveWorkspace(update(current));
  }, [saveWorkspace]);

  const createTask = useCallback(async (listId: string, title: string, notes?: string) => {
    const current = workspaceRef.current;
    if (!current || !title.trim()) {
      throw new Error("Enter a task title after authorizing Google");
    }
    const payload = { listId, title: title.trim(), notes: notes?.trim() || undefined };
    try {
      const task = await api.createTask(listId, payload);
      await updateCachedWorkspace((snapshot) => ({ ...snapshot, tasks: [...snapshot.tasks, task], updatedAt: new Date().toISOString() }));
    } catch (error) {
      if (!queueable(error)) {
        throw error;
      }
      const temporaryId = `local-task-${crypto.randomUUID()}`;
      const mutation: PendingMutation = {
        id: crypto.randomUUID(),
        subject: current.identity.subject,
        kind: "task-create",
        createdAt: new Date().toISOString(),
        payload
      };
      await localStore.queueMutation(mutation);
      await updateCachedWorkspace((snapshot) => ({
        ...snapshot,
        tasks: [...snapshot.tasks, { id: temporaryId, ...payload, status: "needsAction" }],
        updatedAt: new Date().toISOString()
      }));
      setStatus("Task saved locally and will sync after you reconnect Google");
    }
  }, [api, updateCachedWorkspace]);

  const toggleTask = useCallback(async (task: GoogleTask) => {
    const current = workspaceRef.current;
    if (!current) {
      throw new Error("Authorize Google before making changes");
    }
    const patch: Partial<GoogleTask> = task.status === "completed"
      ? { status: "needsAction", completed: undefined }
      : { status: "completed", completed: new Date().toISOString() };
    try {
      const updated = await api.updateTask(task.listId, task.id, patch);
      await updateCachedWorkspace((snapshot) => ({
        ...snapshot,
        tasks: snapshot.tasks.map((item) => item.id === task.id ? updated : item),
        updatedAt: new Date().toISOString()
      }));
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
      await updateCachedWorkspace((snapshot) => ({
        ...snapshot,
        tasks: snapshot.tasks.map((item) => item.id === task.id ? { ...item, ...patch } : item),
        updatedAt: new Date().toISOString()
      }));
      setStatus("Task change saved locally and will sync after you reconnect Google");
    }
  }, [api, updateCachedWorkspace]);

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
      const localEvent: GoogleCalendarEvent = {
        id: `local-event-${crypto.randomUUID()}`,
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
        payload: { calendarId, event }
      });
      await updateCachedWorkspace((snapshot) => ({
        ...snapshot,
        events: [...snapshot.events, localEvent],
        updatedAt: new Date().toISOString()
      }));
      setStatus("Event saved locally and will sync after you reconnect Google");
    }
  }, [api, updateCachedWorkspace]);

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
    saveClientId,
    connect,
    sync,
    authorizeDrive,
    searchDrive,
    createTask,
    toggleTask,
    createEvent,
    disconnect,
    clearLocalData
  };
}
