import type {
  GoogleCalendar,
  GoogleCalendarEvent,
  ConnectionProfile,
  GoogleDriveFile,
  GoogleIdentity,
  GoogleTask,
  GoogleTaskList,
  PendingMutation,
  ReminderState,
  SavedSearch,
  ScheduledTaskBlock,
  SyncCheckpoint,
  TaskMetadata,
  UndoEntry,
  WorkspaceConflict,
  WorkspacePreferences,
  WorkspaceSnapshot
} from "@/types";
import { calendarSearchDocument, type CalendarSearchDocument } from "@/features/calendarSearch";

const DATABASE_NAME = "hot-cross-buns-web";
const DATABASE_VERSION = 4;

const stores = {
  settings: "settings",
  accounts: "accounts",
  taskLists: "taskLists",
  tasks: "tasks",
  calendars: "calendars",
  events: "events",
  canonicalEvents: "canonicalEvents",
  driveFiles: "driveFiles",
  mutations: "mutations",
  checkpoints: "checkpoints",
  syncRuns: "syncRuns",
  preferences: "preferences",
  taskMetadata: "taskMetadata",
  scheduledTaskBlocks: "scheduledTaskBlocks",
  savedSearches: "savedSearches",
  conflicts: "conflicts",
  undoEntries: "undoEntries",
  reminderStates: "reminderStates"
} as const;

type StoreName = (typeof stores)[keyof typeof stores];
type Cached<T> = T & { readonly subject: string };
type CachedDriveFile = Cached<GoogleDriveFile> & { readonly cachedAt?: string };

const MAX_CACHED_DRIVE_FILES = 200;

interface StoredSetting {
  readonly key: string;
  readonly value: unknown;
}

interface StoredCheckpoint extends SyncCheckpoint {
  readonly subject: string;
}

type SubjectRecord<T> = T & { readonly subject: string };

const defaultPreferences: WorkspacePreferences = {
  schemaVersion: 1,
  notesProjectionMode: "mirrored",
  conflictPolicy: "prefer-google",
  appearance: "system",
  density: "comfortable",
  accentColor: "#2f3437",
  fontFamily: "system",
  customFontFamily: "",
  fontStylesheetUrl: "",
  fontScale: 1,
  taskListPaneWidth: 256,
  weekStartsOn: 0,
  hourCycle: "h12",
  displayTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  workdayStartHour: 9,
  workdayEndHour: 17,
  visibleCalendarIds: [],
  undoRetentionDays: 30,
  undoMaximumEntries: 200,
  keybindings: {
    commandPalette: "Meta+K",
    quickCapture: "Meta+Shift+N",
    sync: "Meta+Shift+S",
    tasks: "Meta+1",
    calendar: "Meta+2",
    settings: "Meta+3",
    health: "Meta+4",
    tutorial: "Meta+/"
  },
  quickCapture: {
    defaultEventDurationMinutes: 30,
    removeRecognizedText: true,
    taskAliases: ["task"],
    eventAliases: ["event"],
    highPriorityAliases: ["p1"],
    mediumPriorityAliases: ["p2"],
    lowPriorityAliases: ["p3"]
  }
};

export function defaultWorkspacePreferences(): WorkspacePreferences {
  return structuredClone(defaultPreferences);
}

export interface CalendarSyncRun {
  readonly subject: string;
  readonly startedAt: string;
  readonly phase: "calendar-list" | "calendar-events";
  readonly calendarListSyncToken?: string;
  readonly calendarListPageToken?: string;
  readonly calendarListReset: boolean;
  readonly calendarIds: readonly string[];
  readonly calendarIndex: number;
  readonly eventSyncToken?: string;
  readonly eventPageToken?: string;
  readonly eventReset: boolean;
  readonly changedCalendarIds: readonly string[];
  readonly occurrenceCacheCleared: boolean;
  readonly pagesSaved: number;
  readonly recordsSaved: number;
}

export interface StorageEstimate {
  readonly usage?: number;
  readonly quota?: number;
}

export interface LocalDiagnosticsCounts {
  readonly taskLists: number;
  readonly tasks: number;
  readonly calendars: number;
  readonly visibleEvents: number;
  readonly canonicalEvents: number;
  readonly pendingMutations: number;
  readonly conflicts: number;
  readonly undoEntries: number;
  readonly reminderStates: number;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed"));
  });
}

function createSubjectStore(database: IDBDatabase, name: StoreName, keyPath: string | string[]): IDBObjectStore {
  const store = database.createObjectStore(name, { keyPath });
  store.createIndex("subject", "subject", { unique: false });
  if (Array.isArray(keyPath) && keyPath.includes("calendarId")) {
    store.createIndex("subjectCalendar", ["subject", "calendarId"], { unique: false });
  }
  return store;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = (event) => {
      const database = request.result;
      if (event.oldVersion < 1) {
        database.createObjectStore(stores.settings, { keyPath: "key" });
        createSubjectStore(database, stores.accounts, "subject");
        createSubjectStore(database, stores.taskLists, ["subject", "id"]);
        createSubjectStore(database, stores.tasks, ["subject", "id"]);
        createSubjectStore(database, stores.calendars, ["subject", "id"]);
        createSubjectStore(database, stores.events, ["subject", "id"]);
        createSubjectStore(database, stores.driveFiles, ["subject", "id"]);
        createSubjectStore(database, stores.mutations, "id");
        createSubjectStore(database, stores.checkpoints, ["subject", "resource"]);
      }
      if (event.oldVersion < 2) {
        database.deleteObjectStore(stores.events);
        createSubjectStore(database, stores.events, ["subject", "calendarId", "id"]);
        createSubjectStore(database, stores.canonicalEvents, ["subject", "calendarId", "id"]);
      }
      if (event.oldVersion < 3) {
        createSubjectStore(database, stores.syncRuns, "subject");
      }
      if (event.oldVersion < 4) {
        createSubjectStore(database, stores.preferences, "subject");
        createSubjectStore(database, stores.taskMetadata, ["subject", "taskId"]);
        createSubjectStore(database, stores.scheduledTaskBlocks, ["subject", "taskId"]);
        createSubjectStore(database, stores.savedSearches, ["subject", "id"]);
        createSubjectStore(database, stores.conflicts, ["subject", "id"]);
        createSubjectStore(database, stores.undoEntries, ["subject", "id"]);
        createSubjectStore(database, stores.reminderStates, ["subject", "id"]);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB could not open"));
  });
}

function withoutSubject<T extends { readonly subject: string }>(record: T): Omit<T, "subject"> {
  const { subject: _subject, ...value } = record;
  return value;
}

export class LocalStore {
  private database: Promise<IDBDatabase> | undefined;

  private db(): Promise<IDBDatabase> {
    this.database ??= openDatabase();
    return this.database;
  }

  async getClientId(): Promise<string | undefined> {
    const database = await this.db();
    const transaction = database.transaction(stores.settings, "readonly");
    const stored = await requestResult(transaction.objectStore(stores.settings).get("googleClientId"));
    await transactionDone(transaction);
    return typeof (stored as StoredSetting | undefined)?.value === "string"
      ? ((stored as StoredSetting).value as string)
      : undefined;
  }

  async setClientId(clientId: string): Promise<void> {
    await this.put(stores.settings, { key: "googleClientId", value: clientId.trim() } satisfies StoredSetting);
  }

  async getConnectionProfile(): Promise<ConnectionProfile> {
    const database = await this.db();
    const transaction = database.transaction(stores.settings, "readonly");
    const stored = await requestResult(transaction.objectStore(stores.settings).get("connectionProfile"));
    await transactionDone(transaction);
    const value = (stored as StoredSetting | undefined)?.value;
    if (typeof value === "object" && value !== null && (value as ConnectionProfile).mode === "managed" && typeof (value as ConnectionProfile).backendOrigin === "string") {
      try {
        const backend = new URL((value as ConnectionProfile).backendOrigin);
        if (backend.protocol === "http:" || backend.protocol === "https:") return { mode: "managed", backendOrigin: backend.origin };
      } catch {
        // a malformed browser-local setting must not turn into a network target
      }
    }
    return { mode: "direct" };
  }

  async setConnectionProfile(profile: ConnectionProfile): Promise<void> {
    await this.put(stores.settings, { key: "connectionProfile", value: profile } satisfies StoredSetting);
  }

  async getActiveSubject(): Promise<string | undefined> {
    const database = await this.db();
    const transaction = database.transaction(stores.settings, "readonly");
    const stored = await requestResult(transaction.objectStore(stores.settings).get("activeGoogleSubject"));
    await transactionDone(transaction);
    return typeof (stored as StoredSetting | undefined)?.value === "string"
      ? ((stored as StoredSetting).value as string)
      : undefined;
  }

  async setActiveSubject(subject: string | undefined): Promise<void> {
    const database = await this.db();
    const transaction = database.transaction(stores.settings, "readwrite");
    const store = transaction.objectStore(stores.settings);
    if (subject) {
      store.put({ key: "activeGoogleSubject", value: subject } satisfies StoredSetting);
    } else {
      store.delete("activeGoogleSubject");
    }
    await transactionDone(transaction);
  }

  async saveSnapshot(snapshot: WorkspaceSnapshot): Promise<void> {
    const database = await this.db();
    const transaction = database.transaction(
      [stores.accounts, stores.taskLists, stores.tasks, stores.calendars, stores.events],
      "readwrite"
    );
    transaction.objectStore(stores.accounts).put({ ...snapshot.identity, updatedAt: snapshot.updatedAt });
    await this.replaceSubjectRecords(transaction.objectStore(stores.taskLists), snapshot.identity.subject, snapshot.taskLists);
    await this.replaceSubjectRecords(transaction.objectStore(stores.tasks), snapshot.identity.subject, snapshot.tasks);
    await this.replaceSubjectRecords(transaction.objectStore(stores.calendars), snapshot.identity.subject, snapshot.calendars);
    await this.replaceSubjectRecords(transaction.objectStore(stores.events), snapshot.identity.subject, snapshot.events);
    await transactionDone(transaction);
  }

  async readSnapshot(subject: string): Promise<WorkspaceSnapshot | undefined> {
    const database = await this.db();
    const transaction = database.transaction(
      [stores.accounts, stores.taskLists, stores.tasks, stores.calendars, stores.events],
      "readonly"
    );
    const account = await requestResult(transaction.objectStore(stores.accounts).get(subject)) as (GoogleIdentity & { updatedAt: string }) | undefined;
    const [taskLists, tasks, calendars, events] = await Promise.all([
      this.recordsForSubject<Cached<GoogleTaskList>>(transaction.objectStore(stores.taskLists), subject),
      this.recordsForSubject<Cached<GoogleTask>>(transaction.objectStore(stores.tasks), subject),
      this.recordsForSubject<Cached<GoogleCalendar>>(transaction.objectStore(stores.calendars), subject),
      this.recordsForSubject<Cached<GoogleCalendarEvent>>(transaction.objectStore(stores.events), subject)
    ]);
    await transactionDone(transaction);
    if (!account) {
      return undefined;
    }
    const { updatedAt, ...identity } = account;
    return {
      identity,
      taskLists: taskLists.map(withoutSubject),
      tasks: tasks.map(withoutSubject),
      calendars: calendars.map(withoutSubject),
      events: events.map(withoutSubject),
      updatedAt
    };
  }

  async saveDriveFiles(subject: string, files: readonly GoogleDriveFile[]): Promise<void> {
    const database = await this.db();
    const transaction = database.transaction(stores.driveFiles, "readwrite");
    const store = transaction.objectStore(stores.driveFiles);
    const existing = await this.recordsForSubject<CachedDriveFile>(store, subject);
    const cachedAt = new Date().toISOString();
    const byId = new Map(existing.map((file) => [file.id, file]));
    for (const file of files) {
      byId.set(file.id, { ...file, subject, cachedAt });
    }
    const next = [...byId.values()]
      .sort((left, right) => (right.cachedAt ?? "").localeCompare(left.cachedAt ?? ""))
      .slice(0, MAX_CACHED_DRIVE_FILES);
    await this.deleteSubjectRecords(store, subject);
    for (const file of next) {
      store.put(file);
    }
    await transactionDone(transaction);
  }

  async readDriveFiles(subject: string): Promise<GoogleDriveFile[]> {
    const database = await this.db();
    const transaction = database.transaction(stores.driveFiles, "readonly");
    const files = await this.recordsForSubject<CachedDriveFile>(transaction.objectStore(stores.driveFiles), subject);
    await transactionDone(transaction);
    return files
      .sort((left, right) => (right.cachedAt ?? "").localeCompare(left.cachedAt ?? ""))
      .map(({ subject: _subject, cachedAt: _cachedAt, ...file }) => file);
  }

  async readPreferences(subject: string): Promise<WorkspacePreferences> {
    const database = await this.db();
    const transaction = database.transaction(stores.preferences, "readonly");
    const record = await requestResult(transaction.objectStore(stores.preferences).get(subject)) as SubjectRecord<WorkspacePreferences> | undefined;
    await transactionDone(transaction);
    if (!record) {
      return defaultWorkspacePreferences();
    }
    const { subject: _subject, ...preferences } = record;
    return {
      ...defaultWorkspacePreferences(),
      ...preferences,
      keybindings: { ...defaultWorkspacePreferences().keybindings, ...preferences.keybindings },
      quickCapture: { ...defaultWorkspacePreferences().quickCapture, ...preferences.quickCapture }
    };
  }

  async savePreferences(subject: string, preferences: WorkspacePreferences): Promise<void> {
    await this.put(stores.preferences, { ...preferences, subject } satisfies SubjectRecord<WorkspacePreferences>);
  }

  async updatePreferences(subject: string, update: Partial<WorkspacePreferences>): Promise<WorkspacePreferences> {
    const current = await this.readPreferences(subject);
    const next: WorkspacePreferences = {
      ...current,
      ...update,
      quickCapture: { ...current.quickCapture, ...update.quickCapture }
    };
    await this.savePreferences(subject, next);
    return next;
  }

  async readTaskMetadata(subject: string): Promise<TaskMetadata[]> {
    return this.readSubjectRecords(stores.taskMetadata, subject);
  }

  async saveTaskMetadata(subject: string, metadata: TaskMetadata): Promise<void> {
    await this.put(stores.taskMetadata, { ...metadata, subject } satisfies SubjectRecord<TaskMetadata>);
  }

  async removeTaskMetadata(subject: string, taskId: string): Promise<void> {
    await this.delete(stores.taskMetadata, [subject, taskId]);
  }

  async readScheduledTaskBlocks(subject: string): Promise<ScheduledTaskBlock[]> {
    return this.readSubjectRecords(stores.scheduledTaskBlocks, subject);
  }

  async saveScheduledTaskBlock(subject: string, block: ScheduledTaskBlock): Promise<void> {
    await this.put(stores.scheduledTaskBlocks, { ...block, subject } satisfies SubjectRecord<ScheduledTaskBlock>);
  }

  async removeScheduledTaskBlock(subject: string, taskId: string): Promise<void> {
    await this.delete(stores.scheduledTaskBlocks, [subject, taskId]);
  }

  async readSavedSearches(subject: string): Promise<SavedSearch[]> {
    const searches = await this.readSubjectRecords<SavedSearch>(stores.savedSearches, subject);
    return searches.sort((left, right) => left.name.localeCompare(right.name));
  }

  async saveSavedSearch(subject: string, search: SavedSearch): Promise<void> {
    await this.put(stores.savedSearches, { ...search, subject } satisfies SubjectRecord<SavedSearch>);
  }

  async removeSavedSearch(subject: string, id: string): Promise<void> {
    await this.delete(stores.savedSearches, [subject, id]);
  }

  async readConflicts(subject: string): Promise<WorkspaceConflict[]> {
    const conflicts = await this.readSubjectRecords<WorkspaceConflict>(stores.conflicts, subject);
    return conflicts.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async saveConflict(subject: string, conflict: WorkspaceConflict): Promise<void> {
    await this.put(stores.conflicts, { ...conflict, subject } satisfies SubjectRecord<WorkspaceConflict>);
  }

  async removeConflict(subject: string, id: string): Promise<void> {
    await this.delete(stores.conflicts, [subject, id]);
  }

  async readUndoEntries(subject: string): Promise<UndoEntry[]> {
    const entries = await this.readSubjectRecords<UndoEntry>(stores.undoEntries, subject);
    return entries.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async saveUndoEntry(subject: string, entry: UndoEntry): Promise<void> {
    await this.put(stores.undoEntries, { ...entry, subject } satisfies SubjectRecord<UndoEntry>);
  }

  async removeUndoEntry(subject: string, id: string): Promise<void> {
    await this.delete(stores.undoEntries, [subject, id]);
  }

  async cleanupUndoEntries(subject: string, maximumEntries: number, now = new Date().toISOString()): Promise<void> {
    const entries = await this.readUndoEntries(subject);
    const keep = entries
      .filter((entry) => entry.expiresAt > now)
      .slice(0, Math.max(1, Math.min(maximumEntries, 200)));
    const keepIds = new Set(keep.map((entry) => entry.id));
    await Promise.all(entries.filter((entry) => !keepIds.has(entry.id)).map((entry) => this.removeUndoEntry(subject, entry.id)));
  }

  async readReminderStates(subject: string): Promise<ReminderState[]> {
    return this.readSubjectRecords(stores.reminderStates, subject);
  }

  async saveReminderState(subject: string, state: ReminderState): Promise<void> {
    await this.put(stores.reminderStates, { ...state, subject } satisfies SubjectRecord<ReminderState>);
  }

  async removeReminderState(subject: string, id: string): Promise<void> {
    await this.delete(stores.reminderStates, [subject, id]);
  }

  async queueMutation(mutation: PendingMutation): Promise<void> {
    await this.put(stores.mutations, mutation);
  }

  async pendingMutations(subject: string): Promise<PendingMutation[]> {
    const database = await this.db();
    const transaction = database.transaction(stores.mutations, "readonly");
    const result = await this.recordsForSubject<PendingMutation>(transaction.objectStore(stores.mutations), subject);
    await transactionDone(transaction);
    return result.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async removeMutation(id: string): Promise<void> {
    const database = await this.db();
    const transaction = database.transaction(stores.mutations, "readwrite");
    transaction.objectStore(stores.mutations).delete(id);
    await transactionDone(transaction);
  }

  async saveCheckpoint(subject: string, checkpoint: SyncCheckpoint): Promise<void> {
    await this.put(stores.checkpoints, { ...checkpoint, subject } satisfies StoredCheckpoint);
  }

  async readCalendarSyncRun(subject: string): Promise<CalendarSyncRun | undefined> {
    const database = await this.db();
    const transaction = database.transaction(stores.syncRuns, "readonly");
    const run = await requestResult(transaction.objectStore(stores.syncRuns).get(subject)) as CalendarSyncRun | undefined;
    await transactionDone(transaction);
    return run && {
      ...run,
      changedCalendarIds: run.changedCalendarIds ?? [],
      occurrenceCacheCleared: run.occurrenceCacheCleared ?? false
    };
  }

  async saveCalendarSyncRun(run: CalendarSyncRun): Promise<void> {
    await this.put(stores.syncRuns, run);
  }

  async clearCalendarSyncRun(subject: string): Promise<void> {
    const database = await this.db();
    const transaction = database.transaction(stores.syncRuns, "readwrite");
    transaction.objectStore(stores.syncRuns).delete(subject);
    await transactionDone(transaction);
  }

  async beginCalendarListReplacement(subject: string): Promise<void> {
    const database = await this.db();
    const transaction = database.transaction([stores.calendars, stores.events, stores.canonicalEvents, stores.checkpoints], "readwrite");
    await this.deleteSubjectRecords(transaction.objectStore(stores.calendars), subject);
    await this.deleteSubjectRecords(transaction.objectStore(stores.events), subject);
    await this.deleteSubjectRecords(transaction.objectStore(stores.canonicalEvents), subject);
    await this.deleteCheckpointsWithPrefix(transaction.objectStore(stores.checkpoints), subject, "calendar-");
    await transactionDone(transaction);
  }

  async applyCalendarListPage(subject: string, changes: readonly GoogleCalendar[]): Promise<void> {
    const database = await this.db();
    const transaction = database.transaction([stores.calendars, stores.events, stores.canonicalEvents, stores.checkpoints], "readwrite");
    const calendars = transaction.objectStore(stores.calendars);
    const occurrences = transaction.objectStore(stores.events);
    const canonicalEvents = transaction.objectStore(stores.canonicalEvents);
    const checkpoints = transaction.objectStore(stores.checkpoints);
    for (const calendar of changes) {
      if (calendar.deleted) {
        calendars.delete([subject, calendar.id]);
        await this.deleteCalendarRecords(occurrences, subject, calendar.id);
        await this.deleteCalendarRecords(canonicalEvents, subject, calendar.id);
        checkpoints.delete([subject, `calendar-events:${calendar.id}`]);
      } else {
        calendars.put({ ...calendar, subject });
      }
    }
    await transactionDone(transaction);
  }

  async applyCalendarEventPage(
    subject: string,
    calendarId: string,
    changes: readonly GoogleCalendarEvent[],
    invalidateOccurrences: boolean
  ): Promise<void> {
    const database = await this.db();
    const transaction = database.transaction([stores.canonicalEvents, stores.events], "readwrite");
    const canonicalEvents = transaction.objectStore(stores.canonicalEvents);
    if (invalidateOccurrences) {
      await this.deleteCalendarRecords(transaction.objectStore(stores.events), subject, calendarId);
    }
    for (const event of changes) {
      if (event.status === "cancelled") {
        canonicalEvents.delete([subject, calendarId, event.id]);
      } else {
        canonicalEvents.put({ ...event, subject });
      }
    }
    await transactionDone(transaction);
  }

  async clearOccurrenceCache(subject: string): Promise<void> {
    const database = await this.db();
    const transaction = database.transaction(stores.events, "readwrite");
    await this.deleteSubjectRecords(transaction.objectStore(stores.events), subject);
    await transactionDone(transaction);
  }

  async replaceTaskMirror(
    subject: string,
    taskLists: readonly GoogleTaskList[],
    tasks: readonly GoogleTask[],
    updatedAt: string
  ): Promise<void> {
    const database = await this.db();
    const transaction = database.transaction([stores.taskLists, stores.tasks, stores.checkpoints], "readwrite");
    await this.replaceSubjectRecords(transaction.objectStore(stores.taskLists), subject, taskLists);
    await this.replaceSubjectRecords(transaction.objectStore(stores.tasks), subject, tasks);
    const checkpoints = transaction.objectStore(stores.checkpoints);
    await this.deleteCheckpointsWithPrefix(checkpoints, subject, "tasks:");
    for (const taskList of taskLists) {
      checkpoints.put({ subject, resource: `tasks:${taskList.id}`, updatedAt } satisfies StoredCheckpoint);
    }
    await transactionDone(transaction);
  }

  async storageEstimate(): Promise<StorageEstimate> {
    if (typeof navigator === "undefined" || !navigator.storage?.estimate) {
      return {};
    }
    const estimate = await navigator.storage.estimate();
    return { usage: estimate.usage, quota: estimate.quota };
  }

  async diagnosticsCounts(subject: string): Promise<LocalDiagnosticsCounts> {
    const database = await this.db();
    const names = [stores.taskLists, stores.tasks, stores.calendars, stores.events, stores.canonicalEvents, stores.mutations, stores.conflicts, stores.undoEntries, stores.reminderStates];
    const transaction = database.transaction(names, "readonly");
    const count = async (storeName: StoreName) => (await this.recordsForSubject<unknown>(transaction.objectStore(storeName), subject)).length;
    const [taskLists, tasks, calendars, visibleEvents, canonicalEvents, pendingMutations, conflicts, undoEntries, reminderStates] = await Promise.all(names.map((name) => count(name)));
    await transactionDone(transaction);
    return { taskLists, tasks, calendars, visibleEvents, canonicalEvents, pendingMutations, conflicts, undoEntries, reminderStates };
  }

  async applyCalendarListChanges(
    subject: string,
    changes: readonly GoogleCalendar[],
    checkpoint: SyncCheckpoint
  ): Promise<void> {
    const database = await this.db();
    const transaction = database.transaction(
      [stores.calendars, stores.events, stores.canonicalEvents, stores.checkpoints],
      "readwrite"
    );
    const calendars = transaction.objectStore(stores.calendars);
    const occurrences = transaction.objectStore(stores.events);
    const canonicalEvents = transaction.objectStore(stores.canonicalEvents);
    const checkpoints = transaction.objectStore(stores.checkpoints);
    for (const calendar of changes) {
      if (calendar.deleted) {
        calendars.delete([subject, calendar.id]);
        await this.deleteCalendarRecords(occurrences, subject, calendar.id);
        await this.deleteCalendarRecords(canonicalEvents, subject, calendar.id);
        checkpoints.delete([subject, `calendar-events:${calendar.id}`]);
      } else {
        calendars.put({ ...calendar, subject });
      }
    }
    checkpoints.put({ ...checkpoint, subject } satisfies StoredCheckpoint);
    await transactionDone(transaction);
  }

  async applyCalendarEventChanges(
    subject: string,
    calendarId: string,
    changes: readonly GoogleCalendarEvent[],
    checkpoint: SyncCheckpoint
  ): Promise<void> {
    const database = await this.db();
    const transaction = database.transaction([stores.canonicalEvents, stores.events, stores.checkpoints], "readwrite");
    const canonicalEvents = transaction.objectStore(stores.canonicalEvents);
    for (const event of changes) {
      if (event.status === "cancelled") {
        canonicalEvents.delete([subject, calendarId, event.id]);
      } else {
        canonicalEvents.put({ ...event, subject });
      }
    }
    if (changes.length > 0) {
      await this.deleteCalendarRecords(transaction.objectStore(stores.events), subject, calendarId);
    }
    transaction.objectStore(stores.checkpoints).put({ ...checkpoint, subject } satisfies StoredCheckpoint);
    await transactionDone(transaction);
  }

  async replaceCalendarEventCache(
    subject: string,
    calendarId: string,
    checkpoint: SyncCheckpoint
  ): Promise<void> {
    const database = await this.db();
    const transaction = database.transaction([stores.canonicalEvents, stores.events, stores.checkpoints], "readwrite");
    await this.deleteCalendarRecords(transaction.objectStore(stores.canonicalEvents), subject, calendarId);
    await this.deleteCalendarRecords(transaction.objectStore(stores.events), subject, calendarId);
    transaction.objectStore(stores.checkpoints).delete([subject, checkpoint.resource]);
    await transactionDone(transaction);
  }

  async applyTaskChanges(
    subject: string,
    listId: string,
    changes: readonly GoogleTask[],
    checkpoint: SyncCheckpoint
  ): Promise<void> {
    const database = await this.db();
    const transaction = database.transaction([stores.tasks, stores.checkpoints], "readwrite");
    const tasks = transaction.objectStore(stores.tasks);
    for (const task of changes) {
      if (task.listId !== listId) {
        throw new Error("Task change was applied to the wrong task list");
      }
      if (task.deleted) {
        const current = await requestResult(tasks.get([subject, task.id])) as Cached<GoogleTask> | undefined;
        if (current?.listId === listId) {
          tasks.delete([subject, task.id]);
        }
      } else {
        tasks.put({ ...task, subject });
      }
    }
    transaction.objectStore(stores.checkpoints).put({ ...checkpoint, subject } satisfies StoredCheckpoint);
    await transactionDone(transaction);
  }

  async readCheckpoint(subject: string, resource: string): Promise<SyncCheckpoint | undefined> {
    const database = await this.db();
    const transaction = database.transaction(stores.checkpoints, "readonly");
    const record = await requestResult(
      transaction.objectStore(stores.checkpoints).get([subject, resource])
    ) as StoredCheckpoint | undefined;
    await transactionDone(transaction);
    return record ? withoutSubject(record) : undefined;
  }

  async readCanonicalEventSearchDocuments(subject: string): Promise<CalendarSearchDocument[]> {
    const database = await this.db();
    const transaction = database.transaction(stores.canonicalEvents, "readonly");
    const events = await this.recordsForSubject<Cached<GoogleCalendarEvent>>(
      transaction.objectStore(stores.canonicalEvents),
      subject
    );
    await transactionDone(transaction);
    return events.map(withoutSubject).flatMap((event) => {
      const document = calendarSearchDocument(event);
      return document ? [document] : [];
    });
  }

  async readCanonicalEvents(subject: string): Promise<GoogleCalendarEvent[]> {
    const database = await this.db();
    const transaction = database.transaction(stores.canonicalEvents, "readonly");
    const events = await this.recordsForSubject<Cached<GoogleCalendarEvent>>(transaction.objectStore(stores.canonicalEvents), subject);
    await transactionDone(transaction);
    return events.map(withoutSubject);
  }

  async saveCanonicalEvent(subject: string, event: GoogleCalendarEvent): Promise<void> {
    await this.put(stores.canonicalEvents, { ...event, subject } satisfies Cached<GoogleCalendarEvent>);
  }

  async removeCanonicalEvent(subject: string, calendarId: string, eventId: string): Promise<void> {
    await this.delete(stores.canonicalEvents, [subject, calendarId, eventId]);
  }

  async clearAccount(subject: string): Promise<void> {
    const database = await this.db();
    const affectedStores: StoreName[] = [
      stores.accounts,
      stores.taskLists,
      stores.tasks,
      stores.calendars,
      stores.events,
      stores.canonicalEvents,
      stores.driveFiles,
      stores.mutations,
      stores.checkpoints,
      stores.syncRuns
    ];
    const transaction = database.transaction(affectedStores, "readwrite");
    for (const storeName of affectedStores) {
      const store = transaction.objectStore(storeName);
      if (storeName === stores.accounts) {
        store.delete(subject);
      } else {
        await this.deleteSubjectRecords(store, subject);
      }
    }
    await transactionDone(transaction);
  }

  async clearAll(): Promise<void> {
    const database = await this.db();
    const transaction = database.transaction(Object.values(stores), "readwrite");
    for (const name of Object.values(stores)) {
      transaction.objectStore(name).clear();
    }
    await transactionDone(transaction);
  }

  private async put(storeName: StoreName, value: unknown): Promise<void> {
    const database = await this.db();
    const transaction = database.transaction(storeName, "readwrite");
    transaction.objectStore(storeName).put(value);
    await transactionDone(transaction);
  }

  private async delete(storeName: StoreName, key: IDBValidKey): Promise<void> {
    const database = await this.db();
    const transaction = database.transaction(storeName, "readwrite");
    transaction.objectStore(storeName).delete(key);
    await transactionDone(transaction);
  }

  private async readSubjectRecords<T>(storeName: StoreName, subject: string): Promise<T[]> {
    const database = await this.db();
    const transaction = database.transaction(storeName, "readonly");
    const records = await this.recordsForSubject<SubjectRecord<T>>(transaction.objectStore(storeName), subject);
    await transactionDone(transaction);
    return records.map((record) => withoutSubject(record) as T);
  }

  private async recordsForSubject<T>(store: IDBObjectStore, subject: string): Promise<T[]> {
    return requestResult(store.index("subject").getAll(IDBKeyRange.only(subject))) as Promise<T[]>;
  }

  private async replaceSubjectRecords<T extends { readonly id: string }>(
    store: IDBObjectStore,
    subject: string,
    records: readonly T[]
  ): Promise<void> {
    await this.deleteSubjectRecords(store, subject);
    for (const record of records) {
      store.put({ ...record, subject });
    }
  }

  private async deleteSubjectRecords(store: IDBObjectStore, subject: string): Promise<void> {
    const index = store.index("subject");
    await new Promise<void>((resolve, reject) => {
      const request = index.openKeyCursor(IDBKeyRange.only(subject));
      request.onerror = () => reject(request.error ?? new Error("IndexedDB cursor failed"));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve();
          return;
        }
        store.delete(cursor.primaryKey);
        cursor.continue();
      };
    });
  }

  private async deleteCalendarRecords(store: IDBObjectStore, subject: string, calendarId: string): Promise<void> {
    const keys = await requestResult(store.index("subjectCalendar").getAllKeys([subject, calendarId]));
    for (const key of keys) {
      store.delete(key);
    }
  }

  private async deleteCheckpointsWithPrefix(store: IDBObjectStore, subject: string, prefix: string): Promise<void> {
    const checkpoints = await this.recordsForSubject<StoredCheckpoint>(store, subject);
    for (const checkpoint of checkpoints) {
      if (checkpoint.resource.startsWith(prefix)) {
        store.delete([subject, checkpoint.resource]);
      }
    }
  }
}

export const localStore = new LocalStore();
