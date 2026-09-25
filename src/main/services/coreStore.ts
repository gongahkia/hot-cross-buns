import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

type JsonRecord = Record<string, any>;

export interface PendingSyncMutation {
  id: string;
  kind: string;
  entityId: string;
  payload: JsonRecord;
  attempts: number;
  createdAt: string;
}

const schemaVersion = 2;

const defaultSettings: JsonRecord = {
  theme: "system",
  colorTheme: "notion",
  customBackground: null,
  useInferredBackgroundTheme: true,
  appLanguage: "system",
  uiFontName: null,
  uiTextSizePoints: 13,
  perSurfaceFontOverrides: {},
  calendarEventColorOverrides: {},
  autoTagRules: [],
  autoTagBackgroundReapplyMode: "preview",
  disableAnimations: false,
  uiLayoutScale: 1,
  navigationPlacement: "left",
  hiddenNavigationTabs: [],
  navigationTabOrder: ["calendar", "tasks", "notes"],
  toolbarActionOrder: ["commandPalette", "notifications", "diagnostics", "splitPane", "refresh", "settings"],
  hiddenCalendarViewModes: [],
  showCompletedInCalendarViews: true,
  eventCompletionDefaultScope: "occurrence",
  calendarTimelineDensity: "compact",
  monthScrollPastMonths: 0,
  monthScrollFutureMonths: 1,
  quickCreateExpandedByDefault: false,
  restoreWindowStateEnabled: true,
  startOnLogin: false,
  selectedTaskListIds: [],
  selectedCalendarIds: [],
  setupCompletedAt: null,
  syncMode: "balanced",
  syncTasksEnabled: true,
  syncCalendarEventsEnabled: true,
  eventRetentionDaysBack: 0,
  completedTaskRetentionDaysBack: 365,
  keybindings: {},
  leaderKey: "CmdOrCtrl+K",
  leaderKeybindings: {},
  showTrayIcon: true,
  trayClickAction: "open-menu",
  menuBarPanelStyle: "adaptive",
  menuBarIconName: "calendar",
  menuBarCalendarIconId: "calendar",
  menuBarCalendarDoneMode: "visibleTodayDone",
  customMenuBarIcons: [],
  showMenuBarBadge: true,
  showDockBadge: true,
  notificationsEnabled: false,
  notificationLeadMinutes: 10,
  taskCompletionSoundEnabled: true,
  taskCompletionSoundId: "glass",
  eventCompletionSoundEnabled: true,
  eventCompletionSoundId: "pop",
  importedSoundCount: 0,
  perTabListFilters: {
    tasks: { useCustomFilter: false, selectedTaskListIds: [] },
    notes: { useCustomFilter: false, selectedTaskListIds: [] }
  },
  portableExportOnlySelectedTaskLists: false,
  portableExportOnlySelectedCalendars: false,
  portableExportOnlyFutureCurrentEvents: false,
  dailyLocalBackupEnabled: false,
  localBackupRetentionCount: 14,
  lastLocalBackupAt: null,
  visibleHistoryEntryCount: 50,
  historyStorageCap: 5000,
  historyCategoryVisibility: {},
  dismissedDuplicateGroupIds: [],
  taskTemplates: [],
  eventTemplates: [],
  noteTemplates: [],
  lastUpdateCheckAt: null,
  storageBackend: "sqlite",
  hcbHosterEndpoint: null,
  hcbVaultPath: null,
  hcbHosterLastPackageSha256: null,
  mcpEnabled: false,
  mcpPermissionMode: "confirm-writes",
  mcpPort: 0,
  localHostersEnabled: false,
  localHosterPort: 0,
  defaultTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  todayCapacityMinutes: 480,
  todayWorkingHoursStart: 6,
  todayWorkingHoursEnd: 22,
  diagnosticsIncludePerformance: true,
  rawGoogleDiagnosticsEnabled: false,
  savedSearchViews: [],
  pinnedSavedSearchViewIds: [],
  savedTaskViews: [],
  semanticSearchEnabled: false,
  semanticSearchMode: "lexical",
  embeddingModelId: "hcb-local-hash-384",
  semanticSearchModels: [],
  agentActionTrayEnabled: true,
  webhooksEnabled: false
};

export class CoreStore {
  private readonly db: Database.Database;

  constructor(databasePath: string) {
    mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 });
    chmodSync(dirname(databasePath), 0o700);
    this.db = new Database(databasePath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("synchronous = NORMAL");
    this.migrate();
    this.seed();
  }

  close(): void {
    this.db.close();
  }

  oauthClientId(): string | null {
    return this.googleStatus().clientId;
  }

  setOAuthClientId(clientId: string): void {
    this.db.prepare("INSERT INTO sync_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
      .run("google-client", JSON.stringify({ clientId }));
  }

  setGoogleAccount(account: JsonRecord | null): void {
    if (account) {
      this.db.prepare("INSERT INTO sync_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
        .run("google-account", JSON.stringify(account));
      return;
    }

    this.db.prepare("DELETE FROM sync_meta WHERE key='google-account'").run();
  }

  /**
   * The sync service is deliberately the only code which reads these records.
   * Renderer DTOs never contain a Google identifier, ETag, sync token, or
   * credential. Local ids stay stable while a remote create is in flight.
   */
  pendingSyncMutations(limit = 100): PendingSyncMutation[] {
    return (this.db.prepare(`SELECT id,kind,entity_id AS entityId,payload_json AS payload,
      attempts,created_at AS createdAt FROM outbox WHERE state='pending' AND next_attempt_at <= ?
      ORDER BY created_at,id LIMIT ?`).all(timestamp(), Math.max(1, Math.min(500, limit))) as any[])
      .map((row) => ({ ...row, payload: safeJson(row.payload, {}) }));
  }

  completeSyncMutation(id: string): void {
    this.db.prepare("UPDATE outbox SET state='delivered',updated_at=?,last_error=NULL WHERE id=?")
      .run(timestamp(), id);
  }

  deferSyncMutation(id: string, error: string, retryable: boolean): void {
    const row = this.db.prepare("SELECT attempts FROM outbox WHERE id=?").get(id) as { attempts?: number } | undefined;
    const attempts = Number(row?.attempts ?? 0) + 1;
    const delayMs = retryable
      ? Math.min(15 * 60_000, 1_000 * (2 ** Math.min(attempts, 8)) + Math.floor(Math.random() * 500))
      : 0;
    this.db.prepare("UPDATE outbox SET state=?,attempts=?,next_attempt_at=?,last_error=?,updated_at=? WHERE id=?")
      .run(retryable ? "pending" : "conflict", attempts,
        new Date(Date.now() + delayMs).toISOString(), sanitizeSyncError(error), timestamp(), id);
  }

  resetGoogleSyncTokens(): void {
    this.db.prepare("DELETE FROM sync_meta WHERE key LIKE 'google-sync-token:%'").run();
  }

  googleSyncToken(key: string): string | null {
    const row = this.db.prepare("SELECT value FROM sync_meta WHERE key=?").get(`google-sync-token:${key}`) as { value?: string } | undefined;
    return row?.value ?? null;
  }

  setGoogleSyncToken(key: string, token: string | null): void {
    const metaKey = `google-sync-token:${key}`;
    if (!token) {
      this.db.prepare("DELETE FROM sync_meta WHERE key=?").run(metaKey);
      return;
    }
    this.db.prepare("INSERT INTO sync_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
      .run(metaKey, token);
  }

  setSyncRuntime(status: JsonRecord): void {
    this.db.prepare("INSERT INTO sync_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
      .run("google-sync-runtime", JSON.stringify({ ...status, updatedAt: timestamp() }));
  }

  googleTaskListForSync(id: string): JsonRecord | null {
    return (this.db.prepare("SELECT id,title,google_id AS googleId,google_etag AS googleEtag FROM task_lists WHERE id=?").get(id) as JsonRecord | undefined) ?? null;
  }

  googleTaskForSync(id: string): JsonRecord | null {
    return (this.db.prepare(`SELECT task.id,task.list_id AS listId,task.title,task.notes,task.status,task.due_at AS dueAt,
      task.parent_id AS parentId,task.sort_order AS sortOrder,task.google_id AS googleId,task.google_etag AS googleEtag,
      task.google_list_id AS googleListId,task.google_parent_id AS googleParentId,
      list.google_id AS listGoogleId FROM tasks task JOIN task_lists list ON list.id=task.list_id WHERE task.id=?`)
      .get(id) as JsonRecord | undefined) ?? null;
  }

  googleCalendarForSync(id: string): JsonRecord | null {
    return (this.db.prepare("SELECT id,title,color,google_id AS googleId,google_etag AS googleEtag FROM calendars WHERE id=?").get(id) as JsonRecord | undefined) ?? null;
  }

  googleEventForSync(id: string): JsonRecord | null {
    return (this.db.prepare(`SELECT event.id,event.calendar_id AS calendarId,event.title,event.description,event.starts_at AS startsAt,
      event.ends_at AS endsAt,event.all_day AS allDay,event.color_id AS colorId,event.location,event.recurrence_json AS recurrence,
      event.attendees_json AS attendees,event.reminders_json AS reminders,event.reminders_use_default AS remindersUseDefault,
      event.transparency,event.visibility,event.google_id AS googleId,event.google_etag AS googleEtag,
      calendar.google_id AS calendarGoogleId FROM events event JOIN calendars calendar ON calendar.id=event.calendar_id WHERE event.id=?`)
      .get(id) as JsonRecord | undefined) ?? null;
  }

  bindGoogleTask(localId: string, remote: JsonRecord): JsonRecord {
    const list = this.googleTaskForSync(localId);
    if (!list) throw new CoreStoreError("Task no longer exists");
    this.db.prepare(`UPDATE tasks SET google_id=?,google_etag=?,google_list_id=?,google_parent_id=?,sort_order=?,updated_at=? WHERE id=?`)
      .run(requiredText(remote.id, "Google task id"), remote.etag ?? null, list.listGoogleId ?? null,
        remote.parent ?? null, remote.position ?? null, remote.updated ?? timestamp(), localId);
    return this.requireTask(localId);
  }

  bindGoogleEvent(localId: string, remote: JsonRecord): JsonRecord {
    const event = this.googleEventForSync(localId);
    if (!event) throw new CoreStoreError("Calendar event no longer exists");
    this.db.prepare("UPDATE events SET google_id=?,google_etag=?,updated_at=? WHERE id=?")
      .run(requiredText(remote.id, "Google event id"), remote.etag ?? null, remote.updated ?? timestamp(), localId);
    return this.requireEvent(localId);
  }

  upsertGoogleTaskList(remote: JsonRecord): JsonRecord {
    const googleId = requiredText(remote.id, "Google task-list id");
    const title = requiredText(remote.title, "Google task-list title");
    const existing = this.db.prepare("SELECT id FROM task_lists WHERE google_id=?").get(googleId) as { id: string } | undefined;
    const seed = !existing
      ? this.db.prepare("SELECT id FROM task_lists WHERE id='inbox' AND google_id IS NULL").get() as { id: string } | undefined
      : undefined;
    const id = existing?.id ?? seed?.id ?? randomUUID();
    const now = timestamp();
    this.db.prepare(`INSERT INTO task_lists(id,title,google_id,google_etag,created_at,updated_at) VALUES(?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET title=excluded.title,google_id=excluded.google_id,google_etag=excluded.google_etag,updated_at=excluded.updated_at`)
      .run(id, title, googleId, remote.etag ?? null, now, remote.updated ?? now);
    return this.googleTaskListForSync(id)!;
  }

  upsertGoogleTask(remote: JsonRecord, localListId: string): JsonRecord | null {
    const googleId = requiredText(remote.id, "Google task id");
    const existing = this.db.prepare("SELECT id FROM tasks WHERE google_id=?").get(googleId) as { id: string } | undefined;
    const localId = existing?.id ?? randomUUID();
    if (this.hasPendingEntityMutation("task", localId)) return null;
    const parentId = remote.parent
      ? (this.db.prepare("SELECT id FROM tasks WHERE google_id=?").get(remote.parent) as { id?: string } | undefined)?.id ?? null
      : null;
    const previous = existing ? this.requireTask(localId) : null;
    const now = timestamp();
    this.db.prepare(`INSERT INTO tasks(id,list_id,title,notes,status,priority,due_at,parent_id,planned_start,planned_end,duration_minutes,
      locked_schedule,snooze_until,tags_json,sort_order,google_id,google_etag,google_parent_id,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET list_id=excluded.list_id,title=excluded.title,notes=excluded.notes,status=excluded.status,
      due_at=excluded.due_at,parent_id=excluded.parent_id,sort_order=excluded.sort_order,google_id=excluded.google_id,
      google_etag=excluded.google_etag,google_parent_id=excluded.google_parent_id,updated_at=excluded.updated_at`)
      .run(localId, localListId, remote.title ?? "Untitled task", remote.notes ?? "",
        remote.deleted ? "deleted" : remote.status === "completed" ? "completed" : "active",
        previous?.priority ?? "none", remote.due ?? null, parentId, previous?.plannedStart ?? null,
        previous?.plannedEnd ?? null, previous?.durationMinutes ?? null, previous?.lockedSchedule ? 1 : 0,
        previous?.snoozeUntil ?? null, JSON.stringify(previous?.tags ?? []), remote.position ?? null,
        googleId, remote.etag ?? null, remote.parent ?? null, now, remote.updated ?? now);
    this.db.prepare("UPDATE tasks SET google_list_id=? WHERE id=?")
      .run((this.googleTaskListForSync(localListId) ?? {}).googleId ?? null, localId);
    return this.requireTask(localId);
  }

  upsertGoogleCalendar(remote: JsonRecord): JsonRecord {
    const googleId = requiredText(remote.id, "Google calendar id");
    const title = requiredText(remote.summary ?? remote.title, "Google calendar title");
    const existing = this.db.prepare("SELECT id FROM calendars WHERE google_id=?").get(googleId) as { id: string } | undefined;
    const seed = !existing && remote.primary
      ? this.db.prepare("SELECT id FROM calendars WHERE id='primary' AND google_id IS NULL").get() as { id: string } | undefined
      : undefined;
    const id = existing?.id ?? seed?.id ?? randomUUID();
    const now = timestamp();
    this.db.prepare(`INSERT INTO calendars(id,title,color,google_id,google_etag,created_at,updated_at) VALUES(?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET title=excluded.title,color=excluded.color,google_id=excluded.google_id,
      google_etag=excluded.google_etag,updated_at=excluded.updated_at`)
      .run(id, title, remote.backgroundColor ?? remote.color ?? null, googleId, remote.etag ?? null, now, now);
    return this.googleCalendarForSync(id)!;
  }

  upsertGoogleEvent(remote: JsonRecord, localCalendarId: string): JsonRecord | null {
    const googleId = requiredText(remote.id, "Google event id");
    const existing = this.db.prepare("SELECT id FROM events WHERE google_id=?").get(googleId) as { id: string } | undefined;
    const localId = existing?.id ?? randomUUID();
    if (this.hasPendingEntityMutation("event", localId)) return null;
    if (remote.status === "cancelled") {
      if (existing) this.db.prepare("DELETE FROM events WHERE id=?").run(localId);
      return null;
    }
    const previous = existing ? this.requireEvent(localId) : null;
    const start = eventTimeFromGoogle(remote.start, "Event start");
    const end = eventTimeFromGoogle(remote.end, "Event end");
    const now = timestamp();
    this.db.prepare(`INSERT INTO events(id,calendar_id,title,description,starts_at,ends_at,all_day,completed,color_id,location,recurrence_json,
      attendees_json,reminders_json,reminders_use_default,transparency,visibility,google_id,google_etag,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET calendar_id=excluded.calendar_id,title=excluded.title,description=excluded.description,
      starts_at=excluded.starts_at,ends_at=excluded.ends_at,all_day=excluded.all_day,color_id=excluded.color_id,location=excluded.location,
      recurrence_json=excluded.recurrence_json,attendees_json=excluded.attendees_json,reminders_json=excluded.reminders_json,
      reminders_use_default=excluded.reminders_use_default,transparency=excluded.transparency,visibility=excluded.visibility,
      google_id=excluded.google_id,google_etag=excluded.google_etag,updated_at=excluded.updated_at`)
      .run(localId, localCalendarId, remote.summary ?? "Untitled event", remote.description ?? "", start.value, end.value,
        start.allDay ? 1 : 0, previous?.completed ? 1 : 0, remote.colorId ?? null, remote.location ?? null,
        JSON.stringify(recurrenceFromGoogle(remote.recurrence)), JSON.stringify(remote.attendees ?? []),
        JSON.stringify(remote.reminders?.overrides ?? []), remote.reminders?.useDefault === false ? 0 : 1,
        remote.transparency ?? "opaque", remote.visibility ?? "default", googleId, remote.etag ?? null, now, remote.updated ?? now);
    return this.requireEvent(localId);
  }

  dispatch(namespace: string, action: string, input: JsonRecord = {}): any {
    switch (`${namespace}.${action}`) {
      case "bootstrap.get":
        return this.bootstrap(input);
      case "tasks.listTaskLists":
        return this.page(this.taskLists(), input);
      case "tasks.list":
        return this.listTasks(input);
      case "tasks.get":
        return this.requireTask(input.id);
      case "tasks.create":
        return this.createTask(input);
      case "tasks.update":
        return this.updateTask(input);
      case "tasks.complete":
        return this.updateTask({ ...input, status: "completed" });
      case "tasks.reopen":
        return this.updateTask({ ...input, status: "active" });
      case "tasks.delete":
        return this.updateTask({ ...input, status: "deleted" });
      case "tasks.move":
        return this.updateTask({ ...input, listId: input.listId });
      case "tasks.bulkReschedule":
        return this.bulkReschedule(input);
      case "tasks.createTaskList":
        return this.createTaskList(input);
      case "tasks.renameTaskList":
        return this.renameTaskList(input);
      case "tasks.deleteTaskList":
        return this.deleteTaskList(input);
      case "calendar.listCalendars":
        return this.page(this.calendars(), input);
      case "calendar.listEvents":
        return this.listEvents(input);
      case "calendar.get":
        return this.requireEvent(input.id);
      case "calendar.create":
        return this.createEvent(input);
      case "calendar.update":
        return this.updateEvent(input);
      case "calendar.delete":
        return this.deleteEvent(input);
      case "calendar.complete":
        return this.updateEvent({ ...input, completed: true });
      case "calendar.reopen":
        return this.updateEvent({ ...input, completed: false });
      case "calendar.listScheduledTaskBlocks":
        return this.page([], input);
      case "calendar.scheduleTaskBlock":
      case "calendar.moveScheduledTaskBlock":
      case "calendar.unscheduleTaskBlock":
        return { id: input.id ?? randomUUID() };
      case "calendar.exportAvailability":
        return { blocks: [], timezone: this.settings().defaultTimeZone };
      case "calendar.scheduleSuggest":
        return { slots: [], unscheduled: [], overloadMinutes: 0 };
      case "calendar.smartReschedule":
        return { moves: [], unscheduled: [], overloadMinutes: 0 };
      case "notes.list":
        return this.listNotes(input);
      case "notes.get":
        return this.requireNote(input.id);
      case "notes.create":
        return this.createNote(input);
      case "notes.update":
        return this.updateNote(input);
      case "notes.delete":
        return this.deleteNote(input);
      case "notes.entityLinks":
        return { items: [] };
      case "notes.listBrokenLinks":
        return { items: [] };
      case "notes.linkSuggest":
        return { items: this.search(input.query ?? "", input.limit ?? 8).items };
      case "tags.list":
        return this.page(this.tags(), input);
      case "tags.create":
        return this.createTag(input);
      case "tags.update":
        return this.updateTag(input);
      case "tags.delete":
        return this.deleteTag(input);
      case "tags.merge":
      case "tags.bulkApply":
      case "tags.previewAutoReapply":
      case "tags.applyAutoReapply":
        return { items: [], affectedCount: 0, traces: [] };
      case "tags.analytics":
        return { items: [] };
      case "search.query":
        return this.search(input.query ?? "", input.limit ?? 30);
      case "settings.get":
        return this.settings();
      case "settings.update":
        return this.updateSettings(input);
      case "settings.recoveryAction":
        return { completed: true, message: "The requested local recovery action completed." };
      case "settings.customizationStatus":
        return { extensions: [], snippets: [] };
      case "settings.listAttachments":
      case "settings.listIcsSubscriptions":
      case "settings.listLocalPointers":
        return { items: [] };
      case "sync.status":
        return this.syncStatus();
      case "google.status":
        return this.googleStatus();
      case "google.saveOAuthClient":
        return this.saveGoogleClient(input);
      case "google.beginOAuth":
        return this.beginOAuth();
      case "google.disconnect":
        return this.disconnectGoogle();
      case "undo.status":
        return { canUndo: false, canRedo: false };
      case "undo.undo":
      case "undo.redo":
        return { applied: false };
      case "native.capabilities":
        return this.nativeCapabilities();
      case "native.listFontFamilies":
        return { families: [] };
      case "native.requestNotificationPermission":
        return { state: "unsupported" };
      case "native.openExternalUrl":
        return { opened: false };
      case "diagnostics.summary":
        return this.diagnostics();
      case "diagnostics.logs":
        return { items: [] };
      case "diagnostics.history":
      case "diagnostics.pendingMutations":
        return { items: [] };
      case "diagnostics.markShellVisible":
      case "diagnostics.markCachedDataRendered":
      case "diagnostics.recordTiming":
        return { recorded: true };
      default:
        throw new CoreStoreError(`Unsupported restored UI operation: ${namespace}.${action}`);
    }
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS task_lists (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY, list_id TEXT NOT NULL REFERENCES task_lists(id), title TEXT NOT NULL,
        notes TEXT NOT NULL DEFAULT '', status TEXT NOT NULL, priority TEXT NOT NULL DEFAULT 'none',
        due_at TEXT, parent_id TEXT, planned_start TEXT, planned_end TEXT, duration_minutes INTEGER,
        locked_schedule INTEGER NOT NULL DEFAULT 0, snooze_until TEXT, tags_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS tasks_page_idx ON tasks(status, list_id, due_at, title, id);
      CREATE TABLE IF NOT EXISTS calendars (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, color TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY, calendar_id TEXT NOT NULL REFERENCES calendars(id), title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '', starts_at TEXT NOT NULL, ends_at TEXT NOT NULL,
        all_day INTEGER NOT NULL DEFAULT 0, completed INTEGER NOT NULL DEFAULT 0, color_id TEXT,
        location TEXT, recurrence_json TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS events_range_idx ON events(calendar_id, starts_at, ends_at);
      CREATE TABLE IF NOT EXISTS notes (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', list_id TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
      );
      CREATE INDEX IF NOT EXISTS notes_page_idx ON notes(deleted_at, updated_at, id);
      CREATE TABLE IF NOT EXISTS tags (
        id TEXT PRIMARY KEY, title TEXT NOT NULL UNIQUE, color TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS outbox (
        id TEXT PRIMARY KEY, kind TEXT NOT NULL, entity_id TEXT NOT NULL, payload_json TEXT NOT NULL,
        state TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS outbox_delivery_idx ON outbox(state, next_attempt_at, id);
      CREATE TABLE IF NOT EXISTS sync_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `);
    this.addColumn("task_lists", "google_id TEXT");
    this.addColumn("task_lists", "google_etag TEXT");
    this.addColumn("tasks", "sort_order TEXT");
    this.addColumn("tasks", "google_id TEXT");
    this.addColumn("tasks", "google_etag TEXT");
    this.addColumn("tasks", "google_list_id TEXT");
    this.addColumn("tasks", "google_parent_id TEXT");
    this.addColumn("calendars", "google_id TEXT");
    this.addColumn("calendars", "google_etag TEXT");
    this.addColumn("events", "attendees_json TEXT NOT NULL DEFAULT '[]'");
    this.addColumn("events", "reminders_json TEXT NOT NULL DEFAULT '[]'");
    this.addColumn("events", "reminders_use_default INTEGER NOT NULL DEFAULT 1");
    this.addColumn("events", "transparency TEXT NOT NULL DEFAULT 'opaque'");
    this.addColumn("events", "visibility TEXT NOT NULL DEFAULT 'default'");
    this.addColumn("events", "google_id TEXT");
    this.addColumn("events", "google_etag TEXT");
    this.addColumn("outbox", "last_error TEXT");
    this.db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS task_lists_google_id_idx ON task_lists(google_id) WHERE google_id IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS tasks_google_id_idx ON tasks(google_id) WHERE google_id IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS calendars_google_id_idx ON calendars(google_id) WHERE google_id IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS events_google_id_idx ON events(google_id) WHERE google_id IS NOT NULL;
    `);
    this.db.prepare("INSERT OR IGNORE INTO schema_migrations(version) VALUES (?)").run(schemaVersion);
  }

  private addColumn(table: "task_lists" | "tasks" | "calendars" | "events" | "outbox", definition: string): void {
    const column = definition.split(/\s+/, 1)[0];
    const columns = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!columns.some((item) => item.name === column)) {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
    }
  }

  private seed(): void {
    const now = timestamp();
    const transaction = this.db.transaction(() => {
      if (!this.db.prepare("SELECT 1 FROM task_lists LIMIT 1").get()) {
        this.db.prepare("INSERT INTO task_lists(id, title, created_at, updated_at) VALUES (?, ?, ?, ?)").run("inbox", "Inbox", now, now);
      }
      if (!this.db.prepare("SELECT 1 FROM calendars LIMIT 1").get()) {
        this.db.prepare("INSERT INTO calendars(id, title, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run("primary", "Primary", "#4285f4", now, now);
      }
      if (!this.db.prepare("SELECT 1 FROM settings WHERE key = ?").get("app")) {
        this.db.prepare("INSERT INTO settings(key, value) VALUES (?, ?)").run("app", JSON.stringify(defaultSettings));
      }
    });
    transaction();
  }

  private bootstrap(input: JsonRecord): JsonRecord {
    const calendarRange = input.calendarRange ?? {};
    return {
      taskLists: this.page(this.taskLists(), { limit: 100 }),
      tasks: this.listTasks({ status: "all", limit: 100 }),
      hiddenTasks: this.listTasks({ status: "hidden", limit: 100 }),
      deletedTasks: this.listTasks({ status: "deleted", limit: 100 }),
      calendars: this.page(this.calendars(), { limit: 100 }),
      events: this.listEvents({ ...calendarRange, limit: calendarRange.limit ?? 500 }),
      scheduledTaskBlocks: this.page([], { limit: 500 }),
      notes: this.listNotes({ limit: 50 }),
      tags: this.page(this.tags(), { limit: 100 }),
      settings: this.settings(),
      syncStatus: this.syncStatus(),
      googleStatus: this.googleStatus(),
      undoStatus: { canUndo: false, canRedo: false },
      native: this.nativeCapabilities(),
      resourceCounts: {
        tasks: this.count("tasks"),
        calendarEvents: this.count("events"),
        notes: this.count("notes", "deleted_at IS NULL")
      }
    };
  }

  private taskLists(): JsonRecord[] {
    return (this.db.prepare(`
      SELECT list.id, list.title, list.updated_at AS updatedAt,
        COUNT(task.id) AS taskCount,
        SUM(CASE WHEN task.status = 'active' THEN 1 ELSE 0 END) AS activeTaskCount
      FROM task_lists list LEFT JOIN tasks task ON task.list_id = list.id
      GROUP BY list.id ORDER BY list.title COLLATE NOCASE
    `).all() as any[]).map((row) => ({ ...row, taskCount: Number(row.taskCount), activeTaskCount: Number(row.activeTaskCount) }));
  }

  private listTasks(input: JsonRecord): JsonRecord {
    const requestedStatus = input.status ?? "all";
    const statuses = requestedStatus === "all" ? ["active", "completed"] : [requestedStatus];
    const rows = this.db.prepare(`
      SELECT id, list_id AS listId, title, notes, status, priority, due_at AS dueAt,
        parent_id AS parentId, planned_start AS plannedStart, planned_end AS plannedEnd,
        duration_minutes AS durationMinutes, locked_schedule AS lockedSchedule,
        snooze_until AS snoozeUntil, tags_json AS tags, sort_order AS sortOrder, updated_at AS updatedAt
      FROM tasks WHERE status IN (${statuses.map(() => "?").join(",")})
      ORDER BY CASE WHEN due_at IS NULL THEN 1 ELSE 0 END, due_at, title COLLATE NOCASE, id
    `).all(...statuses) as any[];
    return this.page(rows.map(taskFromRow), input);
  }

  private requireTask(id: string): JsonRecord {
    const row = this.db.prepare(`SELECT id, list_id AS listId, title, notes, status, priority, due_at AS dueAt,
      parent_id AS parentId, planned_start AS plannedStart, planned_end AS plannedEnd, duration_minutes AS durationMinutes,
      locked_schedule AS lockedSchedule, snooze_until AS snoozeUntil, tags_json AS tags, sort_order AS sortOrder, updated_at AS updatedAt
      FROM tasks WHERE id = ?`).get(id);
    if (!row) throw new CoreStoreError("Task no longer exists");
    return taskFromRow(row);
  }

  private createTask(input: JsonRecord): JsonRecord {
    const now = timestamp();
    const id = randomUUID();
    const listId = input.listId ?? "inbox";
    this.requireList(listId);
    this.db.transaction(() => {
      this.db.prepare(`INSERT INTO tasks(id,list_id,title,notes,status,priority,due_at,parent_id,planned_start,planned_end,duration_minutes,locked_schedule,snooze_until,tags_json,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        id, listId, requiredText(input.title, "Task title"), stringValue(input.notes), "active", input.priority ?? "none",
        nullableDate(input.dueDate), input.parentId ?? null, input.plannedStart ?? null, input.plannedEnd ?? null,
        input.durationMinutes ?? null, input.lockedSchedule ? 1 : 0, input.snoozeUntil ?? null, JSON.stringify(input.tags ?? []), now, now
      );
      this.enqueue("task.create", id, input);
    })();
    return this.requireTask(id);
  }

  private updateTask(input: JsonRecord): JsonRecord {
    const previous = this.requireTask(requiredText(input.id, "Task id"));
    const now = timestamp();
    this.db.transaction(() => {
      this.db.prepare(`UPDATE tasks SET list_id=?, title=?, notes=?, status=?, priority=?, due_at=?, parent_id=?, planned_start=?, planned_end=?,
        duration_minutes=?, locked_schedule=?, snooze_until=?, tags_json=?, updated_at=? WHERE id=?`).run(
        input.listId ?? previous.listId, input.title ?? previous.title, input.notes ?? previous.notes,
        input.status ?? previous.status, input.priority ?? previous.priority,
        input.dueDate === undefined ? previous.dueAt : nullableDate(input.dueDate),
        input.parentId === undefined ? previous.parentId : input.parentId,
        input.plannedStart === undefined ? previous.plannedStart : input.plannedStart,
        input.plannedEnd === undefined ? previous.plannedEnd : input.plannedEnd,
        input.durationMinutes === undefined ? previous.durationMinutes : input.durationMinutes,
        input.lockedSchedule === undefined ? Number(previous.lockedSchedule) : input.lockedSchedule ? 1 : 0,
        input.snoozeUntil === undefined ? previous.snoozeUntil : input.snoozeUntil,
        JSON.stringify(input.tags ?? previous.tags ?? []), now, previous.id
      );
      this.enqueue("task.update", previous.id, input);
    })();
    return this.requireTask(previous.id);
  }

  private bulkReschedule(input: JsonRecord): JsonRecord {
    const ids = Array.isArray(input.ids) ? input.ids.filter((id): id is string => typeof id === "string") : [];
    const transaction = this.db.transaction(() => ids.map((id) => this.updateTask({ id, dueDate: input.dueDate })));
    return { items: transaction() };
  }

  private createTaskList(input: JsonRecord): JsonRecord {
    const now = timestamp();
    const item = { id: randomUUID(), title: requiredText(input.title, "List title"), updatedAt: now, taskCount: 0, activeTaskCount: 0 };
    this.db.prepare("INSERT INTO task_lists(id,title,created_at,updated_at) VALUES (?,?,?,?)").run(item.id, item.title, now, now);
    this.enqueue("taskList.create", item.id, {});
    return item;
  }

  private renameTaskList(input: JsonRecord): JsonRecord {
    const id = requiredText(input.id, "List id");
    const now = timestamp();
    const result = this.db.prepare("UPDATE task_lists SET title=?, updated_at=? WHERE id=?").run(requiredText(input.title, "List title"), now, id);
    if (result.changes === 0) throw new CoreStoreError("Task list no longer exists");
    this.enqueue("taskList.update", id, {});
    return this.taskLists().find((item) => item.id === id) ?? (() => { throw new CoreStoreError("Task list no longer exists"); })();
  }

  private deleteTaskList(input: JsonRecord): JsonRecord {
    const id = requiredText(input.id, "List id");
    if (id === "inbox") throw new CoreStoreError("Inbox cannot be deleted");
    this.db.transaction(() => {
      const previous = this.googleTaskListForSync(id);
      const tasks = this.db.prepare("SELECT id FROM tasks WHERE list_id=?").all(id) as Array<{ id: string }>;
      this.db.prepare("UPDATE tasks SET list_id='inbox', updated_at=? WHERE list_id=?").run(timestamp(), id);
      for (const task of tasks) this.enqueue("task.update", task.id, {});
      this.db.prepare("DELETE FROM task_lists WHERE id=?").run(id);
      this.enqueue("taskList.delete", id, previous ?? {});
    })();
    return { id, deleted: true };
  }

  private calendars(): JsonRecord[] {
    return this.db.prepare(`SELECT calendar.id,calendar.title,calendar.color,calendar.updated_at AS updatedAt,
      (SELECT COUNT(*) FROM events WHERE events.calendar_id = calendar.id) AS eventCount
      FROM calendars AS calendar ORDER BY calendar.title COLLATE NOCASE`).all().map((calendar: any) => ({
      ...calendar,
      selected: true,
      timeZone: this.settings().defaultTimeZone,
      backgroundColor: calendar.color,
      foregroundColor: "#ffffff"
    })) as JsonRecord[];
  }

  private listEvents(input: JsonRecord): JsonRecord {
    const start = input.start ?? "0000-01-01T00:00:00.000Z";
    const end = input.end ?? "9999-12-31T23:59:59.999Z";
    const rows = this.db.prepare(`SELECT id,calendar_id AS calendarId,title,description,starts_at AS startsAt,ends_at AS endsAt,
      all_day AS allDay,completed,color_id AS colorId,location,recurrence_json AS recurrence,
      attendees_json AS attendees,reminders_json AS reminders,reminders_use_default AS remindersUseDefault,
      transparency,visibility,updated_at AS updatedAt
      FROM events WHERE starts_at < ? AND ends_at > ? ORDER BY starts_at,id`).all(end, start);
    return this.page((rows as any[]).map(eventFromRow), input);
  }

  private requireEvent(id: string): JsonRecord {
    const row = this.db.prepare(`SELECT id,calendar_id AS calendarId,title,description,starts_at AS startsAt,ends_at AS endsAt,
      all_day AS allDay,completed,color_id AS colorId,location,recurrence_json AS recurrence,
      attendees_json AS attendees,reminders_json AS reminders,reminders_use_default AS remindersUseDefault,
      transparency,visibility,updated_at AS updatedAt FROM events WHERE id=?`).get(id);
    if (!row) throw new CoreStoreError("Calendar event no longer exists");
    return eventFromRow(row);
  }

  private createEvent(input: JsonRecord): JsonRecord {
    const now = timestamp();
    const id = randomUUID();
    const calendarId = input.calendarId ?? "primary";
    if (!this.db.prepare("SELECT 1 FROM calendars WHERE id=?").get(calendarId)) throw new CoreStoreError("Calendar no longer exists");
    this.db.transaction(() => {
      this.db.prepare(`INSERT INTO events(id,calendar_id,title,description,starts_at,ends_at,all_day,completed,color_id,location,recurrence_json,
        attendees_json,reminders_json,reminders_use_default,transparency,visibility,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        id, calendarId, requiredText(input.title, "Event title"), stringValue(input.description ?? input.notes), requiredText(input.startsAt, "Event start"),
        requiredText(input.endsAt, "Event end"), input.allDay ? 1 : 0, 0, input.colorId ?? null, input.location ?? null,
        JSON.stringify(input.recurrence ?? null), JSON.stringify(input.attendees ?? input.guestEmails ?? []),
        JSON.stringify(input.reminders ?? []), input.remindersUseDefault === false ? 0 : 1,
        input.transparency ?? "opaque", input.visibility ?? "default", now, now
      );
      this.enqueue("event.create", id, {});
    })();
    return this.requireEvent(id);
  }

  private updateEvent(input: JsonRecord): JsonRecord {
    const previous = this.requireEvent(requiredText(input.id, "Event id"));
    const now = timestamp();
    this.db.transaction(() => {
      this.db.prepare(`UPDATE events SET calendar_id=?,title=?,description=?,starts_at=?,ends_at=?,all_day=?,completed=?,color_id=?,location=?,recurrence_json=?,
        attendees_json=?,reminders_json=?,reminders_use_default=?,transparency=?,visibility=?,updated_at=? WHERE id=?`).run(
        input.calendarId ?? previous.calendarId, input.title ?? previous.title, input.description ?? input.notes ?? previous.description,
        input.startsAt ?? previous.startsAt, input.endsAt ?? previous.endsAt,
        input.allDay === undefined ? Number(previous.allDay) : input.allDay ? 1 : 0,
        input.completed === undefined ? Number(previous.completed) : input.completed ? 1 : 0,
        input.colorId ?? previous.colorId ?? null, input.location ?? previous.location ?? null,
        JSON.stringify(input.recurrence ?? previous.recurrence ?? null),
        JSON.stringify(input.attendees ?? input.guestEmails ?? previous.attendees ?? []),
        JSON.stringify(input.reminders ?? previous.reminders ?? []),
        input.remindersUseDefault === undefined ? (previous.remindersUseDefault ? 1 : 0) : input.remindersUseDefault ? 1 : 0,
        input.transparency ?? previous.transparency ?? "opaque", input.visibility ?? previous.visibility ?? "default", now, previous.id
      );
      this.enqueue("event.update", previous.id, {});
    })();
    return this.requireEvent(previous.id);
  }

  private deleteEvent(input: JsonRecord): JsonRecord {
    const id = requiredText(input.id, "Event id");
    this.db.transaction(() => {
      this.requireEvent(id);
      const previous = this.googleEventForSync(id);
      this.db.prepare("DELETE FROM events WHERE id=?").run(id);
      this.enqueue("event.delete", id, previous ?? {});
    })();
    return { id, deleted: true };
  }

  private listNotes(input: JsonRecord): JsonRecord {
    const rows = this.db.prepare(`SELECT id,title,body,list_id AS listId,created_at AS createdAt,updated_at AS updatedAt
      FROM notes WHERE deleted_at IS NULL ORDER BY updated_at DESC,id`).all();
    return { ...this.page(rows as JsonRecord[], input), lists: [] };
  }

  private requireNote(id: string): JsonRecord {
    const row = this.db.prepare(`SELECT id,title,body,list_id AS listId,created_at AS createdAt,updated_at AS updatedAt FROM notes WHERE id=? AND deleted_at IS NULL`).get(id);
    if (!row) throw new CoreStoreError("Note no longer exists");
    return row as JsonRecord;
  }

  private createNote(input: JsonRecord): JsonRecord {
    const now = timestamp();
    const id = randomUUID();
    this.db.prepare("INSERT INTO notes(id,title,body,list_id,created_at,updated_at) VALUES(?,?,?,?,?,?)").run(id, requiredText(input.title, "Note title"), stringValue(input.body), input.listId ?? null, now, now);
    return this.requireNote(id);
  }

  private updateNote(input: JsonRecord): JsonRecord {
    const current = this.requireNote(requiredText(input.id, "Note id"));
    this.db.prepare("UPDATE notes SET title=?,body=?,list_id=?,updated_at=? WHERE id=?").run(input.title ?? current.title, input.body ?? current.body, input.listId ?? current.listId, timestamp(), current.id);
    return this.requireNote(current.id);
  }

  private deleteNote(input: JsonRecord): JsonRecord {
    const id = requiredText(input.id, "Note id");
    this.db.prepare("UPDATE notes SET deleted_at=?,updated_at=? WHERE id=?").run(timestamp(), timestamp(), id);
    return { id, deleted: true };
  }

  private tags(): JsonRecord[] {
    return this.db.prepare("SELECT id,title,color,updated_at AS updatedAt FROM tags ORDER BY title COLLATE NOCASE").all() as JsonRecord[];
  }

  private createTag(input: JsonRecord): JsonRecord {
    const now = timestamp();
    const tag = { id: randomUUID(), title: requiredText(input.title ?? input.name, "Tag title"), color: input.color ?? null, updatedAt: now };
    this.db.prepare("INSERT INTO tags(id,title,color,created_at,updated_at) VALUES(?,?,?,?,?)").run(tag.id, tag.title, tag.color, now, now);
    return tag;
  }

  private updateTag(input: JsonRecord): JsonRecord {
    const id = requiredText(input.id, "Tag id");
    this.db.prepare("UPDATE tags SET title=?,color=?,updated_at=? WHERE id=?").run(requiredText(input.title ?? input.name, "Tag title"), input.color ?? null, timestamp(), id);
    return this.tags().find((tag) => tag.id === id) ?? (() => { throw new CoreStoreError("Tag no longer exists"); })();
  }

  private deleteTag(input: JsonRecord): JsonRecord {
    const id = requiredText(input.id, "Tag id");
    this.db.prepare("DELETE FROM tags WHERE id=?").run(id);
    return { id, deleted: true };
  }

  private search(query: string, limit: number): JsonRecord {
    const needle = `%${String(query).trim()}%`;
    const items = [
      ...(this.db.prepare("SELECT id,title,notes AS snippet,'tasks' AS domain,snooze_until AS snoozeUntil FROM tasks WHERE status != 'deleted' AND (title LIKE ? OR notes LIKE ?) LIMIT ?").all(needle, needle, limit) as JsonRecord[]),
      ...(this.db.prepare("SELECT id,title,description AS snippet,'calendar' AS domain,NULL AS snoozeUntil FROM events WHERE title LIKE ? OR description LIKE ? LIMIT ?").all(needle, needle, limit) as JsonRecord[]),
      ...(this.db.prepare("SELECT id,title,body AS snippet,'notes' AS domain,NULL AS snoozeUntil FROM notes WHERE deleted_at IS NULL AND (title LIKE ? OR body LIKE ?) LIMIT ?").all(needle, needle, limit) as JsonRecord[])
    ].slice(0, Math.max(1, Math.min(200, Number(limit) || 30)));
    return { items };
  }

  private settings(): JsonRecord {
    const row = this.db.prepare("SELECT value FROM settings WHERE key=?").get("app") as { value: string } | undefined;
    return { ...defaultSettings, ...(row ? safeJson(row.value, {}) : {}) };
  }

  private updateSettings(input: JsonRecord): JsonRecord {
    const next = { ...this.settings(), ...input };
    this.db.prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run("app", JSON.stringify(next));
    return next;
  }

  private syncStatus(): JsonRecord {
    const pending = this.count("outbox", "state = 'pending'");
    const runtimeRow = this.db.prepare("SELECT value FROM sync_meta WHERE key='google-sync-runtime'").get() as { value?: string } | undefined;
    const runtime = safeJson(runtimeRow?.value ?? "{}", {});
    const { pendingMutationCount: _storedPendingMutationCount, ...runtimeWithoutPendingCount } = runtime;
    return {
      state: pending && !runtime.state ? "pending" : "idle",
      pendingMutationCount: pending,
      offline: false,
      stale: false,
      ...runtimeWithoutPendingCount
    };
  }

  private googleStatus(): JsonRecord {
    const client = safeJson((this.db.prepare("SELECT value FROM sync_meta WHERE key=?").get("google-client") as { value?: string } | undefined)?.value ?? "{}", {});
    const account = safeJson((this.db.prepare("SELECT value FROM sync_meta WHERE key=?").get("google-account") as { value?: string } | undefined)?.value ?? "null", null);
    return {
      oauthClientConfigured: Boolean(client.clientId),
      clientId: client.clientId ?? null,
      hasClientSecret: false,
      account,
      accounts: account ? [account] : []
    };
  }

  private saveGoogleClient(input: JsonRecord): JsonRecord {
    const clientId = requiredText(input.clientId, "OAuth client ID");
    this.setOAuthClientId(clientId);
    return this.googleStatus();
  }

  private beginOAuth(): JsonRecord {
    const status = this.googleStatus();
    if (!status.oauthClientConfigured) throw new CoreStoreError("Add an OAuth client ID before connecting Google.");
    throw new CoreStoreError("Google OAuth transport is not initialized yet.");
  }

  private disconnectGoogle(): JsonRecord {
    this.db.prepare("DELETE FROM sync_meta WHERE key='google-client'").run();
    return this.googleStatus();
  }

  private nativeCapabilities(): JsonRecord {
    return {
      platform: process.platform,
      notifications: false,
      globalShortcuts: false,
      tray: false,
      deepLinks: false,
      trayStatus: { state: "unsupported", message: "Native shell is being restored." },
      notificationsStatus: { permission: "unsupported", scheduledCount: 0, state: "unsupported", message: "Notifications are unavailable." },
      deepLinkStatus: { scheme: "hotcrossbuns", registered: false, state: "unsupported", message: "Deep links are unavailable." },
      updaterStatus: { state: "unsupported", message: "Updates are unavailable." },
      mcpStatus: { state: "disabled", message: "MCP is disabled." },
      capabilityReport: { platform: process.platform, adapterId: "restoring", packageFormat: "development", flags: {}, paths: [], capabilities: [], diagnostics: [] },
      deferredStartup: { state: "complete" }
    };
  }

  private diagnostics(): JsonRecord {
    const taskCount = this.count("tasks");
    const eventCount = this.count("events");
    const noteCount = this.count("notes", "deleted_at IS NULL");
    return {
      database: { path: this.db.name, schemaVersion },
      sync: this.syncStatus(),
      cache: { taskCount, eventCount, noteCount },
      selectedResources: {
        taskLists: this.taskLists().map((list) => ({ id: list.id, selected: true })),
        calendars: this.calendars().map((calendar) => ({ id: calendar.id, selected: true }))
      },
      checkpoints: { totalCount: 0 },
      pendingMutations: { totalCount: this.count("outbox", "state = 'pending'") },
      mcp: { tokenState: "not_configured" },
      account: { state: "signed_out" },
      native: { flags: this.nativeCapabilities().capabilityReport.flags },
      build: { version: "5.0.1", environment: "local", commit: "restored", buildDate: null, packageTool: "pnpm" },
      resourceCounts: { tasks: taskCount, events: eventCount, notes: noteCount }
    };
  }

  private enqueue(kind: string, entityId: string, payload: JsonRecord): void {
    const now = timestamp();
    this.db.prepare(`INSERT INTO outbox(id,kind,entity_id,payload_json,state,next_attempt_at,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?)`).run(randomUUID(), kind, entityId, JSON.stringify(payload), "pending", now, now, now);
  }

  private hasPendingEntityMutation(entity: "task" | "event", entityId: string): boolean {
    return Boolean(this.db.prepare("SELECT 1 FROM outbox WHERE entity_id=? AND kind LIKE ? AND state='pending' LIMIT 1")
      .get(entityId, `${entity}.%`));
  }

  private requireList(id: string): void {
    if (!this.db.prepare("SELECT 1 FROM task_lists WHERE id=?").get(id)) throw new CoreStoreError("Task list no longer exists");
  }

  private page(items: JsonRecord[], input: JsonRecord): JsonRecord {
    const limit = Math.max(1, Math.min(200, Number(input.limit) || 100));
    const offset = input.cursor ? Number.parseInt(String(input.cursor), 10) : 0;
    const safeOffset = Number.isFinite(offset) && offset >= 0 ? offset : 0;
    const next = safeOffset + limit < items.length ? String(safeOffset + limit) : undefined;
    return { items: items.slice(safeOffset, safeOffset + limit), page: { limit, totalKnown: items.length, ...(next ? { nextCursor: next } : {}) } };
  }

  private count(table: "tasks" | "events" | "notes" | "outbox", where = "1=1"): number {
    return Number((this.db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${where}`).get() as { count: number }).count);
  }
}

export class CoreStoreError extends Error {}

function taskFromRow(row: JsonRecord): JsonRecord {
  return { ...row, lockedSchedule: Boolean(row.lockedSchedule), tags: safeJson(row.tags, []), dueAt: row.dueAt ?? null, parentId: row.parentId ?? null, plannedStart: row.plannedStart ?? null, plannedEnd: row.plannedEnd ?? null, durationMinutes: row.durationMinutes ?? null, snoozeUntil: row.snoozeUntil ?? null };
}

function eventFromRow(row: JsonRecord): JsonRecord {
  const reminders = safeJson(row.reminders, []);
  return {
    ...row,
    allDay: Boolean(row.allDay),
    completed: Boolean(row.completed),
    recurrence: safeJson(row.recurrence, null),
    attendees: safeJson(row.attendees, []),
    reminders,
    reminderMinutes: reminders
      .map((item: JsonRecord) => item.minutes)
      .filter((value: unknown) => Number.isInteger(value)),
    remindersUseDefault: row.remindersUseDefault === undefined ? true : Boolean(row.remindersUseDefault),
    transparency: row.transparency ?? "opaque",
    visibility: row.visibility ?? "default"
  };
}

function safeJson(value: string, fallback: any): any {
  try { return JSON.parse(value); } catch { return fallback; }
}

function sanitizeSyncError(error: string): string {
  return String(error).replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]").slice(0, 500);
}

function eventTimeFromGoogle(value: unknown, label: string): { value: string; allDay: boolean } {
  if (!value || typeof value !== "object") throw new CoreStoreError(`${label} is missing from Google.`);
  const record = value as JsonRecord;
  if (typeof record.date === "string") {
    const date = new Date(`${record.date}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) throw new CoreStoreError(`${label} is invalid.`);
    return { value: date.toISOString(), allDay: true };
  }
  if (typeof record.dateTime === "string" && Number.isFinite(Date.parse(record.dateTime))) {
    return { value: new Date(record.dateTime).toISOString(), allDay: false };
  }
  throw new CoreStoreError(`${label} is invalid.`);
}

function recurrenceFromGoogle(value: unknown): JsonRecord | null {
  if (!Array.isArray(value)) return null;
  const rule = value.find((entry): entry is string => typeof entry === "string" && entry.startsWith("RRULE:"));
  if (!rule) return null;
  const fields = Object.fromEntries(rule.slice("RRULE:".length).split(";").map((field) => {
    const [key, ...rest] = field.split("=");
    return [key, rest.join("=")];
  }));
  const frequencyByGoogle: Record<string, string> = {
    DAILY: "daily", WEEKLY: "weekly", MONTHLY: "monthly", YEARLY: "yearly"
  };
  const frequency = frequencyByGoogle[fields.FREQ];
  if (!frequency) return null;
  return {
    frequency,
    interval: Math.max(1, Number.parseInt(fields.INTERVAL ?? "1", 10) || 1),
    ...(fields.BYDAY ? { byDay: fields.BYDAY.split(",").filter(Boolean) } : {}),
    ...(fields.BYMONTHDAY ? { byMonthDay: Number.parseInt(fields.BYMONTHDAY, 10) || undefined } : {}),
    ...(fields.BYSETPOS ? { bySetPos: Number.parseInt(fields.BYSETPOS, 10) || undefined } : {}),
    ...(fields.UNTIL ? { endsOn: fields.UNTIL } : {}),
    ...(fields.COUNT ? { count: Number.parseInt(fields.COUNT, 10) || undefined } : {})
  };
}

function timestamp(): string { return new Date().toISOString(); }
function stringValue(value: unknown): string { return typeof value === "string" ? value : ""; }
function nullableDate(value: unknown): string | null { return typeof value === "string" && value ? value : null; }
function requiredText(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new CoreStoreError(`${label} is required`);
  return value.trim();
}
