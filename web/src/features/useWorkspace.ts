import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { browserGoogleTransport, GoogleApiClient, GoogleApiError, GoogleAuthorizationRequiredError, managedGoogleTransport } from "@/api/googleApiClient";
import {
  fetchGoogleIdentity,
  requestGoogleAccessToken,
  revokeGoogleAccessToken,
  type BrowserAccessToken
} from "@/auth/googleIdentity";
import { beginManagedAuthorization, disconnectManagedConnection, managedConnectionProfile, readManagedSession } from "@/auth/managedConnection";
import { TokenSession } from "@/auth/tokenSession";
import { defaultWorkspacePreferences, localStore, type StorageEstimate } from "@/data/localStore";
import { parseTaskRecurrenceNotes, serializeTaskRecurrenceNotes, taskRecurrenceSuccessor } from "@/features/taskRecurrence";
import {
  GOOGLE_SCOPES,
  INITIAL_GOOGLE_SCOPES,
  type CalendarInput,
  type CalendarEventInput,
  type ConnectionProfile,
  type GoogleCalendar,
  type GoogleCalendarEvent,
  type GoogleDriveFile,
  type GoogleFreeBusyResponse,
  type GoogleIdentity,
  type GoogleTask,
  type GoogleTaskList,
  type TaskInput,
  type TaskMetadata,
  type TaskMoveInput,
  type WorkspaceConflict,
  type WorkspacePreferences,
  type ScheduledTaskBlock,
  type SavedSearch,
  type UndoEntry,
  type WorkspaceSnapshot
} from "@/types";

const emptyWorkspace: WorkspaceSnapshot | undefined = undefined;
const session = new TokenSession();

export interface EventConflict {
  readonly kind: "update" | "delete";
  readonly latest: GoogleCalendarEvent;
  readonly localInput?: CalendarEventInput;
}

export type TaskBulkOperation =
  | { readonly kind: "complete" }
  | { readonly kind: "delete" }
  | { readonly kind: "move"; readonly destinationListId: string }
  | { readonly kind: "reparent"; readonly parent?: string }
  | { readonly kind: "due"; readonly due?: string }
  | { readonly kind: "priority"; readonly priority: TaskMetadata["priority"] }
  | { readonly kind: "replace-text"; readonly find: string; readonly replace: string };

export type EventBulkOperation =
  | { readonly kind: "delete" }
  | { readonly kind: "move"; readonly calendarId: string }
  | { readonly kind: "color"; readonly colorId?: string }
  | { readonly kind: "availability"; readonly transparency: "opaque" | "transparent" }
  | { readonly kind: "visibility"; readonly visibility: NonNullable<GoogleCalendarEvent["visibility"]> }
  | { readonly kind: "shift"; readonly minutes: number }
  | { readonly kind: "replace-text"; readonly find: string; readonly replace: string };

export interface BulkOperationResult {
  readonly succeeded: readonly string[];
  readonly failed: readonly { readonly id: string; readonly error: string }[];
}

export interface SyncProgress {
  readonly active: boolean;
  readonly cancellable: boolean;
  readonly phase: "idle" | "pending" | "tasks" | "calendar-list" | "calendar-events" | "occurrences" | "complete" | "paused" | "error";
  readonly detail: string;
  readonly completed?: number;
  readonly total?: number;
  readonly pagesSaved: number;
  readonly recordsSaved: number;
  readonly storage?: StorageEstimate;
}

const idleSyncProgress: SyncProgress = {
  active: false,
  cancellable: false,
  phase: "idle",
  detail: "No sync is running",
  pagesSaved: 0,
  recordsSaved: 0
};

export interface WorkspaceController {
  readonly clientId: string;
  readonly onboardingDisplayTimeZone: string;
  readonly connectionProfile: ConnectionProfile;
  readonly managedConnectionAvailable: boolean;
  readonly ready: boolean;
  readonly busy: boolean;
  readonly status: string;
  readonly syncProgress: SyncProgress;
  readonly workspace: WorkspaceSnapshot | undefined;
  readonly connected: boolean;
  readonly driveAuthorized: boolean;
  readonly eventConflict: EventConflict | undefined;
  readonly preferences: WorkspacePreferences;
  readonly taskMetadata: readonly TaskMetadata[];
  readonly scheduledTaskBlocks: readonly ScheduledTaskBlock[];
  readonly conflicts: readonly WorkspaceConflict[];
  readonly undoEntries: readonly UndoEntry[];
  readonly invitationEvents: readonly GoogleCalendarEvent[];
  readonly savedSearches: readonly SavedSearch[];
  saveClientId(clientId: string): Promise<void>;
  saveOnboardingDisplayTimeZone(timeZone: string): Promise<void>;
  connect(): Promise<void>;
  connectManaged(): Promise<void>;
  useDirectConnection(): Promise<void>;
  sync(): Promise<void>;
  cancelSync(): void;
  refreshAllTasks(): Promise<void>;
  loadCalendarRange(timeMin: string, timeMax: string): Promise<void>;
  createCalendar(input: CalendarInput): Promise<void>;
  subscribeCalendar(calendarId: string): Promise<void>;
  removeCalendarFromList(calendar: GoogleCalendar): Promise<void>;
  queryAvailability(calendarIds: readonly string[], timeMin: string, timeMax: string): Promise<GoogleFreeBusyResponse>;
  authorizeDrive(): Promise<void>;
  searchDrive(query: string): Promise<GoogleDriveFile[]>;
  createTaskList(title: string): Promise<void>;
  updateTaskList(taskList: GoogleTaskList, title: string): Promise<void>;
  deleteTaskList(taskList: GoogleTaskList): Promise<void>;
  createTask(listId: string, task: TaskInput): Promise<GoogleTask>;
  updateTask(task: GoogleTask, patch: Partial<GoogleTask>): Promise<void>;
  toggleTask(task: GoogleTask): Promise<void>;
  deleteTask(task: GoogleTask): Promise<void>;
  moveTask(task: GoogleTask, move: TaskMoveInput): Promise<void>;
  savePreferences(update: Partial<WorkspacePreferences>): Promise<void>;
  saveTaskMetadata(taskId: string, update: Pick<TaskMetadata, "priority" | "dueTimeZone">): Promise<void>;
  scheduleTask(task: GoogleTask, calendarId: string, start: string, end: string): Promise<void>;
  unscheduleTask(taskId: string): Promise<void>;
  bulkTasks(taskIds: readonly string[], operation: TaskBulkOperation): Promise<BulkOperationResult>;
  bulkEvents(events: readonly GoogleCalendarEvent[], operation: EventBulkOperation): Promise<BulkOperationResult>;
  undo(): Promise<void>;
  redo(): Promise<void>;
  saveSearch(name: string, query: string): Promise<void>;
  deleteSearch(id: string): Promise<void>;
  createEvent(calendarId: string, event: CalendarEventInput): Promise<void>;
  updateEvent(event: GoogleCalendarEvent, input: CalendarEventInput): Promise<"updated" | "conflict">;
  deleteEvent(event: GoogleCalendarEvent): Promise<"deleted" | "conflict">;
  getEvent(calendarId: string, eventId: string): Promise<GoogleCalendarEvent>;
  respondToEvent(event: GoogleCalendarEvent, responseStatus: "accepted" | "declined" | "tentative" | "needsAction", comment?: string): Promise<GoogleCalendarEvent>;
  resolveEventConflict(resolution: "keep-local" | "use-google"): Promise<void>;
  dismissEventConflict(): void;
  dismissConflict(id: string): Promise<void>;
  splitRecurringEvent(series: GoogleCalendarEvent, firstChangedInstance: GoogleCalendarEvent, input: CalendarEventInput): Promise<void>;
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

function subtractMinutes(timestamp: string, minutes: number): string {
  return new Date(new Date(timestamp).getTime() - minutes * 60_000).toISOString();
}

function mergeTasks(existing: readonly GoogleTask[], changes: readonly GoogleTask[]): GoogleTask[] {
  const tasks = new Map(existing.map((task) => [task.id, task]));
  for (const task of changes) {
    if (task.deleted) {
      if (tasks.get(task.id)?.listId === task.listId) {
        tasks.delete(task.id);
      }
    } else {
      tasks.set(task.id, task);
    }
  }
  return [...tasks.values()];
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
    transparency: input.transparency,
    colorId: input.colorId,
    guestsCanInviteOthers: input.guestsCanInviteOthers,
    guestsCanModify: input.guestsCanModify,
    guestsCanSeeOtherGuests: input.guestsCanSeeOtherGuests,
    eventType: input.eventType,
    focusTimeProperties: input.focusTimeProperties,
    outOfOfficeProperties: input.outOfOfficeProperties,
    workingLocationProperties: input.workingLocationProperties
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

function recurrenceUntilBefore(start: GoogleCalendarEvent["start"]): string {
  if (start.date) {
    const previous = new Date(`${start.date}T00:00:00Z`);
    previous.setUTCDate(previous.getUTCDate() - 1);
    return `${previous.getUTCFullYear()}${String(previous.getUTCMonth() + 1).padStart(2, "0")}${String(previous.getUTCDate()).padStart(2, "0")}`;
  }
  const previous = new Date(new Date(start.dateTime ?? 0).getTime() - 1_000);
  if (Number.isNaN(previous.valueOf())) throw new Error("The recurring instance has no valid original start time");
  return `${previous.getUTCFullYear()}${String(previous.getUTCMonth() + 1).padStart(2, "0")}${String(previous.getUTCDate()).padStart(2, "0")}T${String(previous.getUTCHours()).padStart(2, "0")}${String(previous.getUTCMinutes()).padStart(2, "0")}${String(previous.getUTCSeconds()).padStart(2, "0")}Z`;
}

function trimRecurrenceBefore(lines: readonly string[] | undefined, firstChangedStart: GoogleCalendarEvent["start"]): readonly string[] {
  if (!lines?.some((line) => line.startsWith("RRULE:"))) throw new Error("The recurring event has no RRULE to split");
  const until = recurrenceUntilBefore(firstChangedStart);
  return lines.map((line) => {
    if (!line.startsWith("RRULE:")) return line;
    const parts = line.slice("RRULE:".length).split(";").filter((part) => !part.startsWith("UNTIL=") && !part.startsWith("COUNT="));
    return `RRULE:${[...parts, `UNTIL=${until}`].join(";")}`;
  });
}

function isLocalId(id: string): boolean {
  return id.startsWith("local-");
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  maximum: number,
  callback: (value: T) => Promise<R>,
  signal?: AbortSignal
): Promise<R[]> {
  const result: R[] = [];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(maximum, values.length) }, async () => {
    while (cursor < values.length) {
      throwIfAborted(signal);
      const index = cursor;
      cursor += 1;
      result[index] = await callback(values[index]);
      throwIfAborted(signal);
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

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new DOMException("Sync was cancelled", "AbortError");
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function isQuotaError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "QuotaExceededError";
}

function storagePressured(estimate: StorageEstimate): boolean {
  if (!estimate.usage || !estimate.quota) {
    return false;
  }
  return estimate.usage / estimate.quota >= 0.8 || estimate.quota - estimate.usage < 50 * 1024 * 1024;
}

export function useWorkspace(): WorkspaceController {
  const [clientId, setClientId] = useState("");
  const [onboardingDisplayTimeZone, setOnboardingDisplayTimeZone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  const [connectionProfile, setConnectionProfile] = useState<ConnectionProfile>({ mode: "direct" });
  const [managedSession, setManagedSession] = useState<(GoogleIdentity & { readonly scopes: readonly string[] }) | undefined>();
  const [workspace, setWorkspace] = useState<WorkspaceSnapshot | undefined>(emptyWorkspace);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Configure your Google Web OAuth client to begin");
  const [syncProgress, setSyncProgress] = useState<SyncProgress>(idleSyncProgress);
  const [eventConflict, setEventConflict] = useState<EventConflict | undefined>();
  const [preferences, setPreferences] = useState<WorkspacePreferences>(defaultWorkspacePreferences);
  const [taskMetadata, setTaskMetadata] = useState<readonly TaskMetadata[]>([]);
  const [scheduledTaskBlocks, setScheduledTaskBlocks] = useState<readonly ScheduledTaskBlock[]>([]);
  const [conflicts, setConflicts] = useState<readonly WorkspaceConflict[]>([]);
  const [undoEntries, setUndoEntries] = useState<readonly UndoEntry[]>([]);
  const [invitationEvents, setInvitationEvents] = useState<readonly GoogleCalendarEvent[]>([]);
  const [savedSearches, setSavedSearches] = useState<readonly SavedSearch[]>([]);
  const workspaceRef = useRef<WorkspaceSnapshot | undefined>(workspace);
  const syncAbortRef = useRef<AbortController | undefined>(undefined);
  const connectionProfileRef = useRef<ConnectionProfile>(connectionProfile);
  const managedSessionRef = useRef<(GoogleIdentity & { readonly scopes: readonly string[] }) | undefined>(undefined);
  const onboardingDisplayTimeZoneRef = useRef(onboardingDisplayTimeZone);

  const rememberConnectionProfile = useCallback((profile: ConnectionProfile) => {
    connectionProfileRef.current = profile;
    setConnectionProfile(profile);
  }, []);

  const rememberManagedSession = useCallback((next: (GoogleIdentity & { readonly scopes: readonly string[] }) | undefined) => {
    managedSessionRef.current = next;
    setManagedSession(next);
  }, []);

  const replaceWorkspace = useCallback((next: WorkspaceSnapshot | undefined) => {
    workspaceRef.current = next;
    setWorkspace(next);
  }, []);

  const loadSubjectState = useCallback(async (subject: string) => {
    const [nextPreferences, metadata, blocks, storedConflicts, searches] = await Promise.all([
      localStore.readPreferences(subject),
      localStore.readTaskMetadata(subject),
      localStore.readScheduledTaskBlocks(subject),
      localStore.readConflicts(subject),
      localStore.readSavedSearches(subject)
    ]);
    await localStore.cleanupUndoEntries(subject, nextPreferences.undoMaximumEntries);
    const storedUndo = await localStore.readUndoEntries(subject);
    setPreferences(nextPreferences);
    setTaskMetadata(metadata);
    setScheduledTaskBlocks(blocks);
    setConflicts(storedConflicts);
    setUndoEntries(storedUndo);
    setSavedSearches(searches);
  }, []);

  useEffect(() => {
    void (async () => {
      const managedResult = new URLSearchParams(window.location.search).get("managed");
      if (managedResult === "connected" || managedResult === "error") {
        const url = new URL(window.location.href);
        url.searchParams.delete("managed");
        window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
      }
      try {
        const [storedClientId, storedProfile, activeSubject, setupTimeZone] = await Promise.all([localStore.getClientId(), localStore.getConnectionProfile(), localStore.getActiveSubject(), localStore.getSetupDisplayTimeZone()]);
        onboardingDisplayTimeZoneRef.current = setupTimeZone;
        setOnboardingDisplayTimeZone(setupTimeZone);
        if (storedClientId) {
          setClientId(storedClientId);
        }
        rememberConnectionProfile(storedProfile);
        const managed = storedProfile.mode === "managed" && storedProfile.backendOrigin
          ? await readManagedSession(storedProfile.backendOrigin).catch(() => undefined)
          : undefined;
        rememberManagedSession(managed);
        const subject = managed?.subject ?? activeSubject;
        if (subject) {
          if (!(await localStore.hasPreferences(subject))) {
            await localStore.updatePreferences(subject, { displayTimeZone: setupTimeZone });
          }
          const snapshot = await localStore.readSnapshot(subject);
          if (snapshot) {
            replaceWorkspace(snapshot);
            await loadSubjectState(subject);
            setStatus(managed ? "Connected through the managed Hot Cross Buns service" : "Showing browser-local data. Select Sync to reconnect Google and update it.");
          } else if (managed) {
            const initial: WorkspaceSnapshot = { identity: managed, taskLists: [], tasks: [], calendars: [], events: [], updatedAt: new Date().toISOString() };
            await localStore.setActiveSubject(managed.subject);
            await localStore.saveSnapshot(initial);
            replaceWorkspace(initial);
            await loadSubjectState(managed.subject);
            setStatus("Connected through the managed Hot Cross Buns service. Syncing Google data is ready.");
          }
        }
        if (managedResult === "error") {
          setStatus("Managed Google authorization was not completed. Your browser-local data is unchanged; try connecting again.");
        } else if (managedResult === "connected" && !managed) {
          setStatus("Managed Google authorization completed, but the browser could not read the new session. Check the managed service’s cookie and allowed-origin settings.");
        }
      } catch (error) {
        setStatus(`Browser storage is unavailable: ${asErrorMessage(error)}`);
      } finally {
        setReady(true);
      }
    })();
  }, [loadSubjectState, rememberConnectionProfile, rememberManagedSession, replaceWorkspace]);

  useEffect(() => {
    const subject = workspace?.identity.subject;
    if (!subject) {
      setInvitationEvents([]);
      return;
    }
    let active = true;
    void localStore.readCanonicalEvents(subject).then((events) => {
      if (active) setInvitationEvents(events.filter((event) => event.attendees?.some((attendee) => attendee.self && attendee.responseStatus === "needsAction")));
    }, () => {
      if (active) setInvitationEvents([]);
    });
    return () => { active = false; };
  }, [workspace]);

  const api = useMemo(() => new GoogleApiClient({
    request(path, init) {
      const profile = connectionProfileRef.current;
      return profile.mode === "managed" && profile.backendOrigin
        ? managedGoogleTransport(profile.backendOrigin).request(path, init)
        : browserGoogleTransport(() => session.accessToken()).request(path, init);
    }
  }), []);

  const hasRemoteAccess = useCallback(() => connectionProfileRef.current.mode === "managed"
    ? Boolean(managedSessionRef.current)
    : Boolean(session.accessToken()), []);

  const saveClientId = useCallback(async (value: string) => {
    const normalized = value.trim();
    if (normalized.length < 10 || normalized.length > 500 || normalized.includes("\0")) {
      throw new Error("Enter a valid Google Web OAuth client ID");
    }
    await localStore.setClientId(normalized);
    setClientId(normalized);
    setStatus("Google Web OAuth client ID saved in this browser");
  }, []);

  const saveOnboardingDisplayTimeZone = useCallback(async (timeZone: string) => {
    const normalized = timeZone.trim();
    try {
      new Intl.DateTimeFormat(undefined, { timeZone: normalized }).format();
    } catch {
      throw new Error("Choose a valid IANA time zone, such as Asia/Singapore");
    }
    await localStore.setSetupDisplayTimeZone(normalized);
    onboardingDisplayTimeZoneRef.current = normalized;
    setOnboardingDisplayTimeZone(normalized);
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
    if (previousId !== task.id && workspaceRef.current) {
      const subject = workspaceRef.current.identity.subject;
      const metadata = taskMetadata.find((entry) => entry.taskId === previousId);
      if (metadata) {
        await localStore.removeTaskMetadata(subject, previousId);
        const remapped = { ...metadata, taskId: task.id, updatedAt: new Date().toISOString() };
        await localStore.saveTaskMetadata(subject, remapped);
        setTaskMetadata((entries) => entries.map((entry) => entry.taskId === previousId ? remapped : entry));
      }
    }
  }, [taskMetadata, updateCachedWorkspace]);

  const replaceEvent = useCallback(async (event: GoogleCalendarEvent, previousId = event.id, previousCalendarId = event.calendarId) => {
    await updateCachedWorkspace((snapshot) => ({
      ...snapshot,
      events: snapshot.events.map((item) => item.id === previousId && item.calendarId === previousCalendarId ? event : item),
      updatedAt: new Date().toISOString()
    }));
    if (workspaceRef.current) {
      const subject = workspaceRef.current.identity.subject;
      if (previousId !== event.id || previousCalendarId !== event.calendarId) await localStore.removeCanonicalEvent(subject, previousCalendarId, previousId);
      await localStore.saveCanonicalEvent(subject, event);
    }
    if ((previousId !== event.id || previousCalendarId !== event.calendarId) && workspaceRef.current) {
      const subject = workspaceRef.current.identity.subject;
      const linked = scheduledTaskBlocks.filter((block) => block.calendarId === previousCalendarId && block.eventId === previousId);
      await Promise.all(linked.map(async (block) => {
        const remapped = { ...block, eventId: event.id, updatedAt: new Date().toISOString() };
        await localStore.saveScheduledTaskBlock(subject, remapped);
        setScheduledTaskBlocks((blocks) => blocks.map((candidate) => candidate.taskId === block.taskId ? remapped : candidate));
      }));
    }
  }, [scheduledTaskBlocks, updateCachedWorkspace]);

  const savePreferences = useCallback(async (update: Partial<WorkspacePreferences>) => {
    const current = workspaceRef.current;
    if (!current) throw new Error("Authorize Google before changing preferences");
    const { displayTimeZone: requestedDisplayTimeZone, ...otherUpdates } = update;
    const displayTimeZone = requestedDisplayTimeZone?.trim();
    if (displayTimeZone !== undefined) {
      try {
        new Intl.DateTimeFormat(undefined, { timeZone: displayTimeZone }).format();
      } catch {
        throw new Error("Choose a valid IANA time zone, such as Asia/Singapore");
      }
    }
    const normalizedUpdate = displayTimeZone === undefined ? otherUpdates : { ...otherUpdates, displayTimeZone };
    const next = await localStore.updatePreferences(current.identity.subject, normalizedUpdate);
    if (displayTimeZone !== undefined) {
      await localStore.setSetupDisplayTimeZone(next.displayTimeZone);
      onboardingDisplayTimeZoneRef.current = next.displayTimeZone;
      setOnboardingDisplayTimeZone(next.displayTimeZone);
    }
    setPreferences(next);
  }, []);

  const saveTaskMetadata = useCallback(async (
    taskId: string,
    update: Pick<TaskMetadata, "priority" | "dueTimeZone">
  ) => {
    const current = workspaceRef.current;
    if (!current) throw new Error("Authorize Google before changing task metadata");
    if (!current.tasks.some((task) => task.id === taskId)) throw new Error("The task is no longer available");
    const previous = taskMetadata.find((entry) => entry.taskId === taskId);
    const next: TaskMetadata = { taskId, priority: update.priority, dueTimeZone: update.dueTimeZone, updatedAt: new Date().toISOString() };
    await localStore.saveTaskMetadata(current.identity.subject, next);
    setTaskMetadata((entries) => previous ? entries.map((entry) => entry.taskId === taskId ? next : entry) : [...entries, next]);
  }, [taskMetadata]);

  const recordUndo = useCallback(async (
    label: string,
    resourceKind: UndoEntry["resourceKind"],
    before: unknown,
    after: unknown,
    mutationIds: readonly string[] = []
  ) => {
    const current = workspaceRef.current;
    if (!current) return;
    const createdAt = new Date();
    const entry: UndoEntry = {
      id: crypto.randomUUID(),
      label,
      resourceKind,
      before,
      after,
      mutationIds,
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(createdAt.getTime() + preferences.undoRetentionDays * 86_400_000).toISOString(),
      state: "undoable"
    };
    await localStore.saveUndoEntry(current.identity.subject, entry);
    await localStore.cleanupUndoEntries(current.identity.subject, preferences.undoMaximumEntries);
    setUndoEntries(await localStore.readUndoEntries(current.identity.subject));
  }, [preferences.undoMaximumEntries, preferences.undoRetentionDays]);

  const saveConflict = useCallback(async (
    kind: EventConflict["kind"],
    calendarId: string,
    eventId: string,
    localInput?: CalendarEventInput,
    reason: WorkspaceConflict["reason"] = "conflict"
  ) => {
    let latest: GoogleCalendarEvent | undefined;
    try { latest = await api.getEvent(calendarId, eventId); } catch { /* 410/auth still retain a recoverable local intent */ }
    const current = workspaceRef.current;
    if (current) {
      const stored: WorkspaceConflict = {
        id: crypto.randomUUID(),
        resourceKind: "event",
        operation: kind,
        resourceId: eventId,
        calendarId,
        localIntent: localInput ?? { delete: true },
        latestRemote: latest ?? { unavailable: true },
        etag: latest?.etag,
        createdAt: new Date().toISOString(),
        retryState: "pending",
        reason
      };
      await localStore.saveConflict(current.identity.subject, stored);
      setConflicts((items) => [stored, ...items]);
    }
    if (preferences.conflictPolicy === "prefer-google" && latest) {
      await replaceEvent(latest);
      setStatus("Google's newer event version was kept. The local intent is available in conflict history.");
      return;
    }
    if (latest) {
      setEventConflict({ kind, latest, localInput });
      setStatus(preferences.conflictPolicy === "prefer-local" ? "Google changed this event; review and confirm the local overwrite." : "This event changed in Google. Choose which version to keep.");
    } else {
      setStatus(reason === "gone" ? "The event no longer exists in Google. Its local intent is retained in conflict history." : "The event could not be refreshed. Its local intent is retained in conflict history.");
    }
  }, [api, preferences.conflictPolicy, replaceEvent]);

  const saveTaskConflict = useCallback(async (task: GoogleTask, operation: WorkspaceConflict["operation"], localIntent: unknown, reason: WorkspaceConflict["reason"] = "conflict") => {
    const current = workspaceRef.current;
    if (!current) return;
    let latest: GoogleTask | undefined;
    try { latest = await api.getTask(task.listId, task.id); } catch { /* deletion and authorization conflicts retain the local intent for recovery */ }
    const stored: WorkspaceConflict = {
      id: crypto.randomUUID(),
      resourceKind: "task",
      operation,
      resourceId: task.id,
      localIntent,
      latestRemote: latest ?? { unavailable: true },
      etag: latest?.etag,
      createdAt: new Date().toISOString(),
      retryState: "pending",
      reason
    };
    await localStore.saveConflict(current.identity.subject, stored);
    setConflicts((items) => [stored, ...items]);
    if (preferences.conflictPolicy === "prefer-google" && latest) {
      await replaceTask(latest);
      setStatus("Google's newer task version was kept. The local intent is available in conflict history.");
    } else {
      setStatus("A task change needs review. Open the task or Settings conflict history before retrying.");
    }
  }, [api, preferences.conflictPolicy, replaceTask]);

  const saveResponseConflict = useCallback(async (
    event: GoogleCalendarEvent,
    responseStatus: "accepted" | "declined" | "tentative" | "needsAction",
    comment: string | undefined,
    reason: WorkspaceConflict["reason"] = "conflict"
  ) => {
    const current = workspaceRef.current;
    if (!current) return;
    let latest: GoogleCalendarEvent | undefined;
    try { latest = await api.getEvent(event.calendarId, event.id); } catch { /* preserve the local RSVP for recovery */ }
    const stored: WorkspaceConflict = {
      id: crypto.randomUUID(),
      resourceKind: "event",
      operation: "respond",
      resourceId: event.id,
      calendarId: event.calendarId,
      localIntent: { responseStatus, comment },
      latestRemote: latest ?? { unavailable: true },
      etag: latest?.etag,
      createdAt: new Date().toISOString(),
      retryState: "pending",
      reason
    };
    await localStore.saveConflict(current.identity.subject, stored);
    setConflicts((items) => [stored, ...items]);
    if (preferences.conflictPolicy === "prefer-google" && latest) {
      await replaceEvent(latest);
      setStatus("Google's newer invitation version was kept. Your response is available in conflict history.");
    } else {
      setStatus("An invitation response needs review. Open Settings conflict history before retrying.");
    }
  }, [api, preferences.conflictPolicy, replaceEvent]);

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
            const updated = await api.updateTask(mutation.payload.listId, mutation.payload.taskId, mutation.payload.patch, mutation.payload.etag);
            await replaceTask(updated);
            break;
          }
          case "task-delete":
            await api.deleteTask(mutation.payload.listId, mutation.payload.taskId, mutation.payload.etag);
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
          case "event-respond": {
            const updated = await api.updateAttendeeResponse(
              mutation.payload.calendarId,
              mutation.payload.eventId,
              mutation.payload.responseStatus,
              mutation.payload.comment,
              mutation.payload.etag
            );
            await replaceEvent(updated);
            break;
          }
        }
        await localStore.removeMutation(mutation.id);
      } catch (error) {
        if (error instanceof GoogleApiError && (error.status === 409 || error.status === 410 || error.status === 412) && (mutation.kind === "task-update" || mutation.kind === "task-delete" || mutation.kind === "task-move")) {
          await localStore.removeMutation(mutation.id);
          const task = workspaceRef.current?.tasks.find((candidate) => candidate.id === mutation.payload.taskId)
            ?? { id: mutation.payload.taskId, listId: mutation.payload.listId, title: "", status: "needsAction" as const };
          const localIntent = mutation.kind === "task-update" ? mutation.payload.patch : mutation.kind === "task-move" ? mutation.payload.move : { delete: true };
          await saveTaskConflict(task, mutation.kind === "task-delete" ? "delete" : "update", localIntent, error.status === 410 ? "gone" : "conflict");
          continue;
        }
        if (error instanceof GoogleApiError && (error.status === 409 || error.status === 410 || error.status === 412) && (mutation.kind === "event-update" || mutation.kind === "event-delete")) {
          await localStore.removeMutation(mutation.id);
          await saveConflict(
            mutation.kind === "event-update" ? "update" : "delete",
            mutation.payload.calendarId,
            mutation.payload.eventId,
            mutation.kind === "event-update" ? mutation.payload.patch : undefined,
            error.status === 410 ? "gone" : "conflict"
          );
          continue;
        }
        if (error instanceof GoogleApiError && (error.status === 409 || error.status === 410 || error.status === 412) && mutation.kind === "event-respond") {
          await localStore.removeMutation(mutation.id);
          const event = workspaceRef.current?.events.find((candidate) => candidate.id === mutation.payload.eventId && candidate.calendarId === mutation.payload.calendarId)
            ?? { id: mutation.payload.eventId, calendarId: mutation.payload.calendarId, summary: "", start: {}, end: {} };
          await saveResponseConflict(event, mutation.payload.responseStatus, mutation.payload.comment, error.status === 410 ? "gone" : "conflict");
          continue;
        }
        if (!queueable(error)) {
          throw error;
        }
        break;
      }
    }
  }, [api, replaceEvent, replaceTask, saveConflict, saveResponseConflict, saveTaskConflict, updateCachedWorkspace]);

  const ensureRecurringTaskSuccessors = useCallback(async (subject: string, candidates: readonly GoogleTask[]): Promise<number> => {
    const knownOccurrenceIds = new Set(candidates.map((task) => parseTaskRecurrenceNotes(task.notes).marker?.occurrenceId).filter((id): id is string => Boolean(id)));
    const additions: GoogleTask[] = [];
    const metadata: TaskMetadata[] = [];
    for (const task of candidates) {
      if (task.status !== "completed" || task.parent) continue;
      const parsed = parseTaskRecurrenceNotes(task.notes);
      if (parsed.state !== "managed" || !parsed.marker) continue;
      const successor = taskRecurrenceSuccessor(parsed.marker);
      if (!successor || knownOccurrenceIds.has(successor.occurrenceId)) continue;
      const serialized = serializeTaskRecurrenceNotes(parsed.userNotes, successor);
      if (!serialized.notes) continue;
      try {
        const created = await api.createTask(task.listId, {
          title: successor.templateTitle,
          notes: serialized.notes,
          due: `${successor.templateDueDate}T12:00:00.000Z`
        });
        knownOccurrenceIds.add(successor.occurrenceId);
        additions.push(created);
        const localMetadata: TaskMetadata = { taskId: created.id, priority: successor.templatePriority, dueTimeZone: successor.timeZone, updatedAt: new Date().toISOString() };
        metadata.push(localMetadata);
        await localStore.saveTaskMetadata(subject, localMetadata);
      } catch (error) {
        if (!queueable(error)) setStatus(`Could not create a recurring-task successor: ${asErrorMessage(error)}`);
      }
    }
    if (additions.length) {
      await updateCachedWorkspace((snapshot) => ({ ...snapshot, tasks: [...snapshot.tasks, ...additions], updatedAt: new Date().toISOString() }));
      setTaskMetadata((current) => [...current, ...metadata]);
    }
    return additions.length;
  }, [api, updateCachedWorkspace]);

  const synchronize = useCallback(async (signal?: AbortSignal, fullTaskRefresh = false) => {
    if (!hasRemoteAccess()) {
      throw new GoogleAuthorizationRequiredError();
    }
    const current = workspaceRef.current;
    if (!current) {
      throw new Error("Authorize Google before synchronizing");
    }
    const subject = current.identity.subject;
    const syncStartedAt = new Date().toISOString();
    setSyncProgress({ active: true, cancellable: false, phase: "pending", detail: "Saving pending local changes", pagesSaved: 0, recordsSaved: 0 });
    await flushPending(subject);
    throwIfAborted(signal);

    setSyncProgress({ active: true, cancellable: true, phase: "tasks", detail: fullTaskRefresh ? "Refreshing all Google Tasks" : "Checking Google Tasks changes", pagesSaved: 0, recordsSaved: 0 });
    const taskLists = await api.listTaskLists(signal);
    const taskChanges: Array<{ readonly listId: string; readonly changes: readonly GoogleTask[]; readonly initial: boolean }> = [];
    let taskPages = 0;
    let taskRecords = 0;
    for (let index = 0; index < taskLists.length; index += 1) {
      throwIfAborted(signal);
      const taskList = taskLists[index]!;
      const checkpoint = fullTaskRefresh ? undefined : await localStore.readCheckpoint(subject, `tasks:${taskList.id}`);
      const changes: GoogleTask[] = [];
      let pageToken: string | undefined;
      do {
        const page = await api.listTasksPage(taskList.id, checkpoint ? subtractMinutes(checkpoint.updatedAt, 5) : undefined, pageToken, signal);
        changes.push(...page.items);
        pageToken = page.nextPageToken;
        taskPages += 1;
        taskRecords += page.items.length;
        setSyncProgress({ active: true, cancellable: true, phase: "tasks", detail: `${fullTaskRefresh ? "Refreshing" : "Checking"} task list ${index + 1} of ${taskLists.length}`, completed: index, total: taskLists.length, pagesSaved: taskPages, recordsSaved: taskRecords });
        throwIfAborted(signal);
      } while (pageToken);
      taskChanges.push({ listId: taskList.id, changes, initial: fullTaskRefresh || !checkpoint });
      if (!fullTaskRefresh) {
        await localStore.applyTaskChanges(subject, taskList.id, changes, { resource: `tasks:${taskList.id}`, updatedAt: syncStartedAt });
      }
    }
    let tasks = current.tasks.filter((task) => taskLists.some((list) => list.id === task.listId));
    for (const group of taskChanges) {
      const existing = group.initial ? tasks.filter((task) => task.listId !== group.listId) : tasks;
      tasks = group.initial ? [...existing, ...group.changes.filter((task) => !task.deleted)] : mergeTasks(tasks, group.changes);
    }
    if (fullTaskRefresh) {
      await localStore.replaceTaskMirror(subject, taskLists, tasks, syncStartedAt);
      await saveWorkspace({ ...current, taskLists, tasks, updatedAt: new Date().toISOString() });
      const successors = await ensureRecurringTaskSuccessors(subject, tasks);
      setStatus(`Refreshed ${tasks.length} tasks from Google${successors ? ` and created ${successors} recurring successor${successors === 1 ? "" : "s"}` : ""}`);
      setSyncProgress({ active: false, cancellable: false, phase: "complete", detail: "Google Tasks refresh complete", pagesSaved: taskPages, recordsSaved: taskRecords });
      return;
    }

    const estimate = await localStore.storageEstimate().catch(() => ({}));
    if (storagePressured(estimate)) {
      setStatus("Browser storage is under pressure. Calendar sync will clear only regenerable visible-range events if a write runs out of space.");
    }
    let run = await localStore.readCalendarSyncRun(subject);
    if (!run) {
      const checkpoint = await localStore.readCheckpoint(subject, "calendar-list");
      const reset = !checkpoint;
      if (reset) {
        await localStore.beginCalendarListReplacement(subject);
      }
      run = {
        subject,
        startedAt: syncStartedAt,
        phase: "calendar-list",
        calendarListSyncToken: checkpoint?.token,
        calendarListReset: reset,
        calendarIds: [],
        calendarIndex: 0,
        eventReset: false,
        changedCalendarIds: [],
        occurrenceCacheCleared: false,
        pagesSaved: 0,
        recordsSaved: 0
      };
      await localStore.saveCalendarSyncRun(run);
    }
    if (!run) {
      throw new Error("Calendar sync could not start");
    }

    while (run.phase === "calendar-list") {
      throwIfAborted(signal);
      setSyncProgress({ active: true, cancellable: true, phase: "calendar-list", detail: "Synchronizing Calendar list", pagesSaved: run.pagesSaved, recordsSaved: run.recordsSaved, storage: estimate });
      let page;
      try {
        page = await api.listCalendarChangesPage(run.calendarListSyncToken, run.calendarListPageToken, signal);
      } catch (error) {
        if (!(error instanceof GoogleApiError) || error.status !== 410 || !run.calendarListSyncToken) {
          throw error;
        }
        await localStore.beginCalendarListReplacement(subject);
        run = { ...run, calendarListSyncToken: undefined, calendarListPageToken: undefined, calendarListReset: true };
        await localStore.saveCalendarSyncRun(run);
        continue;
      }
      if (!page.nextPageToken && !page.nextSyncToken) {
        throw new Error("Google Calendar did not return a calendar-list sync token");
      }
      const applyCalendarListPage = () => page.nextPageToken
        ? localStore.applyCalendarListPage(subject, page.items)
        : localStore.applyCalendarListChanges(subject, page.items, {
          resource: "calendar-list",
          token: page.nextSyncToken!,
          updatedAt: syncStartedAt
        });
      try {
        await applyCalendarListPage();
      } catch (error) {
        if (!isQuotaError(error)) {
          throw error;
        }
        setStatus("Browser storage is full. Cleared regenerable visible-range events and retrying this Calendar-list page.");
        await localStore.clearOccurrenceCache(subject);
        run = { ...run, occurrenceCacheCleared: true };
        await localStore.saveCalendarSyncRun(run);
        await applyCalendarListPage();
      }
      run = { ...run, calendarListPageToken: page.nextPageToken, pagesSaved: run.pagesSaved + 1, recordsSaved: run.recordsSaved + page.items.length };
      if (page.nextPageToken) {
        await localStore.saveCalendarSyncRun(run);
        continue;
      }
      const snapshot = await localStore.readSnapshot(subject);
      run = { ...run, phase: "calendar-events", calendarIds: snapshot?.calendars.filter((calendar) => !calendar.deleted).map((calendar) => calendar.id) ?? [], calendarIndex: 0, calendarListPageToken: undefined };
      await localStore.saveCalendarSyncRun(run);
    }

    while (run.calendarIndex < run.calendarIds.length) {
      throwIfAborted(signal);
      const calendarId = run.calendarIds[run.calendarIndex]!;
      const resource = `calendar-events:${calendarId}`;
      if (!run.eventSyncToken && !run.eventPageToken && !run.eventReset) {
        const checkpoint = await localStore.readCheckpoint(subject, resource);
        run = { ...run, eventSyncToken: checkpoint?.token, eventReset: !checkpoint };
        if (!checkpoint) {
          await localStore.replaceCalendarEventCache(subject, calendarId, { resource, updatedAt: syncStartedAt });
        }
        await localStore.saveCalendarSyncRun(run);
      }
      setSyncProgress({ active: true, cancellable: true, phase: "calendar-events", detail: `Synchronizing calendar ${run.calendarIndex + 1} of ${run.calendarIds.length}`, completed: run.calendarIndex, total: run.calendarIds.length, pagesSaved: run.pagesSaved, recordsSaved: run.recordsSaved, storage: estimate });
      let page;
      try {
        page = await api.listCalendarEventChangesPage(calendarId, run.eventSyncToken, run.eventPageToken, signal);
      } catch (error) {
        if (!(error instanceof GoogleApiError) || error.status !== 410 || !run.eventSyncToken) {
          throw error;
        }
        await localStore.replaceCalendarEventCache(subject, calendarId, { resource, updatedAt: syncStartedAt });
        run = { ...run, eventSyncToken: undefined, eventPageToken: undefined, eventReset: true };
        await localStore.saveCalendarSyncRun(run);
        continue;
      }
      if (!page.nextPageToken && !page.nextSyncToken) {
        throw new Error(`Google Calendar did not return a sync token for ${calendarId}`);
      }
      const invalidateOccurrences = !run.eventPageToken;
      const applyPage = () => page.nextPageToken
        ? localStore.applyCalendarEventPage(subject, calendarId, page.items, invalidateOccurrences)
        : localStore.applyCalendarEventChanges(subject, calendarId, page.items, {
          resource,
          token: page.nextSyncToken!,
          updatedAt: syncStartedAt
        });
      try {
        await applyPage();
      } catch (error) {
        if (!isQuotaError(error)) {
          throw error;
        }
        setStatus("Browser storage is full. Cleared regenerable visible-range events and retrying this Calendar page.");
        await localStore.clearOccurrenceCache(subject);
        run = { ...run, occurrenceCacheCleared: true };
        await localStore.saveCalendarSyncRun(run);
        await applyPage();
      }
      const changedCalendarIds: readonly string[] = (run.eventReset || page.items.length > 0) && !run.changedCalendarIds.includes(calendarId)
        ? [...run.changedCalendarIds, calendarId]
        : run.changedCalendarIds;
      run = { ...run, changedCalendarIds, eventPageToken: page.nextPageToken, pagesSaved: run.pagesSaved + 1, recordsSaved: run.recordsSaved + page.items.length };
      if (page.nextPageToken) {
        await localStore.saveCalendarSyncRun(run);
        continue;
      }
      run = { ...run, calendarIndex: run.calendarIndex + 1, eventSyncToken: undefined, eventPageToken: undefined, eventReset: false };
      await localStore.saveCalendarSyncRun(run);
    }

    const snapshot = await localStore.readSnapshot(subject);
    const calendars = (snapshot?.calendars ?? []).filter((calendar) => !calendar.deleted);
    const range = toIsoRange();
    const changedCalendarIds = new Set(run.changedCalendarIds);
    const calendarsToLoad = run.occurrenceCacheCleared ? calendars : calendars.filter((calendar) => changedCalendarIds.has(calendar.id));
    let occurrencesLoaded = 0;
    setSyncProgress({ active: true, cancellable: true, phase: "occurrences", detail: calendarsToLoad.length > 0 ? "Loading the visible Calendar range" : "Using the existing visible Calendar range", completed: 0, total: calendarsToLoad.length, pagesSaved: run.pagesSaved, recordsSaved: run.recordsSaved, storage: estimate });
    const eventGroups = await mapWithConcurrency(
      calendarsToLoad,
      4,
      async (calendar) => {
        const events = await api.listCalendarOccurrences(calendar.id, range.start, range.end, signal);
        occurrencesLoaded += 1;
        setSyncProgress({ active: true, cancellable: true, phase: "occurrences", detail: "Loading the visible Calendar range", completed: occurrencesLoaded, total: calendarsToLoad.length, pagesSaved: run.pagesSaved, recordsSaved: run.recordsSaved, storage: estimate });
        return events;
      },
      signal
    );
    throwIfAborted(signal);
    const calendarIds = new Set(calendars.map((calendar) => calendar.id));
    const retainedEvents = run.occurrenceCacheCleared
      ? []
      : current.events.filter((event) => calendarIds.has(event.calendarId) && !changedCalendarIds.has(event.calendarId));
    const next: WorkspaceSnapshot = {
      identity: current.identity,
      taskLists,
      tasks,
      calendars,
      events: [...retainedEvents, ...eventGroups.flat()],
      updatedAt: new Date().toISOString()
    };
    await saveWorkspace(next);
    const successors = await ensureRecurringTaskSuccessors(subject, next.tasks);
    const canonicalEvents = await localStore.readCanonicalEvents(subject);
    const knownEvents = new Set(canonicalEvents.map((event) => `${event.calendarId}:${event.id}`));
    const orphanedBlocks = scheduledTaskBlocks.filter((block) => !knownEvents.has(`${block.calendarId}:${block.eventId}`));
    if (orphanedBlocks.length) {
      await Promise.all(orphanedBlocks.map((block) => localStore.removeScheduledTaskBlock(subject, block.taskId)));
      setScheduledTaskBlocks((blocks) => blocks.filter((block) => !orphanedBlocks.some((orphan) => orphan.taskId === block.taskId)));
    }
    await localStore.clearCalendarSyncRun(subject);
    setStatus(`Synced ${next.tasks.length} tasks and ${calendars.length} calendars${successors ? `. Created ${successors} recurring-task successor${successors === 1 ? "" : "s"}` : ""}${orphanedBlocks.length ? `. Repaired ${orphanedBlocks.length} orphaned scheduled-task link${orphanedBlocks.length === 1 ? "" : "s"}` : ""}`);
    setSyncProgress({ active: false, cancellable: false, phase: "complete", detail: "Sync complete", completed: calendarsToLoad.length, total: calendarsToLoad.length, pagesSaved: run.pagesSaved, recordsSaved: run.recordsSaved, storage: estimate });
  }, [api, ensureRecurringTaskSuccessors, flushPending, hasRemoteAccess, saveWorkspace, scheduledTaskBlocks]);

  const loadCalendarRange = useCallback(async (timeMin: string, timeMax: string) => {
    const current = workspaceRef.current;
    if (!current || !hasRemoteAccess()) {
      return;
    }
    setBusy(true);
    try {
      const eventGroups = await mapWithConcurrency(
        current.calendars,
        4,
        (calendar) => api.listCalendarOccurrences(calendar.id, timeMin, timeMax)
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
  }, [api, hasRemoteAccess, updateCachedWorkspace]);

  const connect = useCallback(async (fullTaskRefresh = false) => {
    if (connectionProfileRef.current.mode === "managed") {
      const backendOrigin = connectionProfileRef.current.backendOrigin;
      if (!backendOrigin) throw new Error("The managed backend URL is not configured for this build");
      beginManagedAuthorization(backendOrigin);
      return;
    }
    if (!clientId) {
      throw new Error("Save your Google Web OAuth client ID first");
    }
    setBusy(true);
    setStatus(workspaceRef.current ? "Reconnecting Google" : "Waiting for Google authorization");
    try {
      const token = await requestGoogleAccessToken(clientId, INITIAL_GOOGLE_SCOPES);
      session.set(token);
      const identity = await fetchGoogleIdentity(token.value);
      await localStore.setActiveSubject(identity.subject);
      if (!(await localStore.hasPreferences(identity.subject))) {
        await localStore.updatePreferences(identity.subject, { displayTimeZone: onboardingDisplayTimeZoneRef.current });
      }
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
      await loadSubjectState(identity.subject);
      const controller = new AbortController();
      syncAbortRef.current = controller;
      await synchronize(controller.signal, fullTaskRefresh);
    } catch (error) {
      setStatus(isAbortError(error) ? "Sync paused. Choose Sync now after reconnecting Google to resume Calendar history." : asErrorMessage(error));
      throw error;
    } finally {
      syncAbortRef.current = undefined;
      setBusy(false);
    }
  }, [clientId, loadSubjectState, saveWorkspace, synchronize]);

  const connectManaged = useCallback(async () => {
    const profile = managedConnectionProfile();
    if (!profile?.backendOrigin) throw new Error("This app build does not have a managed backend configured");
    await localStore.setConnectionProfile(profile);
    rememberConnectionProfile(profile);
    session.clear();
    rememberManagedSession(undefined);
    setStatus("Opening managed Google authorization");
    beginManagedAuthorization(profile.backendOrigin);
  }, [rememberConnectionProfile, rememberManagedSession]);

  const useDirectConnection = useCallback(async () => {
    const profile: ConnectionProfile = { mode: "direct" };
    await localStore.setConnectionProfile(profile);
    rememberConnectionProfile(profile);
    rememberManagedSession(undefined);
    session.clear();
    setStatus("Direct browser connection selected. Save your Google client ID, then connect.");
  }, [rememberConnectionProfile, rememberManagedSession]);

  const sync = useCallback(async () => {
    if (syncAbortRef.current) {
      throw new Error("A synchronization is already running");
    }
    if (!hasRemoteAccess()) {
      await connect();
      return;
    }
    const controller = new AbortController();
    syncAbortRef.current = controller;
    setBusy(true);
    try {
      await synchronize(controller.signal);
    } catch (error) {
      if (isAbortError(error)) {
        const current = workspaceRef.current;
        const resumable = current ? await localStore.readCalendarSyncRun(current.identity.subject) : undefined;
        setStatus(resumable ? "Sync paused. Reconnect Google if needed, then choose Sync now to resume Calendar history." : "Sync cancelled before Calendar history started.");
        setSyncProgress((progress) => ({ ...progress, active: false, cancellable: false, phase: "paused", detail: "Sync paused; saved Calendar pages can resume" }));
        return;
      }
      const message = isQuotaError(error)
        ? "Browser storage is still full after clearing visible-range events. Free browser storage or clear local data, then choose Sync now to resume Calendar history."
        : asErrorMessage(error);
      setStatus(message);
      setSyncProgress((progress) => ({ ...progress, active: false, cancellable: false, phase: "error", detail: message }));
      throw error;
    } finally {
      if (syncAbortRef.current === controller) {
        syncAbortRef.current = undefined;
      }
      setBusy(false);
    }
  }, [connect, hasRemoteAccess, synchronize]);

  const cancelSync = useCallback(() => {
    syncAbortRef.current?.abort();
  }, []);

  const refreshAllTasks = useCallback(async () => {
    if (syncAbortRef.current) {
      throw new Error("A synchronization is already running");
    }
    if (!hasRemoteAccess()) {
      await connect(true);
      return;
    }
    const controller = new AbortController();
    syncAbortRef.current = controller;
    setBusy(true);
    try {
      await synchronize(controller.signal, true);
    } catch (error) {
      if (isAbortError(error)) {
        setStatus("Google Tasks refresh cancelled. Your existing browser-local task cache was kept.");
        setSyncProgress((progress) => ({ ...progress, active: false, cancellable: false, phase: "paused", detail: "Tasks refresh cancelled" }));
        return;
      }
      setStatus(asErrorMessage(error));
      setSyncProgress((progress) => ({ ...progress, active: false, cancellable: false, phase: "error", detail: asErrorMessage(error) }));
      throw error;
    } finally {
      if (syncAbortRef.current === controller) {
        syncAbortRef.current = undefined;
      }
      setBusy(false);
    }
  }, [connect, hasRemoteAccess, synchronize]);

  const authorizeDrive = useCallback(async () => {
    if (connectionProfileRef.current.mode === "managed") {
      const backendOrigin = connectionProfileRef.current.backendOrigin;
      if (!backendOrigin) throw new Error("The managed backend URL is not configured for this build");
      beginManagedAuthorization(backendOrigin, "drive");
      return;
    }
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
    const driveAuthorized = connectionProfileRef.current.mode === "managed"
      ? managedSessionRef.current?.scopes.includes(GOOGLE_SCOPES.driveMetadata)
      : session.hasScope(GOOGLE_SCOPES.driveMetadata);
    if (!driveAuthorized) {
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
      await recordUndo(`Create task “${created.title || "Untitled task"}”`, "task", undefined, created);
      return created;
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
      const localTask: GoogleTask = { id: temporaryId, listId, status: "needsAction", ...task };
      await updateCachedWorkspace((snapshot) => ({
        ...snapshot,
        tasks: [...snapshot.tasks, localTask],
        updatedAt: new Date().toISOString()
      }));
      await recordUndo(`Create task “${task.title}”`, "task", undefined, localTask);
      setStatus("Task saved locally and will sync after you reconnect Google");
      return localTask;
    }
  }, [api, recordUndo, updateCachedWorkspace]);

  const updateTask = useCallback(async (task: GoogleTask, patch: Partial<GoogleTask>) => {
    const current = workspaceRef.current;
    if (!current) {
      throw new Error("Authorize Google before making changes");
    }
    if (isLocalId(task.id)) {
      throw new Error("Reconnect Google before editing a task that is still waiting to be created");
    }
    try {
      const updated = await api.updateTask(task.listId, task.id, patch, task.etag);
      await replaceTask(updated);
      await recordUndo(`Edit task “${task.title || "Untitled task"}”`, "task", task, updated);
    } catch (error) {
      if (error instanceof GoogleApiError && (error.status === 409 || error.status === 410 || error.status === 412)) {
        await saveTaskConflict(task, "update", patch, error.status === 410 ? "gone" : "conflict");
        throw error;
      }
      if (!queueable(error)) {
        throw error;
      }
      await localStore.queueMutation({
        id: crypto.randomUUID(),
        subject: current.identity.subject,
        kind: "task-update",
        createdAt: new Date().toISOString(),
        payload: { listId: task.listId, taskId: task.id, patch, etag: task.etag }
      });
      await replaceTask({ ...task, ...patch });
      await recordUndo(`Edit task “${task.title || "Untitled task"}”`, "task", task, { ...task, ...patch });
      setStatus("Task change saved locally and will sync after you reconnect Google");
    }
  }, [api, recordUndo, replaceTask, saveTaskConflict]);

  const toggleTask = useCallback(async (task: GoogleTask) => {
    await updateTask(task, task.status === "completed"
      ? { status: "needsAction", completed: undefined }
      : { status: "completed", completed: new Date().toISOString() });
    if (task.status === "completed" || task.parent) return;
    const recurrence = parseTaskRecurrenceNotes(task.notes);
    const successor = recurrence.state === "managed" && recurrence.marker ? taskRecurrenceSuccessor(recurrence.marker) : undefined;
    if (!successor || !workspaceRef.current) return;
    const duplicate = workspaceRef.current.tasks.some((candidate) => parseTaskRecurrenceNotes(candidate.notes).marker?.occurrenceId === successor.occurrenceId);
    if (duplicate) return;
    const notes = serializeTaskRecurrenceNotes(recurrence.userNotes, successor);
    if (!notes.notes) {
      setStatus(notes.error ?? "The recurring task could not create its successor");
      return;
    }
    await createTask(task.listId, {
      title: successor.templateTitle,
      notes: notes.notes,
      due: `${successor.templateDueDate}T12:00:00.000Z`
    });
    const successorTask = workspaceRef.current?.tasks.find((candidate) => parseTaskRecurrenceNotes(candidate.notes).marker?.occurrenceId === successor.occurrenceId);
    if (successorTask) {
      await saveTaskMetadata(successorTask.id, { priority: successor.templatePriority, dueTimeZone: successor.timeZone });
    }
  }, [createTask, saveTaskMetadata, updateTask]);

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
    const removeLocalLinks = async () => {
      await localStore.removeTaskMetadata(current.identity.subject, task.id);
      await localStore.removeScheduledTaskBlock(current.identity.subject, task.id);
      setTaskMetadata((entries) => entries.filter((entry) => entry.taskId !== task.id));
      setScheduledTaskBlocks((entries) => entries.filter((entry) => entry.taskId !== task.id));
    };
    try {
      await api.deleteTask(task.listId, task.id, task.etag);
      await remove();
      await removeLocalLinks();
      await recordUndo(`Delete task “${task.title || "Untitled task"}”`, "task", task, undefined);
    } catch (error) {
      if (error instanceof GoogleApiError && (error.status === 409 || error.status === 410 || error.status === 412)) {
        await saveTaskConflict(task, "delete", { delete: true }, error.status === 410 ? "gone" : "conflict");
        throw error;
      }
      if (!queueable(error)) {
        throw error;
      }
      await localStore.queueMutation({
        id: crypto.randomUUID(),
        subject: current.identity.subject,
        kind: "task-delete",
        createdAt: new Date().toISOString(),
        payload: { listId: task.listId, taskId: task.id, etag: task.etag }
      });
      await remove();
      await removeLocalLinks();
      await recordUndo(`Delete task “${task.title || "Untitled task"}”`, "task", task, undefined);
      setStatus("Task deleted locally and will sync after you reconnect Google");
    }
  }, [api, recordUndo, saveTaskConflict, updateCachedWorkspace]);

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
      await recordUndo(`Move task “${task.title || "Untitled task"}”`, "task", task, moved);
    } catch (error) {
      if (error instanceof GoogleApiError && (error.status === 409 || error.status === 410 || error.status === 412)) {
        await saveTaskConflict(task, "update", move, error.status === 410 ? "gone" : "conflict");
        throw error;
      }
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
      await recordUndo(`Move task “${task.title || "Untitled task"}”`, "task", task, optimistic);
      setStatus("Task move saved locally and will sync after you reconnect Google");
    }
  }, [api, recordUndo, replaceTask, saveTaskConflict]);

  const createCalendar = useCallback(async (input: CalendarInput) => {
    const normalized = input.summary.trim();
    if (!workspaceRef.current || !normalized) {
      throw new Error("Enter a calendar name after authorizing Google");
    }
    const created = await api.createCalendar({
      summary: normalized,
      description: input.description?.trim() || undefined,
      timeZone: input.timeZone
    });
    await updateCachedWorkspace((snapshot) => ({
      ...snapshot,
      calendars: [...snapshot.calendars, { ...created, accessRole: "owner" }],
      updatedAt: new Date().toISOString()
    }));
    setStatus(`Created the ${normalized} calendar`);
  }, [api, updateCachedWorkspace]);

  const subscribeCalendar = useCallback(async (calendarId: string) => {
    const normalized = calendarId.trim();
    if (!workspaceRef.current || !normalized) {
      throw new Error("Enter a Google Calendar ID after authorizing Google");
    }
    const subscribed = await api.subscribeCalendar(normalized);
    await updateCachedWorkspace((snapshot) => ({
      ...snapshot,
      calendars: snapshot.calendars.some((calendar) => calendar.id === subscribed.id)
        ? snapshot.calendars.map((calendar) => calendar.id === subscribed.id ? subscribed : calendar)
        : [...snapshot.calendars, subscribed],
      updatedAt: new Date().toISOString()
    }));
    setStatus(`Added ${subscribed.summary} to your Google Calendar list`);
  }, [api, updateCachedWorkspace]);

  const removeCalendarFromList = useCallback(async (calendar: GoogleCalendar) => {
    if (!workspaceRef.current) {
      throw new Error("Authorize Google before making changes");
    }
    if (calendar.primary || calendar.accessRole === "owner") {
      throw new Error("Google does not let this app remove a primary or owner calendar from your list");
    }
    await api.removeCalendarFromList(calendar.id);
    await updateCachedWorkspace((snapshot) => ({
      ...snapshot,
      calendars: snapshot.calendars.filter((item) => item.id !== calendar.id),
      events: snapshot.events.filter((event) => event.calendarId !== calendar.id),
      updatedAt: new Date().toISOString()
    }));
    setStatus(`Removed ${calendar.summary} from your Google Calendar list`);
  }, [api, updateCachedWorkspace]);

  const queryAvailability = useCallback(async (calendarIds: readonly string[], timeMin: string, timeMax: string) => {
    if (!workspaceRef.current) {
      throw new Error("Authorize Google before checking availability");
    }
    if (calendarIds.length === 0) {
      throw new Error("Choose at least one calendar");
    }
    if (calendarIds.length > 50) {
      throw new Error("Google can check availability for up to 50 calendars at once");
    }
    return api.queryFreeBusy(calendarIds, timeMin, timeMax);
  }, [api]);

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
      await localStore.saveCanonicalEvent(current.identity.subject, created);
      await recordUndo(`Create event “${created.summary || "Untitled event"}”`, "event", undefined, created);
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
        transparency: event.transparency,
        colorId: event.colorId,
        guestsCanInviteOthers: event.guestsCanInviteOthers,
        guestsCanModify: event.guestsCanModify,
        guestsCanSeeOtherGuests: event.guestsCanSeeOtherGuests,
        eventType: event.eventType,
        focusTimeProperties: event.focusTimeProperties,
        outOfOfficeProperties: event.outOfOfficeProperties,
        workingLocationProperties: event.workingLocationProperties
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
      await localStore.saveCanonicalEvent(current.identity.subject, localEvent);
      await recordUndo(`Create event “${event.summary || "Untitled event"}”`, "event", undefined, localEvent);
      setStatus("Event saved locally and will sync after you reconnect Google");
    }
  }, [api, recordUndo, updateCachedWorkspace]);

  const getEvent = useCallback(async (calendarId: string, eventId: string) => {
    if (!workspaceRef.current) {
      throw new Error("Authorize Google before viewing an event");
    }
    return api.getEvent(calendarId, eventId);
  }, [api]);

  const respondToEvent = useCallback(async (
    event: GoogleCalendarEvent,
    responseStatus: "accepted" | "declined" | "tentative" | "needsAction",
    comment?: string
  ) => {
    if (!workspaceRef.current) {
      throw new Error("Authorize Google before responding to an event");
    }
    if (isLocalId(event.id)) {
      throw new Error("Reconnect Google before responding to an event that is still waiting to be created");
    }
    try {
      const updated = await api.updateAttendeeResponse(event.calendarId, event.id, responseStatus, comment, event.etag);
      await replaceEvent(updated);
      setStatus(`Invitation response saved: ${responseStatus}`);
      return updated;
    } catch (error) {
      if (error instanceof GoogleApiError && (error.status === 409 || error.status === 410 || error.status === 412)) {
        await saveResponseConflict(event, responseStatus, comment, error.status === 410 ? "gone" : "conflict");
        throw error;
      }
      if (!queueable(error)) throw error;
      await localStore.queueMutation({
        id: crypto.randomUUID(),
        subject: workspaceRef.current!.identity.subject,
        kind: "event-respond",
        createdAt: new Date().toISOString(),
        payload: { calendarId: event.calendarId, eventId: event.id, responseStatus, comment, etag: event.etag }
      });
      const attendees = event.attendees?.map((attendee) => attendee.self ? { ...attendee, responseStatus, comment } : attendee);
      const optimistic = { ...event, attendees };
      await replaceEvent(optimistic);
      setStatus(`Invitation response saved locally: ${responseStatus}`);
      return optimistic;
    }
  }, [api, replaceEvent, saveResponseConflict]);

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
      await recordUndo(`Edit event “${event.summary || "Untitled event"}”`, "event", event, updated);
      return "updated";
    } catch (error) {
      if (error instanceof GoogleApiError && (error.status === 409 || error.status === 410 || error.status === 412)) {
        await saveConflict("update", event.calendarId, event.id, input, error.status === 410 ? "gone" : "conflict");
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
      await recordUndo(`Edit event “${event.summary || "Untitled event"}”`, "event", event, eventFromInput(event, input));
      setStatus("Event change saved locally and will sync after you reconnect Google");
      return "updated";
    }
  }, [api, recordUndo, replaceEvent, saveConflict]);

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
      await localStore.removeCanonicalEvent(current.identity.subject, event.calendarId, event.id);
      await recordUndo(`Delete event “${event.summary || "Untitled event"}”`, "event", event, undefined);
      return "deleted";
    } catch (error) {
      if (error instanceof GoogleApiError && (error.status === 409 || error.status === 410 || error.status === 412)) {
        await saveConflict("delete", event.calendarId, event.id, undefined, error.status === 410 ? "gone" : "conflict");
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
      await localStore.removeCanonicalEvent(current.identity.subject, event.calendarId, event.id);
      await recordUndo(`Delete event “${event.summary || "Untitled event"}”`, "event", event, undefined);
      setStatus("Event deleted locally and will sync after you reconnect Google");
      return "deleted";
    }
  }, [api, recordUndo, saveConflict, updateCachedWorkspace]);

  const scheduleTask = useCallback(async (task: GoogleTask, calendarId: string, start: string, end: string) => {
    const current = workspaceRef.current;
    if (!current) throw new Error("Authorize Google before scheduling a task");
    if (scheduledTaskBlocks.some((block) => block.taskId === task.id)) throw new Error("This task is already scheduled. Move or unschedule its existing block first.");
    const startDate = new Date(start);
    const endDate = new Date(end);
    if (Number.isNaN(startDate.valueOf()) || Number.isNaN(endDate.valueOf()) || endDate <= startDate) throw new Error("Choose an end time after the start time");
    const event: CalendarEventInput = {
      summary: task.title || "Untitled task",
      description: task.notes ? `Scheduled task\n\n${parseTaskRecurrenceNotes(task.notes).userNotes}` : "Scheduled task",
      start: { dateTime: startDate.toISOString(), timeZone: preferences.displayTimeZone },
      end: { dateTime: endDate.toISOString(), timeZone: preferences.displayTimeZone },
      transparency: "opaque"
    };
    try {
      const created = await api.createEvent(calendarId, event);
      await updateCachedWorkspace((snapshot) => ({ ...snapshot, events: [...snapshot.events, created], updatedAt: new Date().toISOString() }));
      await localStore.saveCanonicalEvent(current.identity.subject, created);
      const block: ScheduledTaskBlock = { taskId: task.id, calendarId, eventId: created.id, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      await localStore.saveScheduledTaskBlock(current.identity.subject, block);
      setScheduledTaskBlocks((blocks) => [...blocks, block]);
      await recordUndo(`Schedule task “${task.title || "Untitled task"}”`, "event", undefined, created);
    } catch (error) {
      if (!queueable(error)) throw error;
      const eventId = `local-event-${crypto.randomUUID()}`;
      const block: ScheduledTaskBlock = { taskId: task.id, calendarId, eventId, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      await localStore.queueMutation({ id: crypto.randomUUID(), subject: current.identity.subject, kind: "event-create", createdAt: new Date().toISOString(), payload: { calendarId, temporaryId: eventId, event } });
      await localStore.saveScheduledTaskBlock(current.identity.subject, block);
      const localEvent: GoogleCalendarEvent = { id: eventId, calendarId, summary: event.summary, description: event.description, start: event.start, end: event.end, transparency: "opaque" };
      await updateCachedWorkspace((snapshot) => ({ ...snapshot, events: [...snapshot.events, localEvent], updatedAt: new Date().toISOString() }));
      await localStore.saveCanonicalEvent(current.identity.subject, localEvent);
      setScheduledTaskBlocks((blocks) => [...blocks, block]);
      setStatus("Scheduled task saved locally and will sync after you reconnect Google");
    }
  }, [api, preferences.displayTimeZone, recordUndo, scheduledTaskBlocks, updateCachedWorkspace]);

  const unscheduleTask = useCallback(async (taskId: string) => {
    const current = workspaceRef.current;
    if (!current) throw new Error("Authorize Google before unscheduling a task");
    const block = scheduledTaskBlocks.find((candidate) => candidate.taskId === taskId);
    if (!block) return;
    await localStore.removeScheduledTaskBlock(current.identity.subject, taskId);
    setScheduledTaskBlocks((blocks) => blocks.filter((candidate) => candidate.taskId !== taskId));
    setStatus("The task is now unscheduled. Its Calendar event was kept.");
  }, [scheduledTaskBlocks]);

  const bulkTasks = useCallback(async (taskIds: readonly string[], operation: TaskBulkOperation): Promise<BulkOperationResult> => {
    const current = workspaceRef.current;
    if (!current) throw new Error("Authorize Google before changing tasks");
    const succeeded: string[] = [];
    const failed: Array<{ id: string; error: string }> = [];
    for (const taskId of [...new Set(taskIds)]) {
      const task = workspaceRef.current?.tasks.find((candidate) => candidate.id === taskId);
      if (!task) { failed.push({ id: taskId, error: "Task is no longer available" }); continue; }
      try {
        if (operation.kind === "complete") await toggleTask(task);
        if (operation.kind === "delete") await deleteTask(task);
        if (operation.kind === "move") await moveTask(task, { destinationListId: operation.destinationListId });
        if (operation.kind === "reparent") await moveTask(task, { parent: operation.parent });
        if (operation.kind === "due") await updateTask(task, { due: operation.due });
        if (operation.kind === "priority") await saveTaskMetadata(task.id, { priority: operation.priority, dueTimeZone: taskMetadata.find((metadata) => metadata.taskId === task.id)?.dueTimeZone });
        if (operation.kind === "replace-text") {
          if (!operation.find) throw new Error("Enter text to replace");
          const parsed = parseTaskRecurrenceNotes(task.notes);
          const changedUserNotes = parsed.userNotes.replaceAll(operation.find, operation.replace);
          if (parsed.state === "unsupported-version") throw new Error("This task has an unsupported recurrence marker and was left unchanged");
          const changedTitle = task.title.replaceAll(operation.find, operation.replace);
          const notes = parsed.marker ? serializeTaskRecurrenceNotes(changedUserNotes, { ...parsed.marker, templateTitle: changedTitle }).notes : changedUserNotes;
          if (!notes) throw new Error("The recurring-task marker is invalid and could not be preserved");
          await updateTask(task, { title: changedTitle, notes: notes || undefined });
        }
        succeeded.push(taskId);
      } catch (error) {
        failed.push({ id: taskId, error: asErrorMessage(error) });
      }
    }
    return { succeeded, failed };
  }, [deleteTask, moveTask, saveTaskMetadata, taskMetadata, toggleTask, updateTask]);

  const inputFromEvent = useCallback((event: GoogleCalendarEvent): CalendarEventInput => ({
    summary: event.summary,
    description: event.description,
    location: event.location,
    start: event.start,
    end: event.end,
    recurrence: event.recurrence,
    attendees: event.attendees?.map((attendee) => ({ email: attendee.email })),
    reminders: event.reminders,
    attachments: event.attachments,
    visibility: event.visibility,
    transparency: event.transparency,
    colorId: event.colorId,
    guestsCanInviteOthers: event.guestsCanInviteOthers,
    guestsCanModify: event.guestsCanModify,
    guestsCanSeeOtherGuests: event.guestsCanSeeOtherGuests,
    eventType: event.eventType,
    focusTimeProperties: event.focusTimeProperties,
    outOfOfficeProperties: event.outOfOfficeProperties,
    workingLocationProperties: event.workingLocationProperties
  }), []);

  const bulkEvents = useCallback(async (events: readonly GoogleCalendarEvent[], operation: EventBulkOperation): Promise<BulkOperationResult> => {
    const succeeded: string[] = [];
    const failed: Array<{ id: string; error: string }> = [];
    for (const event of events) {
      const id = `${event.calendarId}:${event.id}`;
      try {
        if (operation.kind === "delete") await deleteEvent(event);
        if (operation.kind === "move") {
          const copy = await api.createEvent(operation.calendarId, inputFromEvent(event));
          await api.deleteEvent(event.calendarId, event.id, event.etag);
          await replaceEvent(copy, event.id, event.calendarId);
        }
        if (operation.kind === "color") await updateEvent(event, { ...inputFromEvent(event), colorId: operation.colorId });
        if (operation.kind === "availability") await updateEvent(event, { ...inputFromEvent(event), transparency: operation.transparency });
        if (operation.kind === "visibility") await updateEvent(event, { ...inputFromEvent(event), visibility: operation.visibility });
        if (operation.kind === "shift") {
          if (event.start.date || event.end.date) throw new Error("All-day events require an explicit day move");
          const shift = (value: string | undefined) => value ? new Date(new Date(value).getTime() + operation.minutes * 60_000).toISOString() : undefined;
          await updateEvent(event, { ...inputFromEvent(event), start: { ...event.start, dateTime: shift(event.start.dateTime) }, end: { ...event.end, dateTime: shift(event.end.dateTime) } });
        }
        if (operation.kind === "replace-text") {
          if (!operation.find) throw new Error("Enter text to replace");
          await updateEvent(event, { ...inputFromEvent(event), summary: event.summary.replaceAll(operation.find, operation.replace), description: event.description?.replaceAll(operation.find, operation.replace), location: event.location?.replaceAll(operation.find, operation.replace) });
        }
        succeeded.push(id);
      } catch (error) {
        failed.push({ id, error: asErrorMessage(error) });
      }
    }
    return { succeeded, failed };
  }, [api, deleteEvent, inputFromEvent, replaceEvent, updateEvent]);

  const splitRecurringEvent = useCallback(async (series: GoogleCalendarEvent, firstChangedInstance: GoogleCalendarEvent, input: CalendarEventInput) => {
    const originalStart = firstChangedInstance.originalStartTime ?? firstChangedInstance.start;
    if (!series.recurrence?.some((line) => line.startsWith("RRULE:"))) throw new Error("This event series cannot be split because its recurrence rule is unavailable");
    const originalInput = inputFromEvent(series);
    const trimmedInput: CalendarEventInput = { ...originalInput, recurrence: trimRecurrenceBefore(series.recurrence, originalStart) };
    let trimmed: GoogleCalendarEvent | undefined;
    try {
      trimmed = await api.updateEvent(series.calendarId, series.id, trimmedInput, series.etag);
      const created = await api.createEvent(series.calendarId, input);
      await replaceEvent(trimmed);
      await updateCachedWorkspace((snapshot) => ({ ...snapshot, events: [...snapshot.events, created], updatedAt: new Date().toISOString() }));
      setStatus("Split the repeating event from this occurrence onward. Later exceptions in the original series may need review.");
    } catch (error) {
      if (trimmed) {
        try {
          await api.updateEvent(trimmed.calendarId, trimmed.id, originalInput, trimmed.etag);
        } catch {
          setStatus("The recurring series was trimmed, but creating its replacement failed. Reopen the series in Google Calendar to review and repair it.");
        }
      }
      if (error instanceof GoogleApiError && error.status === 412) await saveConflict("update", series.calendarId, series.id, input);
      throw error;
    }
  }, [api, inputFromEvent, replaceEvent, saveConflict, updateCachedWorkspace]);

  const applyUndoEntry = useCallback(async (entry: UndoEntry, direction: "undo" | "redo") => {
    const target = (direction === "undo" ? entry.before : entry.after) as GoogleTask | GoogleCalendarEvent | undefined;
    const source = (direction === "undo" ? entry.after : entry.before) as GoogleTask | GoogleCalendarEvent | undefined;
    const current = workspaceRef.current;
    if (!current) throw new Error("Authorize Google before changing history");
    if (entry.resourceKind === "task") {
      const sourceTask = source as GoogleTask | undefined;
      const targetTask = target as GoogleTask | undefined;
      if (!targetTask && sourceTask) {
        if (!sourceTask.etag) throw new Error("This task history entry has no version to verify against Google");
        await api.deleteTask(sourceTask.listId, sourceTask.id, sourceTask.etag);
        await updateCachedWorkspace((snapshot) => ({ ...snapshot, tasks: snapshot.tasks.filter((task) => task.id !== sourceTask.id), updatedAt: new Date().toISOString() }));
      } else if (targetTask && !sourceTask) {
        const created = await api.createTask(targetTask.listId, { title: targetTask.title, notes: targetTask.notes, due: targetTask.due, status: targetTask.status, completed: targetTask.completed });
        await updateCachedWorkspace((snapshot) => ({ ...snapshot, tasks: [...snapshot.tasks, created], updatedAt: new Date().toISOString() }));
      } else if (targetTask && sourceTask) {
        if (!sourceTask.etag) throw new Error("This task history entry has no version to verify against Google");
        const updated = await api.updateTask(targetTask.listId, targetTask.id, { title: targetTask.title, notes: targetTask.notes, due: targetTask.due, status: targetTask.status, completed: targetTask.completed }, sourceTask.etag);
        await replaceTask(updated);
      }
    } else {
      const sourceEvent = source as GoogleCalendarEvent | undefined;
      const targetEvent = target as GoogleCalendarEvent | undefined;
      if (!targetEvent && sourceEvent) {
        if (!sourceEvent.etag) throw new Error("This event history entry has no version to verify against Google");
        await api.deleteEvent(sourceEvent.calendarId, sourceEvent.id, sourceEvent.etag);
        await updateCachedWorkspace((snapshot) => ({ ...snapshot, events: snapshot.events.filter((event) => event.id !== sourceEvent.id || event.calendarId !== sourceEvent.calendarId), updatedAt: new Date().toISOString() }));
      } else if (targetEvent && !sourceEvent) {
        const created = await api.createEvent(targetEvent.calendarId, inputFromEvent(targetEvent));
        await updateCachedWorkspace((snapshot) => ({ ...snapshot, events: [...snapshot.events, created], updatedAt: new Date().toISOString() }));
      } else if (targetEvent && sourceEvent) {
        if (!sourceEvent.etag) throw new Error("This event history entry has no version to verify against Google");
        const updated = await api.updateEvent(targetEvent.calendarId, targetEvent.id, inputFromEvent(targetEvent), sourceEvent.etag);
        await replaceEvent(updated);
      }
    }
    const next = { ...entry, state: direction === "undo" ? "redoable" as const : "undoable" as const };
    await localStore.saveUndoEntry(current.identity.subject, next);
    setUndoEntries(await localStore.readUndoEntries(current.identity.subject));
  }, [api, inputFromEvent, replaceEvent, replaceTask, updateCachedWorkspace]);

  const undo = useCallback(async () => {
    const entry = undoEntries.find((candidate) => candidate.state === "undoable" && candidate.expiresAt > new Date().toISOString());
    if (!entry) throw new Error("There is no undoable change");
    await applyUndoEntry(entry, "undo");
    setStatus(`Undid: ${entry.label}`);
  }, [applyUndoEntry, undoEntries]);

  const redo = useCallback(async () => {
    const entry = undoEntries.find((candidate) => candidate.state === "redoable" && candidate.expiresAt > new Date().toISOString());
    if (!entry) throw new Error("There is no redoable change");
    await applyUndoEntry(entry, "redo");
    setStatus(`Redid: ${entry.label}`);
  }, [applyUndoEntry, undoEntries]);

  const saveSearch = useCallback(async (name: string, query: string) => {
    const current = workspaceRef.current;
    const normalizedName = name.trim();
    const normalizedQuery = query.trim();
    if (!current || !normalizedName || !normalizedQuery) throw new Error("Enter a name and query for the saved search");
    const existing = savedSearches.find((search) => search.name.localeCompare(normalizedName, undefined, { sensitivity: "accent" }) === 0);
    const now = new Date().toISOString();
    const search: SavedSearch = existing ? { ...existing, query: normalizedQuery, updatedAt: now } : { id: crypto.randomUUID(), name: normalizedName, query: normalizedQuery, createdAt: now, updatedAt: now };
    await localStore.saveSavedSearch(current.identity.subject, search);
    setSavedSearches(await localStore.readSavedSearches(current.identity.subject));
  }, [savedSearches]);

  const deleteSearch = useCallback(async (id: string) => {
    const current = workspaceRef.current;
    if (!current) return;
    await localStore.removeSavedSearch(current.identity.subject, id);
    setSavedSearches((searches) => searches.filter((search) => search.id !== id));
  }, []);

  const dismissConflict = useCallback(async (id: string) => {
    const current = workspaceRef.current;
    if (!current) return;
    await localStore.removeConflict(current.identity.subject, id);
    setConflicts((entries) => entries.filter((entry) => entry.id !== id));
  }, []);

  const resolveStoredConflicts = useCallback(async (resourceKind: WorkspaceConflict["resourceKind"], resourceId: string, calendarId?: string) => {
    const current = workspaceRef.current;
    if (!current) return;
    const matching = conflicts.filter((entry) => entry.resourceKind === resourceKind && entry.resourceId === resourceId && entry.calendarId === calendarId);
    await Promise.all(matching.map((entry) => localStore.removeConflict(current.identity.subject, entry.id)));
    if (matching.length) setConflicts((entries) => entries.filter((entry) => !matching.some((candidate) => candidate.id === entry.id)));
  }, [conflicts]);

  const resolveEventConflict = useCallback(async (resolution: "keep-local" | "use-google") => {
    const conflict = eventConflict;
    if (!conflict) {
      return;
    }
    setBusy(true);
    try {
      if (resolution === "use-google") {
        await replaceEvent(conflict.latest);
        await resolveStoredConflicts("event", conflict.latest.id, conflict.latest.calendarId);
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
        await resolveStoredConflicts("event", conflict.latest.id, conflict.latest.calendarId);
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
      await resolveStoredConflicts("event", conflict.latest.id, conflict.latest.calendarId);
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
  }, [api, eventConflict, replaceEvent, resolveStoredConflicts, saveConflict, updateCachedWorkspace]);

  const dismissEventConflict = useCallback(() => {
    setEventConflict(undefined);
    setStatus("The event was not changed. Review the Google version before trying again.");
  }, []);

  const disconnect = useCallback(async () => {
    if (connectionProfileRef.current.mode === "managed") {
      const backendOrigin = connectionProfileRef.current.backendOrigin;
      if (!backendOrigin) throw new Error("The managed backend URL is not configured for this build");
      setBusy(true);
      try {
        await disconnectManagedConnection(backendOrigin);
        rememberManagedSession(undefined);
        setStatus("Managed Google access was disconnected. Browser-local data remains until you clear it.");
      } finally {
        setBusy(false);
      }
      return;
    }
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
  }, [rememberManagedSession]);

  const clearLocalData = useCallback(async () => {
    setBusy(true);
    try {
      await localStore.clearAll();
      session.clear();
      rememberConnectionProfile({ mode: "direct" });
      rememberManagedSession(undefined);
      setClientId("");
      const deviceTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
      onboardingDisplayTimeZoneRef.current = deviceTimeZone;
      setOnboardingDisplayTimeZone(deviceTimeZone);
      setEventConflict(undefined);
      setPreferences(defaultWorkspacePreferences());
      setTaskMetadata([]);
      setScheduledTaskBlocks([]);
      setConflicts([]);
      setUndoEntries([]);
      setInvitationEvents([]);
      setSavedSearches([]);
      replaceWorkspace(undefined);
      setStatus("Browser-local Hot Cross Buns data was cleared");
    } finally {
      setBusy(false);
    }
  }, [rememberConnectionProfile, rememberManagedSession, replaceWorkspace]);

  return {
    clientId,
    onboardingDisplayTimeZone,
    connectionProfile,
    managedConnectionAvailable: Boolean(managedConnectionProfile()),
    ready,
    busy,
    status,
    syncProgress,
    workspace,
    connected: Boolean(hasRemoteAccess() && workspace),
    driveAuthorized: connectionProfile.mode === "managed"
      ? Boolean(managedSession?.scopes.includes(GOOGLE_SCOPES.driveMetadata))
      : session.hasScope(GOOGLE_SCOPES.driveMetadata),
    eventConflict,
    preferences,
    taskMetadata,
    scheduledTaskBlocks,
    conflicts,
    undoEntries,
    invitationEvents,
    savedSearches,
    saveClientId,
    saveOnboardingDisplayTimeZone,
    connect,
    connectManaged,
    useDirectConnection,
    sync,
    cancelSync,
    refreshAllTasks,
    loadCalendarRange,
    createCalendar,
    subscribeCalendar,
    removeCalendarFromList,
    queryAvailability,
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
    savePreferences,
    saveTaskMetadata,
    scheduleTask,
    unscheduleTask,
    bulkTasks,
    bulkEvents,
    splitRecurringEvent,
    undo,
    redo,
    saveSearch,
    deleteSearch,
    createEvent,
    updateEvent,
    deleteEvent,
    getEvent,
    respondToEvent,
    resolveEventConflict,
    dismissEventConflict,
    dismissConflict,
    disconnect,
    clearLocalData
  };
}
