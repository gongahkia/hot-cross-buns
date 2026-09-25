import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

type JsonRecord = Record<string, any>;

export interface CoreNativeBridge {
  capabilities: () => JsonRecord;
  listFontFamilies: () => JsonRecord | Promise<JsonRecord>;
  requestNotificationPermission: () => JsonRecord | Promise<JsonRecord>;
  openExternalUrl: (request: { url: string }) => JsonRecord | Promise<JsonRecord>;
  applySettings?: (settings: JsonRecord) => void;
}

export interface PendingSyncMutation {
  id: string;
  accountId: string | null;
  kind: string;
  entityId: string;
  payload: JsonRecord;
  attempts: number;
  createdAt: string;
}

// v3 deliberately starts a new developer-only data set.  The previous
// restored Electron build used global Google identifiers, which makes two
// accounts unsafe (both can legitimately expose e.g. a `primary` calendar).
// This branch has no released users, so a clean reset is safer than a lossy
// inference migration.
const schemaVersion = 4;
const localAccountId = "local";

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
  loadingIndicators: {
    general: "blocks",
    search: "blocks",
    preview: "blocks"
  },
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
  private fullTextSearchAvailable = false;
  private applyingUndo = false;
  private nativeBridge: CoreNativeBridge | null = null;
  private developerDataWasReset = false;

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

  attachNativeBridge(nativeBridge: CoreNativeBridge): void {
    this.nativeBridge = nativeBridge;
    nativeBridge.applySettings?.(this.settings());
  }

  get didResetDeveloperData(): boolean { return this.developerDataWasReset; }

  oauthClientId(): string | null {
    return this.googleStatus().clientId;
  }

  setOAuthClientId(clientId: string): void {
    this.db.prepare("INSERT INTO sync_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
      .run("google-client", JSON.stringify({ clientId }));
  }

  googleAccounts(): JsonRecord[] {
    return this.db.prepare(`SELECT id AS accountId,google_account_id AS googleAccountId,email,display_name AS displayName,
      avatar_url AS avatarUrl,connection_state AS connectionState,missing_scopes_json AS missingScopes,
      granted_scopes_json AS grantedScopes,updated_at AS updatedAt
      FROM google_accounts ORDER BY created_at`).all().map((row: any) => ({
      ...row,
      missingScopes: safeJson(row.missingScopes, []),
      grantedScopes: safeJson(row.grantedScopes, [])
    })) as JsonRecord[];
  }

  upsertGoogleAccount(input: JsonRecord): JsonRecord {
    const googleAccountId = requiredText(input.googleAccountId ?? input.id, "Google account id");
    const existing = this.db.prepare("SELECT id FROM google_accounts WHERE google_account_id=?").get(googleAccountId) as { id: string } | undefined;
    const accountId = existing?.id ?? randomUUID();
    const now = timestamp();
    this.db.prepare(`INSERT INTO google_accounts(id,google_account_id,email,display_name,avatar_url,connection_state,missing_scopes_json,granted_scopes_json,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(google_account_id) DO UPDATE SET email=excluded.email,display_name=excluded.display_name,
      avatar_url=excluded.avatar_url,connection_state=excluded.connection_state,missing_scopes_json=excluded.missing_scopes_json,
      granted_scopes_json=excluded.granted_scopes_json,updated_at=excluded.updated_at`).run(
      accountId, googleAccountId, input.email ?? null, input.displayName ?? input.email ?? "Google account", input.avatarUrl ?? null,
      input.connectionState ?? "connected", JSON.stringify(input.missingScopes ?? []), JSON.stringify(input.grantedScopes ?? []), now, now
    );
    return this.googleAccount(accountId)!;
  }

  googleAccount(accountId: string): JsonRecord | null {
    return this.googleAccounts().find((account) => account.accountId === accountId) ?? null;
  }

  updateGoogleAccountState(accountId: string, connectionState: string, message?: string): void {
    const result = this.db.prepare("UPDATE google_accounts SET connection_state=?,last_error=?,updated_at=? WHERE id=?")
      .run(connectionState, message ?? null, timestamp(), accountId);
    if (result.changes === 0) throw new CoreStoreError("Google account no longer exists.");
  }

  removeGoogleAccount(accountId: string): void {
    // Remote records remain a local cache until the user explicitly clears the
    // workspace; disconnecting must not silently delete their planner data.
    this.updateGoogleAccountState(accountId, "disconnected");
    this.resetGoogleSyncTokens(accountId);
  }

  previewCrossAccountCopy(input: JsonRecord): JsonRecord {
    const { sourceAccountId, destinationAccountId, destinationCalendarId } = this.crossAccountCopyTargets(input);
    const taskListCount = Number((this.db.prepare("SELECT COUNT(*) AS count FROM task_lists WHERE account_id=?").get(sourceAccountId) as { count: number }).count);
    const taskCount = Number((this.db.prepare(`SELECT COUNT(*) AS count FROM tasks task JOIN task_lists list ON list.id=task.list_id
      WHERE list.account_id=? AND task.status != 'deleted'`).get(sourceAccountId) as { count: number }).count);
    const events = this.db.prepare("SELECT event_type AS eventType FROM events event JOIN calendars calendar ON calendar.id=event.calendar_id WHERE calendar.account_id=?")
      .all(sourceAccountId) as Array<{ eventType?: string }>;
    return {
      sourceAccountId,
      destinationAccountId,
      destinationCalendarId,
      taskLists: taskListCount,
      tasks: taskCount,
      events: events.filter((event) => normalizedEventType(event.eventType) === "default").length,
      skippedStatusEvents: events.filter((event) => normalizedEventType(event.eventType) !== "default").length,
      safety: [
        "Copies create new Google resources after the normal outbox sync.",
        "The source account is never modified or deleted.",
        "Copied events omit attendees, Meet conferences, Drive attachments, and status-event types to avoid invitations and access leaks."
      ]
    };
  }

  copyCrossAccountData(input: JsonRecord): JsonRecord {
    if (input.confirmation !== "COPY") throw new CoreStoreError("Cross-account copy requires the explicit confirmation word COPY.");
    const preview = this.previewCrossAccountCopy(input);
    const { sourceAccountId, destinationAccountId, destinationCalendarId } = preview;
    const sourceLists = this.db.prepare("SELECT id,title FROM task_lists WHERE account_id=? ORDER BY title COLLATE NOCASE,id").all(sourceAccountId) as Array<{ id: string; title: string }>;
    const sourceTasks = this.db.prepare(`SELECT task.id,task.list_id AS listId,task.title,task.notes,task.status,task.priority,task.due_at AS dueAt,
      task.parent_id AS parentId,task.duration_minutes AS durationMinutes,task.locked_schedule AS lockedSchedule,task.snooze_until AS snoozeUntil,task.tags_json AS tags
      FROM tasks task JOIN task_lists list ON list.id=task.list_id WHERE list.account_id=? AND task.status != 'deleted'
      ORDER BY task.created_at,task.id`).all(sourceAccountId) as JsonRecord[];
    const sourceEventIds = (this.db.prepare(`SELECT event.id FROM events event JOIN calendars calendar ON calendar.id=event.calendar_id
      WHERE calendar.account_id=? AND event.event_type='default' ORDER BY event.starts_at,event.id`).all(sourceAccountId) as Array<{ id: string }>).map((row) => row.id);
    const listMap = new Map<string, string>();
    const taskMap = new Map<string, string>();

    for (const list of sourceLists) {
      const copied = this.createTaskList({ accountId: destinationAccountId, title: `${list.title} (copied)` });
      listMap.set(list.id, copied.id);
    }
    for (const task of sourceTasks) {
      const listId = listMap.get(task.listId);
      if (!listId) continue;
      const copied = this.createTask({
        listId,
        title: task.title,
        notes: task.notes,
        priority: task.priority,
        dueDate: task.dueAt,
        durationMinutes: task.durationMinutes,
        lockedSchedule: Boolean(task.lockedSchedule),
        snoozeUntil: task.snoozeUntil,
        tags: safeJson(task.tags, [])
      });
      taskMap.set(task.id, copied.id);
      if (task.status === "completed") this.updateTask({ id: copied.id, status: "completed" });
    }
    for (const task of sourceTasks) {
      if (!task.parentId) continue;
      const copiedId = taskMap.get(task.id);
      const copiedParentId = taskMap.get(task.parentId);
      if (copiedId && copiedParentId) this.updateTask({ id: copiedId, parentId: copiedParentId });
    }
    for (const eventId of sourceEventIds) {
      const event = this.requireEvent(eventId);
      this.createEvent({
        calendarId: destinationCalendarId,
        title: event.title,
        description: event.description ?? event.notes,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
        allDay: event.allDay,
        colorId: event.colorId,
        location: event.location,
        recurrence: event.recurrence,
        reminders: event.reminders,
        remindersUseDefault: event.remindersUseDefault,
        transparency: event.transparency,
        visibility: event.visibility,
        timeZone: event.timeZone,
        attachments: []
      });
    }
    return {
      ...preview,
      copied: { taskLists: listMap.size, tasks: taskMap.size, events: sourceEventIds.length },
      message: "Copies are queued locally. Run sync or wait for the normal debounced sync before checking the destination account."
    };
  }

  /**
   * The sync service is deliberately the only code which reads these records.
   * Renderer DTOs never contain a Google identifier, ETag, sync token, or
   * credential. Local ids stay stable while a remote create is in flight.
   */
  pendingSyncMutations(limit = 100, accountId?: string): PendingSyncMutation[] {
    const accountFilter = accountId ? " AND account_id=?" : "";
    return (this.db.prepare(`SELECT id,account_id AS accountId,kind,entity_id AS entityId,payload_json AS payload,
      attempts,created_at AS createdAt FROM outbox WHERE state='pending' AND next_attempt_at <= ?${accountFilter}
      ORDER BY created_at,id LIMIT ?`).all(timestamp(), ...(accountId ? [accountId] : []), Math.max(1, Math.min(500, limit))) as any[])
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

  resetGoogleSyncTokens(accountId?: string): void {
    const prefix = accountId ? `google-sync-token:${accountId}:%` : "google-sync-token:%";
    this.db.prepare("DELETE FROM sync_meta WHERE key LIKE ?").run(prefix);
  }

  googleSyncToken(accountId: string, key: string): string | null {
    const row = this.db.prepare("SELECT value FROM sync_meta WHERE key=?").get(`google-sync-token:${accountId}:${key}`) as { value?: string } | undefined;
    return row?.value ?? null;
  }

  setGoogleSyncToken(accountId: string, key: string, token: string | null): void {
    const metaKey = `google-sync-token:${accountId}:${key}`;
    if (!token) {
      this.db.prepare("DELETE FROM sync_meta WHERE key=?").run(metaKey);
      return;
    }
    this.db.prepare("INSERT INTO sync_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
      .run(metaKey, token);
  }

  isSelectedTaskList(id: string): boolean {
    const selected = stringArray(this.settings().selectedTaskListIds);
    return selected.length === 0 || selected.includes(id);
  }

  isSelectedCalendar(id: string): boolean {
    const selected = stringArray(this.settings().selectedCalendarIds);
    return selected.length === 0 || selected.includes(id);
  }

  setSyncRuntime(status: JsonRecord): void {
    this.db.prepare("INSERT INTO sync_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
      .run("google-sync-runtime", JSON.stringify({ ...status, updatedAt: timestamp() }));
  }

  googleTaskListForSync(id: string): JsonRecord | null {
    return (this.db.prepare("SELECT id,account_id AS accountId,title,google_id AS googleId,google_etag AS googleEtag FROM task_lists WHERE id=?").get(id) as JsonRecord | undefined) ?? null;
  }

  googleTaskForSync(id: string): JsonRecord | null {
    return (this.db.prepare(`SELECT task.id,task.list_id AS listId,task.title,task.notes,task.status,task.due_at AS dueAt,
      task.parent_id AS parentId,task.sort_order AS sortOrder,task.google_id AS googleId,task.google_etag AS googleEtag,
      task.google_list_id AS googleListId,task.google_parent_id AS googleParentId,
      list.google_id AS listGoogleId,list.account_id AS accountId FROM tasks task JOIN task_lists list ON list.id=task.list_id WHERE task.id=?`)
      .get(id) as JsonRecord | undefined) ?? null;
  }

  bindGoogleTaskList(localId: string, remote: JsonRecord): JsonRecord {
    const googleId = requiredText(remote.id, "Google task-list id");
    const result = this.db.prepare("UPDATE task_lists SET google_id=?,google_etag=?,updated_at=? WHERE id=?")
      .run(googleId, remote.etag ?? null, remote.updated ?? timestamp(), localId);
    if (result.changes === 0) throw new CoreStoreError("Task list no longer exists");
    return this.googleTaskListForSync(localId)!;
  }

  googleCalendarForSync(id: string): JsonRecord | null {
    return (this.db.prepare("SELECT id,account_id AS accountId,title,color,time_zone AS timeZone,google_id AS googleId,google_etag AS googleEtag FROM calendars WHERE id=?").get(id) as JsonRecord | undefined) ?? null;
  }

  googleEventForSync(id: string): JsonRecord | null {
    const record = this.db.prepare(`SELECT event.id,event.calendar_id AS calendarId,event.title,event.description,event.starts_at AS startsAt,
      event.ends_at AS endsAt,event.all_day AS allDay,event.color_id AS colorId,event.location,event.recurrence_json AS recurrence,
      event.attendees_json AS attendees,event.reminders_json AS reminders,event.reminders_use_default AS remindersUseDefault,
      event.transparency,event.visibility,event.time_zone AS timeZone,event.google_id AS googleId,event.google_etag AS googleEtag,
      event.google_recurring_event_id AS googleRecurringEventId,event.google_original_start_time AS googleOriginalStartTime,
      event.conference_json AS conference,event.conference_create_requested AS conferenceCreateRequested,
      event.attachments_json AS attachments,event.attachments_managed AS attachmentsManaged,event.event_type AS eventType,
      event.focus_time_properties_json AS focusTimeProperties,event.out_of_office_properties_json AS outOfOfficeProperties,
      event.working_location_properties_json AS workingLocationProperties,event.self_response_status AS selfResponseStatus,
      calendar.google_id AS calendarGoogleId,calendar.account_id AS accountId FROM events event JOIN calendars calendar ON calendar.id=event.calendar_id WHERE event.id=?`)
      .get(id) as JsonRecord | undefined;
    return record
      ? {
          ...record,
          recurrence: safeJson(record.recurrence, null),
          attendees: safeJson(record.attendees, []),
          reminders: safeJson(record.reminders, []),
          conference: safeJson(record.conference, null),
          attachments: safeJson(record.attachments, []),
          attachmentsManaged: Boolean(record.attachmentsManaged),
          conferenceCreateRequested: Boolean(record.conferenceCreateRequested),
          focusTimeProperties: safeJson(record.focusTimeProperties, null),
          outOfOfficeProperties: safeJson(record.outOfOfficeProperties, null),
          workingLocationProperties: safeJson(record.workingLocationProperties, null)
        }
      : null;
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
    const remoteMetadata = googleEventMetadata(remote);
    this.db.prepare(`UPDATE events SET google_id=?,google_etag=?,conference_json=?,conference_create_requested=0,
      attachments_json=?,event_type=?,focus_time_properties_json=?,out_of_office_properties_json=?,
      working_location_properties_json=?,self_response_status=?,updated_at=? WHERE id=?`)
      .run(
        requiredText(remote.id, "Google event id"), remote.etag ?? null,
        remoteMetadata.conference === undefined ? JSON.stringify(event.conference ?? null) : JSON.stringify(remoteMetadata.conference),
        remoteMetadata.attachments === undefined ? JSON.stringify(event.attachments ?? []) : JSON.stringify(remoteMetadata.attachments),
        remoteMetadata.eventType ?? event.eventType ?? "default",
        JSON.stringify(remoteMetadata.focusTimeProperties ?? event.focusTimeProperties ?? null),
        JSON.stringify(remoteMetadata.outOfOfficeProperties ?? event.outOfOfficeProperties ?? null),
        JSON.stringify(remoteMetadata.workingLocationProperties ?? event.workingLocationProperties ?? null),
        remoteMetadata.selfResponseStatus ?? event.selfResponseStatus ?? null,
        remote.updated ?? timestamp(), localId
      );
    return this.requireEvent(localId);
  }

  upsertGoogleTaskList(remote: JsonRecord, accountId: string): JsonRecord {
    const googleId = requiredText(remote.id, "Google task-list id");
    const title = requiredText(remote.title, "Google task-list title");
    const existing = this.db.prepare("SELECT id FROM task_lists WHERE account_id=? AND google_id=?").get(accountId, googleId) as { id: string } | undefined;
    const id = existing?.id ?? randomUUID();
    const now = timestamp();
    this.db.prepare(`INSERT INTO task_lists(id,account_id,title,google_id,google_etag,created_at,updated_at) VALUES(?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET title=excluded.title,google_id=excluded.google_id,google_etag=excluded.google_etag,updated_at=excluded.updated_at`)
      .run(id, accountId, title, googleId, remote.etag ?? null, now, remote.updated ?? now);
    return this.googleTaskListForSync(id)!;
  }

  upsertGoogleTask(remote: JsonRecord, localListId: string): JsonRecord | null {
    const googleId = requiredText(remote.id, "Google task id");
    const localList = this.googleTaskListForSync(localListId);
    if (!localList) throw new CoreStoreError("Task list no longer exists");
    const existing = this.db.prepare(`SELECT task.id FROM tasks task JOIN task_lists list ON list.id=task.list_id
      WHERE list.account_id=? AND task.google_id=?`).get(localList.accountId, googleId) as { id: string } | undefined;
    const localId = existing?.id ?? randomUUID();
    if (this.hasPendingEntityMutation("task", localId)) return null;
    const parentId = remote.parent
      ? (this.db.prepare("SELECT id FROM tasks WHERE list_id=? AND google_id=?").get(localListId, remote.parent) as { id?: string } | undefined)?.id ?? null
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
      .run(localList.googleId ?? null, localId);
    return this.requireTask(localId);
  }

  upsertGoogleCalendar(remote: JsonRecord, accountId: string): JsonRecord {
    const googleId = requiredText(remote.id, "Google calendar id");
    const title = requiredText(remote.summary ?? remote.title, "Google calendar title");
    const existing = this.db.prepare("SELECT id FROM calendars WHERE account_id=? AND google_id=?").get(accountId, googleId) as { id: string } | undefined;
    const id = existing?.id ?? randomUUID();
    const now = timestamp();
    this.db.prepare(`INSERT INTO calendars(id,account_id,title,color,time_zone,google_id,google_etag,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET title=excluded.title,color=excluded.color,google_id=excluded.google_id,
      time_zone=excluded.time_zone,google_etag=excluded.google_etag,updated_at=excluded.updated_at`)
      .run(id, accountId, title, remote.backgroundColor ?? remote.color ?? null, remote.timeZone ?? this.settings().defaultTimeZone,
        googleId, remote.etag ?? null, now, now);
    return this.googleCalendarForSync(id)!;
  }

  upsertGoogleEvent(remote: JsonRecord, localCalendarId: string): JsonRecord | null {
    const googleId = requiredText(remote.id, "Google event id");
    const existing = this.db.prepare("SELECT id FROM events WHERE calendar_id=? AND google_id=?").get(localCalendarId, googleId) as { id: string } | undefined;
    const localId = existing?.id ?? randomUUID();
    if (this.hasPendingEntityMutation("event", localId)) return null;
    if (remote.status === "cancelled") {
      if (existing) this.db.prepare("DELETE FROM events WHERE id=?").run(localId);
      return null;
    }
    const previous = existing ? this.requireEvent(localId) : null;
    const start = eventTimeFromGoogle(remote.start, "Event start");
    const end = eventTimeFromGoogle(remote.end, "Event end");
    const metadata = googleEventMetadata(remote);
    const now = timestamp();
    this.db.prepare(`INSERT INTO events(id,calendar_id,title,description,starts_at,ends_at,all_day,completed,color_id,location,recurrence_json,
      attendees_json,reminders_json,reminders_use_default,transparency,visibility,time_zone,google_id,google_etag,google_recurring_event_id,google_original_start_time,
      conference_json,conference_create_requested,attachments_json,attachments_managed,event_type,focus_time_properties_json,out_of_office_properties_json,
      working_location_properties_json,self_response_status,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET calendar_id=excluded.calendar_id,title=excluded.title,description=excluded.description,
      starts_at=excluded.starts_at,ends_at=excluded.ends_at,all_day=excluded.all_day,color_id=excluded.color_id,location=excluded.location,
      recurrence_json=excluded.recurrence_json,attendees_json=excluded.attendees_json,reminders_json=excluded.reminders_json,
      reminders_use_default=excluded.reminders_use_default,transparency=excluded.transparency,visibility=excluded.visibility,
      google_id=excluded.google_id,google_etag=excluded.google_etag,google_recurring_event_id=excluded.google_recurring_event_id,
      google_original_start_time=excluded.google_original_start_time,conference_json=excluded.conference_json,
      conference_create_requested=excluded.conference_create_requested,attachments_json=excluded.attachments_json,
      event_type=excluded.event_type,focus_time_properties_json=excluded.focus_time_properties_json,
      out_of_office_properties_json=excluded.out_of_office_properties_json,working_location_properties_json=excluded.working_location_properties_json,
      self_response_status=excluded.self_response_status,updated_at=excluded.updated_at`)
      .run(localId, localCalendarId, remote.summary ?? "Untitled event", remote.description ?? "", start.value, end.value,
        start.allDay ? 1 : 0, previous?.completed ? 1 : 0, remote.colorId ?? null, remote.location ?? null,
        JSON.stringify(recurrenceFromGoogle(remote.recurrence)), JSON.stringify(remote.attendees ?? []),
        JSON.stringify(remote.reminders?.overrides ?? []), remote.reminders?.useDefault === false ? 0 : 1,
        remote.transparency ?? "opaque", remote.visibility ?? "default", remote.start?.timeZone ?? null,
        googleId, remote.etag ?? null, remote.recurringEventId ?? null,
        remote.originalStartTime?.dateTime ?? remote.originalStartTime?.date ?? null,
        JSON.stringify(metadata.conference ?? null), 0, JSON.stringify(metadata.attachments ?? []), previous?.attachmentsManaged ? 1 : 0,
        metadata.eventType ?? "default", JSON.stringify(metadata.focusTimeProperties ?? null), JSON.stringify(metadata.outOfOfficeProperties ?? null),
        JSON.stringify(metadata.workingLocationProperties ?? null), metadata.selfResponseStatus ?? null, now, remote.updated ?? now);
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
        return this.listScheduledTaskBlocks(input);
      case "calendar.scheduleTaskBlock":
        return this.scheduleTaskBlock(input);
      case "calendar.moveScheduledTaskBlock":
        return this.moveScheduledTaskBlock(input);
      case "calendar.unscheduleTaskBlock":
        return this.unscheduleTaskBlock(input);
      case "calendar.exportAvailability":
        return this.exportAvailability(input);
      case "calendar.scheduleSuggest":
        return this.scheduleSuggest(input);
      case "calendar.smartReschedule":
        return this.smartReschedule(input);
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
      case "google.previewAccountCopy":
        return this.previewCrossAccountCopy(input);
      case "google.copyAccountData":
        return this.copyCrossAccountData(input);
      case "undo.status":
        return this.undoStatus();
      case "undo.undo":
        return this.applyUndo("undo");
      case "undo.redo":
        return this.applyUndo("redo");
      case "native.capabilities":
        return this.nativeCapabilities();
      case "native.listFontFamilies":
        return this.nativeBridge?.listFontFamilies() ?? { platform: process.platform, families: [] };
      case "native.requestNotificationPermission":
        return this.nativeBridge?.requestNotificationPermission() ?? { state: "unsupported" };
      case "native.openExternalUrl":
        return this.nativeBridge?.openExternalUrl({ url: requiredText(input.url, "External URL") }) ?? { opened: false };
      case "diagnostics.summary":
        return this.diagnostics();
      case "diagnostics.logs":
        return { items: [] };
      case "diagnostics.history":
        return { entries: this.mutationHistory(input) };
      case "diagnostics.pendingMutations":
        return { mutations: this.pendingMutationDiagnostics(input) };
      case "diagnostics.retryPendingMutation":
        return this.retryMutation(input);
      case "diagnostics.cancelPendingMutation":
        return this.cancelMutation(input);
      case "diagnostics.markShellVisible":
      case "diagnostics.markCachedDataRendered":
      case "diagnostics.recordTiming":
        return { recorded: true };
      default:
        throw new CoreStoreError(`Unsupported restored UI operation: ${namespace}.${action}`);
    }
  }

  private migrate(): void {
    const migrationTable = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get();
    const previousVersion = migrationTable
      ? Number((this.db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as { version?: number }).version ?? 0)
      : 0;
    // Schema v3 was the one intentional developer-cache reset: it changed
    // Google resource identity from global ids to account-scoped ids. Later
    // revisions are additive and must not make a routine upgrade erase a
    // local cache or require an account to be reconnected.
    if (previousVersion > 0 && previousVersion < 3) {
      // The user chose a developer reset. Drop only HCB's own local cache and
      // credential metadata; this does not touch source files or any Google
      // account. FTS triggers must go first because they reference these rows.
      this.developerDataWasReset = true;
      this.db.exec(`
        DROP TRIGGER IF EXISTS search_tasks_insert; DROP TRIGGER IF EXISTS search_tasks_update; DROP TRIGGER IF EXISTS search_tasks_delete;
        DROP TRIGGER IF EXISTS search_events_insert; DROP TRIGGER IF EXISTS search_events_update; DROP TRIGGER IF EXISTS search_events_delete;
        DROP TRIGGER IF EXISTS search_notes_insert; DROP TRIGGER IF EXISTS search_notes_update; DROP TRIGGER IF EXISTS search_notes_delete;
        DROP TABLE IF EXISTS search_index; DROP TABLE IF EXISTS scheduled_task_blocks; DROP TABLE IF EXISTS events; DROP TABLE IF EXISTS calendars;
        DROP TABLE IF EXISTS tasks; DROP TABLE IF EXISTS task_lists; DROP TABLE IF EXISTS notes; DROP TABLE IF EXISTS tags; DROP TABLE IF EXISTS outbox;
        DROP TABLE IF EXISTS google_accounts; DROP TABLE IF EXISTS undo_entries; DROP TABLE IF EXISTS settings; DROP TABLE IF EXISTS sync_meta;
        DROP TABLE IF EXISTS schema_migrations;
      `);
    }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS google_accounts (
        id TEXT PRIMARY KEY, google_account_id TEXT NOT NULL UNIQUE, email TEXT, display_name TEXT NOT NULL,
        avatar_url TEXT, connection_state TEXT NOT NULL, missing_scopes_json TEXT NOT NULL DEFAULT '[]', granted_scopes_json TEXT NOT NULL DEFAULT '[]', last_error TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS task_lists (
        id TEXT PRIMARY KEY, account_id TEXT NOT NULL, title TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
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
        id TEXT PRIMARY KEY, account_id TEXT NOT NULL, title TEXT NOT NULL, color TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY, calendar_id TEXT NOT NULL REFERENCES calendars(id), title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '', starts_at TEXT NOT NULL, ends_at TEXT NOT NULL,
        all_day INTEGER NOT NULL DEFAULT 0, completed INTEGER NOT NULL DEFAULT 0, color_id TEXT,
        location TEXT, recurrence_json TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS events_range_idx ON events(calendar_id, starts_at, ends_at);
      CREATE TABLE IF NOT EXISTS scheduled_task_blocks (
        id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id),
        calendar_event_id TEXT NOT NULL REFERENCES events(id), calendar_id TEXT NOT NULL REFERENCES calendars(id),
        starts_at TEXT NOT NULL, ends_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS scheduled_task_blocks_range_idx ON scheduled_task_blocks(calendar_id, starts_at, ends_at);
      CREATE TABLE IF NOT EXISTS notes (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', list_id TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
      );
      CREATE INDEX IF NOT EXISTS notes_page_idx ON notes(deleted_at, updated_at, id);
      CREATE TABLE IF NOT EXISTS tags (
        id TEXT PRIMARY KEY, title TEXT NOT NULL UNIQUE, color TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS outbox (
        id TEXT PRIMARY KEY, account_id TEXT, kind TEXT NOT NULL, entity_id TEXT NOT NULL, payload_json TEXT NOT NULL,
        state TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS outbox_delivery_idx ON outbox(state, next_attempt_at, id);
      CREATE TABLE IF NOT EXISTS undo_entries (
        id TEXT PRIMARY KEY, action TEXT NOT NULL, forward_json TEXT NOT NULL, inverse_json TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'applied', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS undo_entries_state_idx ON undo_entries(state, created_at DESC);
      CREATE TABLE IF NOT EXISTS sync_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `);
    this.addColumn("google_accounts", "granted_scopes_json TEXT NOT NULL DEFAULT '[]'");
    this.addColumn("task_lists", "account_id TEXT NOT NULL DEFAULT 'local'");
    this.addColumn("task_lists", "google_id TEXT");
    this.addColumn("task_lists", "google_etag TEXT");
    this.addColumn("tasks", "sort_order TEXT");
    this.addColumn("tasks", "google_id TEXT");
    this.addColumn("tasks", "google_etag TEXT");
    this.addColumn("tasks", "google_list_id TEXT");
    this.addColumn("tasks", "google_parent_id TEXT");
    this.addColumn("calendars", "account_id TEXT NOT NULL DEFAULT 'local'");
    this.addColumn("calendars", "google_id TEXT");
    this.addColumn("calendars", "google_etag TEXT");
    this.addColumn("calendars", "time_zone TEXT");
    this.addColumn("events", "attendees_json TEXT NOT NULL DEFAULT '[]'");
    this.addColumn("events", "reminders_json TEXT NOT NULL DEFAULT '[]'");
    this.addColumn("events", "reminders_use_default INTEGER NOT NULL DEFAULT 1");
    this.addColumn("events", "transparency TEXT NOT NULL DEFAULT 'opaque'");
    this.addColumn("events", "visibility TEXT NOT NULL DEFAULT 'default'");
    this.addColumn("events", "time_zone TEXT");
    this.addColumn("events", "google_id TEXT");
    this.addColumn("events", "google_etag TEXT");
    this.addColumn("events", "google_recurring_event_id TEXT");
    this.addColumn("events", "google_original_start_time TEXT");
    this.addColumn("events", "conference_json TEXT");
    this.addColumn("events", "conference_create_requested INTEGER NOT NULL DEFAULT 0");
    this.addColumn("events", "attachments_json TEXT NOT NULL DEFAULT '[]'");
    this.addColumn("events", "attachments_managed INTEGER NOT NULL DEFAULT 0");
    this.addColumn("events", "event_type TEXT NOT NULL DEFAULT 'default'");
    this.addColumn("events", "focus_time_properties_json TEXT");
    this.addColumn("events", "out_of_office_properties_json TEXT");
    this.addColumn("events", "working_location_properties_json TEXT");
    this.addColumn("events", "self_response_status TEXT");
    this.addColumn("outbox", "account_id TEXT");
    this.addColumn("outbox", "last_error TEXT");
    this.db.exec(`
      DROP INDEX IF EXISTS task_lists_google_id_idx; DROP INDEX IF EXISTS tasks_google_id_idx; DROP INDEX IF EXISTS tasks_google_list_id_idx;
      DROP INDEX IF EXISTS calendars_google_id_idx; DROP INDEX IF EXISTS events_google_id_idx;
      CREATE UNIQUE INDEX IF NOT EXISTS task_lists_google_account_id_idx ON task_lists(account_id,google_id) WHERE google_id IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS tasks_google_list_id_idx ON tasks(list_id,google_id) WHERE google_id IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS calendars_google_account_id_idx ON calendars(account_id,google_id) WHERE google_id IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS events_google_calendar_id_idx ON events(calendar_id,google_id) WHERE google_id IS NOT NULL;
    `);
    this.installFullTextSearch();
    this.db.prepare("INSERT OR IGNORE INTO schema_migrations(version) VALUES (?)").run(schemaVersion);
  }

  private addColumn(table: "google_accounts" | "task_lists" | "tasks" | "calendars" | "events" | "outbox", definition: string): void {
    const column = definition.split(/\s+/, 1)[0];
    const columns = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!columns.some((item) => item.name === column)) {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
    }
  }

  private installFullTextSearch(): void {
    try {
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
          domain UNINDEXED, entity_id UNINDEXED, title, body
        );
        CREATE TRIGGER IF NOT EXISTS search_tasks_insert AFTER INSERT ON tasks BEGIN
          INSERT INTO search_index(domain,entity_id,title,body)
            SELECT 'tasks',new.id,new.title,new.notes WHERE new.status != 'deleted';
        END;
        CREATE TRIGGER IF NOT EXISTS search_tasks_update AFTER UPDATE ON tasks BEGIN
          DELETE FROM search_index WHERE domain='tasks' AND entity_id=old.id;
          INSERT INTO search_index(domain,entity_id,title,body)
            SELECT 'tasks',new.id,new.title,new.notes WHERE new.status != 'deleted';
        END;
        CREATE TRIGGER IF NOT EXISTS search_tasks_delete AFTER DELETE ON tasks BEGIN
          DELETE FROM search_index WHERE domain='tasks' AND entity_id=old.id;
        END;
        CREATE TRIGGER IF NOT EXISTS search_events_insert AFTER INSERT ON events BEGIN
          INSERT INTO search_index(domain,entity_id,title,body) VALUES('calendar',new.id,new.title,new.description);
        END;
        CREATE TRIGGER IF NOT EXISTS search_events_update AFTER UPDATE ON events BEGIN
          DELETE FROM search_index WHERE domain='calendar' AND entity_id=old.id;
          INSERT INTO search_index(domain,entity_id,title,body) VALUES('calendar',new.id,new.title,new.description);
        END;
        CREATE TRIGGER IF NOT EXISTS search_events_delete AFTER DELETE ON events BEGIN
          DELETE FROM search_index WHERE domain='calendar' AND entity_id=old.id;
        END;
        CREATE TRIGGER IF NOT EXISTS search_notes_insert AFTER INSERT ON notes BEGIN
          INSERT INTO search_index(domain,entity_id,title,body)
            SELECT 'notes',new.id,new.title,new.body WHERE new.deleted_at IS NULL;
        END;
        CREATE TRIGGER IF NOT EXISTS search_notes_update AFTER UPDATE ON notes BEGIN
          DELETE FROM search_index WHERE domain='notes' AND entity_id=old.id;
          INSERT INTO search_index(domain,entity_id,title,body)
            SELECT 'notes',new.id,new.title,new.body WHERE new.deleted_at IS NULL;
        END;
        CREATE TRIGGER IF NOT EXISTS search_notes_delete AFTER DELETE ON notes BEGIN
          DELETE FROM search_index WHERE domain='notes' AND entity_id=old.id;
        END;
      `);
      const version = this.db.prepare("SELECT value FROM sync_meta WHERE key='search-index-version'").get() as { value?: string } | undefined;
      if (version?.value !== "1") {
        this.db.transaction(() => {
          this.db.prepare("DELETE FROM search_index").run();
          this.db.prepare("INSERT INTO search_index(domain,entity_id,title,body) SELECT 'tasks',id,title,notes FROM tasks WHERE status != 'deleted'").run();
          this.db.prepare("INSERT INTO search_index(domain,entity_id,title,body) SELECT 'calendar',id,title,description FROM events").run();
          this.db.prepare("INSERT INTO search_index(domain,entity_id,title,body) SELECT 'notes',id,title,body FROM notes WHERE deleted_at IS NULL").run();
          this.db.prepare("INSERT INTO sync_meta(key,value) VALUES('search-index-version','1') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run();
        })();
      }
      this.fullTextSearchAvailable = true;
    } catch {
      // FTS5 is present in Electron's bundled SQLite today. Keep a correct,
      // bounded fallback for unusual platform builds rather than preventing
      // the planner from opening.
      this.fullTextSearchAvailable = false;
    }
  }

  private seed(): void {
    const now = timestamp();
    const transaction = this.db.transaction(() => {
      this.db.prepare(`INSERT OR IGNORE INTO google_accounts(id,google_account_id,email,display_name,connection_state,missing_scopes_json,granted_scopes_json,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?)`).run(localAccountId, "local", null, "Local workspace", "local", "[]", "[]", now, now);
      if (!this.db.prepare("SELECT 1 FROM task_lists LIMIT 1").get()) {
        this.db.prepare("INSERT INTO task_lists(id, account_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run("inbox", localAccountId, "Inbox", now, now);
      }
      if (!this.db.prepare("SELECT 1 FROM calendars LIMIT 1").get()) {
        this.db.prepare("INSERT INTO calendars(id, account_id, title, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run("primary", localAccountId, "Primary", "#4285f4", now, now);
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
      scheduledTaskBlocks: this.listScheduledTaskBlocks({ ...calendarRange, limit: 500 }),
      notes: this.listNotes({ limit: 50 }),
      tags: this.page(this.tags(), { limit: 100 }),
      settings: this.settings(),
      syncStatus: this.syncStatus(),
      googleStatus: this.googleStatus(),
      undoStatus: this.undoStatus(),
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
      SELECT list.id, list.account_id AS accountId, list.title, list.updated_at AS updatedAt,
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
      SELECT task.id, list.account_id AS accountId, task.list_id AS listId, task.title, task.notes, task.status, task.priority, task.due_at AS dueAt,
        parent_id AS parentId, planned_start AS plannedStart, planned_end AS plannedEnd,
        duration_minutes AS durationMinutes, locked_schedule AS lockedSchedule,
        snooze_until AS snoozeUntil, tags_json AS tags, sort_order AS sortOrder, task.updated_at AS updatedAt
      FROM tasks task JOIN task_lists list ON list.id=task.list_id WHERE task.status IN (${statuses.map(() => "?").join(",")})
      ORDER BY CASE WHEN task.due_at IS NULL THEN 1 ELSE 0 END, task.due_at, task.sort_order, task.title COLLATE NOCASE, task.id
    `).all(...statuses) as any[];
    return this.page(rows.map(taskFromRow), input);
  }

  private requireTask(id: string): JsonRecord {
    const row = this.db.prepare(`SELECT task.id, list.account_id AS accountId, task.list_id AS listId, task.title, task.notes, task.status, task.priority, task.due_at AS dueAt,
      task.parent_id AS parentId, task.planned_start AS plannedStart, task.planned_end AS plannedEnd, task.duration_minutes AS durationMinutes,
      task.locked_schedule AS lockedSchedule, task.snooze_until AS snoozeUntil, task.tags_json AS tags, task.sort_order AS sortOrder, task.updated_at AS updatedAt
      FROM tasks task JOIN task_lists list ON list.id=task.list_id WHERE task.id = ?`).get(id);
    if (!row) throw new CoreStoreError("Task no longer exists");
    return taskFromRow(row);
  }

  private createTask(input: JsonRecord): JsonRecord {
    const now = timestamp();
    const id = typeof input.id === "string" ? input.id : randomUUID();
    const listId = input.listId ?? "inbox";
    this.requireList(listId);
    this.db.transaction(() => {
      this.db.prepare(`INSERT INTO tasks(id,list_id,title,notes,status,priority,due_at,parent_id,planned_start,planned_end,duration_minutes,locked_schedule,snooze_until,tags_json,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET list_id=excluded.list_id,title=excluded.title,notes=excluded.notes,
        status='active',priority=excluded.priority,due_at=excluded.due_at,parent_id=excluded.parent_id,planned_start=excluded.planned_start,
        planned_end=excluded.planned_end,duration_minutes=excluded.duration_minutes,locked_schedule=excluded.locked_schedule,
        snooze_until=excluded.snooze_until,tags_json=excluded.tags_json,updated_at=excluded.updated_at`).run(
        id, listId, requiredText(input.title, "Task title"), stringValue(input.notes), "active", input.priority ?? "none",
        nullableDate(input.dueDate), input.parentId ?? null, input.plannedStart ?? null, input.plannedEnd ?? null,
        input.durationMinutes ?? null, input.lockedSchedule ? 1 : 0, input.snoozeUntil ?? null, JSON.stringify(input.tags ?? []), now, now
      );
      this.enqueue("task.create", id, input, this.accountForTaskList(listId));
    })();
    const task = this.requireTask(id);
    this.recordUndo("Create task", { namespace: "tasks", action: "create", payload: taskCreatePayload(task) }, { namespace: "tasks", action: "delete", payload: { id } });
    return task;
  }

  private updateTask(input: JsonRecord): JsonRecord {
    const previous = this.requireTask(requiredText(input.id, "Task id"));
    const nextListId = input.listId ?? previous.listId;
    const nextAccountId = this.accountForTaskList(nextListId);
    if (nextAccountId !== previous.accountId) throw new CoreStoreError("Tasks cannot be moved between Google accounts.");
    const now = timestamp();
    this.db.transaction(() => {
      this.db.prepare(`UPDATE tasks SET list_id=?, title=?, notes=?, status=?, priority=?, due_at=?, parent_id=?, planned_start=?, planned_end=?,
        duration_minutes=?, locked_schedule=?, snooze_until=?, tags_json=?, updated_at=? WHERE id=?`).run(
        nextListId, input.title ?? previous.title, input.notes ?? previous.notes,
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
      if (typeof input.previousTaskId === "string" || input.previousTaskId === null) this.reorderTask(previous.id, nextListId, input.previousTaskId);
      this.enqueue("task.update", previous.id, input, nextAccountId);
    })();
    const task = this.requireTask(previous.id);
    this.recordUndo("Update task", { namespace: "tasks", action: "update", payload: taskUpdatePayload(task) }, { namespace: "tasks", action: "update", payload: taskUpdatePayload(previous) });
    return task;
  }

  private bulkReschedule(input: JsonRecord): JsonRecord {
    const ids = Array.isArray(input.ids) ? input.ids.filter((id): id is string => typeof id === "string") : [];
    const transaction = this.db.transaction(() => ids.map((id) => this.updateTask({ id, dueDate: input.dueDate })));
    return { items: transaction() };
  }

  private createTaskList(input: JsonRecord): JsonRecord {
    const now = timestamp();
    const accountId = typeof input.accountId === "string" ? input.accountId : this.defaultWritableAccountId();
    const item = { id: randomUUID(), accountId, title: requiredText(input.title, "List title"), updatedAt: now, taskCount: 0, activeTaskCount: 0 };
    this.db.prepare("INSERT INTO task_lists(id,account_id,title,created_at,updated_at) VALUES (?,?,?,?,?)").run(item.id, accountId, item.title, now, now);
    this.enqueue("taskList.create", item.id, {}, accountId);
    return item;
  }

  private renameTaskList(input: JsonRecord): JsonRecord {
    const id = requiredText(input.id, "List id");
    const now = timestamp();
    const result = this.db.prepare("UPDATE task_lists SET title=?, updated_at=? WHERE id=?").run(requiredText(input.title, "List title"), now, id);
    if (result.changes === 0) throw new CoreStoreError("Task list no longer exists");
    this.enqueue("taskList.update", id, {}, this.accountForTaskList(id));
    return this.taskLists().find((item) => item.id === id) ?? (() => { throw new CoreStoreError("Task list no longer exists"); })();
  }

  private deleteTaskList(input: JsonRecord): JsonRecord {
    const id = requiredText(input.id, "List id");
    if (id === "inbox") throw new CoreStoreError("Inbox cannot be deleted");
    this.db.transaction(() => {
      const previous = this.googleTaskListForSync(id);
      if (previous?.accountId && previous.accountId !== localAccountId) {
        const blockEvents = this.db.prepare(`SELECT event.id FROM events event JOIN scheduled_task_blocks block ON block.calendar_event_id=event.id
          WHERE block.task_id IN (SELECT id FROM tasks WHERE list_id=?)`).all(id) as Array<{ id: string }>;
        for (const event of blockEvents) this.deleteEvent({ id: event.id });
        this.db.prepare("DELETE FROM scheduled_task_blocks WHERE task_id IN (SELECT id FROM tasks WHERE list_id=?)").run(id);
        this.db.prepare("DELETE FROM tasks WHERE list_id=?").run(id);
        this.db.prepare("DELETE FROM task_lists WHERE id=?").run(id);
        this.enqueue("taskList.delete", id, previous, previous.accountId);
        return;
      }
      const tasks = this.db.prepare("SELECT id FROM tasks WHERE list_id=?").all(id) as Array<{ id: string }>;
      this.db.prepare("UPDATE tasks SET list_id='inbox', updated_at=? WHERE list_id=?").run(timestamp(), id);
      const destinationAccountId = this.accountForTaskList("inbox");
      for (const task of tasks) this.enqueue("task.update", task.id, {}, destinationAccountId);
      this.db.prepare("DELETE FROM task_lists WHERE id=?").run(id);
      this.enqueue("taskList.delete", id, previous ?? {}, previous?.accountId ?? null);
    })();
    return { id, deleted: true };
  }

  private calendars(): JsonRecord[] {
    const selectedCalendars = new Set(this.settings().selectedCalendarIds);
    return this.db.prepare(`SELECT calendar.id,calendar.account_id AS accountId,calendar.title,calendar.color,calendar.time_zone AS timeZone,calendar.updated_at AS updatedAt,
      (SELECT COUNT(*) FROM events WHERE events.calendar_id = calendar.id) AS eventCount
      FROM calendars AS calendar ORDER BY calendar.title COLLATE NOCASE`).all().map((calendar: any) => ({
      ...calendar,
      selected: selectedCalendars.size === 0 || selectedCalendars.has(calendar.id),
      timeZone: calendar.timeZone ?? this.settings().defaultTimeZone,
      backgroundColor: calendar.color,
      foregroundColor: "#ffffff"
    })) as JsonRecord[];
  }

  private listEvents(input: JsonRecord): JsonRecord {
    const start = input.start ?? "0000-01-01T00:00:00.000Z";
    const end = input.end ?? "9999-12-31T23:59:59.999Z";
    const rows = this.db.prepare(`SELECT event.id,calendar.account_id AS accountId,event.calendar_id AS calendarId,event.title,event.description,event.starts_at AS startsAt,event.ends_at AS endsAt,
      all_day AS allDay,completed,color_id AS colorId,location,recurrence_json AS recurrence,
      attendees_json AS attendees,reminders_json AS reminders,reminders_use_default AS remindersUseDefault,
      transparency,visibility,event.time_zone AS timeZone,event.conference_json AS conference,event.attachments_json AS attachments,
      event.event_type AS eventType,event.focus_time_properties_json AS focusTimeProperties,
      event.out_of_office_properties_json AS outOfOfficeProperties,event.working_location_properties_json AS workingLocationProperties,
      event.self_response_status AS selfResponseStatus,event.updated_at AS updatedAt
      FROM events event JOIN calendars calendar ON calendar.id=event.calendar_id WHERE event.starts_at < ? AND event.ends_at > ? ORDER BY event.starts_at,event.id`).all(end, start);
    return this.page((rows as any[]).map(eventFromRow), input);
  }

  private requireEvent(id: string): JsonRecord {
    const row = this.db.prepare(`SELECT event.id,calendar.account_id AS accountId,event.calendar_id AS calendarId,event.title,event.description,event.starts_at AS startsAt,event.ends_at AS endsAt,
      all_day AS allDay,completed,color_id AS colorId,location,recurrence_json AS recurrence,
      attendees_json AS attendees,reminders_json AS reminders,reminders_use_default AS remindersUseDefault,
      event.transparency,event.visibility,event.time_zone AS timeZone,event.google_recurring_event_id AS googleRecurringEventId,
      event.google_original_start_time AS googleOriginalStartTime,event.conference_json AS conference,event.attachments_json AS attachments,
      event.event_type AS eventType,event.focus_time_properties_json AS focusTimeProperties,
      event.out_of_office_properties_json AS outOfOfficeProperties,event.working_location_properties_json AS workingLocationProperties,
      event.self_response_status AS selfResponseStatus,event.updated_at AS updatedAt FROM events event JOIN calendars calendar ON calendar.id=event.calendar_id WHERE event.id=?`).get(id);
    if (!row) throw new CoreStoreError("Calendar event no longer exists");
    return eventFromRow(row);
  }

  private createEvent(input: JsonRecord): JsonRecord {
    const now = timestamp();
    const id = typeof input.id === "string" ? input.id : randomUUID();
    const calendarId = input.calendarId ?? this.defaultWritableCalendarId();
    if (!this.db.prepare("SELECT 1 FROM calendars WHERE id=?").get(calendarId)) throw new CoreStoreError("Calendar no longer exists");
    const eventType = normalizedEventType(input.eventType);
    this.assertStatusEventCalendar(calendarId, eventType);
    const statusProperties = normalizedStatusEventProperties(eventType, input);
    this.db.transaction(() => {
      this.db.prepare(`INSERT INTO events(id,calendar_id,title,description,starts_at,ends_at,all_day,completed,color_id,location,recurrence_json,
        attendees_json,reminders_json,reminders_use_default,transparency,visibility,time_zone,conference_json,conference_create_requested,
        attachments_json,attachments_managed,event_type,focus_time_properties_json,out_of_office_properties_json,working_location_properties_json,
        self_response_status,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        id, calendarId, requiredText(input.title, "Event title"), stringValue(input.description ?? input.notes), requiredText(input.startsAt, "Event start"),
        requiredText(input.endsAt, "Event end"), input.allDay ? 1 : 0, 0, input.colorId ?? null, input.location ?? null,
        JSON.stringify(input.recurrence ?? null), JSON.stringify(input.attendees ?? input.guestEmails ?? []),
        JSON.stringify(input.reminders ?? []), input.remindersUseDefault === false ? 0 : 1,
        statusEventTransparency(eventType, input.transparency), statusEventVisibility(eventType, input.visibility), input.timeZone ?? null,
        JSON.stringify(null), input.conferenceCreateRequest ? 1 : 0,
        JSON.stringify(normalizeCalendarAttachments(input.attachments)), Object.hasOwn(input, "attachments") ? 1 : 0,
        eventType, JSON.stringify(statusProperties.focusTimeProperties), JSON.stringify(statusProperties.outOfOfficeProperties),
        JSON.stringify(statusProperties.workingLocationProperties), normalizedResponseStatus(input.selfResponseStatus), now, now
      );
      this.enqueue("event.create", id, {}, this.accountForCalendar(calendarId));
    })();
    const event = this.requireEvent(id);
    this.recordUndo("Create event", { namespace: "calendar", action: "create", payload: eventCreatePayload(event) }, { namespace: "calendar", action: "delete", payload: { id } });
    return event;
  }

  private updateEvent(input: JsonRecord): JsonRecord {
    const previous = this.requireEvent(requiredText(input.id, "Event id"));
    if (input.scope === "series" && previous.googleRecurringEventId) {
      const series = this.findEventByGoogleId(previous.calendarId, previous.googleRecurringEventId);
      if (!series) throw new CoreStoreError("The recurring series is not available in the local cache.");
      const { scope: _scope, ...seriesInput } = input;
      return this.updateEvent({ ...seriesInput, id: series.id });
    }
    if (isFollowingScope(input.scope)) return this.splitFutureSeries(previous, input);
    const nextCalendarId = input.calendarId ?? previous.calendarId;
    const nextAccountId = this.accountForCalendar(nextCalendarId);
    if (nextAccountId !== previous.accountId) {
      throw new CoreStoreError("Calendar events cannot be moved between Google accounts.");
    }
    const eventType = normalizedEventType(input.eventType ?? previous.eventType);
    this.assertStatusEventCalendar(nextCalendarId, eventType);
    const statusProperties = normalizedStatusEventProperties(eventType, {
      focusTimeProperties: input.focusTimeProperties ?? previous.focusTimeProperties,
      outOfOfficeProperties: input.outOfOfficeProperties ?? previous.outOfOfficeProperties,
      workingLocationProperties: input.workingLocationProperties ?? previous.workingLocationProperties
    });
    const nextAttendees = responseStatusAttendees(
      input.attendees ?? input.guestEmails ?? previous.attendees ?? [],
      input.selfResponseStatus ?? previous.selfResponseStatus
    );
    const previousForSync = this.googleEventForSync(previous.id);
    const now = timestamp();
    this.db.transaction(() => {
      this.db.prepare(`UPDATE events SET calendar_id=?,title=?,description=?,starts_at=?,ends_at=?,all_day=?,completed=?,color_id=?,location=?,recurrence_json=?,
        attendees_json=?,reminders_json=?,reminders_use_default=?,transparency=?,visibility=?,time_zone=?,conference_create_requested=?,
        attachments_json=?,attachments_managed=?,event_type=?,focus_time_properties_json=?,out_of_office_properties_json=?,
        working_location_properties_json=?,self_response_status=?,updated_at=? WHERE id=?`).run(
        nextCalendarId, input.title ?? previous.title, input.description ?? input.notes ?? previous.description,
        input.startsAt ?? previous.startsAt, input.endsAt ?? previous.endsAt,
        input.allDay === undefined ? Number(previous.allDay) : input.allDay ? 1 : 0,
        input.completed === undefined ? Number(previous.completed) : input.completed ? 1 : 0,
        input.colorId ?? previous.colorId ?? null, input.location ?? previous.location ?? null,
        JSON.stringify(input.recurrence ?? previous.recurrence ?? null),
        JSON.stringify(nextAttendees),
        JSON.stringify(input.reminders ?? previous.reminders ?? []),
        input.remindersUseDefault === undefined ? (previous.remindersUseDefault ? 1 : 0) : input.remindersUseDefault ? 1 : 0,
        statusEventTransparency(eventType, input.transparency ?? previous.transparency), statusEventVisibility(eventType, input.visibility ?? previous.visibility),
        input.timeZone ?? previous.timeZone ?? null, input.conferenceCreateRequest ? 1 : 0,
        JSON.stringify(Object.hasOwn(input, "attachments") ? normalizeCalendarAttachments(input.attachments) : previous.attachments ?? []),
        Object.hasOwn(input, "attachments") ? 1 : Number(previous.attachmentsManaged ?? 0), eventType,
        JSON.stringify(statusProperties.focusTimeProperties), JSON.stringify(statusProperties.outOfOfficeProperties),
        JSON.stringify(statusProperties.workingLocationProperties), normalizedResponseStatus(input.selfResponseStatus ?? previous.selfResponseStatus), now, previous.id
      );
      const movedExistingRemoteEvent = nextCalendarId !== previous.calendarId && Boolean(previousForSync?.googleId);
      this.enqueue(
        movedExistingRemoteEvent ? "event.move" : "event.update",
        previous.id,
        movedExistingRemoteEvent ? { sourceCalendarId: previous.calendarId, destinationCalendarId: nextCalendarId } : {},
        previous.accountId
      );
    })();
    const event = this.requireEvent(previous.id);
    this.recordUndo("Update event", { namespace: "calendar", action: "update", payload: eventUpdatePayload(event) }, { namespace: "calendar", action: "update", payload: eventUpdatePayload(previous) });
    return event;
  }

  private splitFutureSeries(occurrence: JsonRecord, input: JsonRecord): JsonRecord {
    const series = occurrence.googleRecurringEventId
      ? this.findEventByGoogleId(occurrence.calendarId, occurrence.googleRecurringEventId) ?? occurrence
      : occurrence;
    if (!series.recurrence) throw new CoreStoreError("This event is not a recurring series.");
    const splitAt = input.startsAt ?? occurrence.googleOriginalStartTime ?? occurrence.startsAt;
    if (!Number.isFinite(Date.parse(splitAt))) throw new CoreStoreError("Recurring split date is invalid.");
    const oldRecurrence = structuredClone(series.recurrence) as JsonRecord;
    const parentRecurrence = { ...oldRecurrence, endsOn: new Date(Date.parse(splitAt) - 1_000).toISOString() };
    // Keep existing completed/exception history with the old series, then make
    // a successor that owns the selected and later occurrences. Google has no
    // dedicated "this and following" endpoint, so this explicit split is the
    // least surprising representation for both the cache and API.
    this.updateEvent({ id: series.id, recurrence: parentRecurrence, scope: "series" });
    const sourceDuration = Math.max(1, Date.parse(series.endsAt) - Date.parse(series.startsAt));
    const successorStartsAt = input.startsAt ?? splitAt;
    const successor = this.createEvent({
      calendarId: input.calendarId ?? series.calendarId,
      title: input.title ?? series.title,
      description: input.description ?? input.notes ?? series.description,
      startsAt: successorStartsAt,
      endsAt: input.endsAt ?? new Date(Date.parse(successorStartsAt) + sourceDuration).toISOString(),
      allDay: input.allDay ?? series.allDay,
      colorId: input.colorId ?? series.colorId,
      location: input.location ?? series.location,
      recurrence: { ...oldRecurrence, ...(input.recurrence ?? {}) },
      attendees: input.attendees ?? input.guestEmails ?? series.attendees,
      reminders: input.reminders ?? series.reminders,
      remindersUseDefault: input.remindersUseDefault ?? series.remindersUseDefault,
      transparency: input.transparency ?? series.transparency,
      visibility: input.visibility ?? series.visibility,
      timeZone: input.timeZone ?? series.timeZone,
      attachments: input.attachments ?? series.attachments,
      eventType: input.eventType ?? series.eventType,
      focusTimeProperties: input.focusTimeProperties ?? series.focusTimeProperties,
      outOfOfficeProperties: input.outOfOfficeProperties ?? series.outOfOfficeProperties,
      workingLocationProperties: input.workingLocationProperties ?? series.workingLocationProperties
    });
    return { ...successor, splitFromEventId: series.id, recurrenceScope: "following" };
  }

  private findEventByGoogleId(calendarId: string, googleId: string): JsonRecord | null {
    const row = this.db.prepare("SELECT id FROM events WHERE calendar_id=? AND google_id=?").get(calendarId, googleId) as { id?: string } | undefined;
    return row?.id ? this.requireEvent(row.id) : null;
  }

  private deleteEvent(input: JsonRecord): JsonRecord {
    const id = requiredText(input.id, "Event id");
    const eventBeforeDelete = this.requireEvent(id);
    if (input.scope === "series" && eventBeforeDelete.googleRecurringEventId) {
      const series = this.findEventByGoogleId(eventBeforeDelete.calendarId, eventBeforeDelete.googleRecurringEventId);
      if (!series) throw new CoreStoreError("The recurring series is not available in the local cache.");
      return this.deleteEvent({ id: series.id });
    }
    this.db.transaction(() => {
      this.requireEvent(id);
      const previous = this.googleEventForSync(id);
      const linkedBlocks = this.db.prepare("SELECT task_id AS taskId FROM scheduled_task_blocks WHERE calendar_event_id=?").all(id) as Array<{ taskId: string }>;
      this.db.prepare("DELETE FROM scheduled_task_blocks WHERE calendar_event_id=?").run(id);
      for (const block of linkedBlocks) {
        this.db.prepare("UPDATE tasks SET planned_start=NULL,planned_end=NULL,updated_at=? WHERE id=?").run(timestamp(), block.taskId);
      }
      this.db.prepare("DELETE FROM events WHERE id=?").run(id);
      this.enqueue("event.delete", id, previous ?? {}, previous?.accountId ?? null);
    })();
    this.recordUndo("Delete event", { namespace: "calendar", action: "delete", payload: { id } }, { namespace: "calendar", action: "create", payload: eventCreatePayload(eventBeforeDelete) });
    return { id, deleted: true };
  }

  private listScheduledTaskBlocks(input: JsonRecord): JsonRecord {
    const start = input.start ?? "0000-01-01T00:00:00.000Z";
    const end = input.end ?? "9999-12-31T23:59:59.999Z";
    const blocks = this.db.prepare(`SELECT block.id,block.task_id AS taskId,block.calendar_event_id AS calendarEventId,
      block.calendar_id AS calendarId,task.title,block.starts_at AS startsAt,block.ends_at AS endsAt,
      CAST((julianday(block.ends_at)-julianday(block.starts_at))*1440 AS INTEGER) AS durationMinutes,
      block.updated_at AS updatedAt FROM scheduled_task_blocks block JOIN tasks task ON task.id=block.task_id
      WHERE block.starts_at < ? AND block.ends_at > ? ORDER BY block.starts_at,block.id`).all(end, start) as JsonRecord[];
    return this.page(blocks.map((block) => ({ ...block, status: "scheduled", mutationState: "queued" })), input);
  }

  private requireScheduledTaskBlock(id: string): JsonRecord {
    const block = this.db.prepare(`SELECT block.id,block.task_id AS taskId,block.calendar_event_id AS calendarEventId,
      block.calendar_id AS calendarId,task.title,block.starts_at AS startsAt,block.ends_at AS endsAt,
      CAST((julianday(block.ends_at)-julianday(block.starts_at))*1440 AS INTEGER) AS durationMinutes,
      block.updated_at AS updatedAt FROM scheduled_task_blocks block JOIN tasks task ON task.id=block.task_id
      WHERE block.id=?`).get(id) as JsonRecord | undefined;
    if (!block) throw new CoreStoreError("Scheduled block no longer exists");
    return { ...block, status: "scheduled", mutationState: "queued" };
  }

  private scheduleTaskBlock(input: JsonRecord): JsonRecord {
    const task = this.requireTask(requiredText(input.taskId, "Task id"));
    const calendarId = requiredText(input.calendarId, "Calendar id");
    const startsAt = requiredText(input.startsAt, "Scheduled start");
    const durationMinutes = Math.max(5, Math.min(24 * 60, Number(input.durationMinutes) || 30));
    const endsAt = input.endsAt ?? new Date(Date.parse(startsAt) + durationMinutes * 60_000).toISOString();
    if (!Number.isFinite(Date.parse(endsAt)) || Date.parse(endsAt) <= Date.parse(startsAt)) {
      throw new CoreStoreError("Scheduled block end must be after its start");
    }
    const previousUndoState = this.applyingUndo;
    this.applyingUndo = true;
    let event: JsonRecord;
    try {
      event = this.createEvent({
        calendarId,
        title: task.title,
        description: task.notes,
        startsAt,
        endsAt,
        allDay: false,
        hcbKind: "task-block"
      });
    } finally {
      this.applyingUndo = previousUndoState;
    }
    const now = timestamp();
    const id = randomUUID();
    this.db.prepare(`INSERT INTO scheduled_task_blocks(id,task_id,calendar_event_id,calendar_id,starts_at,ends_at,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?)`).run(id, task.id, event.id, calendarId, startsAt, endsAt, now, now);
    this.db.prepare("UPDATE tasks SET planned_start=?,planned_end=?,duration_minutes=?,updated_at=? WHERE id=?")
      .run(startsAt, endsAt, durationMinutes, now, task.id);
    const block = this.requireScheduledTaskBlock(id);
    this.recordUndo("Schedule task block", { namespace: "calendar", action: "scheduleTaskBlock", payload: { taskId: task.id, calendarId, startsAt, endsAt } }, { namespace: "calendar", action: "unscheduleTaskBlock", payload: { id } });
    return block;
  }

  private moveScheduledTaskBlock(input: JsonRecord): JsonRecord {
    const id = requiredText(input.id, "Scheduled block id");
    const block = this.db.prepare(`SELECT id,task_id AS taskId,calendar_event_id AS calendarEventId,calendar_id AS calendarId,
      starts_at AS startsAt,ends_at AS endsAt FROM scheduled_task_blocks WHERE id=?`).get(id) as JsonRecord | undefined;
    if (!block) throw new CoreStoreError("Scheduled block no longer exists");
    const startsAt = input.startsAt ?? block.startsAt;
    const durationMinutes = Math.max(5, Math.min(24 * 60, Number(input.durationMinutes) || Math.round((Date.parse(block.endsAt) - Date.parse(block.startsAt)) / 60_000)));
    const endsAt = new Date(Date.parse(startsAt) + durationMinutes * 60_000).toISOString();
    const calendarId = input.calendarId ?? block.calendarId;
    const previousUndoState = this.applyingUndo;
    this.applyingUndo = true;
    try {
      this.updateEvent({ id: block.calendarEventId, calendarId, startsAt, endsAt, allDay: false });
    } finally {
      this.applyingUndo = previousUndoState;
    }
    this.db.prepare("UPDATE scheduled_task_blocks SET calendar_id=?,starts_at=?,ends_at=?,updated_at=? WHERE id=?")
      .run(calendarId, startsAt, endsAt, timestamp(), id);
    this.db.prepare("UPDATE tasks SET planned_start=?,planned_end=?,duration_minutes=?,updated_at=? WHERE id=?")
      .run(startsAt, endsAt, durationMinutes, timestamp(), block.taskId);
    const moved = this.requireScheduledTaskBlock(id);
    this.recordUndo("Move task block", { namespace: "calendar", action: "moveScheduledTaskBlock", payload: { id, calendarId, startsAt, durationMinutes } }, { namespace: "calendar", action: "moveScheduledTaskBlock", payload: { id, calendarId: block.calendarId, startsAt: block.startsAt, durationMinutes: Math.round((Date.parse(block.endsAt) - Date.parse(block.startsAt)) / 60_000) } });
    return moved;
  }

  private unscheduleTaskBlock(input: JsonRecord): JsonRecord {
    const id = requiredText(input.id, "Scheduled block id");
    const block = this.db.prepare("SELECT task_id AS taskId,calendar_event_id AS calendarEventId,calendar_id AS calendarId,starts_at AS startsAt,ends_at AS endsAt FROM scheduled_task_blocks WHERE id=?").get(id) as JsonRecord | undefined;
    if (!block) throw new CoreStoreError("Scheduled block no longer exists");
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM scheduled_task_blocks WHERE id=?").run(id);
      this.db.prepare("UPDATE tasks SET planned_start=NULL,planned_end=NULL,updated_at=? WHERE id=?").run(timestamp(), block.taskId);
    })();
    if (input.deleteCalendarEvent !== false) {
      const previousUndoState = this.applyingUndo;
      this.applyingUndo = true;
      try {
        this.deleteEvent({ id: block.calendarEventId });
      } finally {
        this.applyingUndo = previousUndoState;
      }
    }
    this.recordUndo("Unschedule task block", { namespace: "calendar", action: "unscheduleTaskBlock", payload: { id, deleteCalendarEvent: input.deleteCalendarEvent !== false } }, { namespace: "calendar", action: "scheduleTaskBlock", payload: { taskId: block.taskId, calendarId: block.calendarId, startsAt: block.startsAt, endsAt: block.endsAt } });
    return { id, queued: true, revision: timestamp() };
  }

  private exportAvailability(input: JsonRecord): JsonRecord {
    const start = requiredText(input.start, "Availability start");
    const end = requiredText(input.end, "Availability end");
    if (!Number.isFinite(Date.parse(start)) || !Number.isFinite(Date.parse(end)) || Date.parse(end) <= Date.parse(start)) {
      throw new CoreStoreError("Availability range is invalid");
    }
    const ids = stringArray(input.calendarIds);
    const calendarIds = ids.length ? ids : this.selectedCalendarIds();
    const busy = this.busyEvents(start, end, calendarIds);
    const timeZone = this.settings().defaultTimeZone;
    const text = busy.length === 0
      ? `Available from ${formatAvailabilityTime(start, timeZone)} to ${formatAvailabilityTime(end, timeZone)}.`
      : [`Availability ${formatAvailabilityTime(start, timeZone)} – ${formatAvailabilityTime(end, timeZone)} (${timeZone})`,
          ...busy.map((event) => `Busy: ${formatAvailabilityTime(event.startsAt, timeZone)} – ${formatAvailabilityTime(event.endsAt, timeZone)}${event.title ? ` · ${event.title}` : ""}`)
        ].join("\n");
    return { format: input.format ?? "text", text, generatedAt: timestamp(), busyBlockCount: busy.length, timezone: timeZone };
  }

  private scheduleSuggest(input: JsonRecord): JsonRecord {
    const date = requiredText(input.date, "Schedule date");
    const range = workingRange(date, input.workingHours ?? {}, this.settings());
    const tasks = this.activeSchedulableTasks();
    const busy = this.busyEvents(range.start, range.end, this.selectedCalendarIds());
    const slots = busy.map((event) => ({
      startsAt: event.startsAt, endsAt: event.endsAt, eventId: event.id,
      locked: Boolean(event.locked), conflict: false
    }));
    const capacity = Math.max(0, Math.min(Number(input.capacityMinutes) || durationMinutes(range.start, range.end), durationMinutes(range.start, range.end)));
    const scheduledMinutes = this.scheduledMinutesForRange(range.start, range.end);
    const available = subtractIntervals({ ...range }, busy.map((event) => ({ start: event.startsAt, end: event.endsAt })));
    const unscheduled = tasks.filter((task) => !task.plannedStart).slice(0, 100);
    return {
      slots,
      unscheduled,
      overloadMinutes: Math.max(0, scheduledMinutes - capacity),
      availableMinutes: available.reduce((total, slot) => total + durationMinutes(slot.start, slot.end), 0)
    };
  }

  private smartReschedule(input: JsonRecord): JsonRecord {
    const date = requiredText(input.date, "Schedule date");
    const calendarId = requiredText(input.calendarId, "Calendar id");
    const range = workingRange(date, input.workingHours ?? {}, this.settings());
    const calendar = this.googleCalendarForSync(calendarId);
    if (!calendar) throw new CoreStoreError("Calendar no longer exists");
    const busy = this.busyEvents(range.start, range.end, this.selectedCalendarIds());
    const free = subtractIntervals(range, busy.map((event) => ({ start: event.startsAt, end: event.endsAt })));
    const tasks = this.activeSchedulableTasks().filter((task) => !task.lockedSchedule).sort(compareSchedulableTasks);
    const suggestions: JsonRecord[] = [];
    const skipped: JsonRecord[] = [];
    let slotIndex = 0;
    let cursor = free[0]?.start;
    for (const task of tasks) {
      const needed = Math.max(5, Math.min(24 * 60, Number(task.durationMinutes) || 30));
      while (cursor && slotIndex < free.length && Date.parse(cursor) + needed * 60_000 > Date.parse(free[slotIndex].end)) {
        slotIndex += 1;
        cursor = free[slotIndex]?.start;
      }
      if (!cursor || slotIndex >= free.length) {
        skipped.push({ taskId: task.id, reason: "No free working-hours slot fits this task." });
        continue;
      }
      const startsAt = cursor;
      const endsAt = new Date(Date.parse(startsAt) + needed * 60_000).toISOString();
      suggestions.push({ taskId: task.id, calendarId, startsAt, endsAt, action: task.plannedStart ? "move" : "schedule", reason: task.dueAt ? `Fits before due date ${task.dueAt.slice(0, 10)}.` : "Fits the next available working-hours slot." });
      cursor = endsAt;
    }
    if (input.apply === true) {
      for (const suggestion of suggestions) {
        const existing = this.db.prepare("SELECT id FROM scheduled_task_blocks WHERE task_id=? LIMIT 1").get(suggestion.taskId) as { id?: string } | undefined;
        if (existing?.id) this.moveScheduledTaskBlock({ id: existing.id, calendarId, startsAt: suggestion.startsAt, durationMinutes: durationMinutes(suggestion.startsAt, suggestion.endsAt) });
        else this.scheduleTaskBlock({ taskId: suggestion.taskId, calendarId, startsAt: suggestion.startsAt, endsAt: suggestion.endsAt });
      }
    }
    return { suggestions, skipped, applied: input.apply === true, calendarId, generatedAt: timestamp() };
  }

  private busyEvents(start: string, end: string, calendarIds: string[]): JsonRecord[] {
    if (calendarIds.length === 0) return [];
    const placeholders = calendarIds.map(() => "?").join(",");
    return this.db.prepare(`SELECT id,title,starts_at AS startsAt,ends_at AS endsAt,transparency
      FROM events WHERE starts_at < ? AND ends_at > ? AND calendar_id IN (${placeholders}) AND transparency != 'transparent'`)
      .all(end, start, ...calendarIds) as JsonRecord[];
  }

  private selectedCalendarIds(): string[] {
    const selected = stringArray(this.settings().selectedCalendarIds);
    return selected.length ? selected : this.calendars().map((calendar) => calendar.id);
  }

  private activeSchedulableTasks(): JsonRecord[] {
    return (this.db.prepare(`SELECT task.id,list.account_id AS accountId,task.list_id AS listId,task.title,task.due_at AS dueAt,
      task.planned_start AS plannedStart,task.planned_end AS plannedEnd,task.duration_minutes AS durationMinutes,task.locked_schedule AS lockedSchedule,
      task.priority,task.updated_at AS updatedAt FROM tasks task JOIN task_lists list ON list.id=task.list_id WHERE task.status='active'`).all() as JsonRecord[])
      .map((task) => ({ ...task, lockedSchedule: Boolean(task.lockedSchedule) }));
  }

  private scheduledMinutesForRange(start: string, end: string): number {
    return Number((this.db.prepare(`SELECT COALESCE(SUM((julianday(MIN(ends_at, ?))-julianday(MAX(starts_at, ?)))*1440),0) AS minutes
      FROM scheduled_task_blocks WHERE starts_at < ? AND ends_at > ?`).get(end, start, end, start) as { minutes: number }).minutes ?? 0);
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
    const safeLimit = Math.max(1, Math.min(200, Number(limit) || 30));
    const match = ftsQuery(query);
    if (this.fullTextSearchAvailable && match) {
      return {
        items: this.db.prepare(`SELECT entity_id AS id,title,body AS snippet,domain,
          NULL AS snoozeUntil FROM search_index WHERE search_index MATCH ?
          ORDER BY bm25(search_index) LIMIT ?`).all(match, safeLimit) as JsonRecord[]
      };
    }
    const needle = `%${String(query).trim()}%`;
    const items = [
      ...(this.db.prepare("SELECT id,title,notes AS snippet,'tasks' AS domain,snooze_until AS snoozeUntil FROM tasks WHERE status != 'deleted' AND (title LIKE ? OR notes LIKE ?) LIMIT ?").all(needle, needle, limit) as JsonRecord[]),
      ...(this.db.prepare("SELECT id,title,description AS snippet,'calendar' AS domain,NULL AS snoozeUntil FROM events WHERE title LIKE ? OR description LIKE ? LIMIT ?").all(needle, needle, limit) as JsonRecord[]),
      ...(this.db.prepare("SELECT id,title,body AS snippet,'notes' AS domain,NULL AS snoozeUntil FROM notes WHERE deleted_at IS NULL AND (title LIKE ? OR body LIKE ?) LIMIT ?").all(needle, needle, limit) as JsonRecord[])
    ].slice(0, safeLimit);
    return { items };
  }

  private settings(): JsonRecord {
    const row = this.db.prepare("SELECT value FROM settings WHERE key=?").get("app") as { value: string } | undefined;
    return { ...defaultSettings, ...(row ? safeJson(row.value, {}) : {}) };
  }

  private updateSettings(input: JsonRecord): JsonRecord {
    const next = { ...this.settings(), ...input };
    this.db.prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run("app", JSON.stringify(next));
    this.nativeBridge?.applySettings?.(next);
    return next;
  }

  private syncStatus(): JsonRecord {
    const pending = this.count("outbox", "state = 'pending'");
    const conflicts = this.count("outbox", "state = 'conflict'");
    const runtimeRow = this.db.prepare("SELECT value FROM sync_meta WHERE key='google-sync-runtime'").get() as { value?: string } | undefined;
    const runtime = safeJson(runtimeRow?.value ?? "{}", {});
    const { pendingMutationCount: _storedPendingMutationCount, ...runtimeWithoutPendingCount } = runtime;
    return {
      state: pending && !runtime.state ? "pending" : conflicts && !runtime.state ? "error" : "idle",
      pendingMutationCount: pending,
      offline: false,
      stale: false,
      ...runtimeWithoutPendingCount
    };
  }

  private googleStatus(): JsonRecord {
    const client = safeJson((this.db.prepare("SELECT value FROM sync_meta WHERE key=?").get("google-client") as { value?: string } | undefined)?.value ?? "{}", {});
    const accounts = this.googleAccounts().filter((account) => account.accountId !== localAccountId);
    const account = accounts[0] ?? null;
    return {
      oauthClientConfigured: Boolean(client.clientId),
      clientId: client.clientId ?? null,
      hasClientSecret: false,
      account,
      accounts
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
    for (const account of this.googleAccounts()) {
      if (account.accountId !== localAccountId) this.removeGoogleAccount(account.accountId);
    }
    return this.googleStatus();
  }

  private nativeCapabilities(): JsonRecord {
    if (this.nativeBridge) return this.nativeBridge.capabilities();
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
      checkpoints: { totalCount: this.countSyncTokens() },
      pendingMutations: { totalCount: this.count("outbox", "state IN ('pending','conflict')") },
      mcp: { tokenState: "not_configured" },
      account: { state: "signed_out" },
      native: { flags: this.nativeCapabilities().capabilityReport.flags },
      build: { version: "5.0.1", environment: "local", commit: "restored", buildDate: null, packageTool: "pnpm" },
      resourceCounts: { tasks: taskCount, events: eventCount, notes: noteCount }
    };
  }

  private enqueue(kind: string, entityId: string, payload: JsonRecord, accountId: string | null): void {
    const now = timestamp();
    this.db.prepare(`INSERT INTO outbox(id,account_id,kind,entity_id,payload_json,state,next_attempt_at,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?)`).run(randomUUID(), accountId, kind, entityId, JSON.stringify(payload), "pending", now, now, now);
  }

  private recordUndo(action: string, forward: JsonRecord, inverse: JsonRecord): void {
    if (this.applyingUndo) return;
    const now = timestamp();
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM undo_entries WHERE state='undone'").run();
      this.db.prepare(`INSERT INTO undo_entries(id,action,forward_json,inverse_json,state,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?)`).run(randomUUID(), action, JSON.stringify(forward), JSON.stringify(inverse), "applied", now, now);
      // A bounded local history avoids surprising database growth from normal
      // keyboard editing while keeping enough depth for power-user sessions.
      this.db.prepare(`DELETE FROM undo_entries WHERE id IN (SELECT id FROM undo_entries ORDER BY created_at DESC LIMIT -1 OFFSET 200)`).run();
    })();
  }

  private undoStatus(): JsonRecord {
    return {
      canUndo: Boolean(this.db.prepare("SELECT 1 FROM undo_entries WHERE state='applied' LIMIT 1").get()),
      canRedo: Boolean(this.db.prepare("SELECT 1 FROM undo_entries WHERE state='undone' LIMIT 1").get())
    };
  }

  private applyUndo(direction: "undo" | "redo"): JsonRecord {
    const state = direction === "undo" ? "applied" : "undone";
    const entry = this.db.prepare(`SELECT id,action,forward_json AS forwardJson,inverse_json AS inverseJson FROM undo_entries
      WHERE state=? ORDER BY created_at DESC LIMIT 1`).get(state) as { id: string; action: string; forwardJson: string; inverseJson: string } | undefined;
    if (!entry) return { action: direction, applied: false, ...this.undoStatus() };
    const operation = safeJson(direction === "undo" ? entry.inverseJson : entry.forwardJson, null) as JsonRecord | null;
    if (!operation?.namespace || !operation.action || !operation.payload) throw new CoreStoreError("Undo history entry is corrupted.");
    this.applyingUndo = true;
    try {
      this.dispatch(String(operation.namespace), String(operation.action), operation.payload);
      this.db.prepare("UPDATE undo_entries SET state=?,updated_at=? WHERE id=?")
        .run(direction === "undo" ? "undone" : "applied", timestamp(), entry.id);
    } finally {
      this.applyingUndo = false;
    }
    return { action: direction, applied: true, label: entry.action, ...this.undoStatus() };
  }

  private pendingMutationDiagnostics(input: JsonRecord): JsonRecord[] {
    const limit = Math.max(1, Math.min(500, Number(input.limit) || 100));
    return (this.db.prepare(`SELECT id,kind,entity_id AS entityId,state,attempts,next_attempt_at AS nextAttemptAt,
      last_error AS lastErrorMessage,created_at AS createdAt,updated_at AS updatedAt
      FROM outbox WHERE state IN ('pending','conflict') ORDER BY created_at,id LIMIT ?`).all(limit) as JsonRecord[])
      .map((row) => ({
        id: row.id,
        operation: row.kind,
        resourceType: String(row.kind).split(".")[0],
        resourceId: row.entityId,
        status: row.state === "conflict" ? "failed" : "queued",
        attemptCount: Number(row.attempts),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        nextRetryAt: row.state === "pending" && Number(row.attempts) > 0 ? row.nextAttemptAt : null,
        lastErrorCode: row.lastErrorMessage ? "SYNC_ERROR" : null,
        lastErrorMessage: row.lastErrorMessage ?? null,
        ...(row.state === "conflict" ? {
          resolution: {
            keepLocal: "Retry without the stale revision and overwrite the remote item.",
            keepGoogle: "Cancel the local write; the next pull restores Google's version."
          }
        } : {})
      }));
  }

  private mutationHistory(input: JsonRecord): JsonRecord[] {
    const limit = Math.max(1, Math.min(1000, Number(input.limit) || 100));
    return (this.db.prepare(`SELECT id,kind,entity_id AS entityId,state,attempts,last_error AS message,
      created_at AS createdAt,updated_at AS updatedAt FROM outbox ORDER BY updated_at DESC,id DESC LIMIT ?`).all(limit) as JsonRecord[])
      .map((row) => ({
        id: row.id,
        kind: row.kind,
        summary: `${row.kind} · ${String(row.entityId).slice(0, 12)}`,
        timestamp: row.updatedAt,
        metadataLine: `state=${row.state} attempts=${Number(row.attempts)}${row.message ? ` · ${row.message}` : ""}`
      }));
  }

  private retryMutation(input: JsonRecord): JsonRecord {
    const id = requiredText(input.id, "Mutation id");
    const mutation = this.db.prepare("SELECT kind,entity_id AS entityId FROM outbox WHERE id=?").get(id) as { kind?: string; entityId?: string } | undefined;
    if (!mutation) throw new CoreStoreError("Pending mutation no longer exists");
    // An explicit keep-local resolution intentionally drops a stale ETag. The
    // next conditional request becomes an overwrite chosen by the user rather
    // than an invisible last-write-wins policy.
    if (mutation.kind?.startsWith("task.") && mutation.entityId) this.db.prepare("UPDATE tasks SET google_etag=NULL WHERE id=?").run(mutation.entityId);
    if (mutation.kind?.startsWith("event.") && mutation.entityId) this.db.prepare("UPDATE events SET google_etag=NULL WHERE id=?").run(mutation.entityId);
    const result = this.db.prepare("UPDATE outbox SET state='pending',next_attempt_at=?,last_error=NULL,updated_at=? WHERE id=?")
      .run(timestamp(), timestamp(), id);
    if (result.changes === 0) throw new CoreStoreError("Pending mutation no longer exists");
    return { id, queued: true };
  }

  private cancelMutation(input: JsonRecord): JsonRecord {
    const id = requiredText(input.id, "Mutation id");
    const result = this.db.prepare("UPDATE outbox SET state='cancelled',updated_at=? WHERE id=? AND state IN ('pending','conflict')")
      .run(timestamp(), id);
    if (result.changes === 0) throw new CoreStoreError("Pending mutation no longer exists");
    return { id, cancelled: true };
  }

  private countSyncTokens(): number {
    return Number((this.db.prepare("SELECT COUNT(*) AS count FROM sync_meta WHERE key LIKE 'google-sync-token:%'").get() as { count: number }).count);
  }

  private assertStatusEventCalendar(calendarId: string, eventType: string): void {
    if (eventType === "default") return;
    const calendar = this.googleCalendarForSync(calendarId);
    if (!calendar?.googleId) {
      throw new CoreStoreError("Focus time, out of office, and working location events require a connected Google primary calendar.");
    }
    if (calendar.googleId !== "primary") {
      throw new CoreStoreError("Google only supports this Calendar status event type on the primary calendar.");
    }
  }

  private crossAccountCopyTargets(input: JsonRecord): { sourceAccountId: string; destinationAccountId: string; destinationCalendarId: string } {
    const sourceAccountId = requiredText(input.sourceAccountId, "Source Google account id");
    const destinationAccountId = requiredText(input.destinationAccountId, "Destination Google account id");
    const destinationCalendarId = requiredText(input.destinationCalendarId, "Destination calendar id");
    if (sourceAccountId === destinationAccountId) throw new CoreStoreError("Choose two different Google accounts for a cross-account copy.");
    const source = this.googleAccount(sourceAccountId);
    const destination = this.googleAccount(destinationAccountId);
    if (!source || source.accountId === localAccountId || source.connectionState !== "connected") throw new CoreStoreError("Source account must be a connected Google account.");
    if (!destination || destination.accountId === localAccountId || destination.connectionState !== "connected") throw new CoreStoreError("Destination account must be a connected Google account.");
    const destinationCalendar = this.googleCalendarForSync(destinationCalendarId);
    if (!destinationCalendar || destinationCalendar.accountId !== destinationAccountId) throw new CoreStoreError("Choose a Calendar belonging to the destination account.");
    return { sourceAccountId, destinationAccountId, destinationCalendarId };
  }

  private hasPendingEntityMutation(entity: "task" | "event", entityId: string): boolean {
    return Boolean(this.db.prepare("SELECT 1 FROM outbox WHERE entity_id=? AND kind LIKE ? AND state IN ('pending','conflict') LIMIT 1")
      .get(entityId, `${entity}.%`));
  }

  private requireList(id: string): void {
    if (!this.db.prepare("SELECT 1 FROM task_lists WHERE id=?").get(id)) throw new CoreStoreError("Task list no longer exists");
  }

  private accountForTaskList(listId: string): string {
    const row = this.db.prepare("SELECT account_id AS accountId FROM task_lists WHERE id=?").get(listId) as { accountId?: string } | undefined;
    if (!row?.accountId) throw new CoreStoreError("Task list no longer exists");
    return row.accountId;
  }

  private reorderTask(taskId: string, listId: string, previousTaskId: unknown): void {
    const rows = this.db.prepare(`SELECT id FROM tasks WHERE list_id=? AND id != ? AND status != 'deleted'
      ORDER BY sort_order,title COLLATE NOCASE,id`).all(listId, taskId) as Array<{ id: string }>;
    const priorIndex = typeof previousTaskId === "string" ? rows.findIndex((row) => row.id === previousTaskId) : -1;
    const insertionIndex = typeof previousTaskId === "string" ? (priorIndex < 0 ? rows.length : priorIndex + 1) : 0;
    rows.splice(insertionIndex, 0, { id: taskId });
    const update = this.db.prepare("UPDATE tasks SET sort_order=?,updated_at=? WHERE id=?");
    const now = timestamp();
    rows.forEach((row, index) => update.run(String((index + 1) * 1_000).padStart(12, "0"), now, row.id));
  }

  private accountForCalendar(calendarId: string): string {
    const row = this.db.prepare("SELECT account_id AS accountId FROM calendars WHERE id=?").get(calendarId) as { accountId?: string } | undefined;
    if (!row?.accountId) throw new CoreStoreError("Calendar no longer exists");
    return row.accountId;
  }

  private defaultWritableAccountId(): string {
    const connected = this.googleAccounts().find((account) => account.accountId !== localAccountId && account.connectionState === "connected");
    return connected?.accountId ?? localAccountId;
  }

  private defaultWritableCalendarId(): string {
    const selected = this.selectedCalendarIds();
    const writable = this.calendars().find((calendar) => selected.includes(calendar.id) && calendar.accountId !== localAccountId) ?? this.calendars()[0];
    if (!writable) throw new CoreStoreError("No calendar is available");
    return writable.id;
  }

  private page(items: JsonRecord[], input: JsonRecord): JsonRecord {
    // Calendar bootstrap deliberately requests up to 500 items. Preserve that
    // contract (and allow the 1,000-item perf fixture) rather than silently
    // returning a partial range with an ignored next cursor.
    const limit = Math.max(1, Math.min(1_000, Number(input.limit) || 100));
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
  const recurrence = safeJson(row.recurrence, null);
  const attendees = safeJson(row.attendees, []);
  const conference = safeJson(row.conference, null);
  const attachments = safeJson(row.attachments, []);
  return {
    ...row,
    allDay: Boolean(row.allDay),
    completed: Boolean(row.completed),
    eventId: row.eventId ?? row.id,
    status: row.status ?? "confirmed",
    notes: row.notes ?? row.description ?? "",
    recurrence,
    recurrenceRule: recurrenceRuleFromStored(recurrence),
    attendees,
    conference,
    attachments,
    eventType: normalizedEventType(row.eventType),
    focusTimeProperties: safeJson(row.focusTimeProperties, null),
    outOfOfficeProperties: safeJson(row.outOfOfficeProperties, null),
    workingLocationProperties: safeJson(row.workingLocationProperties, null),
    selfResponseStatus: normalizedResponseStatus(row.selfResponseStatus),
    guestEmails: attendees
      .map((item: JsonRecord) => item.email)
      .filter((value: unknown): value is string => typeof value === "string"),
    reminders,
    reminderMinutes: reminders
      .map((item: JsonRecord) => item.minutes)
      .filter((value: unknown) => Number.isInteger(value)),
    remindersUseDefault: row.remindersUseDefault === undefined ? true : Boolean(row.remindersUseDefault),
    transparency: row.transparency ?? "opaque",
    visibility: row.visibility ?? "default"
  };
}

function hasOwn(record: JsonRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function normalizedEventType(value: unknown): "default" | "focusTime" | "outOfOffice" | "workingLocation" {
  return value === "focusTime" || value === "outOfOffice" || value === "workingLocation" ? value : "default";
}

function normalizedResponseStatus(value: unknown): "needsAction" | "declined" | "tentative" | "accepted" | null {
  return value === "needsAction" || value === "declined" || value === "tentative" || value === "accepted" ? value : null;
}

function responseStatusAttendees(value: unknown, selfResponseStatus: unknown): JsonRecord[] {
  const attendees = (Array.isArray(value) ? value : [])
    .map((attendee) => typeof attendee === "string" ? { email: attendee } : attendee)
    .filter((attendee): attendee is JsonRecord => Boolean(attendee) && typeof attendee === "object" && typeof attendee.email === "string")
    .map((attendee) => ({ ...attendee }));
  const response = normalizedResponseStatus(selfResponseStatus);
  if (!response) return attendees;
  const self = attendees.find((attendee) => attendee.self === true);
  if (self) self.responseStatus = response;
  return attendees;
}

function normalizeCalendarAttachments(value: unknown): JsonRecord[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: JsonRecord[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const candidate = entry as JsonRecord;
    const fileUrl = typeof candidate.fileUrl === "string" ? candidate.fileUrl : typeof candidate.alternateLink === "string" ? candidate.alternateLink : null;
    if (!fileUrl || !/^https:\/\//i.test(fileUrl) || seen.has(fileUrl)) continue;
    seen.add(fileUrl);
    result.push({
      fileUrl,
      title: typeof candidate.title === "string" && candidate.title.trim() ? candidate.title.trim().slice(0, 500) : fileUrl,
      ...(typeof candidate.mimeType === "string" ? { mimeType: candidate.mimeType.slice(0, 200) } : {}),
      ...(typeof candidate.iconLink === "string" ? { iconLink: candidate.iconLink } : {}),
      ...(typeof candidate.fileId === "string" ? { fileId: candidate.fileId } : {})
    });
    if (result.length === 25) break;
  }
  return result;
}

function conferenceFromGoogle(value: unknown): JsonRecord | null {
  if (!value || typeof value !== "object") return null;
  const conference = value as JsonRecord;
  const entryPoints = Array.isArray(conference.entryPoints) ? conference.entryPoints.filter((item): item is JsonRecord => Boolean(item) && typeof item === "object") : [];
  const video = entryPoints.find((item) => item.entryPointType === "video");
  const phone = entryPoints.find((item) => item.entryPointType === "phone");
  const more = entryPoints.find((item) => item.entryPointType === "more");
  return {
    ...(typeof conference.conferenceSolution === "object" && conference.conferenceSolution && typeof (conference.conferenceSolution as JsonRecord).name === "string"
      ? { solutionName: (conference.conferenceSolution as JsonRecord).name }
      : {}),
    ...(typeof video?.uri === "string" ? { videoUri: video.uri } : {}),
    ...(typeof video?.label === "string" ? { videoLabel: video.label } : {}),
    ...(typeof phone?.uri === "string" ? { phoneUri: phone.uri } : {}),
    ...(typeof phone?.label === "string" ? { phoneLabel: phone.label } : {}),
    ...(typeof phone?.pin === "string" ? { phonePin: phone.pin } : {}),
    ...(typeof more?.uri === "string" ? { moreUri: more.uri } : {}),
    ...(typeof more?.label === "string" ? { moreLabel: more.label } : {})
  };
}

function googleEventMetadata(remote: JsonRecord): JsonRecord {
  const attendees = Array.isArray(remote.attendees) ? remote.attendees : [];
  const self = attendees.find((attendee): attendee is JsonRecord => Boolean(attendee) && typeof attendee === "object" && attendee.self === true);
  return {
    ...(hasOwn(remote, "conferenceData") ? { conference: conferenceFromGoogle(remote.conferenceData) } : {}),
    ...(hasOwn(remote, "attachments") ? { attachments: normalizeCalendarAttachments(remote.attachments) } : {}),
    ...(hasOwn(remote, "eventType") ? { eventType: normalizedEventType(remote.eventType) } : {}),
    ...(hasOwn(remote, "focusTimeProperties") ? { focusTimeProperties: safeObject(remote.focusTimeProperties) } : {}),
    ...(hasOwn(remote, "outOfOfficeProperties") ? { outOfOfficeProperties: safeObject(remote.outOfOfficeProperties) } : {}),
    ...(hasOwn(remote, "workingLocationProperties") ? { workingLocationProperties: safeObject(remote.workingLocationProperties) } : {}),
    ...(Array.isArray(remote.attendees) ? { selfResponseStatus: normalizedResponseStatus(self?.responseStatus) } : {})
  };
}

function safeObject(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? structuredClone(value as JsonRecord) : null;
}

function normalizedStatusEventProperties(eventType: string, input: JsonRecord): JsonRecord {
  if (eventType === "focusTime") {
    const source = safeObject(input.focusTimeProperties) ?? {};
    return {
      focusTimeProperties: {
        autoDeclineMode: new Set(["declineNone", "declineAllConflictingInvitations", "declineOnlyNewConflictingInvitations"]).has(source.autoDeclineMode)
          ? source.autoDeclineMode
          : "declineNone",
        chatStatus: source.chatStatus === "doNotDisturb" ? "doNotDisturb" : "available"
      },
      outOfOfficeProperties: null,
      workingLocationProperties: null
    };
  }
  if (eventType === "outOfOffice") {
    const source = safeObject(input.outOfOfficeProperties) ?? {};
    return {
      focusTimeProperties: null,
      outOfOfficeProperties: {
        autoDeclineMode: new Set(["declineNone", "declineAllConflictingInvitations", "declineOnlyNewConflictingInvitations"]).has(source.autoDeclineMode)
          ? source.autoDeclineMode
          : "declineNone"
      },
      workingLocationProperties: null
    };
  }
  if (eventType === "workingLocation") {
    const source = safeObject(input.workingLocationProperties) ?? {};
    const type = source.type === "officeLocation" || source.type === "customLocation" ? source.type : "homeOffice";
    const label = typeof source.customLocation === "object" && source.customLocation && typeof (source.customLocation as JsonRecord).label === "string"
      ? (source.customLocation as JsonRecord).label.trim().slice(0, 500)
      : "";
    return {
      focusTimeProperties: null,
      outOfOfficeProperties: null,
      workingLocationProperties: type === "customLocation"
        ? { type, customLocation: { label: label || "Custom location" } }
        : type === "officeLocation"
          ? { type, officeLocation: safeObject(source.officeLocation) ?? {} }
          : { type: "homeOffice" }
    };
  }
  return { focusTimeProperties: null, outOfOfficeProperties: null, workingLocationProperties: null };
}

function statusEventTransparency(eventType: string, value: unknown): string {
  if (eventType === "focusTime" || eventType === "outOfOffice") return "opaque";
  if (eventType === "workingLocation") return "transparent";
  return value === "transparent" ? "transparent" : "opaque";
}

function statusEventVisibility(eventType: string, value: unknown): string {
  if (eventType === "focusTime") return "private";
  if (eventType === "outOfOffice" || eventType === "workingLocation") return "public";
  return value === "public" || value === "private" ? value : "default";
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

function recurrenceRuleFromStored(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as JsonRecord;
  const frequency = String(record.frequency ?? "").toUpperCase();
  if (!new Set(["DAILY", "WEEKLY", "MONTHLY", "YEARLY"]).has(frequency)) return null;
  const fields = [`FREQ=${frequency}`, `INTERVAL=${Math.max(1, Number(record.interval) || 1)}`];
  if (Array.isArray(record.byDay) && record.byDay.length) fields.push(`BYDAY=${record.byDay.join(",")}`);
  if (record.byMonthDay) fields.push(`BYMONTHDAY=${record.byMonthDay}`);
  if (record.bySetPos) fields.push(`BYSETPOS=${record.bySetPos}`);
  if (record.endsOn) fields.push(`UNTIL=${String(record.endsOn).replace(/-/g, "")}`);
  if (record.count) fields.push(`COUNT=${record.count}`);
  return `RRULE:${fields.join(";")}`;
}

function ftsQuery(value: string): string | null {
  const terms = String(value)
    .trim()
    .split(/\s+/)
    .map((term) => term.replace(/[^\p{L}\p{N}_-]/gu, ""))
    .filter(Boolean)
    .slice(0, 12);
  return terms.length ? terms.map((term) => `${term}*`).join(" AND ") : null;
}

function timestamp(): string { return new Date().toISOString(); }
function stringValue(value: unknown): string { return typeof value === "string" ? value : ""; }
function nullableDate(value: unknown): string | null { return typeof value === "string" && value ? value : null; }
function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === "string" && item.length > 0))] : [];
}
function durationMinutes(start: string, end: string): number {
  return Math.max(0, Math.round((Date.parse(end) - Date.parse(start)) / 60_000));
}
function workingRange(date: string, hours: JsonRecord, settings: JsonRecord): { start: string; end: string } {
  const startHour = Math.max(0, Math.min(23, Number(hours.start ?? settings.todayWorkingHoursStart) || 9));
  const endHour = Math.max(startHour + 1, Math.min(24, Number(hours.end ?? settings.todayWorkingHoursEnd) || 17));
  const zone = typeof settings.defaultTimeZone === "string" && settings.defaultTimeZone ? settings.defaultTimeZone : "UTC";
  const start = zonedDateTime(date, startHour, zone);
  const end = zonedDateTime(date, endHour, zone);
  return { start, end };
}
function zonedDateTime(date: string, hour: number, timeZone: string): string {
  const [year, month, day] = date.split("-").map(Number);
  if (![year, month, day].every(Number.isFinite)) throw new CoreStoreError("Schedule date is invalid.");
  let instant = Date.UTC(year, month - 1, day, hour, 0, 0);
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  });
  // Two passes account for a DST boundary between UTC and the requested wall
  // time. Persisted values are always UTC instants; only interpretation uses
  // the user's configured calendar timezone.
  for (let pass = 0; pass < 2; pass += 1) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(instant)).filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
    const displayed = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0);
    instant += Date.UTC(year, month - 1, day, hour, 0, 0) - displayed;
  }
  return new Date(instant).toISOString();
}
function subtractIntervals(range: { start: string; end: string }, intervals: Array<{ start: string; end: string }>): Array<{ start: string; end: string }> {
  const ordered = intervals
    .map((interval) => ({ start: Math.max(Date.parse(range.start), Date.parse(interval.start)), end: Math.min(Date.parse(range.end), Date.parse(interval.end)) }))
    .filter((interval) => Number.isFinite(interval.start) && Number.isFinite(interval.end) && interval.end > interval.start)
    .sort((left, right) => left.start - right.start);
  const free: Array<{ start: string; end: string }> = [];
  let cursor = Date.parse(range.start);
  for (const interval of ordered) {
    if (interval.start > cursor) free.push({ start: new Date(cursor).toISOString(), end: new Date(interval.start).toISOString() });
    cursor = Math.max(cursor, interval.end);
  }
  if (cursor < Date.parse(range.end)) free.push({ start: new Date(cursor).toISOString(), end: range.end });
  return free;
}
function compareSchedulableTasks(left: JsonRecord, right: JsonRecord): number {
  const priority = { high: 0, medium: 1, low: 2, none: 3 } as Record<string, number>;
  return (priority[left.priority] ?? 3) - (priority[right.priority] ?? 3) ||
    String(left.dueAt ?? "9999-12-31").localeCompare(String(right.dueAt ?? "9999-12-31")) ||
    String(left.updatedAt ?? "").localeCompare(String(right.updatedAt ?? ""));
}
function formatAvailabilityTime(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short", timeZone }).format(new Date(value));
}
function isFollowingScope(scope: unknown): boolean {
  return scope === "following" || scope === "thisAndFollowing" || scope === "future";
}
function taskCreatePayload(task: JsonRecord): JsonRecord {
  return {
    id: task.id, listId: task.listId, title: task.title, notes: task.notes, status: task.status, priority: task.priority,
    dueDate: task.dueAt, parentId: task.parentId, plannedStart: task.plannedStart, plannedEnd: task.plannedEnd,
    durationMinutes: task.durationMinutes, lockedSchedule: task.lockedSchedule, snoozeUntil: task.snoozeUntil, tags: task.tags
  };
}
function taskUpdatePayload(task: JsonRecord): JsonRecord { return taskCreatePayload(task); }
function eventCreatePayload(event: JsonRecord): JsonRecord {
  return {
    id: event.id, calendarId: event.calendarId, title: event.title, description: event.description ?? event.notes,
    startsAt: event.startsAt, endsAt: event.endsAt, allDay: event.allDay, completed: event.completed, colorId: event.colorId, location: event.location,
    recurrence: event.recurrence, attendees: event.attendees, reminders: event.reminders, remindersUseDefault: event.remindersUseDefault,
    transparency: event.transparency, visibility: event.visibility, timeZone: event.timeZone,
    attachments: event.attachments, eventType: event.eventType, focusTimeProperties: event.focusTimeProperties,
    outOfOfficeProperties: event.outOfOfficeProperties, workingLocationProperties: event.workingLocationProperties,
    selfResponseStatus: event.selfResponseStatus
  };
}
function eventUpdatePayload(event: JsonRecord): JsonRecord { return eventCreatePayload(event); }
function requiredText(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new CoreStoreError(`${label} is required`);
  return value.trim();
}
