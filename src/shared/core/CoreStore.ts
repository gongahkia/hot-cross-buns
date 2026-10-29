import { currentZonedDay, zonedDayRange, cachedDateTimeFormat } from "@shared/zonedTime";
import type { SqlDatabase, SqlStatement, CoreStorePlatform } from "./database";
const randomUUID = (): string => globalThis.crypto.randomUUID();
import type { GoogleResolutionSnapshot, SyncResolutionContext } from "./syncResolution";
import { resolutionGoogleEvent } from "./syncResolution";
import { claimedLocalEventId, deterministicGoogleEventId } from "./googleEventIdentity";
import { calendarCanWrite, calendarWriteRestriction } from "@shared/calendarPermissions";
import { splitHcbTaskMetadata } from "./hcbTaskMetadata";
import { expandGoogleRecurrenceLines, shiftGoogleRecurrenceSchedule, splitGoogleRecurrenceLines, withGoogleExdate } from "./googleRecurrence";
import { recordTiming, timed, timingSnapshot } from "./performance";
import { getStartupTimings, markStartupTiming } from "./startupTiming";
import { appLogger } from "./appLogger";
import { CoreStoreError } from "./coreStoreError";
import { taskOrderBetween } from "./taskOrder";
import { taskBoardPage } from "./taskBoardQuery";
import { shiftSeriesTime } from "./calendarTimeChange";
import type { TaskSummary } from "@shared/ipc/contracts";
export { CoreStoreError } from "./coreStoreError";

type JsonRecord = Record<string, any>;

export interface CoreNativeBridge {
  capabilities: () => JsonRecord;
  listFontFamilies: () => JsonRecord | Promise<JsonRecord>;
  requestNotificationPermission: () => JsonRecord | Promise<JsonRecord>;
  openExternalUrl: (request: { url: string }) => JsonRecord | Promise<JsonRecord>;
  applySettings?: (settings: JsonRecord) => void;
  checkForUpdates?: () => Promise<JsonRecord>;
  rescheduleNotifications?: () => JsonRecord;
  refreshData?: () => void;
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

export interface HistoricalSmokeNoteFixture {
  id: string;
  title: string;
  body: string;
}

interface EventWriteOptions {
  enqueue?: boolean;
  recordUndo?: boolean;
}

interface SmartSchedulePlan {
  availableMinutes: number;
  calendarId: string;
  candidateScope: SmartScheduleCandidateScope;
  candidateScopeLabel: string;
  createdAt: number;
  date: string;
  fixedEventCount: number;
  nonBlockingEventCount: number;
  scheduledMinutes: number;
  suggestions: JsonRecord[];
  skipped: JsonRecord[];
  candidateCount: number;
}

type SmartScheduleCandidateScope = "dueSoon" | "allOpen";

export const schemaVersion = 9;
const localAccountId = "local";
// Indexed lookups for the event and, for scheduled blocks, its task. Keep queue
// state on the existing event projection so recurring instances share it too.
const eventMutationStateSql = `(SELECT CASE WHEN MAX(state='conflict' OR last_error IS NOT NULL) THEN 'failed'
  WHEN COUNT(*)>0 THEN 'queued' ELSE 'synced' END FROM outbox
  WHERE entity_id IN (event.id,block.task_id) AND state IN ('pending','conflict') AND account_id!='local')`;
const legacyPseudoNoteImportVersion = 1;
const legacyPseudoNoteSourceType = "legacy-google-task-pseudo-note";
const historicalSmokeNoteBody = "SQLite-backed smoke note.";

const defaultSettings: JsonRecord = {
  theme: "system",
  colorTheme: "hcb-neutral-light",
  customBackground: null,
  useInferredBackgroundTheme: true,
  appLanguage: "system",
  uiFontName: null,
  uiMonoFontName: null,
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
  // Retained only to read preferences written by previous builds. Navigation
  // now lives in the app header, so this value is no longer rendered.
  navigationPlacement: "left",
  hiddenNavigationTabs: [],
  navigationTabOrder: ["calendar", "tasks", "notes"],
  toolbarActionOrder: ["refresh", "settings"],
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
  onboardingStatus: "pending",
  setupCompletedAt: null,
  syncMode: "balanced",
  syncTasksEnabled: true,
  syncCalendarEventsEnabled: true,
  eventRetentionDaysBack: 0,
  completedTaskRetentionDaysBack: 365,
  keybindings: {
    "commandPalette.open": "CmdOrCtrl+P",
    "undo.perform": "CmdOrCtrl+Z",
    "redo.perform": "CmdOrCtrl+Shift+Z",
    "sync.refresh": "CmdOrCtrl+R",
    "navigation.diagnostics.toggle": "CmdOrCtrl+Alt+D",
    "navigation.settings": "CmdOrCtrl+Shift+?",
    "navigation.calendar": "CmdOrCtrl+1",
    "navigation.tasks": "CmdOrCtrl+2",
    "navigation.notes": "CmdOrCtrl+3"
  },
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
  agentActionTrayEnabled: false,
  webhooksEnabled: false
};

export class CoreStore {
  private readonly db: SqlDatabase;
  private readonly statementCache = new Map<string, SqlStatement>();
  private fullTextSearchAvailable = false;
  private applyingUndo = false;
  private nativeBridge: CoreNativeBridge | null = null;
  private developerDataWasReset = false;
  /**
   * Smart Schedule plans deliberately live only for the current app session.
   * The renderer can review a stable plan without making it durable state, and
   * an app restart cannot accidentally apply an old plan against new data.
   */
  private readonly smartSchedulePlans = new Map<string, SmartSchedulePlan>();
  private eventRangeCacheRevision = -1;
  private readonly eventRangeCache = new Map<string, JsonRecord[]>();

  constructor(database: SqlDatabase, private readonly platform: CoreStorePlatform = {}) {
    this.db = database;
    this.db.pragma("foreign_keys = ON");
    timed("database.migration", "startup", () => this.db.transaction(() => this.migrate())());
    if (!platform.deferSyncRecovery) this.recoverInterruptedSyncCreations();
    this.seed();
  }

  /** Caller must exclude a live Google writer before recovering its durable intent. */
  recoverInterruptedSyncCreations(): void {
    // A create may have reached Google before the previous process stopped.
    // Its outcome must be reviewed, rather than replayed with a new remote id.
    this.statement(`UPDATE outbox SET state='conflict',creation_started=0,payload_json=json_set(payload_json,'$.__hcbUncertainCreation',json('true')),last_error=?,updated_at=?
      WHERE state='pending' AND creation_started=1`).run(
        "Hot Cross Buns stopped during a Google creation. Check Google before retrying to avoid duplicates.", timestamp());
  }

  /**
   * Cache parameterized statements only. Borrows stay in tight SQL loops:
   * never retain a statement across arbitrary domain calls (which may evict
   * and finalize it), or retain a streaming iterator.
   */
  private statement(sql: string): SqlStatement {
    const cached = this.statementCache.get(sql);
    if (cached) { this.statementCache.delete(sql); this.statementCache.set(sql, cached); return cached; }
    const statement = this.db.prepare(sql);
    this.statementCache.set(sql, statement);
    if (this.statementCache.size > 128) {
      const oldest = this.statementCache.keys().next().value!;
      this.statementCache.get(oldest)?.finalize?.();
      this.statementCache.delete(oldest);
    }
    return statement;
  }

  close(): void {
    for (const statement of this.statementCache.values()) statement.finalize?.();
    this.statementCache.clear();
    this.db.close();
  }

  async backupTo(filePath: string): Promise<void> {
    if (!this.platform.backupTo) throw new CoreStoreError("File backups are unavailable in this runtime.");
    await this.platform.backupTo(filePath);
  }

  /** Recover device-only notes without replaying old Google mutation queues. */
  restoreLocalNotes(filePath: string): number {
    if (!this.platform.openSnapshot) throw new CoreStoreError("File restore is unavailable in this runtime.");
    const snapshot = this.platform.openSnapshot(filePath);
    try {
      if (snapshot.pragma("quick_check", { simple: true }) !== "ok") throw new CoreStoreError("The backup failed its integrity check.");
      const version = snapshot.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as { version: number };
      // v6 uses the same Notes layout as v7/v8. Queue/index-only migrations
      // must not make a user's existing note backups unusable after upgrading.
      if (!Number.isInteger(version.version) || version.version < 6 || version.version > schemaVersion) {
        throw new CoreStoreError("This backup uses an incompatible database version. Open it with a compatible version of Hot Cross Buns.");
      }
      const insertList = this.statement(`INSERT INTO note_lists(id,title,created_at,updated_at) VALUES(@id,@title,@created_at,@updated_at)
        ON CONFLICT(id) DO UPDATE SET title=excluded.title,updated_at=excluded.updated_at`);
      const insertNote = this.statement(`INSERT INTO notes(id,title,body,list_id,tags_json,created_at,updated_at,deleted_at)
        VALUES(@id,@title,@body,@list_id,@tags_json,@created_at,@updated_at,NULL)
        ON CONFLICT(id) DO UPDATE SET title=excluded.title,body=excluded.body,list_id=excluded.list_id,tags_json=excluded.tags_json,updated_at=excluded.updated_at,deleted_at=NULL`);
      return this.db.transaction(() => {
        for (const row of snapshot.prepare("SELECT id,title,created_at,updated_at FROM note_lists").iterate()) insertList.run(row);
        let count = 0;
        for (const row of snapshot.prepare("SELECT id,title,body,list_id,tags_json,created_at,updated_at FROM notes WHERE deleted_at IS NULL").iterate()) {
          insertNote.run(row);
          count += 1;
        }
        return count;
      })();
    } catch (error) {
      if (error instanceof CoreStoreError) throw error;
      throw new CoreStoreError("This file is not a readable Hot Cross Buns backup.");
    } finally {
      snapshot.close();
    }
  }

  /**
   * Operator-only recovery hook for the historical Playwright defect. Callers
   * must supply an audited manifest of exact record ids; this is deliberately
   * not a broad title-based cleanup and is safe to repeat.
   */
  removeKnownHistoricalSmokeNotes(fixtures: readonly HistoricalSmokeNoteFixture[]): number {
    const confirmed = fixtures.filter(isHistoricalSmokeNoteFixture);
    const remove = this.statement("DELETE FROM notes WHERE id=? AND title=? AND body=?");
    let removed = 0;
    this.db.transaction(() => {
      for (const fixture of confirmed) removed += remove.run(fixture.id, fixture.title, fixture.body).changes;
    })();
    return removed;
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
    this.statement("INSERT INTO sync_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
      .run("google-client", JSON.stringify({ clientId }));
  }

  googleAccounts(): JsonRecord[] {
    return this.statement(`SELECT id AS accountId,google_account_id AS googleAccountId,email,display_name AS displayName,
      avatar_url AS avatarUrl,connection_state AS connectionState,missing_scopes_json AS missingScopes,
      granted_scopes_json AS grantedScopes,updated_at AS updatedAt,
      (SELECT COUNT(*) FROM outbox WHERE account_id=google_accounts.id AND state IN ('pending','conflict')) AS unresolvedMutationCount
      FROM google_accounts ORDER BY created_at`).all().map((row: any) => ({
      ...row,
      missingScopes: safeJson(row.missingScopes, []),
      grantedScopes: safeJson(row.grantedScopes, []),
      unresolvedMutationCount: Number(row.unresolvedMutationCount ?? 0)
    })) as JsonRecord[];
  }

  upsertGoogleAccount(input: JsonRecord): JsonRecord {
    const googleAccountId = requiredText(input.googleAccountId ?? input.id, "Google account id");
    const existing = this.statement("SELECT id FROM google_accounts WHERE google_account_id=?").get(googleAccountId) as { id: string } | undefined;
    const accountId = existing?.id ?? randomUUID();
    const now = timestamp();
    this.statement(`INSERT INTO google_accounts(id,google_account_id,email,display_name,avatar_url,connection_state,missing_scopes_json,granted_scopes_json,created_at,updated_at)
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
    const result = this.statement("UPDATE google_accounts SET connection_state=?,last_error=?,updated_at=? WHERE id=?")
      .run(connectionState, message ?? null, timestamp(), accountId);
    if (result.changes === 0) throw new CoreStoreError("Google account no longer exists.");
  }

  removeGoogleAccount(accountId: string): void {
    // Remote records remain a local cache until the user explicitly clears the
    // workspace; disconnecting must not silently delete their planner data.
    this.updateGoogleAccountState(accountId, "disconnected");
    this.resetGoogleSyncTokens(accountId);
  }

  /**
   * Retire the starter workspace once a real Google account is connected.
   *
   * The local account is only a first-run fallback. Its task lists, tasks,
   * calendars, events, queued local writes, and undo history must never be
   * mistaken for Google data. Notes and tags deliberately remain: they are
   * HCB-owned features and do not belong to the starter account.
   */
  retireLocalFallback(): void {
    if (!this.statement("SELECT 1 FROM google_accounts WHERE id=?").get(localAccountId)) {
      this.statement("INSERT INTO sync_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
        .run("local-fallback-retired", "1");
      return;
    }

    const currentSettings = this.settings();
    const nextSettings = withoutLocalFallbackSelections(currentSettings);
    const transaction = this.db.transaction(() => {
      // A task block owns references to both a task and an event, so it must
      // be removed before either local resource table can be cleared.
      this.statement(`DELETE FROM scheduled_task_blocks
        WHERE task_id IN (SELECT id FROM tasks WHERE list_id IN (SELECT id FROM task_lists WHERE account_id=?))
           OR calendar_event_id IN (SELECT id FROM events WHERE calendar_id IN (SELECT id FROM calendars WHERE account_id=?))
           OR calendar_id IN (SELECT id FROM calendars WHERE account_id=?)`)
        .run(localAccountId, localAccountId, localAccountId);
      this.statement("DELETE FROM outbox WHERE account_id=?").run(localAccountId);
      this.statement("DELETE FROM events WHERE calendar_id IN (SELECT id FROM calendars WHERE account_id=?)").run(localAccountId);
      this.statement("DELETE FROM tasks WHERE list_id IN (SELECT id FROM task_lists WHERE account_id=?)").run(localAccountId);
      // Notes can reference the starter Inbox as an optional grouping. Keep
      // the note, but remove that now-invalid local list reference.
      this.statement("UPDATE notes SET list_id=NULL WHERE list_id IN (SELECT id FROM task_lists WHERE account_id=?)").run(localAccountId);
      this.statement("DELETE FROM task_lists WHERE account_id=?").run(localAccountId);
      this.statement("DELETE FROM calendars WHERE account_id=?").run(localAccountId);
      this.statement("DELETE FROM google_accounts WHERE id=?").run(localAccountId);
      this.statement("DELETE FROM sync_meta WHERE key LIKE ?").run(`google-sync-token:${localAccountId}:%`);
      // Local undo entries could otherwise recreate a resource we just
      // intentionally retired. Preserve any Google history by removing only
      // entries whose forward or inverse payload points at Inbox/Primary.
      this.statement(`DELETE FROM undo_entries
        WHERE forward_json LIKE ? OR forward_json LIKE ? OR inverse_json LIKE ? OR inverse_json LIKE ?`)
        .run('%"listId":"inbox"%', '%"calendarId":"primary"%', '%"listId":"inbox"%', '%"calendarId":"primary"%');
      this.statement("INSERT INTO sync_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
        .run("local-fallback-retired", "1");
      this.statement("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
        .run("app", JSON.stringify(nextSettings));
    });
    transaction();
    this.nativeBridge?.applySettings?.(nextSettings);
  }

  previewCrossAccountCopy(input: JsonRecord): JsonRecord {
    const { sourceAccountId, destinationAccountId, destinationCalendarId } = this.crossAccountCopyTargets(input);
    const taskListCount = Number((this.statement("SELECT COUNT(*) AS count FROM task_lists WHERE account_id=?").get(sourceAccountId) as { count: number }).count);
    const taskCount = Number((this.statement(`SELECT COUNT(*) AS count FROM tasks task JOIN task_lists list ON list.id=task.list_id
      WHERE list.account_id=? AND task.status != 'deleted'`).get(sourceAccountId) as { count: number }).count);
    const events = this.statement("SELECT event_type AS eventType FROM events event JOIN calendars calendar ON calendar.id=event.calendar_id WHERE calendar.account_id=?")
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
    const sourceLists = this.statement("SELECT id,title FROM task_lists WHERE account_id=? ORDER BY title COLLATE NOCASE,id").all(sourceAccountId) as Array<{ id: string; title: string }>;
    const sourceTasks = this.statement(`SELECT task.id,task.list_id AS listId,task.title,task.notes,task.status,task.priority,task.due_at AS dueAt,
      task.parent_id AS parentId,task.duration_minutes AS durationMinutes,task.locked_schedule AS lockedSchedule,task.snooze_until AS snoozeUntil,task.tags_json AS tags
      FROM tasks task JOIN task_lists list ON list.id=task.list_id WHERE list.account_id=? AND task.status != 'deleted'
      ORDER BY task.created_at,task.id`).all(sourceAccountId) as JsonRecord[];
    const sourceEventIds = (this.statement(`SELECT event.id FROM events event JOIN calendars calendar ON calendar.id=event.calendar_id
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
    const accountFilter = accountId ? " AND mutation.account_id=?" : "";
    const now = timestamp();
    // rowid follows insertion order even when timestamps tie or the clock moves
    // backwards. A blocked write remains a barrier on subsequent sync runs.
    return (this.statement(`WITH blocked_accounts AS (
        SELECT account_id,MIN(rowid) AS barrier FROM outbox
        WHERE state IN ('pending','conflict') AND (state='conflict' OR creation_started=1 OR next_attempt_at > ?)
        GROUP BY account_id
      ) SELECT mutation.id,mutation.account_id AS accountId,mutation.kind,mutation.entity_id AS entityId,
      mutation.payload_json AS payload,mutation.attempts,mutation.created_at AS createdAt
      FROM outbox mutation LEFT JOIN blocked_accounts blocked ON blocked.account_id IS mutation.account_id
      WHERE mutation.state='pending' AND mutation.creation_started=0 AND mutation.next_attempt_at <= ?${accountFilter}
        AND (blocked.barrier IS NULL OR mutation.rowid < blocked.barrier)
      ORDER BY mutation.rowid LIMIT ?`).all(now, now, ...(accountId ? [accountId] : []), Math.max(1, Math.min(500, limit))) as any[])
      .map((row) => ({ ...row, payload: safeJson(row.payload, {}) }));
  }

  unresolvedSyncMutationCount(accountId: string): number {
    const row = this.statement("SELECT COUNT(*) AS count FROM outbox WHERE account_id=? AND state IN ('pending','conflict')")
      .get(accountId) as { count?: number } | undefined;
    return Number(row?.count ?? 0);
  }

  completeSyncMutation(id: string): void {
    this.statement("UPDATE outbox SET state='delivered',creation_started=0,updated_at=?,last_error=NULL WHERE id=?")
      .run(timestamp(), id);
  }

  beginSyncCreation(id: string): void {
    this.statement("UPDATE outbox SET creation_started=1,updated_at=? WHERE id=? AND state='pending'").run(timestamp(), id);
  }

  deferSyncMutation(id: string, error: string, retryable: boolean, uncertainCreation = false): void {
    const row = this.statement("SELECT attempts FROM outbox WHERE id=?").get(id) as { attempts?: number } | undefined;
    const attempts = Number(row?.attempts ?? 0) + 1;
    const exhausted = retryable && attempts >= 8;
    const canRetry = retryable && !exhausted;
    const delayMs = canRetry
      ? Math.min(15 * 60_000, 1_000 * (2 ** Math.min(attempts, 8)) + Math.floor(Math.random() * 500))
      : 0;
    this.statement("UPDATE outbox SET payload_json=json_set(payload_json,'$.__hcbUncertainCreation',json(?)),state=?,creation_started=0,attempts=?,next_attempt_at=?,last_error=?,updated_at=? WHERE id=?")
      .run(JSON.stringify(uncertainCreation), canRetry ? "pending" : "conflict", attempts,
        new Date(Date.now() + delayMs).toISOString(), sanitizeSyncError(exhausted
          ? `Automatic delivery stopped after ${attempts} failed attempts. Review this change in Diagnostics before retrying. ${error}`
          : error), timestamp(), id);
  }

  resetGoogleSyncTokens(accountId?: string): void {
    const prefix = accountId ? `google-sync-token:${accountId}:%` : "google-sync-token:%";
    this.statement("DELETE FROM sync_meta WHERE key LIKE ?").run(prefix);
  }

  googleSyncToken(accountId: string, key: string): string | null {
    const row = this.statement("SELECT value FROM sync_meta WHERE key=?").get(`google-sync-token:${accountId}:${key}`) as { value?: string } | undefined;
    return row?.value ?? null;
  }

  setGoogleSyncToken(accountId: string, key: string, token: string | null): void {
    const metaKey = `google-sync-token:${accountId}:${key}`;
    if (!token) {
      this.statement("DELETE FROM sync_meta WHERE key=?").run(metaKey);
      return;
    }
    this.statement("INSERT INTO sync_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
      .run(metaKey, token);
  }

  /** Remote create identities are durable receipts, not disposable pull tokens. */
  googleOperationRecord(accountId: string, key: string): JsonRecord | null {
    const row = this.statement("SELECT value FROM sync_meta WHERE key=?").get(`google-operation:${accountId}:${key}`) as { value: string } | undefined;
    return row ? safeJson(row.value, null) : null;
  }

  setGoogleOperationRecord(accountId: string, key: string, value: JsonRecord): void {
    this.statement("INSERT INTO sync_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
      .run(`google-operation:${accountId}:${key}`, JSON.stringify(value));
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
    this.statement("INSERT INTO sync_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
      .run("google-sync-runtime", JSON.stringify({ ...status, updatedAt: timestamp() }));
  }

  googleTaskListForSync(id: string): JsonRecord | null {
    return (this.statement("SELECT id,account_id AS accountId,title,google_id AS googleId,google_etag AS googleEtag FROM task_lists WHERE id=?").get(id) as JsonRecord | undefined) ?? null;
  }

  googleTaskForSync(id: string): JsonRecord | null {
    const record = this.statement(`SELECT task.id,task.list_id AS listId,task.title,task.notes,task.status,task.priority,task.due_at AS dueAt,
      task.planned_start AS plannedStart,task.planned_end AS plannedEnd,task.duration_minutes AS durationMinutes,
      task.locked_schedule AS lockedSchedule,task.snooze_until AS snoozeUntil,task.tags_json AS tags,
      task.parent_id AS parentId,task.sort_order AS sortOrder,task.google_id AS googleId,task.google_etag AS googleEtag,
      task.google_list_id AS googleListId,task.google_parent_id AS googleParentId,
      list.google_id AS listGoogleId,list.account_id AS accountId FROM tasks task JOIN task_lists list ON list.id=task.list_id WHERE task.id=?`)
      .get(id) as JsonRecord | undefined;
    return record ? { ...record, tags: safeJson(record.tags, []), lockedSchedule: Boolean(record.lockedSchedule) } : null;
  }

  bindGoogleTaskList(localId: string, remote: JsonRecord, submitted?: JsonRecord): JsonRecord {
    const googleId = requiredText(remote.id, "Google task-list id");
    this.bindDeletionReceipt('taskList', localId, remote, submitted);
    const result = this.statement("UPDATE task_lists SET google_id=?,google_etag=?,updated_at=? WHERE id=?")
      .run(googleId, remote.etag ?? null, remote.updated ?? timestamp(), localId);
    if (result.changes === 0) {
      if (submitted) return { id: localId, deleted: true };
      throw new CoreStoreError("Task list no longer exists");
    }
    return this.googleTaskListForSync(localId)!;
  }

  googleCalendarForSync(id: string): JsonRecord | null {
    return (this.statement("SELECT id,account_id AS accountId,title,color,time_zone AS timeZone,google_id AS googleId,google_etag AS googleEtag,access_role AS accessRole FROM calendars WHERE id=?").get(id) as JsonRecord | undefined) ?? null;
  }

  googleEventForSync(id: string): JsonRecord | null {
    const record = this.statement(`SELECT event.id,event.calendar_id AS calendarId,event.title,event.description,event.starts_at AS startsAt,
      event.ends_at AS endsAt,event.all_day AS allDay,event.color_id AS colorId,event.location,event.recurrence_json AS recurrence,
      event.google_recurrence_json AS googleRecurrence,
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
          googleRecurrence: safeJson(record.googleRecurrence, null),
          recurrenceLines: recurrenceLinesFromStored(
            safeJson(record.googleRecurrence, null),
            safeJson(record.recurrence, null)
          ),
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

  bindGoogleTask(localId: string, remote: JsonRecord, submitted?: JsonRecord): JsonRecord {
    const list = this.googleTaskForSync(localId);
    if (!list) {
      // Deleting a Google list removes its tasks locally; its queued remote
      // deletion also removes a task whose creation response arrives late.
      if (submitted) {
        const deletions = this.statement("SELECT id,payload_json AS payload FROM outbox WHERE account_id=? AND kind='taskList.delete' AND state IN ('pending','conflict')")
          .all(submitted.accountId) as Array<{ id: string; payload: string }>;
        for (const deletion of deletions) {
          const payload = safeJson(deletion.payload, {}) as JsonRecord;
          if (!payload.deletedTasks?.some((task: JsonRecord) => task.id === localId)) continue;
          const receipt = { ...submitted, googleId: requiredText(remote.id, 'Google task id'), googleEtag: remote.etag ?? null, googleListId: submitted.listGoogleId };
          payload.deletedTasks = payload.deletedTasks.map((task: JsonRecord) => task.id === localId ? { ...task, ...receipt } : task);
          this.statement('UPDATE outbox SET payload_json=? WHERE id=?').run(JSON.stringify(payload), deletion.id);
          // It may have been moved locally to a different list before that
          // list was deleted. Deleting the destination won't delete its actual
          // remote resource, so retain an explicit cleanup command as well.
          if (payload.googleId !== submitted.listGoogleId) this.enqueue('task.delete', localId, receipt, submitted.accountId);
          return { id: localId, deleted: true };
        }
      }
      throw new CoreStoreError("Task no longer exists");
    }
    this.statement(`UPDATE tasks SET google_id=?,google_etag=?,google_list_id=?,google_parent_id=?,sort_order=?,updated_at=? WHERE id=?`)
      .run(requiredText(remote.id, "Google task id"), remote.etag ?? null, (submitted ?? list).listGoogleId ?? null,
        remote.parent ?? null, submitted && list.sortOrder !== submitted.sortOrder ? list.sortOrder : remote.position ?? null,
        submitted && JSON.stringify(list) !== JSON.stringify(submitted) ? timestamp() : remote.updated ?? timestamp(), localId);
    return this.requireTask(localId);
  }

  bindGoogleEvent(localId: string, remote: JsonRecord, submitted?: JsonRecord, mutationId?: string): JsonRecord {
    const event = this.googleEventForSync(localId);
    this.bindDeletionReceipt('event', localId, remote, submitted);
    if (!event) {
      if (submitted) return { id: localId, deleted: true };
      throw new CoreStoreError("Calendar event no longer exists");
    }
    const keep = (field: string, received: any) => submitted && JSON.stringify(event[field]) !== JSON.stringify(submitted[field]) ? event[field] : received;
    // Moving a still-unbound creation queues ordinary updates. Once its remote
    // identity arrives, the first following update must move that identity.
    if (submitted && !submitted.googleId && event.calendarId !== submitted.calendarId && mutationId) {
      this.bindEventCreationLocation(localId, submitted.calendarId, event.calendarId, mutationId);
    }
    const remoteMetadata = googleEventMetadata(remote);
    const recurrenceLines = keep('recurrenceLines', hasOwn(remote, "recurrence")
      ? googleRecurrenceLines(remote.recurrence)
      : recurrenceLinesFromStored(event.googleRecurrence, event.recurrence));
    const remoteOriginalStart = hasOwn(remote, "originalStartTime")
      ? originalStartTimeFromGoogle(remote.originalStartTime)
      : event.googleOriginalStartTime ?? null;
    const remoteRecurringEventId = typeof remote.recurringEventId === "string"
      ? remote.recurringEventId
      : event.googleRecurringEventId ?? null;
    this.statement(`UPDATE events SET google_id=?,google_etag=?,google_recurring_event_id=?,google_original_start_time=?,recurrence_json=?,google_recurrence_json=?,conference_json=?,conference_create_requested=?,
      attachments_json=?,event_type=?,focus_time_properties_json=?,out_of_office_properties_json=?,
      working_location_properties_json=?,self_response_status=?,updated_at=? WHERE id=?`)
      .run(
        requiredText(remote.id, "Google event id"), remote.etag ?? null,
        remoteRecurringEventId, remoteOriginalStart,
        JSON.stringify(recurrenceFromGoogle(recurrenceLines)), JSON.stringify(recurrenceLines),
        JSON.stringify(keep('conference', remoteMetadata.conference ?? event.conference ?? null)),
        Number(keep('conferenceCreateRequested', false)),
        JSON.stringify(keep('attachments', remoteMetadata.attachments ?? event.attachments ?? [])),
        keep('eventType', remoteMetadata.eventType ?? event.eventType ?? "default"),
        JSON.stringify(keep('focusTimeProperties', remoteMetadata.focusTimeProperties ?? event.focusTimeProperties ?? null)),
        JSON.stringify(keep('outOfOfficeProperties', remoteMetadata.outOfOfficeProperties ?? event.outOfOfficeProperties ?? null)),
        JSON.stringify(keep('workingLocationProperties', remoteMetadata.workingLocationProperties ?? event.workingLocationProperties ?? null)),
        keep('selfResponseStatus', remoteMetadata.selfResponseStatus ?? event.selfResponseStatus ?? null),
        submitted && JSON.stringify(event) !== JSON.stringify(submitted) ? timestamp() : remote.updated ?? timestamp(), localId
      );
    return this.requireEvent(localId);
  }

  private bindDeletionReceipt(kind: 'taskList' | 'event', id: string, remote: JsonRecord, submitted?: JsonRecord): void {
    const rows = this.statement("SELECT id,payload_json AS payload FROM outbox WHERE entity_id=? AND kind=? AND state IN ('pending','conflict')")
      .all(id, `${kind}.delete`) as Array<{ id: string; payload: string }>;
    for (const row of rows) {
      const previous = safeJson(row.payload, {});
      const payload = { ...previous, googleId: requiredText(remote.id, 'Google id'), googleEtag: remote.etag ?? null };
      if (kind === 'event' && submitted && !submitted.googleId && !previous.googleId) payload.calendarGoogleId = submitted.calendarGoogleId;
      this.statement('UPDATE outbox SET payload_json=? WHERE id=?').run(JSON.stringify(payload), row.id);
    }
  }

  private bindEventCreationLocation(localId: string, sourceCalendarId: string, destinationCalendarId: string, mutationId: string): void {
    const next = this.statement(`SELECT id FROM outbox WHERE entity_id=? AND kind='event.update' AND state='pending'
      AND rowid>(SELECT rowid FROM outbox WHERE id=?) ORDER BY rowid LIMIT 1`).get(localId, mutationId) as { id: string } | undefined;
    if (next) this.statement("UPDATE outbox SET kind='event.move',payload_json=? WHERE id=?")
      .run(JSON.stringify({ sourceCalendarId, destinationCalendarId }), next.id);
  }

  googleDeletionPending(kind: 'taskList' | 'event', accountId: string, googleId: string, localId?: string): boolean {
    return Boolean(this.statement(`SELECT 1 FROM outbox WHERE account_id=? AND kind=? AND state IN ('pending','conflict')
      AND (json_extract(payload_json,'$.googleId')=? OR entity_id=?) LIMIT 1`).get(accountId, `${kind}.delete`, googleId, localId ?? ''));
  }

  /** Detect local commands during a multi-request structural Google operation. */
  googleMutationVersion(accountId: string): string {
    return JSON.stringify(this.statement("SELECT id,kind,payload_json,state FROM outbox WHERE account_id=? AND state IN ('pending','conflict') ORDER BY rowid").all(accountId));
  }

  completeGoogleTaskDeletion(localId: string, remoteId: string): void {
    // Undo may have restored the task while DELETE was on the wire. Its next
    // command must recreate it instead of PATCHing the now-deleted identity.
    this.statement("UPDATE tasks SET google_id=NULL,google_etag=NULL,google_list_id=NULL,google_parent_id=NULL WHERE id=? AND google_id=? AND status!='deleted'")
      .run(localId, remoteId);
  }

  googleEventCreationId(accountId: string, localId: string): string {
    return this.googleOperationRecord(accountId, `event-creation:${localId}`)?.id ?? deterministicGoogleEventId(localId);
  }

  completeGoogleEventDeletion(accountId: string, localId: string, remoteId: string): void {
    // Calendar retains deleted IDs. A restored event needs a new durable ID,
    // shared by every retry of that restoration (including after tab closure).
    this.setGoogleOperationRecord(accountId, `event-creation:${localId}`, { id: deterministicGoogleEventId(randomUUID()) });
    this.statement('UPDATE events SET google_id=NULL,google_etag=NULL WHERE id=? AND google_id=?').run(localId, remoteId);
  }

  /**
   * A Google exception cannot be re-parented. During a future-series split it
   * is copied onto an instance of the new master, so replace its stale local
   * representation with the response from that new instance.
   */
  replaceGoogleSplitException(localCalendarId: string, previousGoogleId: string, remote: JsonRecord | null): void {
    this.db.transaction(() => {
      this.statement("DELETE FROM events WHERE calendar_id=? AND google_id=?").run(localCalendarId, previousGoogleId);
      if (remote) this.upsertGoogleEvent(remote, localCalendarId);
    })();
  }

  /** Restore local split state after GoogleSync successfully compensates a failed remote split. */
  restoreGoogleSplitSeries(payload: JsonRecord, successorGoogleId?: string): void {
    const parentEventId = typeof payload.parentEventId === "string" ? payload.parentEventId : null;
    const successorEventId = typeof payload.successorEventId === "string" ? payload.successorEventId : null;
    const original = payload.originalMaster && typeof payload.originalMaster === "object"
      ? payload.originalMaster as JsonRecord
      : null;
    if (!parentEventId || !successorEventId || !original || !this.statement("SELECT 1 FROM events WHERE id=?").get(parentEventId)) return;
    this.db.transaction(() => {
      this.updateEvent({
        id: parentEventId,
        calendarId: original.calendarId,
        title: original.title,
        description: original.description,
        startsAt: original.startsAt,
        endsAt: original.endsAt,
        allDay: original.allDay,
        completed: original.completed,
        colorId: original.colorId,
        location: original.location,
        recurrenceLines: original.recurrenceLines,
        attendees: original.attendees,
        reminders: original.reminders,
        remindersUseDefault: original.remindersUseDefault,
        transparency: original.transparency,
        visibility: original.visibility,
        timeZone: original.timeZone,
        attachments: original.attachments,
        eventType: original.eventType,
        focusTimeProperties: original.focusTimeProperties,
        outOfOfficeProperties: original.outOfOfficeProperties,
        workingLocationProperties: original.workingLocationProperties,
        selfResponseStatus: original.selfResponseStatus
      }, { enqueue: false, recordUndo: false });
      this.statement("DELETE FROM scheduled_task_blocks WHERE calendar_event_id=?").run(successorEventId);
      this.statement("DELETE FROM events WHERE id=?").run(successorEventId);
      if (successorGoogleId) {
        this.statement("DELETE FROM events WHERE calendar_id=? AND google_recurring_event_id=?").run(original.calendarId, successorGoogleId);
        this.statement("DELETE FROM google_event_cancellations WHERE calendar_id=? AND recurring_event_id=?").run(original.calendarId, successorGoogleId);
      }
    })();
  }

  upsertGoogleTaskList(remote: JsonRecord, accountId: string): JsonRecord {
    const googleId = requiredText(remote.id, "Google task-list id");
    const title = requiredText(remote.title, "Google task-list title");
    const existing = this.statement("SELECT id FROM task_lists WHERE account_id=? AND google_id=?").get(accountId, googleId) as { id: string } | undefined;
    if (existing && this.hasPendingEntityMutation("taskList", existing.id)) return this.googleTaskListForSync(existing.id)!;
    const id = existing?.id ?? randomUUID();
    const now = timestamp();
    this.statement(`INSERT INTO task_lists(id,account_id,title,google_id,google_etag,created_at,updated_at) VALUES(?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET title=excluded.title,google_id=excluded.google_id,google_etag=excluded.google_etag,updated_at=excluded.updated_at`)
      .run(id, accountId, title, googleId, remote.etag ?? null, now, remote.updated ?? now);
    return this.googleTaskListForSync(id)!;
  }

  /** Reconcile only after the account's complete Task-list snapshot is read. */
  pruneGoogleTaskLists(accountId: string, activeGoogleIds: readonly string[]): void {
    const activeIds = new Set(activeGoogleIds);
    const cached = this.statement("SELECT id,google_id AS googleId FROM task_lists WHERE account_id=? AND google_id IS NOT NULL")
      .all(accountId) as Array<{ id: string; googleId: string }>;
    const removedListIds = new Set<string>();
    const removedTaskIds = new Set<string>();
    let nextSettings: JsonRecord | null = null;
    this.db.transaction(() => {
      for (const list of cached) {
        if (activeIds.has(list.googleId)) continue;
        const writes = this.statement(`SELECT id FROM outbox WHERE account_id=? AND state IN ('pending','conflict') AND (
          (kind LIKE 'taskList.%' AND entity_id=?) OR
          (kind LIKE 'task.%' AND entity_id IN (SELECT id FROM tasks WHERE list_id=?)))`)
          .all(accountId, list.id, list.id) as Array<{ id: string }>;
        if (writes.length) {
          // Do not discard an optimistic edit or send it to a removed list.
          for (const write of writes) this.statement(`UPDATE outbox SET state='conflict',last_error=?,updated_at=? WHERE id=? AND state='pending'`)
            .run("This Google task list was removed. Local writes are preserved; move tasks to an available list or cancel the queued writes.", timestamp(), write.id);
          continue;
        }
        const tasks = this.statement("SELECT id FROM tasks WHERE list_id=?").all(list.id) as Array<{ id: string }>;
        for (const task of tasks) removedTaskIds.add(task.id);
        // Calendar events are independent Google records. Remove the link,
        // not the event, when its source Task list disappears.
        this.statement("DELETE FROM scheduled_task_blocks WHERE task_id IN (SELECT id FROM tasks WHERE list_id=?)").run(list.id);
        this.statement("DELETE FROM tasks WHERE list_id=?").run(list.id);
        this.statement("UPDATE notes SET list_id=NULL WHERE list_id=?").run(list.id);
        this.statement("DELETE FROM task_lists WHERE id=?").run(list.id);
        this.setGoogleSyncToken(accountId, `tasks-updated:${list.googleId}`, null);
        removedListIds.add(list.id);
      }
      if (!removedListIds.size) return;
      for (const id of [...removedListIds, ...removedTaskIds]) {
        this.statement("DELETE FROM undo_entries WHERE forward_json LIKE ? OR inverse_json LIKE ?").run(`%${id}%`, `%${id}%`);
      }
      const current = this.settings();
      nextSettings = {
        ...current,
        selectedTaskListIds: stringArray(current.selectedTaskListIds).filter((id) => !removedListIds.has(id)),
        starredTaskIds: stringArray(current.starredTaskIds).filter((id) => !removedTaskIds.has(id)),
        perTabListFilters: Object.fromEntries(Object.entries(safeObject(current.perTabListFilters) ?? {}).map(([surface, filter]) => {
          const value = safeObject(filter) ?? {};
          return [surface, { ...value, selectedTaskListIds: stringArray(value.selectedTaskListIds).filter((id) => !removedListIds.has(id)) }];
        }))
      };
      this.statement("INSERT INTO settings(key,value) VALUES('app',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
        .run(JSON.stringify(nextSettings));
    })();
    if (nextSettings) this.nativeBridge?.applySettings?.(nextSettings);
  }

  upsertGoogleTask(remote: JsonRecord, localListId: string): JsonRecord | null {
    const googleId = requiredText(remote.id, "Google task id");
    const localList = this.googleTaskListForSync(localListId);
    if (!localList) return null; // The list may have been deleted while its page downloaded.
    const existing = this.statement(`SELECT task.id FROM tasks task JOIN task_lists list ON list.id=task.list_id
      WHERE list.account_id=? AND task.google_id=?`).get(localList.accountId, googleId) as { id: string } | undefined;
    const localId = existing?.id ?? randomUUID();
    if (this.hasPendingEntityMutation("task", localId)) return null;
    const parentId = remote.parent
      ? (this.statement("SELECT id FROM tasks WHERE list_id=? AND google_id=?").get(localListId, remote.parent) as { id?: string } | undefined)?.id ?? null
      : null;
    const previous = existing ? this.requireTask(localId) : null;
    const remoteTask = splitHcbTaskMetadata(remote.notes);
    const metadata = remoteTask.metadata;
    const now = timestamp();
    this.statement(`INSERT INTO tasks(id,list_id,title,notes,status,priority,due_at,parent_id,planned_start,planned_end,duration_minutes,
      locked_schedule,snooze_until,tags_json,sort_order,google_id,google_etag,google_parent_id,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET list_id=excluded.list_id,title=excluded.title,notes=excluded.notes,status=excluded.status,
      priority=excluded.priority,planned_start=excluded.planned_start,planned_end=excluded.planned_end,duration_minutes=excluded.duration_minutes,
      locked_schedule=excluded.locked_schedule,snooze_until=excluded.snooze_until,tags_json=excluded.tags_json,
      due_at=excluded.due_at,parent_id=excluded.parent_id,sort_order=excluded.sort_order,google_id=excluded.google_id,
      google_etag=excluded.google_etag,google_parent_id=excluded.google_parent_id,updated_at=excluded.updated_at`)
      .run(localId, localListId, remote.title ?? "Untitled task", remoteTask.notes,
        remote.deleted ? "deleted" : remote.status === "completed" ? "completed" : "active",
        metadata ? metadata.priority : previous?.priority ?? "none", remote.due ?? null, parentId, metadata ? metadata.plannedStart : previous?.plannedStart ?? null,
        metadata ? metadata.plannedEnd : previous?.plannedEnd ?? null, metadata ? metadata.durationMinutes : previous?.durationMinutes ?? null, metadata ? Number(metadata.lockedSchedule) : previous?.lockedSchedule ? 1 : 0,
        metadata ? metadata.snoozeUntil : previous?.snoozeUntil ?? null, JSON.stringify(metadata ? metadata.tags : previous?.tags ?? []), remote.position ?? null,
        googleId, remote.etag ?? null, remote.parent ?? null, now, remote.updated ?? now);
    this.statement("UPDATE tasks SET google_list_id=? WHERE id=?")
      .run(localList.googleId ?? null, localId);
    return this.requireTask(localId);
  }

  upsertGoogleTaskBatch(tasks: readonly JsonRecord[], localListId: string): void {
    this.db.transaction(() => { for (const task of tasks) this.upsertGoogleTask(task, localListId); })();
  }

  /** Full Task snapshots include completed, hidden, and deleted tasks. */
  reconcileGoogleTasks(localListId: string, remoteGoogleIds: ReadonlySet<string>): void {
    const cached = this.statement("SELECT id,google_id AS googleId FROM tasks WHERE list_id=? AND google_id IS NOT NULL AND status!='deleted'")
      .all(localListId) as Array<{ id: string; googleId: string }>;
    this.db.transaction(() => {
      for (const task of cached) {
        if (remoteGoogleIds.has(task.googleId) || this.hasPendingEntityMutation("task", task.id)) continue;
        // Retain a tombstone and its context, just as for a remote deletion.
        this.statement("UPDATE tasks SET status='deleted',updated_at=? WHERE id=?").run(timestamp(), task.id);
      }
    })();
  }

  reconcileGoogleTaskParents(localListId: string): void {
    this.statement(`UPDATE tasks SET parent_id=(SELECT parent.id FROM tasks parent WHERE parent.list_id=tasks.list_id AND parent.google_id=tasks.google_parent_id)
      WHERE list_id=? AND google_parent_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM outbox WHERE entity_id=tasks.id AND kind LIKE 'task.%' AND state IN ('pending','conflict')
      )`).run(localListId);
  }

  upsertGoogleEventBatch(events: readonly JsonRecord[], localCalendarId: string): void {
    this.db.transaction(() => { for (const event of events) this.upsertGoogleEvent(event, localCalendarId); })();
  }

  /** Called only after every page of an unfiltered full Calendar pull succeeds. */
  reconcileGoogleEvents(localCalendarId: string, remoteGoogleIds: ReadonlySet<string>): void {
    const cached = this.statement("SELECT id,google_id AS googleId FROM events WHERE calendar_id=? AND google_id IS NOT NULL")
      .all(localCalendarId) as Array<{ id: string; googleId: string }>;
    this.db.transaction(() => {
      for (const event of cached) {
        if (remoteGoogleIds.has(event.googleId) || this.hasPendingEntityMutation("event", event.id)) continue;
        this.removeGoogleEventCache(localCalendarId, event.googleId);
      }
      const cancellations = this.statement("SELECT google_id AS googleId FROM google_event_cancellations WHERE calendar_id=?")
        .all(localCalendarId) as Array<{ googleId: string }>;
      for (const cancellation of cancellations) {
        if (!remoteGoogleIds.has(cancellation.googleId)) {
          this.statement("DELETE FROM google_event_cancellations WHERE calendar_id=? AND google_id=?").run(localCalendarId, cancellation.googleId);
        }
      }
    })();
  }

  upsertGoogleCalendar(remote: JsonRecord, accountId: string): JsonRecord {
    const googleId = requiredText(remote.id, "Google calendar id");
    const title = requiredText(remote.summary ?? remote.title, "Google calendar title");
    const existing = this.statement("SELECT id FROM calendars WHERE account_id=? AND google_id=?").get(accountId, googleId) as { id: string } | undefined;
    const id = existing?.id ?? randomUUID();
    const now = timestamp();
    this.statement(`INSERT INTO calendars(id,account_id,title,color,time_zone,google_id,google_etag,access_role,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET title=excluded.title,color=excluded.color,google_id=excluded.google_id,
      time_zone=excluded.time_zone,google_etag=excluded.google_etag,access_role=excluded.access_role,updated_at=excluded.updated_at`)
      .run(id, accountId, title, remote.backgroundColor ?? remote.color ?? null, remote.timeZone ?? this.settings().defaultTimeZone,
        googleId, remote.etag ?? null, typeof remote.accessRole === "string" ? remote.accessRole : null, now, now);
    return this.googleCalendarForSync(id)!;
  }

  /**
   * The Calendar list is authoritative for a connected account. Once a
   * calendar disappears there, remove its local cache rather than leaving a
   * stale source selectable in the UI or eligible for later outbox delivery.
   */
  pruneGoogleCalendars(accountId: string, activeGoogleIds: readonly string[]): void {
    const activeIds = new Set(activeGoogleIds.filter((id) => typeof id === "string" && id.trim()).map((id) => id.trim()));
    const cached = this.statement("SELECT id,google_id AS googleId FROM calendars WHERE account_id=? AND google_id IS NOT NULL")
      .all(accountId) as Array<{ id: string; googleId: string }>;
    const removed = this.db.transaction(() => cached.filter((calendar) => {
      if (activeIds.has(calendar.googleId)) return false;
      const writes = this.statement(`SELECT id FROM outbox WHERE account_id=? AND kind LIKE 'event.%' AND state IN ('pending','conflict') AND (
        entity_id IN (SELECT id FROM events WHERE calendar_id=?) OR
        json_extract(payload_json,'$.calendarId')=? OR json_extract(payload_json,'$.sourceCalendarId')=? OR
        json_extract(payload_json,'$.destinationCalendarId')=?)`)
        .all(accountId, calendar.id, calendar.id, calendar.id, calendar.id) as Array<{ id: string }>;
      for (const write of writes) this.statement("UPDATE outbox SET state='conflict',last_error=?,updated_at=? WHERE id=? AND state='pending'")
        .run("This Google Calendar was removed. Local writes are preserved; move events to an available Calendar or cancel the queued writes.", timestamp(), write.id);
      return writes.length === 0;
    }))();
    if (removed.length === 0) return;

    const calendarIds = removed.map((calendar) => calendar.id);
    const googleIds = removed.map((calendar) => calendar.googleId);
    const placeholders = calendarIds.map(() => "?").join(",");
    const currentSettings = this.settings();
    const nextSettings = {
      ...currentSettings,
      selectedCalendarIds: stringArray(currentSettings.selectedCalendarIds).filter((id) => !calendarIds.includes(id))
    };

    this.db.transaction(() => {
      const eventIds = (this.statement(`SELECT id FROM events WHERE calendar_id IN (${placeholders})`).all(...calendarIds) as Array<{ id: string }>)
        .map((event) => event.id);
      const linkedEventIds = (this.statement(`SELECT DISTINCT calendar_event_id AS id FROM scheduled_task_blocks WHERE calendar_id IN (${placeholders})`)
        .all(...calendarIds) as Array<{ id: string }>).map((event) => event.id);
      for (const eventId of new Set([...eventIds, ...linkedEventIds])) this.unlinkScheduledTaskBlocks(eventId);
      this.statement(`DELETE FROM events WHERE calendar_id IN (${placeholders})`).run(...calendarIds);
      this.statement(`DELETE FROM calendars WHERE id IN (${placeholders})`).run(...calendarIds);
      for (const googleId of googleIds) {
        this.statement("DELETE FROM sync_meta WHERE key=?").run(`google-sync-token:${accountId}:events:${googleId}`);
      }
      for (const id of [...calendarIds, ...eventIds]) {
        this.statement("DELETE FROM undo_entries WHERE forward_json LIKE ? OR inverse_json LIKE ?")
          .run(`%${id}%`, `%${id}%`);
      }
      this.statement("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
        .run("app", JSON.stringify(nextSettings));
    })();
    this.nativeBridge?.applySettings?.(nextSettings);
  }

  upsertGoogleEvent(remote: JsonRecord, localCalendarId: string): JsonRecord | null {
    const googleId = requiredText(remote.id, "Google event id");
    const calendar = this.googleCalendarForSync(localCalendarId);
    if (!calendar) return null;
    const proposedClaim = remote.extendedProperties?.private?.hcbLocalEventId;
    const reservation = typeof proposedClaim === 'string' && proposedClaim.length <= 200
      ? this.googleOperationRecord(calendar.accountId, `event-creation:${proposedClaim}`)?.id : undefined;
    const claimedId = claimedLocalEventId(remote, reservation);
    if (this.googleDeletionPending('event', calendar.accountId, googleId, claimedId ?? undefined)) {
      // A closed tab may have lost the creation receipt after the user deleted
      // its optimistic row. Recover identity onto the tombstone, not a new row.
      if (claimedId) this.bindDeletionReceipt('event', claimedId, remote, { googleId: null, calendarGoogleId: calendar.googleId });
      return null;
    }
    let existing = this.statement("SELECT id FROM events WHERE calendar_id=? AND google_id=?").get(localCalendarId, googleId) as { id: string } | undefined;
    if (!existing && this.statement(`SELECT 1 FROM events event JOIN outbox mutation ON mutation.entity_id=event.id
      WHERE event.google_id=? AND mutation.kind='event.move' AND mutation.state IN ('pending','conflict')
      AND (json_extract(mutation.payload_json,'$.sourceCalendarId')=? OR json_extract(mutation.payload_json,'$.destinationCalendarId')=?) LIMIT 1`)
      .get(googleId, localCalendarId, localCalendarId)) return null;
    if (!existing && claimedId) {
      existing = this.statement(`SELECT event.id FROM events event JOIN calendars calendar ON calendar.id=event.calendar_id
        WHERE event.id=? AND calendar.account_id=? AND event.google_id IS NULL`).get(claimedId, calendar.accountId) as { id: string } | undefined;
      // A lost Calendar creation response can be recovered by its deterministic
      // ID. Bind identity only: queued local content must survive this pull.
      if (existing) {
        const event = this.googleEventForSync(existing.id)!;
        const first = this.statement("SELECT id FROM outbox WHERE entity_id=? AND kind IN ('event.create','event.update') AND state IN ('pending','conflict') ORDER BY rowid LIMIT 1")
          .get(existing.id) as { id: string } | undefined;
        if (first && event.calendarId !== localCalendarId) this.bindEventCreationLocation(existing.id, localCalendarId, event.calendarId, first.id);
        this.statement("UPDATE events SET google_id=?,google_etag=? WHERE id=?").run(googleId, remote.etag ?? null, existing.id);
      }
    }
    const localId = existing?.id ?? randomUUID();
    if (this.hasPendingEntityMutation("event", localId)) return null;
    if (remote.status === "cancelled") {
      this.db.transaction(() => {
        this.removeGoogleEventCache(localCalendarId, googleId);
        const originalStartAt = originalStartTimeFromGoogle(remote.originalStartTime);
        if (typeof remote.recurringEventId === "string" && originalStartAt) {
          // Google guarantees only id, recurringEventId, and originalStartTime
          // for cancelled exceptions. Retain them without inventing an event.
          this.statement(`INSERT INTO google_event_cancellations(calendar_id,google_id,recurring_event_id,original_start_at) VALUES(?,?,?,?)
            ON CONFLICT(calendar_id,google_id) DO UPDATE SET recurring_event_id=excluded.recurring_event_id,original_start_at=excluded.original_start_at`)
            .run(localCalendarId, googleId, remote.recurringEventId, originalStartAt);
        }
      })();
      return null;
    }
    const previous = existing ? this.requireEvent(localId) : null;
    const start = eventTimeFromGoogle(remote.start, "Event start");
    const end = eventTimeFromGoogle(remote.end, "Event end");
    const metadata = googleEventMetadata(remote);
    const now = timestamp();
    this.statement(`INSERT INTO events(id,calendar_id,title,description,starts_at,ends_at,all_day,completed,color_id,location,recurrence_json,google_recurrence_json,
      attendees_json,reminders_json,reminders_use_default,transparency,visibility,time_zone,google_id,google_etag,google_recurring_event_id,google_original_start_time,
      conference_json,conference_create_requested,attachments_json,attachments_managed,event_type,focus_time_properties_json,out_of_office_properties_json,
      working_location_properties_json,self_response_status,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET calendar_id=excluded.calendar_id,title=excluded.title,description=excluded.description,
      starts_at=excluded.starts_at,ends_at=excluded.ends_at,all_day=excluded.all_day,color_id=excluded.color_id,location=excluded.location,
      recurrence_json=excluded.recurrence_json,google_recurrence_json=excluded.google_recurrence_json,attendees_json=excluded.attendees_json,reminders_json=excluded.reminders_json,
      reminders_use_default=excluded.reminders_use_default,transparency=excluded.transparency,visibility=excluded.visibility,
      google_id=excluded.google_id,google_etag=excluded.google_etag,google_recurring_event_id=excluded.google_recurring_event_id,
      google_original_start_time=excluded.google_original_start_time,conference_json=excluded.conference_json,
      conference_create_requested=excluded.conference_create_requested,attachments_json=excluded.attachments_json,
      event_type=excluded.event_type,focus_time_properties_json=excluded.focus_time_properties_json,
      out_of_office_properties_json=excluded.out_of_office_properties_json,working_location_properties_json=excluded.working_location_properties_json,
      self_response_status=excluded.self_response_status,updated_at=excluded.updated_at`)
      .run(localId, localCalendarId, remote.summary ?? "Untitled event", remote.description ?? "", start.value, end.value,
        start.allDay ? 1 : 0, previous?.completed ? 1 : 0, remote.colorId ?? null, remote.location ?? null,
        JSON.stringify(recurrenceFromGoogle(googleRecurrenceLines(remote.recurrence))), JSON.stringify(googleRecurrenceLines(remote.recurrence)), JSON.stringify(remote.attendees ?? []),
        JSON.stringify(remote.reminders?.overrides ?? []), remote.reminders?.useDefault === false ? 0 : 1,
        remote.transparency ?? "opaque", remote.visibility ?? "default", remote.start?.timeZone ?? null,
        googleId, remote.etag ?? null, remote.recurringEventId ?? null,
        originalStartTimeFromGoogle(remote.originalStartTime),
        JSON.stringify(metadata.conference ?? null), 0, JSON.stringify(metadata.attachments ?? []), previous?.attachmentsManaged ? 1 : 0,
        metadata.eventType ?? "default", JSON.stringify(metadata.focusTimeProperties ?? null), JSON.stringify(metadata.outOfOfficeProperties ?? null),
        JSON.stringify(metadata.workingLocationProperties ?? null), metadata.selfResponseStatus ?? null, now, remote.updated ?? now);
    this.statement("DELETE FROM google_event_cancellations WHERE calendar_id=? AND google_id=?").run(localCalendarId, googleId);
    return this.requireEvent(localId);
  }

  /** Call inside a transaction; a deleted master also invalidates its exceptions. */
  private removeGoogleEventCache(localCalendarId: string, googleId: string): void {
    const events = this.statement(`SELECT id FROM events WHERE calendar_id=? AND google_id=?
      UNION SELECT id FROM events WHERE calendar_id=? AND google_recurring_event_id=?`)
      .all(localCalendarId, googleId, localCalendarId, googleId) as Array<{ id: string }>;
    for (const event of events) {
      if (this.hasPendingEntityMutation("event", event.id)) continue;
      this.unlinkScheduledTaskBlocks(event.id);
      this.statement("DELETE FROM events WHERE id=?").run(event.id);
    }
    this.statement("DELETE FROM google_event_cancellations WHERE calendar_id=? AND (google_id=? OR recurring_event_id=?)")
      .run(localCalendarId, googleId, googleId);
  }

  dispatch(namespace: string, action: string, input: JsonRecord = {}): any {
    if (namespace === "diagnostics") return this.dispatchOperation(namespace, action, input);
    return timed(`${namespace}.${action}`, "sqlite_query", () => this.dispatchOperation(namespace, action, input));
  }

  private dispatchOperation(namespace: string, action: string, input: JsonRecord): any {
    switch (`${namespace}.${action}`) {
      case "bootstrap.get":
        return this.bootstrap(input);
      case "tasks.listTaskLists":
        return this.page(this.taskLists(), input);
      case "tasks.list":
        return this.listTasks(input);
      case "tasks.context":
        return this.taskContext(input);
      case "tasks.board":
        return taskBoardPage(this.db, input, this.settings(), (row) => taskFromRow(row) as TaskSummary, (sql) => this.statement(sql));
      case "tasks.forCalendarRange":
        return this.listTasks({ ...input, summary: true, status: "all", parentId: null, dueStart: input.start, dueEnd: input.end });
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
        return this.setEventCompletion(input, true);
      case "calendar.reopen":
        return this.setEventCompletion(input, false);
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
      case "notes.createNoteList":
        return this.createNoteList(input);
      case "notes.renameNoteList":
        return this.renameNoteList(input);
      case "notes.deleteNoteList":
        return this.deleteNoteList(input);
      case "notes.linkSuggest":
        return { items: this.search(input.query ?? "", input.limit ?? 8).items };
      case "notes.legacyMigrationPreview":
        return this.legacyPseudoNotesMigrationPreview(input);
      case "notes.importLegacyPseudoNotes":
        return this.importLegacyPseudoNotes(input);
      case "tags.list":
        return this.page(this.tags(), input);
      case "tags.create":
        return this.createTag(input);
      case "tags.update":
        return this.updateTag(input);
      case "tags.delete":
        return this.deleteTag(input);
      case "search.count":
        return this.searchCount(input.query ?? "");
      case "search.resolveLinks":
        return this.resolveLinks(input);
      case "search.query":
        return this.search(input.query ?? "", input.limit ?? 30, input.domains);
      case "settings.get":
        return this.settings();
      case "settings.update":
        return this.updateSettings(input);
      case "settings.recoveryAction":
        if (input.action === "checkForUpdates" && this.nativeBridge?.checkForUpdates) {
          return this.nativeBridge.checkForUpdates().then((status) => {
            if (status.state === "error" || status.state === "unsupported") throw new CoreStoreError(status.message ?? "Update check could not complete.");
            return { completed: true, message: status.message ?? "Update check completed." };
          });
        }
        if (input.action === "resetOnboarding") {
          this.updateSettings({ onboardingStatus: "pending", setupCompletedAt: null });
          return { completed: true, message: "Setup assistant will open again." };
        }
        throw new CoreStoreError("This recovery action is not available.");
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
      case "native.planningData":
        return this.nativePlanningData(input);
      case "native.capabilities":
        return this.nativeCapabilities();
      case "native.listFontFamilies":
        return this.nativeBridge?.listFontFamilies() ?? { platform: (this.platform.platform ?? "web"), families: [] };
      case "native.requestNotificationPermission":
        return this.nativeBridge?.requestNotificationPermission() ?? { state: "unsupported" };
      case "native.openExternalUrl":
        return this.nativeBridge?.openExternalUrl({ url: requiredText(input.url, "External URL") }) ?? { opened: false };
      case "diagnostics.summary":
        return this.diagnostics();
      case "diagnostics.logs":
        return appLogger.snapshot(input);
      case "diagnostics.clearLogs":
        appLogger.clear();
        return { cleared: true, message: "Session logs cleared." };
      case "diagnostics.copyableSummary":
        return { text: JSON.stringify(this.diagnostics(), null, 2) };
      case "diagnostics.rescheduleNotifications":
        if (!this.nativeBridge?.rescheduleNotifications) throw new CoreStoreError("Notifications are not available in this runtime.");
        return this.nativeBridge.rescheduleNotifications();
      case "diagnostics.history":
        return { entries: this.mutationHistory(input) };
      case "diagnostics.pendingMutations":
        return { mutations: this.pendingMutationDiagnostics(input) };
      case "diagnostics.retryPendingMutation":
        return this.retryMutation(input);
      case "diagnostics.cancelPendingMutation":
        return this.cancelMutation(input);
      case "diagnostics.markShellVisible":
        return markStartupTiming("shellVisibleMs");
      case "diagnostics.markCachedDataRendered":
        return markStartupTiming("cachedDataRenderedMs");
      case "diagnostics.recordTiming":
        return { recorded: this.settings().diagnosticsIncludePerformance && recordTiming(input) };
      default:
        throw new CoreStoreError(`Unsupported restored UI operation: ${namespace}.${action}`);
    }
  }

  private migrate(): void {
    const migrationTable = this.statement("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get();
    const previousVersion = migrationTable
      ? Number((this.statement("SELECT MAX(version) AS version FROM schema_migrations").get() as { version?: number }).version ?? 0)
      : 0;
    const unrecognizedDatabase = !migrationTable && this.statement("SELECT 1 FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' LIMIT 1").get();
    if (unrecognizedDatabase || (migrationTable && (!Number.isInteger(previousVersion) || previousVersion < 3)) || previousVersion > schemaVersion) {
      throw new CoreStoreError(`Database schema ${previousVersion} is incompatible with this version. Your saved workspace has not been reset.`);
    }
    if (previousVersion === schemaVersion) {
      // Reopening a current snapshot must not rebuild indexes and manufacture
      // another durable revision. Other tabs reopen snapshots before requests.
      this.installFullTextSearch();
      return;
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
      CREATE TABLE IF NOT EXISTS google_event_cancellations (
        calendar_id TEXT NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
        google_id TEXT NOT NULL, recurring_event_id TEXT NOT NULL, original_start_at TEXT NOT NULL,
        PRIMARY KEY(calendar_id,google_id)
      );
      CREATE INDEX IF NOT EXISTS google_event_cancellations_series_idx ON google_event_cancellations(calendar_id,recurring_event_id,original_start_at);
      CREATE INDEX IF NOT EXISTS events_range_idx ON events(calendar_id, starts_at, ends_at);
      CREATE TABLE IF NOT EXISTS scheduled_task_blocks (
        id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id),
        calendar_event_id TEXT NOT NULL REFERENCES events(id), calendar_id TEXT NOT NULL REFERENCES calendars(id),
        starts_at TEXT NOT NULL, ends_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS scheduled_task_blocks_range_idx ON scheduled_task_blocks(calendar_id, starts_at, ends_at);
      CREATE INDEX IF NOT EXISTS scheduled_task_blocks_event_idx ON scheduled_task_blocks(calendar_event_id);
      CREATE TABLE IF NOT EXISTS notes (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', list_id TEXT,
        tags_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
      );
      DROP INDEX IF EXISTS notes_page_idx;
      CREATE INDEX IF NOT EXISTS notes_recent_page_idx ON notes(deleted_at, updated_at DESC, id);
      DROP INDEX IF EXISTS notes_list_page_idx;
      CREATE INDEX IF NOT EXISTS notes_list_recent_page_idx ON notes(list_id,deleted_at,updated_at DESC,id);
      CREATE INDEX IF NOT EXISTS notes_title_lookup_idx ON notes(title COLLATE NOCASE);
      CREATE INDEX IF NOT EXISTS tasks_title_lookup_idx ON tasks(title COLLATE NOCASE);
      CREATE INDEX IF NOT EXISTS events_title_lookup_idx ON events(title COLLATE NOCASE);
      CREATE TABLE IF NOT EXISTS note_lists (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS legacy_note_import_lists (
        source_task_list_id TEXT PRIMARY KEY,
        native_note_list_id TEXT NOT NULL REFERENCES note_lists(id),
        import_version INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS legacy_note_imports (
        source_type TEXT NOT NULL,
        source_task_id TEXT NOT NULL,
        source_task_list_id TEXT NOT NULL,
        source_google_task_id TEXT,
        source_google_task_list_id TEXT,
        native_note_id TEXT NOT NULL REFERENCES notes(id),
        import_version INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY(source_type,source_task_id),
        UNIQUE(native_note_id)
      );
      CREATE INDEX IF NOT EXISTS legacy_note_imports_source_list_idx ON legacy_note_imports(source_task_list_id);
      CREATE TABLE IF NOT EXISTS tags (
        id TEXT PRIMARY KEY, title TEXT NOT NULL UNIQUE, color TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS outbox (
        id TEXT PRIMARY KEY, account_id TEXT, kind TEXT NOT NULL, entity_id TEXT NOT NULL, payload_json TEXT NOT NULL,
        state TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS outbox_delivery_idx ON outbox(state, next_attempt_at, id);
      CREATE INDEX IF NOT EXISTS outbox_unresolved_account_idx ON outbox(account_id) WHERE state IN ('pending','conflict');
      CREATE INDEX IF NOT EXISTS outbox_unresolved_entity_idx ON outbox(entity_id) WHERE state IN ('pending','conflict');
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
    this.addColumn("calendars", "access_role TEXT");
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
    this.addColumn("events", "hcb_kind TEXT");
    this.addColumn("events", "tags_json TEXT NOT NULL DEFAULT '[]'");
    this.addColumn("events", "focus_time_properties_json TEXT");
    this.addColumn("events", "out_of_office_properties_json TEXT");
    this.addColumn("events", "working_location_properties_json TEXT");
    this.addColumn("events", "self_response_status TEXT");
    this.addColumn("events", "google_recurrence_json TEXT");
    this.addColumn("notes", "tags_json TEXT NOT NULL DEFAULT '[]'");
    this.backfillCanonicalRecurrenceLines();
    this.addColumn("outbox", "account_id TEXT");
    this.addColumn("outbox", "last_error TEXT");
    this.addColumn("outbox", "creation_started INTEGER NOT NULL DEFAULT 0");
    this.db.exec(`
      DROP INDEX IF EXISTS task_lists_google_id_idx; DROP INDEX IF EXISTS tasks_google_id_idx; DROP INDEX IF EXISTS tasks_google_list_id_idx;
      DROP INDEX IF EXISTS calendars_google_id_idx; DROP INDEX IF EXISTS events_google_id_idx;
      CREATE UNIQUE INDEX IF NOT EXISTS task_lists_google_account_id_idx ON task_lists(account_id,google_id) WHERE google_id IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS tasks_google_list_id_idx ON tasks(list_id,google_id) WHERE google_id IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS calendars_google_account_id_idx ON calendars(account_id,google_id) WHERE google_id IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS events_google_calendar_id_idx ON events(calendar_id,google_id) WHERE google_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS events_google_recurring_calendar_idx ON events(calendar_id,google_recurring_event_id) WHERE google_recurring_event_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS tasks_order_idx ON tasks((due_at IS NULL),due_at,sort_order,title COLLATE NOCASE,id,status);
      CREATE INDEX IF NOT EXISTS tasks_parent_idx ON tasks(parent_id,status,sort_order,id);
    `);
    this.installFullTextSearch();
    if (previousVersion >= 3 && previousVersion < 9) {
      // Earlier versions discarded cancelled instances while advancing these
      // tokens. Rebuild that missing cache once without disturbing Tasks or writes.
      this.statement("DELETE FROM sync_meta WHERE key LIKE 'google-sync-token:%:events:%'").run();
    }
    this.statement("INSERT OR IGNORE INTO sync_meta(key,value) VALUES('legacy-note-prompt-eligible',?)").run(previousVersion >= 3 ? "true" : "false");
    this.statement("INSERT OR IGNORE INTO schema_migrations(version) VALUES (?)").run(schemaVersion);
  }

  private addColumn(table: "google_accounts" | "task_lists" | "tasks" | "calendars" | "events" | "notes" | "outbox", definition: string): void {
    const column = definition.split(/\s+/, 1)[0];
    const columns = this.statement(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!columns.some((item) => item.name === column)) {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
    }
  }

  /**
   * `google_recurrence_json` is the canonical recurrence representation. The
   * older structured JSON is retained as a projection for the existing quick
   * controls and older renderer clients, but is never the source of a Google
   * Calendar write once canonical lines have been established.
   */
  private backfillCanonicalRecurrenceLines(): void {
    const rows = this.statement(`SELECT id,recurrence_json AS recurrence,google_recurrence_json AS googleRecurrence
      FROM events WHERE google_recurrence_json IS NULL AND recurrence_json IS NOT NULL`).all() as JsonRecord[];
    const update = this.statement("UPDATE events SET google_recurrence_json=? WHERE id=?");
    for (const row of rows) {
      const lines = recurrenceLinesFromStored(null, safeJson(row.recurrence, null));
      if (lines) update.run(JSON.stringify(lines), row.id);
    }
  }

  private installFullTextSearch(): void {
    try {
      const version = this.statement("SELECT value FROM sync_meta WHERE key='search-index-version'").get() as { value?: string } | undefined;
      if (!["2", "3"].includes(version?.value ?? "")) {
        this.db.transaction(() => {
          this.db.exec(`CREATE TABLE IF NOT EXISTS search_documents (
            id INTEGER PRIMARY KEY, domain TEXT NOT NULL, entity_id TEXT NOT NULL, UNIQUE(domain,entity_id)
          );
          CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(domain UNINDEXED, entity_id UNINDEXED, title, body);`);
          for (const table of ["tasks", "events", "notes"]) {
            for (const action of ["insert", "update", "delete"]) this.db.exec(`DROP TRIGGER IF EXISTS search_${table}_${action}`);
          }
          this.db.exec("DELETE FROM search_index; DELETE FROM search_documents;");
          const sources = [
            { table: "tasks", domain: "tasks", body: "notes", predicate: "status != 'deleted'" },
            { table: "events", domain: "calendar", body: "description", predicate: "1=1" },
            { table: "notes", domain: "notes", body: "body", predicate: "deleted_at IS NULL" }
          ];
          for (const { table, domain, body, predicate } of sources) {
            const live = predicate === "1=1" ? "1=1" : `new.${predicate}`;
            const insert = `INSERT INTO search_documents(domain,entity_id) VALUES('${domain}',new.id) ON CONFLICT(domain,entity_id) DO NOTHING;
              INSERT INTO search_index(rowid,domain,entity_id,title,body)
              SELECT id,'${domain}',new.id,new.title,new.${body} FROM search_documents WHERE domain='${domain}' AND entity_id=new.id AND ${live};`;
            const remove = `DELETE FROM search_index WHERE rowid=(SELECT id FROM search_documents WHERE domain='${domain}' AND entity_id=old.id);`;
            this.db.exec(`
              CREATE TRIGGER search_${table}_insert AFTER INSERT ON ${table} BEGIN ${insert} END;
              CREATE TRIGGER search_${table}_update AFTER UPDATE ON ${table} BEGIN ${remove} ${insert} END;
              CREATE TRIGGER search_${table}_delete AFTER DELETE ON ${table} BEGIN ${remove} DELETE FROM search_documents WHERE domain='${domain}' AND entity_id=old.id; END;
              INSERT INTO search_documents(domain,entity_id) SELECT '${domain}',id FROM ${table};
              INSERT INTO search_index(rowid,domain,entity_id,title,body)
              SELECT document.id,'${domain}',source.id,source.title,source.${body} FROM ${table} source
              JOIN search_documents document ON document.domain='${domain}' AND document.entity_id=source.id WHERE ${predicate === "1=1" ? predicate : `source.${predicate}`};
            `);
          }
          this.statement("INSERT INTO sync_meta(key,value) VALUES('search-index-version','2') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run();
        })();
      }
      if (version?.value !== "3") {
        this.db.transaction(() => {
          for (const { table, domain, body, live, changed } of [
            { table: "tasks", domain: "tasks", body: "notes", live: "new.status != 'deleted'", changed: "old.status IS NOT new.status" },
            { table: "events", domain: "calendar", body: "description", live: "1=1", changed: "0" },
            { table: "notes", domain: "notes", body: "body", live: "new.deleted_at IS NULL", changed: "old.deleted_at IS NOT new.deleted_at" }
          ]) {
            this.db.exec(`DROP TRIGGER IF EXISTS search_${table}_update;
              CREATE TRIGGER search_${table}_update AFTER UPDATE ON ${table}
              WHEN old.title IS NOT new.title OR old.${body} IS NOT new.${body} OR ${changed}
              BEGIN
                DELETE FROM search_index WHERE rowid=(SELECT id FROM search_documents WHERE domain='${domain}' AND entity_id=old.id);
                INSERT INTO search_documents(domain,entity_id) VALUES('${domain}',new.id) ON CONFLICT(domain,entity_id) DO NOTHING;
                INSERT INTO search_index(rowid,domain,entity_id,title,body)
                  SELECT id,'${domain}',new.id,new.title,new.${body} FROM search_documents WHERE domain='${domain}' AND entity_id=new.id AND ${live};
              END;`);
          }
          this.statement("INSERT INTO sync_meta(key,value) VALUES('search-index-version','3') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run();
        })();
      }
      // A version marker alone cannot prove the index still exists or is readable.
      this.statement("SELECT rowid FROM search_index WHERE search_index MATCH ? LIMIT 1").get("hcbstartupvalidation");
      this.fullTextSearchAvailable = true;
    } catch (error) {
      this.fullTextSearchAvailable = false;
      throw new CoreStoreError(`The full-text search index could not be initialized. Your saved workspace has not been reset. ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private seed(): void {
    const now = timestamp();
    const browserLocal = this.platform.platform === "web";
    const localFallbackRetired = Boolean(this.statement("SELECT 1 FROM sync_meta WHERE key=?").get("local-fallback-retired"));
    const connectedGoogle = Boolean(this.statement("SELECT 1 FROM google_accounts WHERE id != ? AND connection_state='connected' LIMIT 1").get(localAccountId));
    const transaction = this.db.transaction(() => {
      if (!this.statement("SELECT 1 FROM settings WHERE key = ?").get("app")) {
        this.statement("INSERT INTO settings(key, value) VALUES (?, ?)").run("app", JSON.stringify(defaultSettings));
      }
      if (!this.statement("SELECT 1 FROM note_lists LIMIT 1").get()) {
        this.statement("INSERT INTO note_lists(id,title,created_at,updated_at) VALUES(?,?,?,?)")
          .run("notes", "Notes", now, now);
      }
      this.statement("UPDATE notes SET list_id='notes' WHERE list_id IS NULL").run();
      if (browserLocal || (!localFallbackRetired && !connectedGoogle)) {
        this.statement(`INSERT OR IGNORE INTO google_accounts(id,google_account_id,email,display_name,connection_state,missing_scopes_json,granted_scopes_json,created_at,updated_at)
          VALUES(?,?,?,?,?,?,?,?,?)`).run(localAccountId, "local", null, "Local workspace", "local", "[]", "[]", now, now);
        if (!this.statement(browserLocal ? "SELECT 1 FROM task_lists WHERE account_id='local' LIMIT 1" : "SELECT 1 FROM task_lists LIMIT 1").get()) {
          this.statement("INSERT INTO task_lists(id, account_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(this.statement("SELECT 1 FROM task_lists WHERE id='inbox'").get() ? randomUUID() : "inbox", localAccountId, "Inbox", now, now);
        }
        if (!this.statement(browserLocal ? "SELECT 1 FROM calendars WHERE account_id='local' LIMIT 1" : "SELECT 1 FROM calendars LIMIT 1").get()) {
          this.statement("INSERT INTO calendars(id, account_id, title, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run(this.statement("SELECT 1 FROM calendars WHERE id='primary'").get() ? randomUUID() : "primary", localAccountId, "Primary", "#4285f4", now, now);
        }
      }
    });
    transaction();
    // A connected Google account must never turn reopening a local workspace
    // into deletion of local tasks, calendar events, or their undo history.
  }

  private bootstrap(input: JsonRecord): JsonRecord {
    const settings = this.settings();
    const calendarRange = input.calendarRange?.start && input.calendarRange?.end ? input.calendarRange : zonedDayRange(currentZonedDay(settings.defaultTimeZone), settings.defaultTimeZone);
    const taskLists = this.taskLists(), calendars = this.calendars(), tags = this.tags();
    return {
      calendarRange,
      taskLists: { items: taskLists, page: { limit: taskLists.length, totalKnown: taskLists.length } },
      tasks: this.listTasks({ status: "all", limit: 100, summary: true }),
      hiddenTasks: { items: [], page: { limit: 100, totalKnown: 0 } },
      deletedTasks: { items: [], page: { limit: 100, totalKnown: 0 } },
      calendarTasks: calendarRange.start && calendarRange.end ? this.listTasks({ status: "all", parentId: null, limit: 500, summary: true, dueStart: calendarRange.start, dueEnd: calendarRange.end }) : { items: [], page: { limit: 500, totalKnown: 0 } },
      calendars: { items: calendars, page: { limit: calendars.length, totalKnown: calendars.length } },
      events: this.listEvents({ ...calendarRange, summary: true, limit: calendarRange.limit ?? 500 }),
      scheduledTaskBlocks: this.listScheduledTaskBlocks({ ...calendarRange, limit: 500 }),
      notes: this.listNotes({ limit: 50, summary: true }),
      tags: { items: tags, page: { limit: tags.length, totalKnown: tags.length } },
      settings,
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
    return (this.statement(`
      SELECT list.id, list.account_id AS accountId, list.title, list.updated_at AS updatedAt,
        COUNT(task.id) AS taskCount,
        SUM(CASE WHEN task.status = 'active' THEN 1 ELSE 0 END) AS activeTaskCount,
        SUM(CASE WHEN task.status='active' AND task.parent_id IS NULL THEN 1 ELSE 0 END) AS activeRootTaskCount,
        SUM(CASE WHEN task.status='active' AND task.parent_id IS NULL AND task.id IN (SELECT value FROM json_each(?)) THEN 1 ELSE 0 END) AS starredRootTaskCount
      FROM task_lists list LEFT JOIN tasks task ON task.list_id = list.id
      GROUP BY list.id ORDER BY list.title COLLATE NOCASE
    `).all(JSON.stringify(this.settings().starredTaskIds ?? [])) as any[]).map((row) => ({ ...row, taskCount: Number(row.taskCount), activeTaskCount: Number(row.activeTaskCount), activeRootTaskCount: Number(row.activeRootTaskCount), starredRootTaskCount: Number(row.starredRootTaskCount) }));
  }

  private listTasks(input: JsonRecord): JsonRecord {
    const requestedStatus = input.status ?? "all";
    const statuses = requestedStatus === "all" ? ["active", "completed"] : [requestedStatus];
    const { limit, offset } = this.pageBounds(input);
    const conditions = [`task.status IN (${statuses.map(() => "?").join(",")})`];
    const values: any[] = [...statuses];
    if (typeof input.listId === "string") { conditions.push("task.list_id=?"); values.push(input.listId); }
    if (input.parentId === null) conditions.push("task.parent_id IS NULL");
    else if (typeof input.parentId === "string") { conditions.push("task.parent_id=?"); values.push(input.parentId); }
    if (typeof input.query === "string" && input.query.trim()) { conditions.push("task.title LIKE ? ESCAPE '\\'"); values.push(`%${input.query.trim().slice(0, 200).replace(/[\\%_]/g, "\\$&")}%`); }
    if (typeof input.dueStart === "string" && typeof input.dueEnd === "string") {
      // Date-only Tasks and zoned Calendar windows can straddle UTC days.
      conditions.push("task.due_at>=? AND task.due_at<?");
      values.push(new Date(Date.parse(input.dueStart) - 86400_000).toISOString().slice(0, 10), new Date(Date.parse(input.dueEnd) + 86400_000).toISOString().slice(0, 10));
    }
    const where = conditions.join(" AND ");
    const total = Number((this.statement(`SELECT COUNT(*) AS count FROM tasks task WHERE ${where}`).get(...values) as { count: number }).count);
    const rows = this.statement(`
      SELECT task.id, list.account_id AS accountId, task.list_id AS listId, task.title, ${input.summary ? "substr(task.notes,1,240) AS notes" : "task.notes"}, task.status, task.priority, task.due_at AS dueAt,
        parent_id AS parentId,(SELECT title FROM tasks parent WHERE parent.id=task.parent_id) AS parentTitle, planned_start AS plannedStart, planned_end AS plannedEnd,
        duration_minutes AS durationMinutes, locked_schedule AS lockedSchedule,
        snooze_until AS snoozeUntil, tags_json AS tags, sort_order AS sortOrder, task.updated_at AS updatedAt
      FROM tasks task JOIN task_lists list ON list.id=task.list_id WHERE ${where}
      ORDER BY CASE WHEN task.due_at IS NULL THEN 1 ELSE 0 END, task.due_at, task.sort_order, task.title COLLATE NOCASE, task.id
      LIMIT ? OFFSET ?
    `).all(...values, limit, offset) as any[];
    return { items: rows.map(taskFromRow), page: this.pageMetadata(limit, offset, total) };
  }

  private requireTask(id: string): JsonRecord {
    const row = this.statement(`SELECT task.id, list.account_id AS accountId, task.list_id AS listId, task.title, task.notes, task.status, task.priority, task.due_at AS dueAt,
      task.parent_id AS parentId,(SELECT title FROM tasks parent WHERE parent.id=task.parent_id) AS parentTitle, task.planned_start AS plannedStart, task.planned_end AS plannedEnd, task.duration_minutes AS durationMinutes,
      task.locked_schedule AS lockedSchedule, task.snooze_until AS snoozeUntil, task.tags_json AS tags, task.sort_order AS sortOrder, task.updated_at AS updatedAt
      FROM tasks task JOIN task_lists list ON list.id=task.list_id WHERE task.id = ?`).get(id);
    if (!row) throw new CoreStoreError("Task no longer exists");
    return taskFromRow(row);
  }

  private validateTaskParent(taskId: string, listId: string, parentId: unknown): void {
    if (!parentId) return;
    if (parentId === taskId) throw new CoreStoreError("A task cannot be its own parent.");
    const parent = this.statement("SELECT list_id AS listId,parent_id AS parentId,status FROM tasks WHERE id=?").get(parentId) as JsonRecord | undefined;
    if (!parent || !["active", "completed"].includes(parent.status)) throw new CoreStoreError("Choose an existing parent task.");
    if (parent.listId !== listId) throw new CoreStoreError("The parent task must be in the same list.");
    if (parent.parentId) throw new CoreStoreError("Subtasks cannot have children. Choose a top-level parent task.");
    if (this.statement("SELECT 1 FROM tasks WHERE parent_id=? AND status IN ('active','completed') LIMIT 1").get(taskId)) {
      throw new CoreStoreError("Move this task's subtasks first; nesting them another level would hide them.");
    }
  }

  private createTask(input: JsonRecord): JsonRecord {
    const now = timestamp();
    const id = typeof input.id === "string" ? input.id : randomUUID();
    const listId = input.listId ?? this.defaultWritableTaskListId();
    this.requireList(listId);
    this.validateTaskParent(id, listId, input.parentId);
    this.db.transaction(() => {
      this.statement(`INSERT INTO tasks(id,list_id,title,notes,status,priority,due_at,parent_id,planned_start,planned_end,duration_minutes,locked_schedule,snooze_until,tags_json,created_at,updated_at)
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
    if (input.previousTaskId === undefined && input.previousSiblingId !== undefined) input = { ...input, previousTaskId: input.previousSiblingId };
    const previous = this.requireTask(requiredText(input.id, "Task id"));
    const nextListId = input.listId ?? previous.listId;
    const nextAccountId = this.accountForTaskList(nextListId);
    if (nextAccountId !== previous.accountId) throw new CoreStoreError("Tasks cannot be moved between Google accounts.");
    this.validateTaskParent(previous.id, nextListId, input.parentId === undefined ? previous.parentId : input.parentId);
    if ((nextListId !== previous.listId || input.status === "deleted") && this.statement("SELECT 1 FROM tasks WHERE parent_id=? AND status IN ('active','completed') LIMIT 1").get(previous.id)) {
      throw new CoreStoreError("Move or delete this task's subtasks first so they remain visible in their list.");
    }
    const now = timestamp();
    this.db.transaction(() => {
      this.statement(`UPDATE tasks SET list_id=?, title=?, notes=?, status=?, priority=?, due_at=?, parent_id=?, planned_start=?, planned_end=?,
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
    return { ...task, previousState: { id: previous.id, listId: previous.listId, parentId: previous.parentId, status: previous.status } };
  }

  private bulkReschedule(input: JsonRecord): JsonRecord {
    const selected = input.taskIds ?? input.ids;
    const ids = Array.isArray(selected) ? [...new Set(selected.filter((id): id is string => typeof id === "string"))] : [];
    if (ids.length === 0 || ids.length > 500) throw new CoreStoreError("Select between 1 and 500 tasks to reschedule.");
    const transaction = this.db.transaction(() => ids.map((id) => this.updateTask({ id, dueDate: input.dueDate })));
    return { items: transaction() };
  }

  private createTaskList(input: JsonRecord): JsonRecord {
    const now = timestamp();
    const accountId = typeof input.accountId === "string" ? input.accountId : this.defaultWritableAccountId();
    const item = { id: randomUUID(), accountId, title: requiredText(input.title, "List title"), updatedAt: now, taskCount: 0, activeTaskCount: 0 };
    this.statement("INSERT INTO task_lists(id,account_id,title,created_at,updated_at) VALUES (?,?,?,?,?)").run(item.id, accountId, item.title, now, now);
    this.enqueue("taskList.create", item.id, {}, accountId);
    return item;
  }

  private renameTaskList(input: JsonRecord): JsonRecord {
    const id = requiredText(input.id, "List id");
    const now = timestamp();
    const result = this.statement("UPDATE task_lists SET title=?, updated_at=? WHERE id=?").run(requiredText(input.title, "List title"), now, id);
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
        const deletedTasks = (this.statement("SELECT id FROM tasks WHERE list_id=?").all(id) as Array<{ id: string }>).map((task) => this.googleTaskForSync(task.id)!);
        const blockEvents = this.statement(`SELECT event.id FROM events event JOIN scheduled_task_blocks block ON block.calendar_event_id=event.id
          WHERE block.task_id IN (SELECT id FROM tasks WHERE list_id=?)`).all(id) as Array<{ id: string }>;
        for (const event of blockEvents) this.deleteEvent({ id: event.id }, { relatedTaskListId: id });
        this.statement("DELETE FROM scheduled_task_blocks WHERE task_id IN (SELECT id FROM tasks WHERE list_id=?)").run(id);
        this.statement("DELETE FROM tasks WHERE list_id=?").run(id);
        this.statement("DELETE FROM task_lists WHERE id=?").run(id);
        this.enqueue("taskList.delete", id, { ...previous, deletedTasks }, previous.accountId);
        return;
      }
      const tasks = this.statement("SELECT id FROM tasks WHERE list_id=?").all(id) as Array<{ id: string }>;
      this.statement("UPDATE tasks SET list_id='inbox', updated_at=? WHERE list_id=?").run(timestamp(), id);
      const destinationAccountId = this.accountForTaskList("inbox");
      for (const task of tasks) this.enqueue("task.update", task.id, {}, destinationAccountId);
      this.statement("DELETE FROM task_lists WHERE id=?").run(id);
      this.enqueue("taskList.delete", id, previous ?? {}, previous?.accountId ?? null);
    })();
    return { id, deleted: true };
  }

  private calendars(): JsonRecord[] {
    const selectedCalendars = new Set(this.settings().selectedCalendarIds);
    return this.statement(`SELECT calendar.id,calendar.account_id AS accountId,calendar.title,calendar.color,calendar.time_zone AS timeZone,calendar.updated_at AS updatedAt,calendar.access_role AS accessRole,
      (SELECT COUNT(*) FROM events WHERE events.calendar_id = calendar.id) AS eventCount
      FROM calendars AS calendar ORDER BY calendar.title COLLATE NOCASE`).all().map((calendar: any) => ({
      ...calendar,
      canWrite: calendarCanWrite(calendar),
      writeRestriction: calendarCanWrite(calendar) ? null : calendarWriteRestriction(calendar),
      selected: selectedCalendars.size === 0 || selectedCalendars.has(calendar.id),
      timeZone: calendar.timeZone ?? this.settings().defaultTimeZone,
      backgroundColor: calendar.color,
      foregroundColor: "#ffffff"
    })) as JsonRecord[];
  }

  private listEvents(input: JsonRecord): JsonRecord {
    // Callers without a date window (diagnostics, export, and live-test
    // cleanup) need stored resources, not an effectively unbounded expansion
    // of every recurring series. Calendar views always supply a window.
    const projectRecurrence = typeof input.start === "string" && typeof input.end === "string";
    const start = input.start ?? "0000-01-01T00:00:00.000Z";
    const end = input.end ?? "9999-12-31T23:59:59.999Z";
    const revision = Number((this.statement("SELECT total_changes() AS revision").get() as { revision: number }).revision);
    if (revision !== this.eventRangeCacheRevision) {
      this.eventRangeCache.clear();
      this.eventRangeCacheRevision = revision;
    }
    const cacheKey = JSON.stringify([start, end, projectRecurrence, Boolean(input.summary)]);
    const cached = this.eventRangeCache.get(cacheKey);
    if (cached) return this.page(cached, input);
    const rows = this.statement(`SELECT event.id,calendar.account_id AS accountId,event.calendar_id AS calendarId,event.title,${input.summary ? "substr(event.description,1,240)" : "event.description"} AS description,${input.summary ? "length(event.description)>240" : "0"} AS detailsTruncated,event.starts_at AS startsAt,event.ends_at AS endsAt,
      all_day AS allDay,completed,color_id AS colorId,location,recurrence_json AS recurrence,google_recurrence_json AS googleRecurrence,
      attendees_json AS attendees,reminders_json AS reminders,reminders_use_default AS remindersUseDefault,
      transparency,visibility,event.time_zone AS timeZone,event.google_id AS googleId,event.google_recurring_event_id AS recurringEventId,
      event.google_original_start_time AS originalStartAt,event.conference_json AS conference,event.attachments_json AS attachments,
      event.hcb_kind AS hcbKind,event.tags_json AS tags,event.event_type AS eventType,event.focus_time_properties_json AS focusTimeProperties,
      event.out_of_office_properties_json AS outOfOfficeProperties,event.working_location_properties_json AS workingLocationProperties,
      event.self_response_status AS selfResponseStatus,event.updated_at AS updatedAt,
      block.task_id AS scheduledTaskId,task.status AS scheduledTaskStatus,task.updated_at AS scheduledTaskUpdatedAt,calendar.access_role AS accessRole,
      ${eventMutationStateSql} AS mutationState
      FROM events event JOIN calendars calendar ON calendar.id=event.calendar_id
      LEFT JOIN scheduled_task_blocks block ON block.calendar_event_id=event.id LEFT JOIN tasks task ON task.id=block.task_id
      WHERE (event.starts_at < ? AND event.ends_at > ?)
        OR (event.google_recurrence_json IS NOT NULL AND event.google_recurrence_json != 'null')
        OR event.google_recurring_event_id IS NOT NULL
      ORDER BY event.starts_at,event.id`).all(end, start);
    const records = (rows as any[]).map(eventFromRow);
    const masters = projectRecurrence
      ? records.filter((event) => (event.recurrenceLines?.length ?? 0) > 0 && !event.recurringEventId)
      : [];
    const exceptions = records.filter((event) => Boolean(event.recurringEventId));
    const exceptionOriginalStarts = new Map<string, Set<string>>();
    for (const exception of exceptions) {
      const key = JSON.stringify([exception.calendarId, exception.recurringEventId]);
      const starts = exceptionOriginalStarts.get(key) ?? new Set<string>();
      if (typeof exception.originalStartAt === "string") starts.add(exception.originalStartAt);
      exceptionOriginalStarts.set(key, starts);
    }
    const virtualOccurrences = masters.flatMap((master) => {
      const excluded = exceptionOriginalStarts.get(JSON.stringify([master.calendarId, master.googleId ?? master.id])) ?? new Set<string>();
      const cancellations = this.statement(`SELECT original_start_at AS originalStartAt FROM google_event_cancellations
        WHERE calendar_id=? AND recurring_event_id=?`).all(master.calendarId, master.googleId ?? master.id) as Array<{ originalStartAt: string }>;
      for (const cancellation of cancellations) excluded.add(cancellation.originalStartAt);
      return expandGoogleRecurrenceLines({
        allDay: Boolean(master.allDay),
        endsAt: master.endsAt,
        lines: master.recurrenceLines,
        rangeEnd: end,
        rangeStart: start,
        startsAt: master.startsAt,
        timeZone: master.timeZone
      })
        .filter((occurrence) => !excluded.has(occurrence.originalStartAt))
        .map((occurrence) => ({
          ...master,
          id: `recurrence:${master.id}:${occurrence.originalStartAt}`,
          eventId: master.id,
          recurringEventId: master.googleId ?? master.id,
          originalStartAt: occurrence.originalStartAt,
          startsAt: occurrence.startsAt,
          endsAt: occurrence.endsAt
        }));
    });
    const ordinary = records.filter((event) => {
      if (projectRecurrence && (event.recurrenceLines?.length ?? 0) > 0 && !event.recurringEventId) return false;
      return event.startsAt < end && event.endsAt > start;
    });
    const projected = [...ordinary, ...virtualOccurrences].sort((left, right) =>
      left.startsAt.localeCompare(right.startsAt) || left.id.localeCompare(right.id)
    );
    this.eventRangeCache.set(cacheKey, projected);
    if (this.eventRangeCache.size > 3) this.eventRangeCache.delete(this.eventRangeCache.keys().next().value!);
    return this.page(projected, input);
  }

  private requireEvent(id: string): JsonRecord {
    const row = this.statement(`SELECT event.id,calendar.account_id AS accountId,event.calendar_id AS calendarId,event.title,event.description,event.starts_at AS startsAt,event.ends_at AS endsAt,
      all_day AS allDay,completed,color_id AS colorId,location,recurrence_json AS recurrence,google_recurrence_json AS googleRecurrence,
      attendees_json AS attendees,reminders_json AS reminders,reminders_use_default AS remindersUseDefault,
      event.transparency,event.visibility,event.time_zone AS timeZone,event.google_id AS googleId,event.google_recurring_event_id AS googleRecurringEventId,
      event.google_original_start_time AS googleOriginalStartTime,event.conference_json AS conference,event.attachments_json AS attachments,
      event.hcb_kind AS hcbKind,event.tags_json AS tags,event.event_type AS eventType,event.focus_time_properties_json AS focusTimeProperties,
      event.out_of_office_properties_json AS outOfOfficeProperties,event.working_location_properties_json AS workingLocationProperties,
      event.self_response_status AS selfResponseStatus,event.updated_at AS updatedAt,
      block.task_id AS scheduledTaskId,task.status AS scheduledTaskStatus,task.updated_at AS scheduledTaskUpdatedAt,calendar.access_role AS accessRole,
      ${eventMutationStateSql} AS mutationState
      FROM events event JOIN calendars calendar ON calendar.id=event.calendar_id
      LEFT JOIN scheduled_task_blocks block ON block.calendar_event_id=event.id LEFT JOIN tasks task ON task.id=block.task_id WHERE event.id=?`).get(id);
    if (!row) throw new CoreStoreError("Calendar event no longer exists");
    return eventFromRow(row);
  }

  private setEventCompletion(input: JsonRecord, completed: boolean): JsonRecord {
    const event = this.requireEvent(requiredText(input.id, "Event id"));
    if (!event.scheduledTaskId) return this.updateEvent({ ...input, completed });
    // A scheduled block represents its task. Use the task's existing outbox and
    // undo operation; every block derives completion from that one task record.
    this.updateTask({ id: event.scheduledTaskId, status: completed ? "completed" : "active" });
    return this.requireEvent(event.id);
  }

  private createEvent(input: JsonRecord, options: EventWriteOptions = {}): JsonRecord {
    const now = timestamp();
    const id = typeof input.id === "string" ? input.id : randomUUID();
    const calendarId = input.calendarId ?? this.defaultWritableCalendarId();
    if (!this.statement("SELECT 1 FROM calendars WHERE id=?").get(calendarId)) throw new CoreStoreError("Calendar no longer exists");
    this.assertCalendarWritable(calendarId);
    const eventType = normalizedEventType(input.eventType);
    this.assertStatusEventCalendar(calendarId, eventType);
    const statusProperties = normalizedStatusEventProperties(eventType, input);
    const recurrenceLines = recurrenceLinesForInput(input);
    const recurrence = recurrenceFromGoogle(recurrenceLines);
    const timeZone = normalizedCalendarEventTimeZone(input.timeZone, this.calendarTimeZone(calendarId));
    this.db.transaction(() => {
      this.statement(`INSERT INTO events(id,calendar_id,title,description,starts_at,ends_at,all_day,completed,color_id,location,recurrence_json,google_recurrence_json,
        attendees_json,reminders_json,reminders_use_default,transparency,visibility,time_zone,conference_json,conference_create_requested,
        attachments_json,attachments_managed,event_type,focus_time_properties_json,out_of_office_properties_json,working_location_properties_json,
        self_response_status,created_at,updated_at,hcb_kind,tags_json)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        id, calendarId, requiredText(input.title, "Event title"), stringValue(input.description ?? input.notes), requiredText(input.startsAt, "Event start"),
        requiredText(input.endsAt, "Event end"), input.allDay ? 1 : 0, 0, input.colorId ?? null, input.location ?? null,
        JSON.stringify(recurrence), JSON.stringify(recurrenceLines), JSON.stringify(input.attendees ?? input.guestEmails ?? []),
        JSON.stringify(input.reminders ?? []), input.remindersUseDefault === false ? 0 : 1,
        statusEventTransparency(eventType, input.transparency), statusEventVisibility(eventType, input.visibility), timeZone,
        JSON.stringify(null), input.conferenceCreateRequest ? 1 : 0,
        JSON.stringify(normalizeCalendarAttachments(input.attachments)), Object.hasOwn(input, "attachments") ? 1 : 0,
        eventType, JSON.stringify(statusProperties.focusTimeProperties), JSON.stringify(statusProperties.outOfOfficeProperties),
        JSON.stringify(statusProperties.workingLocationProperties), normalizedResponseStatus(input.selfResponseStatus), now, now,
        input.hcbKind === "birthday" ? "birthday" : null, JSON.stringify(input.tags ?? [])
      );
      if (options.enqueue !== false) this.enqueue("event.create", id, {}, this.accountForCalendar(calendarId));
    })();
    const event = this.requireEvent(id);
    if (options.recordUndo !== false) {
      this.recordUndo("Create event", { namespace: "calendar", action: "create", payload: eventCreatePayload(event) }, { namespace: "calendar", action: "delete", payload: { id } });
    }
    return event;
  }

  private updateEvent(input: JsonRecord, options: EventWriteOptions = {}): JsonRecord {
    const previous = this.requireEvent(requiredText(input.id, "Event id"));
    this.assertCalendarWritable(previous.calendarId);
    if (input.calendarId && input.calendarId !== previous.calendarId) this.assertCalendarWritable(input.calendarId);
    if ((input.scope === "series" || input.scope === "seriesAll") && previous.googleRecurringEventId) {
      const series = this.findEventByGoogleId(previous.calendarId, previous.googleRecurringEventId);
      if (!series) throw new CoreStoreError("The recurring series is not available in the local cache.");
      return this.updateEvent({ ...input, id: series.id, scope: "series" }, options);
    }
    if ((input.scope === "series" || input.scope === "seriesAll") && input.timeChangeOrigin) {
      const seriesKey = previous.googleId ?? previous.id;
      const hasExceptions = Boolean(this.statement("SELECT 1 FROM events WHERE calendar_id=? AND google_recurring_event_id=? LIMIT 1").get(previous.calendarId, seriesKey)) ||
        Boolean(this.statement("SELECT 1 FROM google_event_cancellations WHERE calendar_id=? AND recurring_event_id=? LIMIT 1").get(previous.calendarId, seriesKey));
      if (hasExceptions) throw new CoreStoreError("This series has edited or cancelled occurrences. Move this occurrence instead; shifting its exceptions together needs a reviewed series edit.");
      if (input.allDay !== undefined && Boolean(input.allDay) !== Boolean(previous.allDay)) throw new CoreStoreError("Change one occurrence, or review the repeat rule in event details before changing the series between timed and all-day.");
      const recurrenceLines = recurrenceLinesFromStored(previous.googleRecurrence, previous.recurrence);
      if (recurrenceLines && input.startsAt) {
        input = { ...input, recurrenceLines: shiftGestureRecurrence(recurrenceLines,
          input.timeChangeOrigin.startsAt, input.startsAt, Boolean(previous.allDay), previous.timeZone || this.calendarTimeZone(previous.calendarId)) };
      }
      input = { ...input, ...shiftSeriesTime(
        { startsAt: previous.startsAt, endsAt: previous.endsAt, allDay: previous.allDay }, input.timeChangeOrigin,
        { startsAt: input.startsAt ?? input.timeChangeOrigin.startsAt, endsAt: input.endsAt ?? input.timeChangeOrigin.endsAt, allDay: input.allDay ?? previous.allDay },
        previous.timeZone || this.calendarTimeZone(previous.calendarId)
      ) };
    }
    const originalStartAt = typeof input.originalStartAt === "string" ? requiredIso(input.originalStartAt, "Recurring occurrence date") : null;
    // Calendar rows generated from a master are virtual. Their visible ids are
    // intentionally not database ids, so route writes through their master
    // while retaining the exact originalStartTime Google uses to identify the
    // chosen occurrence.
    if (originalStartAt && !previous.googleRecurringEventId && isFollowingScope(input.scope)) {
      return this.splitFutureSeries({ ...previous, googleOriginalStartTime: originalStartAt }, input);
    }
    if (originalStartAt && !previous.googleRecurringEventId && (input.scope === "occurrence" || input.scope === undefined)) {
      return this.updateGeneratedOccurrence(previous, input, originalStartAt, options);
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
    // Google recurrence lines are canonical. A structured recurrence remains
    // only as a legacy/simple-controls projection, so normal event edits never
    // lower an imported Google rule to HCB's smaller historical subset.
    const nextGoogleRecurrence = hasOwn(input, "recurrenceLines") || hasOwn(input, "recurrence")
      ? recurrenceLinesForInput(input)
      : recurrenceLinesFromStored(previous.googleRecurrence, previous.recurrence);
    const nextRecurrence = recurrenceFromGoogle(nextGoogleRecurrence);
    const nextTimeZone = normalizedCalendarEventTimeZone(
      input.timeZone ?? previous.timeZone,
      this.calendarTimeZone(nextCalendarId)
    );
    const now = timestamp();
    this.db.transaction(() => {
      this.statement(`UPDATE events SET calendar_id=?,title=?,description=?,starts_at=?,ends_at=?,all_day=?,completed=?,color_id=?,location=?,recurrence_json=?,google_recurrence_json=?,
        attendees_json=?,reminders_json=?,reminders_use_default=?,transparency=?,visibility=?,time_zone=?,conference_create_requested=?,
        attachments_json=?,attachments_managed=?,event_type=?,focus_time_properties_json=?,out_of_office_properties_json=?,
        working_location_properties_json=?,self_response_status=?,updated_at=?,hcb_kind=?,tags_json=? WHERE id=?`).run(
        nextCalendarId, input.title ?? previous.title, input.description ?? input.notes ?? previous.description,
        input.startsAt ?? previous.startsAt, input.endsAt ?? previous.endsAt,
        input.allDay === undefined ? Number(previous.allDay) : input.allDay ? 1 : 0,
        input.completed === undefined ? Number(previous.completed) : input.completed ? 1 : 0,
        input.colorId ?? previous.colorId ?? null, input.location ?? previous.location ?? null,
        JSON.stringify(nextRecurrence), JSON.stringify(nextGoogleRecurrence),
        JSON.stringify(nextAttendees),
        JSON.stringify(input.reminders ?? previous.reminders ?? []),
        input.remindersUseDefault === undefined ? (previous.remindersUseDefault ? 1 : 0) : input.remindersUseDefault ? 1 : 0,
        statusEventTransparency(eventType, input.transparency ?? previous.transparency), statusEventVisibility(eventType, input.visibility ?? previous.visibility),
        nextTimeZone, input.conferenceCreateRequest ? 1 : 0,
        JSON.stringify(Object.hasOwn(input, "attachments") ? normalizeCalendarAttachments(input.attachments) : previous.attachments ?? []),
        Object.hasOwn(input, "attachments") ? 1 : Number(previous.attachmentsManaged ?? 0), eventType,
        JSON.stringify(statusProperties.focusTimeProperties), JSON.stringify(statusProperties.outOfOfficeProperties),
        JSON.stringify(statusProperties.workingLocationProperties), normalizedResponseStatus(input.selfResponseStatus ?? previous.selfResponseStatus), now,
        hasOwn(input, "hcbKind") ? (input.hcbKind === "birthday" ? "birthday" : null) : previous.hcbKind ?? null, JSON.stringify(input.tags ?? previous.tags ?? []), previous.id
      );
      const movedExistingRemoteEvent = nextCalendarId !== previous.calendarId && Boolean(previousForSync?.googleId);
      if (options.enqueue !== false) {
        this.enqueue(
          movedExistingRemoteEvent ? "event.move" : "event.update",
          previous.id,
          movedExistingRemoteEvent ? { sourceCalendarId: previous.calendarId, destinationCalendarId: nextCalendarId } : {},
          previous.accountId
        );
      }
    })();
    const event = this.requireEvent(previous.id);
    if (options.recordUndo !== false) {
      this.recordUndo("Update event", { namespace: "calendar", action: "update", payload: eventUpdatePayload(event) }, { namespace: "calendar", action: "update", payload: eventUpdatePayload(previous) });
    }
    return event;
  }

  /** Turn an edit of a projected recurrence row into a real Google exception. */
  private updateGeneratedOccurrence(master: JsonRecord, input: JsonRecord, originalStartAt: string, options: EventWriteOptions): JsonRecord {
    const masterRecurrence = recurrenceLinesFromStored(master.googleRecurrence, master.recurrence);
    if (!masterRecurrence?.length) throw new CoreStoreError("This occurrence no longer belongs to a recurring series.");
    const calendarId = input.calendarId ?? master.calendarId;
    if (calendarId !== master.calendarId) throw new CoreStoreError("A recurring occurrence cannot be moved to another Google calendar.");
    const startsAt = input.startsAt ?? originalStartAt;
    const sourceDuration = Math.max(1, Date.parse(master.endsAt) - Date.parse(master.startsAt));
    const occurrence = this.createEvent({
      calendarId,
      title: input.title ?? master.title,
      description: input.description ?? input.notes ?? master.description,
      startsAt,
      endsAt: input.endsAt ?? new Date(Date.parse(startsAt) + sourceDuration).toISOString(),
      allDay: input.allDay ?? master.allDay,
      colorId: input.colorId ?? master.colorId,
      location: input.location ?? master.location,
      recurrenceLines: null,
      attendees: input.attendees ?? input.guestEmails ?? master.attendees,
      reminders: input.reminders ?? master.reminders,
      remindersUseDefault: input.remindersUseDefault ?? master.remindersUseDefault,
      transparency: input.transparency ?? master.transparency,
      visibility: input.visibility ?? master.visibility,
      timeZone: input.timeZone ?? master.timeZone,
      attachments: input.attachments ?? master.attachments,
      eventType: input.eventType ?? master.eventType,
      focusTimeProperties: input.focusTimeProperties ?? master.focusTimeProperties,
      outOfOfficeProperties: input.outOfOfficeProperties ?? master.outOfOfficeProperties,
      workingLocationProperties: input.workingLocationProperties ?? master.workingLocationProperties,
      selfResponseStatus: input.selfResponseStatus ?? master.selfResponseStatus
    }, { enqueue: false, recordUndo: false });
    this.db.transaction(() => {
      this.statement("UPDATE events SET google_recurring_event_id=?,google_original_start_time=?,updated_at=? WHERE id=?")
        .run(master.googleId ?? master.id, originalStartAt, timestamp(), occurrence.id);
      if (options.enqueue !== false) {
        this.enqueue("event.updateOccurrence", occurrence.id, {
          parentEventId: master.id,
          originalStartAt
        }, master.accountId);
      }
    })();
    const result = this.requireEvent(occurrence.id);
    if (options.recordUndo !== false) {
      this.recordUndo("Edit recurring occurrence", { namespace: "calendar", action: "create", payload: eventCreatePayload(result) }, { namespace: "calendar", action: "delete", payload: { id: result.id } });
    }
    return result;
  }

  private splitFutureSeries(occurrence: JsonRecord, input: JsonRecord): JsonRecord {
    const series = occurrence.googleRecurringEventId
      ? this.findEventByGoogleId(occurrence.calendarId, occurrence.googleRecurringEventId) ?? occurrence
      : occurrence;
    const oldRecurrenceLines = recurrenceLinesFromStored(series.googleRecurrence, series.recurrence);
    if (!oldRecurrenceLines) throw new CoreStoreError("This event is not a recurring series.");
    const splitAt = occurrence.googleOriginalStartTime ?? occurrence.startsAt;
    if (!Number.isFinite(Date.parse(splitAt))) throw new CoreStoreError("Recurring split date is invalid.");
    // Editing the first occurrence is a whole-series edit. Avoid creating an
    // empty historical master (and avoid an unnecessary remote transaction).
    if (Date.parse(splitAt) <= Date.parse(series.startsAt)) {
      const { scope: _scope, ...wholeSeriesInput } = input;
      return this.updateEvent({ ...wholeSeriesInput, id: series.id, scope: "series" });
    }
    if (input.calendarId && input.calendarId !== series.calendarId) {
      throw new CoreStoreError("This-and-following edits must stay on the same Google calendar.");
    }

    let partitioned: ReturnType<typeof splitGoogleRecurrenceLines>;
    try {
      partitioned = splitGoogleRecurrenceLines({
        allDay: Boolean(series.allDay),
        lines: oldRecurrenceLines,
        seriesStartsAt: series.startsAt,
        splitAt,
        timeZone: series.timeZone
      });
    } catch (error) {
      throw new CoreStoreError(error instanceof Error ? error.message : "Could not split this Google recurrence.");
    }
    const parentRecurrenceLines = partitioned.parentLines;
    if (input.timeChangeOrigin && input.allDay !== undefined && Boolean(input.allDay) !== Boolean(series.allDay)) throw new CoreStoreError("Change one occurrence, or review the repeat rule in event details before changing the series between timed and all-day.");
    const successorRecurrenceLines = hasOwn(input, "recurrenceLines") || hasOwn(input, "recurrence")
      ? recurrenceLinesForInput(input)
      : input.timeChangeOrigin && input.startsAt
        ? shiftGestureRecurrence(partitioned.successorLines, input.timeChangeOrigin.startsAt, input.startsAt, Boolean(series.allDay), series.timeZone)
        : partitioned.successorLines;
    const originalMaster = this.googleEventForSync(series.id);
    const futureExceptionIds = originalMaster?.googleId
      ? this.seriesExceptionIdsFrom(series.calendarId, originalMaster.googleId, splitAt)
      : [];
    const sourceDuration = Math.max(1, Date.parse(occurrence.endsAt) - Date.parse(occurrence.startsAt));
    const successorStartsAt = input.startsAt ?? occurrence.startsAt;
    let successor: JsonRecord;
    this.db.transaction(() => {
      // Google Calendar exposes no atomic "this and following" API. Keep the
      // local projection and its one coordinating outbox mutation together so
      // GoogleSync can make the remote steps transactional-with-compensation.
      this.updateEvent({ id: series.id, recurrenceLines: parentRecurrenceLines, scope: "series" }, { enqueue: false, recordUndo: false });
      successor = this.createEvent({
      calendarId: input.calendarId ?? series.calendarId,
      title: input.title ?? series.title,
      description: input.description ?? input.notes ?? series.description,
      startsAt: successorStartsAt,
      endsAt: input.endsAt ?? new Date(Date.parse(successorStartsAt) + sourceDuration).toISOString(),
      allDay: input.allDay ?? series.allDay,
      colorId: input.colorId ?? series.colorId,
      location: input.location ?? series.location,
      recurrenceLines: successorRecurrenceLines,
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
      }, { enqueue: false, recordUndo: false });

      if (originalMaster?.googleId) {
        this.enqueue("event.splitSeries", series.id, {
          parentEventId: series.id,
          successorEventId: successor.id,
          splitAt,
          originalMaster,
          futureExceptionIds
        }, series.accountId);
      } else {
        // A newly-created/offline series has no remote exceptions to migrate.
        // Normal creates/updates preserve the usual offline behavior.
        this.enqueue("event.update", series.id, {}, series.accountId);
        this.enqueue("event.create", successor.id, {}, series.accountId);
      }
    })();
    // A split changes two masters and may migrate remote exceptions. Do not
    // offer the generic one-row undo action here; GoogleSync either completes
    // the coordinated operation or compensates it as one unit.
    return { ...successor!, splitFromEventId: series.id, recurrenceScope: "following" };
  }

  private seriesExceptionIdsFrom(calendarId: string, googleRecurringEventId: string, splitAt: string): string[] {
    return (this.statement(`SELECT id FROM events
      WHERE calendar_id=? AND google_recurring_event_id=? AND google_original_start_time IS NOT NULL AND google_original_start_time>=?`)
      .all(calendarId, googleRecurringEventId, splitAt) as Array<{ id: string }>).map((row) => row.id);
  }

  private findEventByGoogleId(calendarId: string, googleId: string): JsonRecord | null {
    const row = this.statement("SELECT id FROM events WHERE calendar_id=? AND google_id=?").get(calendarId, googleId) as { id?: string } | undefined;
    return row?.id ? this.requireEvent(row.id) : null;
  }

  private deleteEvent(input: JsonRecord, options: { relatedTaskListId?: string } = {}): JsonRecord {
    const id = requiredText(input.id, "Event id");
    const eventBeforeDelete = this.requireEvent(id);
    this.assertCalendarWritable(eventBeforeDelete.calendarId);
    const originalStartAt = typeof input.originalStartAt === "string" ? requiredIso(input.originalStartAt, "Recurring occurrence date") : null;
    if (originalStartAt && !eventBeforeDelete.googleRecurringEventId && input.scope === "occurrence") {
      const recurrenceLines = recurrenceLinesFromStored(eventBeforeDelete.googleRecurrence, eventBeforeDelete.recurrence);
      if (!recurrenceLines?.length) throw new CoreStoreError("This occurrence no longer belongs to a recurring series.");
      let nextLines: string[];
      try {
        nextLines = withGoogleExdate(recurrenceLines, originalStartAt, Boolean(eventBeforeDelete.allDay), eventBeforeDelete.timeZone);
      } catch (error) {
        throw new CoreStoreError(error instanceof Error ? error.message : "Could not cancel this recurring occurrence.");
      }
      this.updateEvent({ id, recurrenceLines: nextLines, scope: "series" });
      return { id, originalStartAt, deleted: true, recurrenceScope: "occurrence" };
    }
    if (input.scope === "series" && eventBeforeDelete.googleRecurringEventId) {
      const series = this.findEventByGoogleId(eventBeforeDelete.calendarId, eventBeforeDelete.googleRecurringEventId);
      if (!series) throw new CoreStoreError("The recurring series is not available in the local cache.");
      return this.deleteEvent({ id: series.id });
    }
    this.db.transaction(() => {
      this.requireEvent(id);
      const previous = this.googleEventForSync(id);
      const scheduledBlocks = this.scheduledBlocksForEvent(id);
      this.unlinkScheduledTaskBlocks(id);
      this.statement("DELETE FROM events WHERE id=?").run(id);
      this.enqueue("event.delete", id, { ...previous, scheduledBlocks, ...(options.relatedTaskListId ? { __hcbRelatedTaskListId: options.relatedTaskListId } : {}) }, previous?.accountId ?? null);
    })();
    this.recordUndo("Delete event", { namespace: "calendar", action: "delete", payload: { id } }, { namespace: "calendar", action: "create", payload: eventCreatePayload(eventBeforeDelete) });
    return { id, deleted: true };
  }

  private unlinkScheduledTaskBlocks(eventId: string): void {
    const linkedBlocks = this.statement("SELECT DISTINCT task_id AS taskId FROM scheduled_task_blocks WHERE calendar_event_id=?")
      .all(eventId) as Array<{ taskId: string }>;
    this.statement("DELETE FROM scheduled_task_blocks WHERE calendar_event_id=?").run(eventId);
    for (const { taskId } of linkedBlocks) {
      const remaining = this.statement(`SELECT starts_at AS startsAt,ends_at AS endsAt FROM scheduled_task_blocks
        WHERE task_id=? ORDER BY updated_at DESC,rowid DESC LIMIT 1`).get(taskId) as { startsAt: string; endsAt: string } | undefined;
      this.statement("UPDATE tasks SET planned_start=?,planned_end=?,updated_at=? WHERE id=?")
        .run(remaining?.startsAt ?? null, remaining?.endsAt ?? null, timestamp(), taskId);
    }
  }

  private scheduledBlocksForEvent(eventId: string): JsonRecord[] {
    return this.statement(`SELECT id,task_id AS taskId,calendar_event_id AS calendarEventId,calendar_id AS calendarId,
      starts_at AS startsAt,ends_at AS endsAt,created_at AS createdAt,updated_at AS updatedAt FROM scheduled_task_blocks WHERE calendar_event_id=? ORDER BY id`).all(eventId) as JsonRecord[];
  }

  private listScheduledTaskBlocks(input: JsonRecord): JsonRecord {
    const start = input.start ?? "0000-01-01T00:00:00.000Z";
    const end = input.end ?? "9999-12-31T23:59:59.999Z";
    const blocks = this.statement(`SELECT block.id,block.task_id AS taskId,block.calendar_event_id AS calendarEventId,
      block.calendar_id AS calendarId,task.title,block.starts_at AS startsAt,block.ends_at AS endsAt,
      CAST((julianday(block.ends_at)-julianday(block.starts_at))*1440 AS INTEGER) AS durationMinutes,
      block.updated_at AS updatedAt FROM scheduled_task_blocks block JOIN tasks task ON task.id=block.task_id
      WHERE block.starts_at < ? AND block.ends_at > ? ORDER BY block.starts_at,block.id`).all(end, start) as JsonRecord[];
    return this.page(blocks.map((block) => ({ ...block, status: "scheduled", mutationState: "queued" })), input);
  }

  private requireScheduledTaskBlock(id: string): JsonRecord {
    const block = this.statement(`SELECT block.id,block.task_id AS taskId,block.calendar_event_id AS calendarEventId,
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
    this.statement(`INSERT INTO scheduled_task_blocks(id,task_id,calendar_event_id,calendar_id,starts_at,ends_at,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?)`).run(id, task.id, event.id, calendarId, startsAt, endsAt, now, now);
    this.statement("UPDATE tasks SET planned_start=?,planned_end=?,duration_minutes=?,updated_at=? WHERE id=?")
      .run(startsAt, endsAt, durationMinutes, now, task.id);
    const block = this.requireScheduledTaskBlock(id);
    this.recordUndo("Schedule task block", { namespace: "calendar", action: "scheduleTaskBlock", payload: { taskId: task.id, calendarId, startsAt, endsAt } }, { namespace: "calendar", action: "unscheduleTaskBlock", payload: { id } });
    return block;
  }

  private moveScheduledTaskBlock(input: JsonRecord): JsonRecord {
    const id = requiredText(input.id, "Scheduled block id");
    const block = this.statement(`SELECT id,task_id AS taskId,calendar_event_id AS calendarEventId,calendar_id AS calendarId,
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
    this.statement("UPDATE scheduled_task_blocks SET calendar_id=?,starts_at=?,ends_at=?,updated_at=? WHERE id=?")
      .run(calendarId, startsAt, endsAt, timestamp(), id);
    this.statement("UPDATE tasks SET planned_start=?,planned_end=?,duration_minutes=?,updated_at=? WHERE id=?")
      .run(startsAt, endsAt, durationMinutes, timestamp(), block.taskId);
    const moved = this.requireScheduledTaskBlock(id);
    this.recordUndo("Move task block", { namespace: "calendar", action: "moveScheduledTaskBlock", payload: { id, calendarId, startsAt, durationMinutes } }, { namespace: "calendar", action: "moveScheduledTaskBlock", payload: { id, calendarId: block.calendarId, startsAt: block.startsAt, durationMinutes: Math.round((Date.parse(block.endsAt) - Date.parse(block.startsAt)) / 60_000) } });
    return moved;
  }

  private unscheduleTaskBlock(input: JsonRecord): JsonRecord {
    const id = requiredText(input.id, "Scheduled block id");
    const block = this.statement("SELECT task_id AS taskId,calendar_event_id AS calendarEventId,calendar_id AS calendarId,starts_at AS startsAt,ends_at AS endsAt FROM scheduled_task_blocks WHERE id=?").get(id) as JsonRecord | undefined;
    if (!block) throw new CoreStoreError("Scheduled block no longer exists");
    this.db.transaction(() => {
      if (input.deleteCalendarEvent !== false) {
        const previousUndoState = this.applyingUndo;
        this.applyingUndo = true;
        try { this.deleteEvent({ id: block.calendarEventId }); }
        finally { this.applyingUndo = previousUndoState; }
      } else {
        this.statement("DELETE FROM scheduled_task_blocks WHERE id=?").run(id);
        this.statement("UPDATE tasks SET planned_start=NULL,planned_end=NULL,updated_at=? WHERE id=?").run(timestamp(), block.taskId);
      }
    })();
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
    if (input.apply === true) {
      return this.applySmartSchedulePlan(input);
    }

    const date = requiredText(input.date, "Schedule date");
    const calendarId = requiredText(input.calendarId, "Calendar id");
    const plan = this.buildSmartSchedulePlan({ ...input, calendarId, date });
    const planId = randomUUID();
    this.pruneSmartSchedulePlans();
    this.smartSchedulePlans.set(planId, plan);

    return this.smartScheduleResponse(plan, {
      applied: false,
      generatedAt: new Date(plan.createdAt).toISOString(),
      planId
    });
  }

  private buildSmartSchedulePlan(input: JsonRecord): SmartSchedulePlan {
    const date = requiredText(input.date, "Schedule date");
    const calendarId = requiredText(input.calendarId, "Calendar id");
    const range = workingRange(date, input.workingHours ?? {}, this.settings());
    const calendar = this.googleCalendarForSync(calendarId);
    if (!calendar) throw new CoreStoreError("Calendar no longer exists");
    this.assertCalendarWritable(calendarId);

    const calendarIds = this.selectedCalendarIds();
    const busy = this.busyEvents(range.start, range.end, calendarIds);
    const nonBlocking = this.nonBlockingEvents(range.start, range.end, calendarIds);
    const free = subtractIntervals(range, busy.map((event) => ({ start: event.startsAt, end: event.endsAt })));
    const candidateScope = smartScheduleCandidateScope(input.candidateScope);
    const candidates = this.activeSchedulableTasks(candidateScope, date)
      .sort((left, right) => compareSchedulableTasks(left, right, date));
    const tasks: JsonRecord[] = [];
    const skipped: JsonRecord[] = [];

    for (const task of candidates) {
      const taskTitle = String(task.title || "Untitled task");
      const needed = smartScheduleDuration(task.durationMinutes);
      const usesDefaultDuration = !Number(task.durationMinutes);
      const dueDate = taskDueDate(task.dueAt);

      if (task.lockedSchedule) {
        skipped.push({ taskId: task.id, taskTitle, durationMinutes: needed, usesDefaultDuration, dueDate, reason: "Its schedule is locked." });
        continue;
      }

      if (task.snoozeUntil && Date.parse(task.snoozeUntil) > Date.parse(range.start)) {
        skipped.push({
          taskId: task.id,
          taskTitle,
          durationMinutes: needed,
          usesDefaultDuration,
          dueDate,
          reason: `Snoozed until ${formatPlannerDateTime(task.snoozeUntil, this.settings().defaultTimeZone)}.`
        });
        continue;
      }

      tasks.push(task);
    }

    const suggestions: JsonRecord[] = [];
    let slotIndex = 0;
    let cursor = free[0]?.start;
    for (const task of tasks) {
      const needed = smartScheduleDuration(task.durationMinutes);
      while (cursor && slotIndex < free.length && Date.parse(cursor) + needed * 60_000 > Date.parse(free[slotIndex].end)) {
        slotIndex += 1;
        cursor = free[slotIndex]?.start;
      }

      const taskTitle = String(task.title || "Untitled task");
      const dueDate = taskDueDate(task.dueAt);
      const usesDefaultDuration = !Number(task.durationMinutes);
      if (!cursor || slotIndex >= free.length) {
        skipped.push({
          taskId: task.id,
          taskTitle,
          durationMinutes: needed,
          usesDefaultDuration,
          dueDate,
          reason: `No ${needed}-minute slot is available in the selected working hours.`
        });
        continue;
      }

      const startsAt = cursor;
      const endsAt = new Date(Date.parse(startsAt) + needed * 60_000).toISOString();
      suggestions.push({
        taskId: task.id,
        taskTitle,
        calendarId,
        startsAt,
        endsAt,
        durationMinutes: needed,
        usesDefaultDuration,
        dueDate,
        action: task.plannedStart ? "move" : "schedule",
        reason: smartScheduleReason(date, dueDate)
      });
      cursor = endsAt;
    }

    return {
      availableMinutes: free.reduce((total, slot) => total + durationMinutes(slot.start, slot.end), 0),
      calendarId,
      candidateCount: candidates.length,
      candidateScope,
      candidateScopeLabel: smartScheduleCandidateScopeLabel(candidateScope),
      createdAt: Date.now(),
      date,
      fixedEventCount: busy.length,
      nonBlockingEventCount: nonBlocking.length,
      scheduledMinutes: suggestions.reduce((total, suggestion) => total + Number(suggestion.durationMinutes ?? 0), 0),
      skipped,
      suggestions
    };
  }

  private applySmartSchedulePlan(input: JsonRecord): JsonRecord {
    const planId = requiredText(input.planId, "Smart Schedule preview");
    this.pruneSmartSchedulePlans();
    const plan = this.smartSchedulePlans.get(planId);
    if (!plan) {
      throw new CoreStoreError("This preview has expired. Generate a new preview before applying changes.");
    }

    if (!this.googleCalendarForSync(plan.calendarId)) {
      throw new CoreStoreError("The preview calendar is no longer available. Generate a new preview.");
    }

    const failed: JsonRecord[] = [];
    let appliedCount = 0;
    for (const suggestion of plan.suggestions) {
      try {
        const task = this.requireTask(suggestion.taskId);
        if (task.status !== "active") {
          throw new CoreStoreError("The task is no longer open.");
        }
        if (task.lockedSchedule) {
          throw new CoreStoreError("Its schedule is now locked.");
        }
        if (task.snoozeUntil && Date.parse(task.snoozeUntil) > Date.parse(suggestion.startsAt)) {
          throw new CoreStoreError("The task is now snoozed.");
        }

        const existing = this.statement("SELECT id FROM scheduled_task_blocks WHERE task_id=? LIMIT 1")
          .get(suggestion.taskId) as { id?: string } | undefined;
        if (existing?.id) {
          this.moveScheduledTaskBlock({
            id: existing.id,
            calendarId: plan.calendarId,
            startsAt: suggestion.startsAt,
            durationMinutes: suggestion.durationMinutes
          });
        } else {
          this.scheduleTaskBlock({
            taskId: suggestion.taskId,
            calendarId: plan.calendarId,
            startsAt: suggestion.startsAt,
            endsAt: suggestion.endsAt
          });
        }
        appliedCount += 1;
      } catch (error) {
        failed.push({
          taskId: suggestion.taskId,
          taskTitle: suggestion.taskTitle,
          reason: error instanceof Error ? error.message : "The change could not be prepared."
        });
      }
    }

    this.smartSchedulePlans.delete(planId);
    return this.smartScheduleResponse(plan, {
      applied: true,
      appliedCount,
      failed,
      generatedAt: timestamp()
    });
  }

  private smartScheduleResponse(
    plan: SmartSchedulePlan,
    details: JsonRecord
  ): JsonRecord {
    return {
      ...details,
      calendarId: plan.calendarId,
      candidateScope: plan.candidateScope,
      candidateScopeLabel: plan.candidateScopeLabel,
      prioritizationLabel: "Overdue first · earliest due date · priority · stable list order",
      capacityPolicy: "allFreeTime",
      availableMinutes: plan.availableMinutes,
      scheduledMinutes: plan.scheduledMinutes,
      candidateCount: plan.candidateCount,
      fixedEventCount: plan.fixedEventCount,
      nonBlockingEventCount: plan.nonBlockingEventCount,
      skipped: plan.skipped,
      suggestions: plan.suggestions
    };
  }

  private pruneSmartSchedulePlans(): void {
    const minimumCreatedAt = Date.now() - 15 * 60_000;
    for (const [id, plan] of this.smartSchedulePlans) {
      if (plan.createdAt < minimumCreatedAt) this.smartSchedulePlans.delete(id);
    }
  }

  private busyEvents(start: string, end: string, calendarIds: string[]): JsonRecord[] {
    if (calendarIds.length === 0) return [];
    const placeholders = calendarIds.map(() => "?").join(",");
    return this.statement(`SELECT id,title,starts_at AS startsAt,ends_at AS endsAt,transparency
      FROM events WHERE starts_at < ? AND ends_at > ? AND calendar_id IN (${placeholders})
      AND COALESCE(transparency, 'opaque') != 'transparent'`)
      .all(end, start, ...calendarIds) as JsonRecord[];
  }

  private nonBlockingEvents(start: string, end: string, calendarIds: string[]): JsonRecord[] {
    if (calendarIds.length === 0) return [];
    const placeholders = calendarIds.map(() => "?").join(",");
    return this.statement(`SELECT id,title,starts_at AS startsAt,ends_at AS endsAt,transparency
      FROM events WHERE starts_at < ? AND ends_at > ? AND calendar_id IN (${placeholders})
      AND transparency = 'transparent'`)
      .all(end, start, ...calendarIds) as JsonRecord[];
  }

  private selectedCalendarIds(): string[] {
    const selected = stringArray(this.settings().selectedCalendarIds);
    return selected.length ? selected : this.calendars().map((calendar) => calendar.id);
  }

  private activeSchedulableTasks(scope: SmartScheduleCandidateScope = "allOpen", scheduleDate?: string): JsonRecord[] {
    const tasks: JsonRecord[] = (this.statement(`SELECT task.id,list.account_id AS accountId,task.list_id AS listId,task.title,task.due_at AS dueAt,
      task.planned_start AS plannedStart,task.planned_end AS plannedEnd,task.duration_minutes AS durationMinutes,task.locked_schedule AS lockedSchedule,
      task.snooze_until AS snoozeUntil,task.priority,task.sort_order AS sortOrder,task.updated_at AS updatedAt
      FROM tasks task JOIN task_lists list ON list.id=task.list_id
      WHERE task.status='active' AND task.parent_id IS NULL`).all() as JsonRecord[])
      .map((task) => ({ ...task, lockedSchedule: Boolean(task.lockedSchedule) }));

    if (scope !== "dueSoon" || !scheduleDate) {
      return tasks;
    }

    const latestIncludedDate = addPlannerDays(scheduleDate, 14);
    return tasks.filter((task) => {
      const dueDate = taskDueDate(task.dueAt);
      return dueDate !== null && dueDate <= latestIncludedDate;
    });
  }

  private scheduledMinutesForRange(start: string, end: string): number {
    return Number((this.statement(`SELECT COALESCE(SUM((julianday(MIN(ends_at, ?))-julianday(MAX(starts_at, ?)))*1440),0) AS minutes
      FROM scheduled_task_blocks WHERE starts_at < ? AND ends_at > ?`).get(end, start, end, start) as { minutes: number }).minutes ?? 0);
  }

  private taskContext(input: JsonRecord): JsonRecord {
    const task = this.requireTask(requiredText(input.id, "Task id"));
    const row = this.statement(`WITH siblings AS (
      SELECT id,LAG(id) OVER sibling_order AS previousId,LAG(id,2) OVER sibling_order AS beforePreviousId,
        LEAD(id) OVER sibling_order AS nextId FROM tasks
      WHERE list_id=? AND parent_id IS ? AND status IN ('active','completed')
      WINDOW sibling_order AS (ORDER BY sort_order IS NULL,sort_order,created_at,id)
    ) SELECT * FROM siblings WHERE id=?`).get(task.listId, task.parentId ?? null, task.id);
    return { ...(row as JsonRecord ?? { id: task.id, previousId: null, beforePreviousId: null, nextId: null }), listId: task.listId, parentId: task.parentId };
  }

  private resolveLinks(input: JsonRecord): JsonRecord {
    const tables: Record<string, { table: string; body: string; live: string }> = {
      task: { table: "tasks", body: "notes", live: "status != 'deleted'" },
      note: { table: "notes", body: "body", live: "deleted_at IS NULL" },
      event: { table: "events", body: "description", live: "1=1" }
    };
    const items: JsonRecord[] = [];
    for (const link of (input.links ?? []).slice(0, 50)) {
      const source = tables[link.kind];
      if (!source) continue;
      const predicate = link.targetId ? "id=?" : "(id=? OR title=? COLLATE NOCASE)";
      const key = link.targetId ?? link.label;
      const row = this.statement(`SELECT id,title,${link.fullBody ? source.body : `substr(${source.body},1,240)`} AS body
        FROM ${source.table} WHERE ${source.live} AND ${predicate} ORDER BY id LIMIT 1`).get(...(link.targetId ? [key] : [key,key])) as JsonRecord | undefined;
      if (row) items.push({ ...row, kind: link.kind });
    }
    return { items };
  }

  private nativePlanningData(input: JsonRecord): import("@shared/nativePlanning").NativePlanningData {
    const now = new Date(input.now ?? timestamp());
    const start = new Date(now); start.setHours(0, 0, 0, 0);
    const tomorrow = new Date(start); tomorrow.setDate(tomorrow.getDate() + 1);
    const end = new Date(tomorrow); end.setDate(end.getDate() + 1);
    const bounds = [start.toISOString(), tomorrow.toISOString(), end.toISOString()];
    const dayKey = (value: Date) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
    const taskBounds = [dayKey(start), dayKey(tomorrow), dayKey(end)];
    const counts = this.statement(`SELECT
      COALESCE(SUM(due_at < ?),0) AS overdueTasks,
      COALESCE(SUM(due_at >= ? AND due_at < ?),0) AS todayTasks,
      COALESCE(SUM(due_at >= ? AND due_at < ?),0) AS tomorrowTasks
      FROM tasks WHERE status='active' AND due_at IS NOT NULL`).get(taskBounds[0], taskBounds[0], taskBounds[1], taskBounds[1], taskBounds[2]) as { overdueTasks: number; todayTasks: number; tomorrowTasks: number };
    const readTasks = (where: string, parameters: unknown[], limit = 100) => this.statement(`SELECT id,list_id AS listId,title,due_at AS dueAt,status
      FROM tasks WHERE status='active' AND ${where} ORDER BY due_at,id LIMIT ?`).all(...parameters, limit) as TaskSummary[];
    const tasks = [
      ...readTasks("due_at < ?", [taskBounds[0]]),
      ...readTasks("due_at >= ? AND due_at < ?", [taskBounds[0], taskBounds[1]]),
      ...readTasks("due_at >= ? AND due_at < ?", [taskBounds[1], taskBounds[2]]),
      ...readTasks("due_at >= ?", [taskBounds[2]], 1)
    ];
    const notificationHorizon = new Date(now.getTime() + 86400_000);
    const notificationTasks = tasks.filter((task) => task.dueAt && task.dueAt.slice(0, 10) <= dayKey(notificationHorizon));
    const events: JsonRecord[] = [];
    let cursor: string | undefined;
    do {
      const page = this.listEvents({ start: bounds[0], end: bounds[2], summary: true, limit: 1000, cursor });
      events.push(...page.items);
      cursor = page.page.nextCursor;
    } while (cursor !== undefined);
    const todayEvents = events.filter((event) => event.startsAt >= bounds[0] && event.startsAt < bounds[1]);
    const tomorrowEvents = events.filter((event) => event.startsAt >= bounds[1] && event.startsAt < bounds[2]);
    const current = now.toISOString();
    const retained = [...new Map([
      ...todayEvents.slice(0, 100), ...tomorrowEvents.slice(0, 100),
      ...events.filter((event) => event.startsAt <= current && event.endsAt > current).slice(0, 100),
      ...events.filter((event) => event.startsAt > current).slice(0, 100)
    ].map((event) => [event.id, event])).values()].sort((left, right) => left.startsAt.localeCompare(right.startsAt));
    return {
      tasks, notificationTasks,
      events: retained.map((event) => ({ id: event.id, eventId: event.eventId, calendarId: event.calendarId, title: event.title,
        startsAt: event.startsAt, endsAt: event.endsAt, allDay: event.allDay, completedAt: event.completed ? event.updatedAt : null })),
      counts: { ...counts, dayStart: bounds[0], todayEvents: todayEvents.length, tomorrowEvents: tomorrowEvents.length,
        todayEventsComplete: todayEvents.every((event) => event.completed) }
    };
  }

  private listNotes(input: JsonRecord): JsonRecord {
    const { limit, offset } = this.pageBounds(input);
    const where = ["note.deleted_at IS NULL"];
    const parameters: unknown[] = [];
    if (typeof input.listId === "string") { where.push("note.list_id=?"); parameters.push(input.listId); }
    const settings = this.settings();
    const starredIds = settings.starredNoteIds ?? [];
    const stars = JSON.stringify(starredIds);
    const select = `SELECT note.id,note.title,${input.summary ? "substr(note.body,1,240)" : "note.body"} AS body,
      note.list_id AS listId,note.tags_json AS tagsJson,list.title AS listTitle,
      note.created_at AS createdAt,note.updated_at AS updatedAt
      FROM notes note LEFT JOIN note_lists list ON list.id=note.list_id`;
    const starredCondition = "note.id IN (SELECT value FROM json_each(?))";
    const starredCount = starredIds.length ? Number((this.statement(`SELECT COUNT(*) AS count FROM notes note
      WHERE ${where.join(" AND ")} AND ${starredCondition}`).get(...parameters, stars) as { count: number }).count) : 0;
    const rows: JsonRecord[] = [];
    // Sort only the starred subset. Ordinary pages can follow the recent-note
    // index directly, even with stars present elsewhere in the collection.
    if (offset < starredCount) {
      rows.push(...this.statement(`${select} WHERE ${where.join(" AND ")} AND ${starredCondition}
        ORDER BY COALESCE((SELECT value FROM json_each(?) WHERE key=note.id),0) DESC,note.updated_at DESC,note.id LIMIT ? OFFSET ?`)
        .all(...parameters, stars, JSON.stringify(settings.starredNoteAt ?? {}), Math.min(limit, starredCount - offset), offset) as JsonRecord[]);
    }
    if (rows.length < limit) {
      rows.push(...this.statement(`${select} WHERE ${where.join(" AND ")}${starredCount ? ` AND NOT (${starredCondition})` : ""}
        ORDER BY note.updated_at DESC,note.id LIMIT ? OFFSET ?`)
        .all(...parameters, ...(starredCount ? [stars] : []), limit - rows.length, Math.max(0, offset - starredCount)) as JsonRecord[]);
    }
    const total = Number((this.statement(`SELECT COUNT(*) AS count FROM notes note WHERE ${where.join(" AND ")}`).get(...parameters) as { count: number }).count);
    return { items: rows.map((row) => this.noteSummary(row)), page: this.pageMetadata(limit, offset, total), lists: this.noteLists() };
  }

  /**
   * The replaced Notes surface projected exactly these items: active,
   * top-level Tasks with no due date. Keep that predicate literal here so an
   * import never sweeps ordinary or completed Google Tasks into native Notes.
   */
  private legacyPseudoNotesMigrationPreview(input: JsonRecord): JsonRecord {
    const autoPromptEligible = (this.statement("SELECT value FROM sync_meta WHERE key='legacy-note-prompt-eligible'").get() as { value?: string } | undefined)?.value === "true";
    if (input.automatic && !autoPromptEligible) return { autoPromptEligible, foundCount: 0, importedCount: this.legacyPseudoNoteImportCount(), items: [] };
    const limit = Math.min(Math.max(Number(input.limit ?? 500), 1), 1_000);
    const candidates = this.legacyPseudoNoteCandidates(false, { limit, preview: true });
    const foundCount = Number((this.statement(`SELECT COUNT(*) AS count FROM tasks task JOIN task_lists list ON list.id=task.list_id
      WHERE task.status='active' AND task.parent_id IS NULL AND task.due_at IS NULL
      AND NOT EXISTS(SELECT 1 FROM legacy_note_imports imported WHERE imported.source_type='legacy-google-task-pseudo-note' AND imported.source_task_id=task.id)`)
      .get() as { count: number }).count);
    return {
      autoPromptEligible,
      foundCount,
      importedCount: this.legacyPseudoNoteImportCount(),
      // Google identifiers remain main-process provenance. The renderer gets
      // the stable local source identity it needs for review and selection.
      items: candidates.map(({ sourceGoogleTaskId, sourceGoogleTaskListId, ...candidate }) => candidate)
    };
  }

  /**
   * Import is a copy-only transaction. It neither changes a Google Task nor
   * enqueues an outbox mutation; provenance prevents a rerun from duplicating
   * a Note even if its imported copy was later deleted by the user.
   */
  private importLegacyPseudoNotes(input: JsonRecord): JsonRecord {
    const requestedTaskIds = [...new Set(stringArray(input.taskIds))];
    if (requestedTaskIds.length === 0) throw new CoreStoreError("Select at least one legacy note to import.");
    if (requestedTaskIds.length > 1_000) throw new CoreStoreError("Import at most 1,000 legacy notes at a time.");

    const sourceById = new Map(this.legacyPseudoNoteCandidates(true, { taskIds: requestedTaskIds }).map((candidate) => [candidate.sourceTaskId, candidate]));
    const now = timestamp();
    let importedCount = 0;
    let skippedCount = 0;
    let listsCreated = 0;

    this.db.transaction(() => {
      const findImported = this.statement(`SELECT native_note_id AS nativeNoteId FROM legacy_note_imports
        WHERE source_type=? AND source_task_id=?`);
      const findListMapping = this.statement(`SELECT native_note_list_id AS nativeNoteListId FROM legacy_note_import_lists
        WHERE source_task_list_id=?`);
      const createList = this.statement("INSERT INTO note_lists(id,title,created_at,updated_at) VALUES(?,?,?,?)");
      const createListMapping = this.statement(`INSERT INTO legacy_note_import_lists(source_task_list_id,native_note_list_id,import_version,created_at)
        VALUES(?,?,?,?) ON CONFLICT(source_task_list_id) DO UPDATE SET native_note_list_id=excluded.native_note_list_id,
        import_version=excluded.import_version,created_at=excluded.created_at`);
      const createNote = this.statement(`INSERT INTO notes(id,title,body,list_id,tags_json,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?)`);
      const createProvenance = this.statement(`INSERT INTO legacy_note_imports(
        source_type,source_task_id,source_task_list_id,source_google_task_id,source_google_task_list_id,native_note_id,import_version,created_at
      ) VALUES(?,?,?,?,?,?,?,?)`);

      for (const sourceTaskId of requestedTaskIds) {
        const source = sourceById.get(sourceTaskId);
        if (!source || findImported.get(legacyPseudoNoteSourceType, source.sourceTaskId)) {
          skippedCount += 1;
          continue;
        }

        const mappedList = findListMapping.get(source.sourceTaskListId) as { nativeNoteListId?: string } | undefined;
        let nativeNoteListId = mappedList?.nativeNoteListId;
        if (!nativeNoteListId || !this.noteList(nativeNoteListId)) {
          nativeNoteListId = randomUUID();
          createList.run(nativeNoteListId, source.sourceListTitle, now, now);
          createListMapping.run(source.sourceTaskListId, nativeNoteListId, legacyPseudoNoteImportVersion, now);
          listsCreated += 1;
        }

        const nativeNoteId = randomUUID();
        createNote.run(nativeNoteId, source.title, source.body, nativeNoteListId, JSON.stringify(source.tags), now, now);
        createProvenance.run(
          legacyPseudoNoteSourceType,
          source.sourceTaskId,
          source.sourceTaskListId,
          source.sourceGoogleTaskId,
          source.sourceGoogleTaskListId,
          nativeNoteId,
          legacyPseudoNoteImportVersion,
          now
        );
        importedCount += 1;
      }
    })();

    return { importedCount, skippedCount, listsCreated, importVersion: legacyPseudoNoteImportVersion };
  }

  private legacyPseudoNoteCandidates(includeImported = false, options: { limit?: number; preview?: boolean; taskIds?: string[] } = {}): JsonRecord[] {
    const importedJoin = includeImported
      ? ""
      : "LEFT JOIN legacy_note_imports imported ON imported.source_type='legacy-google-task-pseudo-note' AND imported.source_task_id=task.id";
    const importedCondition = includeImported ? "" : "AND imported.source_task_id IS NULL";
    const rows = this.statement(`SELECT task.id AS sourceTaskId,task.list_id AS sourceTaskListId,task.google_id AS sourceGoogleTaskId,
      list.google_id AS sourceGoogleTaskListId,list.title AS sourceListTitle,task.title,${options.preview ? "substr(task.notes,1,240)" : "task.notes"} AS body,task.tags_json AS tagsJson,
      task.updated_at AS updatedAt
      FROM tasks task JOIN task_lists list ON list.id=task.list_id
      ${importedJoin}
      WHERE task.status='active' AND task.parent_id IS NULL AND task.due_at IS NULL
      ${importedCondition}
      ${options.taskIds ? "AND task.id IN (SELECT value FROM json_each(?))" : ""}
      ORDER BY list.title COLLATE NOCASE,task.updated_at DESC,task.id LIMIT ?`)
      .all(...(options.taskIds ? [JSON.stringify(options.taskIds)] : []), options.limit ?? 1000) as JsonRecord[];
    return rows.map(({ tagsJson, ...row }) => ({ ...row, tags: stringArray(safeJson(tagsJson, [])) }));
  }

  private legacyPseudoNoteImportCount(): number {
    return Number((this.statement("SELECT COUNT(*) AS count FROM legacy_note_imports WHERE source_type=?")
      .get(legacyPseudoNoteSourceType) as { count?: number }).count ?? 0);
  }

  private requireNote(id: string): JsonRecord {
    const row = this.statement(`SELECT note.id,note.title,note.body,note.list_id AS listId,note.tags_json AS tagsJson,list.title AS listTitle,
      note.created_at AS createdAt,note.updated_at AS updatedAt
      FROM notes note LEFT JOIN note_lists list ON list.id=note.list_id WHERE note.id=? AND note.deleted_at IS NULL`).get(id);
    if (!row) throw new CoreStoreError("Note no longer exists");
    return this.noteSummary(row as JsonRecord);
  }

  private createNote(input: JsonRecord): JsonRecord {
    const now = timestamp();
    const id = randomUUID();
    const requestedListId = typeof input.listId === "string" && input.listId ? input.listId : null;
    // Older renderer builds used Google Task-list ids for local notes. Keep
    // those notes local during upgrade by placing them in the default native
    // list rather than rejecting an otherwise safe local write.
    const listId = (requestedListId && this.noteList(requestedListId) ? requestedListId : this.noteLists()[0]?.id);
    if (!listId) throw new CoreStoreError("No note list is available");
    this.statement("INSERT INTO notes(id,title,body,list_id,tags_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?)").run(id, requiredText(input.title, "Note title"), stringValue(input.body), listId, JSON.stringify(stringArray(input.tags)), now, now);
    return this.requireNote(id);
  }

  private updateNote(input: JsonRecord): JsonRecord {
    const current = this.requireNote(requiredText(input.id, "Note id"));
    const listId = input.listId ?? current.listId;
    if (!this.noteList(listId)) throw new CoreStoreError("Note list no longer exists");
    this.statement("UPDATE notes SET title=?,body=?,list_id=?,tags_json=?,updated_at=? WHERE id=?").run(input.title ?? current.title, input.body ?? current.body, listId, JSON.stringify(input.tags === undefined ? current.tags : stringArray(input.tags)), timestamp(), current.id);
    return this.requireNote(current.id);
  }

  private deleteNote(input: JsonRecord): JsonRecord {
    const id = requiredText(input.id, "Note id");
    this.statement("UPDATE notes SET deleted_at=?,updated_at=? WHERE id=?").run(timestamp(), timestamp(), id);
    return { id, deleted: true };
  }

  private noteSummary(row: JsonRecord): JsonRecord {
    const { tagsJson, ...note } = row;
    return { ...note, tags: stringArray(safeJson(tagsJson, [])) };
  }

  private noteLists(): JsonRecord[] {
    return this.statement(`SELECT list.id,list.title,list.created_at AS createdAt,list.updated_at AS updatedAt,
      COUNT(note.id) AS noteCount FROM note_lists list
      LEFT JOIN notes note ON note.list_id=list.id AND note.deleted_at IS NULL
      GROUP BY list.id ORDER BY list.created_at,list.id`).all() as JsonRecord[];
  }

  private noteList(id: unknown): JsonRecord | null {
    if (typeof id !== "string" || !id) return null;
    return this.statement("SELECT id,title,created_at AS createdAt,updated_at AS updatedAt FROM note_lists WHERE id=?").get(id) as JsonRecord | undefined ?? null;
  }

  private createNoteList(input: JsonRecord): JsonRecord {
    const now = timestamp();
    const list = { id: randomUUID(), title: requiredText(input.title, "Note list title"), createdAt: now, updatedAt: now };
    this.statement("INSERT INTO note_lists(id,title,created_at,updated_at) VALUES(?,?,?,?)").run(list.id, list.title, now, now);
    return { ...list, noteCount: 0 };
  }

  private renameNoteList(input: JsonRecord): JsonRecord {
    const list = this.noteList(requiredText(input.id, "Note list id"));
    if (!list) throw new CoreStoreError("Note list no longer exists");
    const title = requiredText(input.title, "Note list title");
    const updatedAt = timestamp();
    this.statement("UPDATE note_lists SET title=?,updated_at=? WHERE id=?").run(title, updatedAt, list.id);
    return { ...list, title, updatedAt };
  }

  private deleteNoteList(input: JsonRecord): JsonRecord {
    const id = requiredText(input.id, "Note list id");
    const list = this.noteList(id);
    if (!list) throw new CoreStoreError("Note list no longer exists");
    const remaining = this.noteLists().filter((candidate) => candidate.id !== id);
    if (remaining.length === 0) throw new CoreStoreError("Keep at least one note list");
    const deletedAt = timestamp();
    this.db.transaction(() => {
      this.statement("UPDATE notes SET deleted_at=?,updated_at=? WHERE list_id=? AND deleted_at IS NULL").run(deletedAt, deletedAt, id);
      this.statement("DELETE FROM legacy_note_import_lists WHERE native_note_list_id=?").run(id);
      this.statement("DELETE FROM note_lists WHERE id=?").run(id);
    })();
    return { id, deleted: true };
  }

  private tags(): JsonRecord[] {
    return this.statement("SELECT id,title,color,updated_at AS updatedAt FROM tags ORDER BY title COLLATE NOCASE").all() as JsonRecord[];
  }

  private createTag(input: JsonRecord): JsonRecord {
    const now = timestamp();
    const tag = { id: randomUUID(), title: requiredText(input.title ?? input.name, "Tag title"), color: input.color ?? null, updatedAt: now };
    this.statement("INSERT INTO tags(id,title,color,created_at,updated_at) VALUES(?,?,?,?,?)").run(tag.id, tag.title, tag.color, now, now);
    return tag;
  }

  private updateTag(input: JsonRecord): JsonRecord {
    const id = requiredText(input.id, "Tag id");
    this.statement("UPDATE tags SET title=?,color=?,updated_at=? WHERE id=?").run(requiredText(input.title ?? input.name, "Tag title"), input.color ?? null, timestamp(), id);
    return this.tags().find((tag) => tag.id === id) ?? (() => { throw new CoreStoreError("Tag no longer exists"); })();
  }

  private deleteTag(input: JsonRecord): JsonRecord {
    const id = requiredText(input.id, "Tag id");
    this.statement("DELETE FROM tags WHERE id=?").run(id);
    return { id, deleted: true };
  }

  private searchCount(query: string): JsonRecord {
    const match = ftsQuery(query);
    if (this.fullTextSearchAvailable && match) return this.statement("SELECT COUNT(*) AS count FROM search_index WHERE search_index MATCH ?").get(match) as JsonRecord;
    const needle = `%${String(query).trim()}%`;
    return this.statement(`SELECT
      (SELECT COUNT(*) FROM tasks WHERE status!='deleted' AND (title LIKE ? OR notes LIKE ?)) +
      (SELECT COUNT(*) FROM events WHERE title LIKE ? OR description LIKE ?) +
      (SELECT COUNT(*) FROM notes WHERE deleted_at IS NULL AND (title LIKE ? OR body LIKE ?)) AS count`).get(needle, needle, needle, needle, needle, needle) as JsonRecord;
  }

  private search(query: string, limit: number, domains?: unknown): JsonRecord {
    const included = ["tasks", "calendar", "notes"].filter(domain => !Array.isArray(domains) || domains.includes(domain));
    if (!included.length) return { items: [] };
    const safeLimit = Math.max(1, Math.min(200, Number(limit) || 30));
    const match = ftsQuery(query);
    if (this.fullTextSearchAvailable && match) {
      return {
        items: this.statement(`SELECT entity_id AS id,title,snippet(search_index,3,'','','…',32) AS snippet,domain,
          NULL AS snoozeUntil FROM search_index WHERE search_index MATCH ? AND domain IN (${included.map(() => "?").join(",")})
          ORDER BY bm25(search_index) LIMIT ?`).all(match, ...included, safeLimit) as JsonRecord[]
      };
    }
    const needle = `%${String(query).trim()}%`;
    const items = [
      ...(included.includes("tasks") ? this.statement("SELECT id,title,substr(notes,1,240) AS snippet,'tasks' AS domain,snooze_until AS snoozeUntil FROM tasks WHERE status != 'deleted' AND (title LIKE ? OR notes LIKE ?) LIMIT ?").all(needle, needle, safeLimit) as JsonRecord[] : []),
      ...(included.includes("calendar") ? this.statement("SELECT id,title,substr(description,1,240) AS snippet,'calendar' AS domain,NULL AS snoozeUntil FROM events WHERE title LIKE ? OR description LIKE ? LIMIT ?").all(needle, needle, safeLimit) as JsonRecord[] : []),
      ...(included.includes("notes") ? this.statement("SELECT id,title,substr(body,1,240) AS snippet,'notes' AS domain,NULL AS snoozeUntil FROM notes WHERE deleted_at IS NULL AND (title LIKE ? OR body LIKE ?) LIMIT ?").all(needle, needle, safeLimit) as JsonRecord[] : [])
    ].slice(0, safeLimit);
    return { items };
  }

  private settings(): JsonRecord {
    const row = this.statement("SELECT value FROM settings WHERE key=?").get("app") as { value: string } | undefined;
    const stored = row ? safeJson(row.value, {}) : {};
    // Earlier builds recorded only a completion timestamp. Preserve that
    // information as an explicit state so skip and completion remain distinct.
    const onboardingStatus = stored.onboardingStatus ?? (stored.setupCompletedAt ? "completed" : "pending");
    return {
      ...defaultSettings,
      ...stored,
      mcpEnabled: false,
      semanticSearchEnabled: false,
      semanticSearchMode: "lexical",
      agentActionTrayEnabled: false,
      webhooksEnabled: false,
      // New defaults need to reach existing installs too. Explicit user
      // overrides (including null, which means intentionally unassigned)
      // always win over a default binding.
      keybindings: {
        ...defaultSettings.keybindings,
        ...safeObject(stored.keybindings)
      },
      onboardingStatus
    };
  }

  private updateSettings(input: JsonRecord): JsonRecord {
    if (input.mcpEnabled === true || input.semanticSearchEnabled === true || input.agentActionTrayEnabled === true || input.webhooksEnabled === true) {
      throw new CoreStoreError("Local MCP, semantic search, agent actions, and webhooks are not available in this release.");
    }
    const next = { ...this.settings(), ...input };
    this.statement("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run("app", JSON.stringify(next));
    this.nativeBridge?.applySettings?.(next);
    return next;
  }

  private syncStatus(): JsonRecord {
    const pending = this.count("outbox", "state = 'pending' AND account_id!='local'");
    const conflicts = this.count("outbox", "state = 'conflict' AND account_id!='local'");
    const failed = this.count("outbox", "state IN ('pending','conflict') AND account_id!='local' AND (state='conflict' OR last_error IS NOT NULL)");
    const runtimeRow = this.statement("SELECT value FROM sync_meta WHERE key='google-sync-runtime'").get() as { value?: string } | undefined;
    const runtime = safeJson(runtimeRow?.value ?? "{}", {});
    const { pendingMutationCount: _storedPendingMutationCount, ...runtimeWithoutPendingCount } = runtime;
    return {
      state: pending && !runtime.state ? "pending" : conflicts && !runtime.state ? "error" : "idle",
      pendingMutationCount: pending,
      offline: false,
      stale: false,
      ...runtimeWithoutPendingCount,
      failedMutationCount: failed,
      ...(conflicts && runtime.state !== "syncing" ? {
        state: "error", stale: true, lastErrorCode: "SYNC_CONFLICT",
        message: "Resolve failed Google changes in Diagnostics before later changes for that account can sync."
      } : {})
    };
  }

  private googleStatus(): JsonRecord {
    const client = safeJson((this.statement("SELECT value FROM sync_meta WHERE key=?").get("google-client") as { value?: string } | undefined)?.value ?? "{}", {});
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
      platform: (this.platform.platform ?? "web"),
      notifications: false,
      globalShortcuts: false,
      tray: false,
      deepLinks: false,
      trayStatus: { state: "unsupported", message: "Native shell is being restored." },
      notificationsStatus: { permission: "unsupported", scheduledCount: 0, state: "unsupported", message: "Notifications are unavailable." },
      deepLinkStatus: { scheme: "hotcrossbuns", registered: false, state: "unsupported", message: "Deep links are unavailable." },
      updaterStatus: { state: "unsupported", message: "Updates are unavailable." },
      mcpStatus: { state: "disabled", message: "MCP is disabled." },
      capabilityReport: { platform: (this.platform.platform ?? "web"), adapterId: "restoring", packageFormat: "development", flags: {}, paths: [], capabilities: [], diagnostics: [] },
      deferredStartup: { state: "complete" }
    };
  }

  private diagnostics(): JsonRecord {
    const taskCount = this.count("tasks");
    const taskListCount = this.taskLists().length;
    const eventCount = this.count("events");
    const calendarCount = this.calendars().length;
    const noteCount = this.count("notes", "deleted_at IS NULL");
    const capabilityReport = this.nativeCapabilities().capabilityReport ?? {};
    return {
      database: { path: this.db.name, schemaVersion },
      sync: this.syncStatus(),
      cache: { taskListCount, taskCount, calendarCount, eventCount, noteCount },
      selectedResources: {
        taskLists: this.taskLists().map((list) => ({ id: list.id, selected: true })),
        calendars: this.calendars().map((calendar) => ({ id: calendar.id, selected: true }))
      },
      checkpoints: { totalCount: this.countSyncTokens() },
      pendingMutations: { totalCount: this.count("outbox", "state IN ('pending','conflict')") },
      mcp: { tokenState: "not_configured" },
      account: { state: this.googleAccounts().some((account) => account.connectionState === "connected") ? "connected" : "signed_out" },
      native: {
        flags: capabilityReport.flags ?? {},
        capabilities: Array.isArray(capabilityReport.capabilities) ? capabilityReport.capabilities : [],
        paths: Array.isArray(capabilityReport.paths) ? capabilityReport.paths : []
      },
      redaction: {
        credentials: "redacted",
        googlePayloads: "omitted",
        mcpBearerTokens: "redacted",
        sensitiveBodies: "omitted"
      },
      build: { version: "5.0.1", environment: "local", commit: "restored", buildDate: null, packageTool: "pnpm" },
      resourceCounts: { tasks: taskCount, events: eventCount, notes: noteCount },
      search: { engine: this.fullTextSearchAvailable ? "fts5" : "fallback" },
      ...(this.settings().diagnosticsIncludePerformance ? { performance: { startup: getStartupTimings(), timings: timingSnapshot() } } : {})
    };
  }

  private enqueue(kind: string, entityId: string, payload: JsonRecord, accountId: string | null): void {
    const now = timestamp();
    this.statement(`INSERT INTO outbox(id,account_id,kind,entity_id,payload_json,state,next_attempt_at,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?)`).run(randomUUID(), accountId, kind, entityId, JSON.stringify(payload), "pending", now, now, now);
  }

  private recordUndo(action: string, forward: JsonRecord, inverse: JsonRecord): void {
    if (this.applyingUndo) return;
    const now = timestamp();
    this.db.transaction(() => {
      this.statement("DELETE FROM undo_entries WHERE state='undone'").run();
      this.statement(`INSERT INTO undo_entries(id,action,forward_json,inverse_json,state,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?)`).run(randomUUID(), action, JSON.stringify(forward), JSON.stringify(inverse), "applied", now, now);
      // A bounded local history avoids surprising database growth from normal
      // keyboard editing while keeping enough depth for power-user sessions.
      this.statement(`DELETE FROM undo_entries WHERE id IN (SELECT id FROM undo_entries ORDER BY rowid DESC LIMIT -1 OFFSET 200)`).run();
    })();
  }

  private undoStatus(): JsonRecord {
    return {
      canUndo: Boolean(this.statement("SELECT 1 FROM undo_entries WHERE state='applied' LIMIT 1").get()),
      canRedo: Boolean(this.statement("SELECT 1 FROM undo_entries WHERE state='undone' LIMIT 1").get())
    };
  }

  private applyUndo(direction: "undo" | "redo"): JsonRecord {
    const state = direction === "undo" ? "applied" : "undone";
    const entry = this.statement(`SELECT id,action,forward_json AS forwardJson,inverse_json AS inverseJson FROM undo_entries
      WHERE state=? ORDER BY rowid ${direction === "undo" ? "DESC" : "ASC"} LIMIT 1`).get(state) as { id: string; action: string; forwardJson: string; inverseJson: string } | undefined;
    if (!entry) return { action: direction, applied: false, ...this.undoStatus() };
    const operation = safeJson(direction === "undo" ? entry.inverseJson : entry.forwardJson, null) as JsonRecord | null;
    if (!operation?.namespace || !operation.action || !operation.payload) throw new CoreStoreError("Undo history entry is corrupted.");
    this.applyingUndo = true;
    try {
      this.db.transaction(() => {
        this.dispatch(String(operation.namespace), String(operation.action), operation.payload);
        this.statement("UPDATE undo_entries SET state=?,updated_at=? WHERE id=?")
          .run(direction === "undo" ? "undone" : "applied", timestamp(), entry.id);
      })();
    } finally {
      this.applyingUndo = false;
    }
    return { action: direction, applied: true, label: entry.action, ...this.undoStatus() };
  }

  private pendingMutationDiagnostics(input: JsonRecord): JsonRecord[] {
    const limit = Math.max(1, Math.min(500, Number(input.limit) || 100));
    return (this.statement(`SELECT id,kind,entity_id AS entityId,state,attempts,next_attempt_at AS nextAttemptAt,
      last_error AS lastErrorMessage,created_at AS createdAt,updated_at AS updatedAt
      FROM outbox WHERE state IN ('pending','conflict') ORDER BY rowid LIMIT ?`).all(limit) as JsonRecord[])
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
    return (this.statement(`SELECT id,kind,entity_id AS entityId,state,attempts,last_error AS message,
      created_at AS createdAt,updated_at AS updatedAt FROM outbox ORDER BY updated_at DESC,id DESC LIMIT ?`).all(limit) as JsonRecord[])
      .map((row) => ({
        id: row.id,
        kind: row.kind,
        summary: `${row.kind} · ${String(row.entityId).slice(0, 12)}`,
        timestamp: row.updatedAt,
        metadataLine: `state=${row.state} attempts=${Number(row.attempts)}${row.message ? ` · ${row.message}` : ""}`
      }));
  }

  /** One reviewed unit includes later edits and structural dependants. */
  syncResolutionContext(id: string): SyncResolutionContext {
    const rows = (this.statement(`SELECT id,account_id AS accountId,kind,entity_id AS entityId,payload_json AS payload,
      attempts,created_at AS createdAt,state,creation_started AS creationStarted FROM outbox
      WHERE state IN ('pending','conflict') ORDER BY rowid`).all() as JsonRecord[])
      .map((row): JsonRecord => ({ ...row, payload: safeJson(row.payload, {}) }));
    const mutation = rows.find((row) => row.id === id);
    if (!mutation) throw new CoreStoreError("Pending mutation no longer exists");
    if (rows.some((row) => row.accountId === mutation.accountId && row.creationStarted)) throw new CoreStoreError("Wait for the current Google creation to finish.");
    const entities = new Map<string, SyncResolutionContext["entities"][number]>();
    const add = (kind: "task" | "taskList" | "event", entityId: string) => {
      const key = `${kind}:${entityId}`;
      if (entities.has(key)) return;
      let local = kind === "task" ? this.googleTaskForSync(entityId) : kind === "taskList" ? this.googleTaskListForSync(entityId) : this.googleEventForSync(entityId);
      if (local?.accountId && local.accountId !== mutation.accountId) throw new CoreStoreError("Resolve related changes within their own Google account.");
      if (local && kind === "event") local = { ...local, scheduledBlocks: this.scheduledBlocksForEvent(entityId) };
      entities.set(key, { kind, id: entityId, local });
    };
    const family = String(mutation.kind).split(".")[0];
    if (!["task", "taskList", "event"].includes(family)) throw new CoreStoreError("This local operation has no Google version to resolve.");
    add(family as "task" | "taskList" | "event", mutation.entityId);
    let previousSize = -1;
    while (previousSize !== entities.size) {
      previousSize = entities.size;
      for (const entity of [...entities.values()]) {
        if (entity.kind === "taskList") {
          for (const task of this.statement("SELECT id FROM tasks WHERE list_id=? AND EXISTS (SELECT 1 FROM outbox WHERE entity_id=tasks.id AND kind LIKE 'task.%' AND state IN ('pending','conflict'))").all(entity.id) as Array<{ id: string }>) add("task", task.id);
        }
        if (entity.kind === "task") {
          for (const child of this.statement("WITH RECURSIVE descendants(id) AS (SELECT id FROM tasks WHERE parent_id=? UNION SELECT tasks.id FROM tasks JOIN descendants ON tasks.parent_id=descendants.id) SELECT id FROM descendants WHERE EXISTS (SELECT 1 FROM outbox WHERE entity_id=descendants.id AND kind LIKE 'task.%' AND state IN ('pending','conflict'))").all(entity.id) as Array<{ id: string }>) add("task", child.id);
        }
      }
      for (const row of rows.filter((row) => row.accountId === mutation.accountId)) {
        const kind = row.kind.split(".")[0] as "task" | "taskList" | "event";
        const linked = entities.has(`${kind}:${row.entityId}`) ||
          (kind === "task" && (entities.has(`taskList:${row.payload.listId}`) || entities.has(`task:${row.payload.parentId}`))) ||
          (kind === "event" && (entities.has(`taskList:${row.payload.__hcbRelatedTaskListId}`) || [row.payload.parentEventId, row.payload.successorEventId, ...(row.payload.futureExceptionIds ?? [])].some((value) => entities.has(`event:${value}`))));
        if (!linked) continue;
        add(kind, row.entityId);
        if (kind === "event" && typeof row.payload.__hcbRelatedTaskListId === "string") add("taskList", row.payload.__hcbRelatedTaskListId);
        if (kind === "event") for (const value of [row.payload.parentEventId, row.payload.successorEventId, ...(row.payload.futureExceptionIds ?? [])]) if (typeof value === "string") add("event", value);
        if (kind === "taskList") for (const task of row.payload.deletedTasks ?? []) if (rows.some((entry) => entry.kind.startsWith("task.") && entry.entityId === task.id)) add("task", task.id);
      }
    }
    const mutations = rows.filter((row) => row.accountId === mutation.accountId && entities.has(`${row.kind.split(".")[0]}:${row.entityId}`)) as PendingSyncMutation[];
    // Include all unresolved account writes: an unrelated structural edit can
    // change the meaning of the remote snapshot while its requests are pending.
    const version = this.platform.hashVersion?.(JSON.stringify([rows.filter((row) => row.accountId === mutation.accountId), [...entities.values()]])) ?? JSON.stringify([rows.filter((row) => row.accountId === mutation.accountId), [...entities.values()]]);
    return { mutation: mutation as PendingSyncMutation, mutations, entities: [...entities.values()], version,
      uncertainCreation: mutations.some((row) => row.payload.__hcbUncertainCreation === true) };
  }

  private retryMutation(input: JsonRecord): JsonRecord {
    const context = this.syncResolutionContext(requiredText(input.id, "Mutation id"));
    if (context.uncertainCreation) throw new CoreStoreError("Google may already have created this item. Compare Google and link the accepted item before keeping local changes.");
    this.db.transaction(() => {
      for (const entity of context.entities) {
        const table = entity.kind === "task" ? "tasks" : entity.kind === "event" ? "events" : "task_lists";
        this.statement(`UPDATE ${table} SET google_etag=NULL WHERE id=?`).run(entity.id);
      }
      for (const mutation of context.mutations) {
        this.statement(`UPDATE outbox SET state='pending',next_attempt_at=?,last_error=NULL,updated_at=?,
          payload_json=json_remove(payload_json,'$.googleEtag') WHERE id=? AND state IN ('pending','conflict')`)
          .run(timestamp(), timestamp(), mutation.id);
      }
    })();
    return { id: context.mutation.id, queued: true, affectedCount: context.mutations.length };
  }

  private cancelMutation(input: JsonRecord): JsonRecord {
    const context = this.syncResolutionContext(requiredText(input.id, "Mutation id"));
    this.db.transaction(() => {
      for (const mutation of context.mutations) this.statement("UPDATE outbox SET state='cancelled',updated_at=? WHERE id=? AND state IN ('pending','conflict')").run(timestamp(), mutation.id);
      // A pull may already have advanced past the conflicting remote edit.
      // Resetting its checkpoints is part of discarding the optimistic writes.
      if (context.mutation.accountId) this.resetGoogleSyncTokens(context.mutation.accountId);
      const historyIds = new Set(context.entities.map((entity) => entity.id));
      for (const entity of context.entities) for (const block of entity.local?.scheduledBlocks ?? []) historyIds.add(block.id);
      for (const mutation of context.mutations) {
        for (const block of mutation.payload.scheduledBlocks ?? []) historyIds.add(block.id);
        for (const task of mutation.payload.deletedTasks ?? []) historyIds.add(task.id);
      }
      for (const id of historyIds) this.statement(`DELETE FROM undo_entries WHERE json_extract(forward_json,'$.payload.id')=? OR json_extract(inverse_json,'$.payload.id')=?`).run(id, id);
    })();
    return { id: context.mutation.id, cancelled: true, affectedCount: context.mutations.length };
  }

  retryGoogleResolution(context: SyncResolutionContext, snapshot: GoogleResolutionSnapshot): JsonRecord {
    return this.db.transaction(() => {
      if (this.syncResolutionContext(context.mutation.id).version !== context.version) throw new CoreStoreError("Local changes arrived during recovery. Compare again.");
      const result = this.retryMutation({ id: context.mutation.id });
      for (const entity of context.entities.filter((entity) => entity.kind === "event")) {
        const chain = context.mutations.filter((mutation) => mutation.entityId === entity.id);
        if (!chain.some((mutation) => mutation.kind === "event.move")) continue;
        if (chain.some((mutation) => !["event.create", "event.update", "event.move", "event.delete"].includes(mutation.kind))) throw new CoreStoreError("Restore Google's series state before retrying this combined operation.");
        const target = resolutionGoogleEvent(context, entity.id, snapshot, (id) => this.googleCalendarForSync(id));
        if (!target || target.event.status === "cancelled") throw new CoreStoreError("This event no longer exists in a known move location.");
        const actualCalendar = this.upsertGoogleCalendar(target.calendar.remote, context.mutation.accountId!);
        const desired = this.googleEventForSync(entity.id);
        const deleted = chain.find((mutation) => mutation.kind === "event.delete");
        const kind = !desired && deleted ? "event.delete" : desired?.calendarId === actualCalendar.id ? "event.update" : "event.move";
        const payload = kind === "event.delete" ? { ...deleted!.payload, googleId: target.event.id, calendarGoogleId: target.calendar.remote.id, googleEtag: null }
          : kind === "event.move" ? { sourceCalendarId: actualCalendar.id, destinationCalendarId: desired!.calendarId } : {};
        // Keep the earliest causal position, applying the latest desired state
        // from Google's actual location. Later stale moves must not replay.
        this.statement("UPDATE outbox SET kind=?,payload_json=? WHERE id=?").run(kind, JSON.stringify(payload), chain[0].id);
        for (const mutation of chain.slice(1)) this.statement("UPDATE outbox SET state='cancelled',updated_at=? WHERE id=?").run(timestamp(), mutation.id);
        if (desired) this.statement("UPDATE events SET google_id=?,google_etag=NULL WHERE id=?").run(target.event.id, entity.id);
      }
      return result;
    })();
  }

  /** Apply fetched, complete snapshots and the queue decision in one transaction. */
  applyGoogleResolution(context: SyncResolutionContext, snapshot: GoogleResolutionSnapshot): JsonRecord {
    return this.db.transaction(() => {
      if (this.syncResolutionContext(context.mutation.id).version !== context.version) throw new CoreStoreError("Local changes arrived during comparison. Compare again before resolving.");
      const result = this.cancelMutation({ id: context.mutation.id });
      const accountId = context.mutation.accountId!;
      // Restore identities for locally deleted resources before importing them.
      for (const mutation of context.mutations) {
        if (mutation.kind === "taskList.delete" && !this.googleTaskListForSync(mutation.entityId) && snapshot.lists?.some((list) => list.remote.id === mutation.payload.googleId)) {
          this.statement("INSERT INTO task_lists(id,account_id,title,google_id,created_at,updated_at) VALUES(?,?,?,?,?,?)")
            .run(mutation.entityId, accountId, mutation.payload.title, mutation.payload.googleId, timestamp(), timestamp());
          for (const task of mutation.payload.deletedTasks ?? []) this.statement(`INSERT OR IGNORE INTO tasks(id,list_id,title,status,google_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?)`)
            .run(task.id, mutation.entityId, task.title, task.status, task.googleId ?? null, timestamp(), timestamp());
        }
        if (mutation.kind === "event.delete" && !this.googleEventForSync(mutation.entityId)) {
          const calendar = snapshot.calendars?.find((calendar) => calendar.remote.id === mutation.payload.calendarGoogleId);
          if (calendar?.events.some((event) => event.id === mutation.payload.googleId && event.status !== "cancelled")) {
            this.createEvent({ ...mutation.payload, id: mutation.entityId }, { enqueue: false, recordUndo: false });
            this.bindGoogleEvent(mutation.entityId, { id: mutation.payload.googleId });
          }
        }
      }
      for (const list of snapshot.lists ?? []) {
        const local = this.upsertGoogleTaskList(list.remote, accountId);
        this.upsertGoogleTaskBatch(list.tasks, local.id);
        this.reconcileGoogleTasks(local.id, new Set(list.tasks.map((task) => task.id)));
        this.reconcileGoogleTaskParents(local.id);
      }
      if (snapshot.lists) this.pruneGoogleTaskLists(accountId, snapshot.lists.map((list) => list.remote.id));
      for (const calendar of snapshot.calendars ?? []) {
        const local = this.upsertGoogleCalendar(calendar.remote, accountId);
        // A cancelled optimistic Calendar move still has the stable local id
        // in its destination. Put it back before importing the source event.
        for (const entity of context.entities.filter((entity) => entity.kind === "event" && entity.local?.googleId)) {
          if (resolutionGoogleEvent(context, entity.id, snapshot, (id) => this.googleCalendarForSync(id))?.calendar.remote.id === calendar.remote.id) this.statement("UPDATE events SET calendar_id=? WHERE id=?").run(local.id, entity.id);
        }
        this.upsertGoogleEventBatch(calendar.events, local.id);
        this.reconcileGoogleEvents(local.id, new Set(calendar.events.map((event) => event.id)));
        if (calendar.token) this.setGoogleSyncToken(accountId, `events:${calendar.remote.id}`, calendar.token);
      }
      if (snapshot.calendars) this.pruneGoogleCalendars(accountId, snapshot.calendars.map((calendar) => calendar.remote.id));
      // Unbound drafts have no remote identity to restore. Leaving them in the
      // cache would make a later edit silently create them again.
      for (const entity of [...context.entities].reverse()) {
        const current = entity.kind === "task" ? this.googleTaskForSync(entity.id) : entity.kind === "event" ? this.googleEventForSync(entity.id) : this.googleTaskListForSync(entity.id);
        if (current?.googleId) continue;
        if (entity.kind === "event") { this.unlinkScheduledTaskBlocks(entity.id); this.statement("DELETE FROM events WHERE id=?").run(entity.id); }
        if (entity.kind === "task") { this.statement("DELETE FROM scheduled_task_blocks WHERE task_id=?").run(entity.id); this.statement("UPDATE tasks SET parent_id=NULL WHERE parent_id=?").run(entity.id); this.statement("DELETE FROM tasks WHERE id=?").run(entity.id); }
        if (entity.kind === "taskList" && !this.statement("SELECT 1 FROM tasks WHERE list_id=?").get(entity.id)) { this.statement("UPDATE notes SET list_id=NULL WHERE list_id=?").run(entity.id); this.statement("DELETE FROM task_lists WHERE id=?").run(entity.id); }
      }
      for (const entity of context.entities.filter((entity) => entity.kind === "event")) {
        const event = this.googleEventForSync(entity.id);
        if (!event) continue;
        const deleted = context.mutations.find((mutation) => mutation.entityId === entity.id && mutation.kind === "event.delete");
        for (const block of deleted?.payload.scheduledBlocks ?? []) {
          if (!this.googleTaskForSync(block.taskId)) continue;
          this.statement(`INSERT OR IGNORE INTO scheduled_task_blocks(id,task_id,calendar_event_id,calendar_id,starts_at,ends_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)`)
            .run(block.id, block.taskId, event.id, event.calendarId, event.startsAt, event.endsAt, block.createdAt, block.updatedAt);
        }
        this.statement("UPDATE scheduled_task_blocks SET calendar_id=?,starts_at=?,ends_at=? WHERE calendar_event_id=?")
          .run(event.calendarId, event.startsAt, event.endsAt, event.id);
        for (const block of this.scheduledBlocksForEvent(event.id)) {
          const latest = this.statement("SELECT starts_at AS startsAt,ends_at AS endsAt FROM scheduled_task_blocks WHERE task_id=? ORDER BY updated_at DESC,rowid DESC LIMIT 1").get(block.taskId) as JsonRecord;
          this.statement("UPDATE tasks SET planned_start=?,planned_end=? WHERE id=?").run(latest.startsAt, latest.endsAt, block.taskId);
        }
      }
      return result;
    })();
  }

  private countSyncTokens(): number {
    return Number((this.statement("SELECT COUNT(*) AS count FROM sync_meta WHERE key LIKE 'google-sync-token:%'").get() as { count: number }).count);
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

  private hasPendingEntityMutation(entity: "task" | "taskList" | "event", entityId: string): boolean {
    return Boolean(this.statement("SELECT 1 FROM outbox WHERE entity_id=? AND kind LIKE ? AND state IN ('pending','conflict') LIMIT 1")
      .get(entityId, `${entity}.%`));
  }

  private requireList(id: string): void {
    if (!this.statement("SELECT 1 FROM task_lists WHERE id=?").get(id)) throw new CoreStoreError("Task list no longer exists");
  }

  private accountForTaskList(listId: string): string {
    const row = this.statement("SELECT account_id AS accountId FROM task_lists WHERE id=?").get(listId) as { accountId?: string } | undefined;
    if (!row?.accountId) throw new CoreStoreError("Task list no longer exists");
    return row.accountId;
  }

  private reorderTask(taskId: string, listId: string, previousTaskId: unknown): void {
    const task = this.statement("SELECT parent_id AS parentId FROM tasks WHERE id=?").get(taskId) as { parentId: string | null };
    const scope = [listId, task.parentId];
    const normalize = (): void => {
      const siblings = this.statement(`SELECT id FROM tasks WHERE list_id=? AND parent_id IS ? AND status IN ('active','completed')
        ORDER BY sort_order IS NULL,sort_order,created_at,id`).all(...scope) as Array<{ id: string }>;
      const update = this.statement("UPDATE tasks SET sort_order=? WHERE id=?");
      siblings.forEach((sibling, index) => update.run(String((index + 1) * 1000).padStart(16, "0") + "O", sibling.id));
    };
    if (this.statement("SELECT 1 FROM tasks WHERE list_id=? AND parent_id IS ? AND status IN ('active','completed') AND sort_order IS NULL LIMIT 1").get(...scope)) normalize();
    const rank = (): string | null => {
      let left: string | null = null;
      if (typeof previousTaskId === "string") {
        const previous = this.statement("SELECT sort_order AS rank FROM tasks WHERE id=? AND id!=? AND list_id=? AND parent_id IS ? AND status IN ('active','completed')").get(previousTaskId, taskId, ...scope) as { rank: string } | undefined;
        if (!previous) throw new CoreStoreError("The previous task must be a sibling in this list.");
        left = previous.rank;
      }
      const next = this.statement(`SELECT sort_order AS rank FROM tasks WHERE list_id=? AND parent_id IS ? AND id!=? AND status IN ('active','completed')
        AND (? IS NULL OR sort_order>?) ORDER BY sort_order,id LIMIT 1`).get(...scope, taskId, left, left) as { rank: string } | undefined;
      return taskOrderBetween(left, next?.rank ?? null);
    };
    let key = rank();
    if (key === null) { normalize(); key = rank(); }
    if (key === null) throw new CoreStoreError("Task order could not be updated.");
    this.statement("UPDATE tasks SET sort_order=? WHERE id=?").run(key, taskId);
  }

  private accountForCalendar(calendarId: string): string {
    const row = this.statement("SELECT account_id AS accountId FROM calendars WHERE id=?").get(calendarId) as { accountId?: string } | undefined;
    if (!row?.accountId) throw new CoreStoreError("Calendar no longer exists");
    return row.accountId;
  }

  private calendarTimeZone(calendarId: string): string {
    const row = this.statement("SELECT time_zone AS timeZone FROM calendars WHERE id=?").get(calendarId) as { timeZone?: string | null } | undefined;
    if (!row) throw new CoreStoreError("Calendar no longer exists");
    return row.timeZone?.trim() || String(this.settings().defaultTimeZone ?? "UTC");
  }

  private defaultWritableAccountId(): string {
    const connected = this.googleAccounts().find((account) => account.accountId !== localAccountId && account.connectionState === "connected");
    return connected?.accountId ?? localAccountId;
  }

  private defaultWritableTaskListId(): string {
    const selected = new Set(stringArray(this.settings().selectedTaskListIds));
    const connectedAccountIds = new Set(
      this.googleAccounts()
        .filter((account) => account.accountId !== localAccountId && account.connectionState === "connected")
        .map((account) => account.accountId)
    );
    const writable = this.taskLists().find((list) =>
      connectedAccountIds.has(list.accountId) && (selected.size === 0 || selected.has(list.id))
    );
    if (writable) return writable.id;
    if (connectedAccountIds.size > 0) {
      throw new CoreStoreError("Google Tasks has not finished syncing a task list yet.");
    }
    if (this.statement("SELECT 1 FROM task_lists WHERE id=? AND account_id=?").get("inbox", localAccountId)) return "inbox";
    throw new CoreStoreError("Connect Google before creating a task.");
  }

  private assertCalendarWritable(id: string): void {
    const calendar = this.googleCalendarForSync(id);
    if (!calendar) throw new CoreStoreError("Calendar no longer exists");
    if (!calendarCanWrite(calendar)) throw new CoreStoreError(calendarWriteRestriction(calendar));
  }

  private defaultWritableCalendarId(): string {
    const selected = new Set(this.selectedCalendarIds());
    const connectedAccountIds = new Set(
      this.googleAccounts()
        .filter((account) => account.accountId !== localAccountId && account.connectionState === "connected")
        .map((account) => account.accountId)
    );
    const writable = this.calendars().find((calendar) =>
      calendar.canWrite && connectedAccountIds.has(calendar.accountId) && (selected.size === 0 || selected.has(calendar.id))
    );
    if (writable) return writable.id;
    if (connectedAccountIds.size > 0) throw new CoreStoreError("No writable Google calendar is available. Sync to check access or select a calendar you can edit.");
    const local = this.calendars().find((calendar) => calendar.accountId === localAccountId);
    if (local) return local.id;
    throw new CoreStoreError("Connect Google before creating an event.");
  }

  private pageBounds(input: JsonRecord): { limit: number; offset: number } {
    // Calendar bootstrap deliberately requests up to 500 items. Preserve that
    // contract (and allow the 1,000-item perf fixture) rather than silently
    // returning a partial range with an ignored next cursor.
    const limit = Math.max(1, Math.min(1_000, Math.floor(Number(input.limit)) || 100));
    const offset = input.cursor ? Number.parseInt(String(input.cursor), 10) : 0;
    return { limit, offset: Number.isSafeInteger(offset) && offset >= 0 ? offset : 0 };
  }

  private pageMetadata(limit: number, offset: number, total: number): JsonRecord {
    return { limit, totalKnown: total, ...(offset + limit < total ? { nextCursor: String(offset + limit) } : {}) };
  }

  private page(items: JsonRecord[], input: JsonRecord): JsonRecord {
    const { limit, offset } = this.pageBounds(input);
    return { items: items.slice(offset, offset + limit), page: this.pageMetadata(limit, offset, items.length) };
  }

  private count(table: "tasks" | "events" | "notes" | "outbox", where = "1=1"): number {
    return Number((this.statement(`SELECT COUNT(*) AS count FROM ${table} WHERE ${where}`).get() as { count: number }).count);
  }
}


function withoutLocalFallbackSelections(settings: JsonRecord): JsonRecord {
  const withoutLocalId = (ids: unknown) => stringArray(ids).filter((id) => id !== "inbox" && id !== "primary");
  const listFilters = safeObject(settings.perTabListFilters) ?? {};
  const withoutLocalFilters = Object.fromEntries(
    Object.entries(listFilters).map(([surface, filter]) => {
      const value = safeObject(filter) ?? {};
      return [surface, { ...value, selectedTaskListIds: withoutLocalId(value.selectedTaskListIds) }];
    })
  );
  return {
    ...settings,
    selectedTaskListIds: withoutLocalId(settings.selectedTaskListIds),
    selectedCalendarIds: withoutLocalId(settings.selectedCalendarIds),
    perTabListFilters: withoutLocalFilters
  };
}

function taskFromRow(row: JsonRecord): JsonRecord {
  return { ...row, lockedSchedule: Boolean(row.lockedSchedule), tags: safeJson(row.tags, []), dueAt: row.dueAt ?? null, parentId: row.parentId ?? null, plannedStart: row.plannedStart ?? null, plannedEnd: row.plannedEnd ?? null, durationMinutes: row.durationMinutes ?? null, snoozeUntil: row.snoozeUntil ?? null };
}

function eventFromRow(row: JsonRecord): JsonRecord {
  const reminders = safeJson(row.reminders, []);
  const recurrence = safeJson(row.recurrence, null);
  const googleRecurrence = safeJson(row.googleRecurrence, null);
  const recurrenceLines = recurrenceLinesFromStored(googleRecurrence, recurrence);
  const attendees = safeJson(row.attendees, []);
  const conference = safeJson(row.conference, null);
  const attachments = safeJson(row.attachments, []);
  return {
    ...row,
    canWrite: calendarCanWrite(row),
    writeRestriction: calendarCanWrite(row) ? null : calendarWriteRestriction(row),
    tags: safeJson(row.tags, []),
    allDay: Boolean(row.allDay),
    detailsTruncated: Boolean(row.detailsTruncated),
    completed: row.scheduledTaskId ? row.scheduledTaskStatus === "completed" : Boolean(row.completed),
    completedAt: row.scheduledTaskId
      ? row.scheduledTaskStatus === "completed" ? row.scheduledTaskUpdatedAt : null
      : row.completed ? row.updatedAt : null,
    eventId: row.eventId ?? row.id,
    recurringEventId: row.recurringEventId ?? row.googleRecurringEventId ?? null,
    originalStartAt: row.originalStartAt ?? row.googleOriginalStartTime ?? null,
    status: row.status ?? "confirmed",
    notes: row.notes ?? row.description ?? "",
    recurrence,
    googleRecurrence,
    recurrenceLines,
    recurrenceRule: recurrenceRuleFromLines(recurrenceLines) ?? recurrenceRuleFromStored(recurrence),
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

function originalStartTimeFromGoogle(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  try {
    return eventTimeFromGoogle(value, "Google recurring original start").value;
  } catch {
    return null;
  }
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

/**
 * The Calendar API's recurrence field is already its canonical wire format:
 * one RFC 5545 line per array entry. Keep it verbatim so unsupported-but-valid
 * constructs such as EXDATE/RDATE and advanced RRULE parts survive HCB edits.
 */
function googleRecurrenceLines(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const lines = value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
  return lines.length > 0 ? lines : null;
}

const googleRecurrenceProperty = /^(RRULE|EXRULE|RDATE|EXDATE)(?:;[^:\r\n]+)?:[^\r\n]+$/;

/**
 * Validate only Calendar's actual recurrence envelope. Deliberately do not
 * parse or rewrite the RFC 5545 values: Google owns that grammar and adding a
 * local subset would once again make HCB lossy for advanced rules.
 */
function requiredGoogleRecurrenceLines(value: unknown): string[] | null {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value)) throw new CoreStoreError("Google recurrence must be a list of RFC 5545 lines.");
  const lines = value.map((entry) => {
    if (typeof entry !== "string") throw new CoreStoreError("Each Google recurrence line must be text.");
    return entry.trim();
  }).filter(Boolean);
  if (lines.length === 0) return null;
  if (lines.length > 100) throw new CoreStoreError("Google recurrence has too many lines.");
  for (const line of lines) {
    if (!googleRecurrenceProperty.test(line)) {
      throw new CoreStoreError("Google recurrence lines must be RRULE, EXRULE, RDATE, or EXDATE properties (without DTSTART or DTEND).");
    }
    if (line.startsWith("RRULE:") && !/(?:^|;)FREQ=[A-Z]+(?:;|$)/.test(line.slice("RRULE:".length))) {
      throw new CoreStoreError("Each RRULE must include FREQ.");
    }
  }
  return lines;
}

function shiftGestureRecurrence(lines: string[], previousStart: string, nextStart: string, allDay: boolean, timeZone?: string | null): string[] {
  try { return shiftGoogleRecurrenceSchedule(lines, previousStart, nextStart, allDay, timeZone); }
  catch (error) { throw new CoreStoreError(error instanceof Error ? error.message : "This repeat rule needs review before moving the series."); }
}

function recurrenceLinesFromStored(googleRecurrence: unknown, recurrence: unknown): string[] | null {
  return googleRecurrenceLines(googleRecurrence) ?? recurrenceLinesFromStructured(recurrence);
}

function recurrenceLinesForInput(input: JsonRecord): string[] | null {
  if (hasOwn(input, "recurrenceLines")) return requiredGoogleRecurrenceLines(input.recurrenceLines);
  return recurrenceLinesFromStructured(input.recurrence);
}

function recurrenceLinesFromStructured(value: unknown): string[] | null {
  const rule = recurrenceRuleFromStored(value);
  return rule ? [rule] : null;
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

function recurrenceRuleFromLines(lines: string[] | null): string | null {
  return lines?.find((line) => line.startsWith("RRULE:")) ?? null;
}

function ftsQuery(value: string): string | null {
  const terms = String(value)
    .trim()
    .split(/\s+/)
    .map((term) => term.replace(/[^\p{L}\p{N}_-]/gu, ""))
    .filter(Boolean)
    .slice(0, 12);
  return terms.length ? terms.map((term) => `"${term}"*`).join(" AND ") : null;
}

function timestamp(): string { return new Date().toISOString(); }
function isHistoricalSmokeNoteFixture(fixture: HistoricalSmokeNoteFixture): boolean {
  return /^smoke task \d{10,}$/.test(fixture.title) && fixture.body === historicalSmokeNoteBody;
}
function requiredIso(value: unknown, label: string): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new CoreStoreError(`${label} is invalid.`);
  return new Date(value).toISOString();
}
function stringValue(value: unknown): string { return typeof value === "string" ? value : ""; }
function nullableDate(value: unknown): string | null { return typeof value === "string" && value ? value : null; }
function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === "string" && item.length > 0))] : [];
}
function durationMinutes(start: string, end: string): number {
  return Math.max(0, Math.round((Date.parse(end) - Date.parse(start)) / 60_000));
}
function workingRange(date: string, hours: JsonRecord, settings: JsonRecord): { start: string; end: string } {
  const startMinute = workingMinute(hours.startMinutes, hours.start, settings.todayWorkingHoursStart, 9);
  const endMinute = workingMinute(hours.endMinutes, hours.end, settings.todayWorkingHoursEnd, 17);
  if (endMinute <= startMinute) {
    throw new CoreStoreError("End time must be after start time.");
  }
  const zone = typeof settings.defaultTimeZone === "string" && settings.defaultTimeZone ? settings.defaultTimeZone : "UTC";
  const start = zonedDateTime(date, Math.floor(startMinute / 60), startMinute % 60, zone);
  const end = zonedDateTime(date, Math.floor(endMinute / 60), endMinute % 60, zone);
  return { start, end };
}
function workingMinute(
  explicitMinutes: unknown,
  legacyHour: unknown,
  fallbackHour: unknown,
  defaultHour: number
): number {
  const minutes = Number(explicitMinutes);
  if (Number.isFinite(minutes)) return Math.max(0, Math.min(24 * 60, Math.round(minutes)));
  const hour = Number(legacyHour ?? fallbackHour);
  return Math.max(0, Math.min(24 * 60, Math.round((Number.isFinite(hour) ? hour : defaultHour) * 60)));
}
function zonedDateTime(date: string, hour: number, minute: number, timeZone: string): string {
  const [year, month, day] = date.split("-").map(Number);
  if (![year, month, day].every(Number.isFinite)) throw new CoreStoreError("Schedule date is invalid.");
  let instant = Date.UTC(year, month - 1, day, hour, minute, 0);
  const formatter = cachedDateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  });
  // Two passes account for a DST boundary between UTC and the requested wall
  // time. Persisted values are always UTC instants; only interpretation uses
  // the user's configured calendar timezone.
  for (let pass = 0; pass < 2; pass += 1) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(instant)).filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
    const displayed = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0);
    instant += Date.UTC(year, month - 1, day, hour, minute, 0) - displayed;
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
function smartScheduleCandidateScope(value: unknown): SmartScheduleCandidateScope {
  return value === "dueSoon" ? "dueSoon" : "allOpen";
}
function smartScheduleCandidateScopeLabel(scope: SmartScheduleCandidateScope): string {
  return scope === "allOpen"
    ? "All open top-level tasks"
    : "Overdue and due within 14 days";
}
function addPlannerDays(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime())) return date;
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}
function compareSchedulableTasks(left: JsonRecord, right: JsonRecord, scheduleDate: string): number {
  const priority = { high: 0, medium: 1, low: 2, none: 3 } as Record<string, number>;
  const dueDate = (task: JsonRecord) => taskDueDate(task.dueAt) ?? "9999-12-31";
  const dueRank = (task: JsonRecord) => {
    const due = taskDueDate(task.dueAt);
    if (!due) return 2;
    return due < scheduleDate ? 0 : 1;
  };
  return dueRank(left) - dueRank(right) ||
    dueDate(left).localeCompare(dueDate(right)) ||
    (priority[String(left.priority)] ?? 3) - (priority[String(right.priority)] ?? 3) ||
    String(left.sortOrder ?? "").localeCompare(String(right.sortOrder ?? "")) ||
    String(left.id ?? "").localeCompare(String(right.id ?? ""));
}
function smartScheduleDuration(value: unknown): number {
  return Math.max(5, Math.min(24 * 60, Number(value) || 30));
}
function taskDueDate(value: unknown): string | null {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;
}
function smartScheduleReason(scheduleDate: string, dueDate: string | null): string {
  if (!dueDate) return "No due date · first available slot.";
  if (dueDate < scheduleDate) return `Overdue · due ${formatPlannerDate(dueDate)}.`;
  if (dueDate === scheduleDate) return "Due today · first available slot.";
  return `Scheduled ahead of its ${formatPlannerDate(dueDate)} due date.`;
}
function formatPlannerDate(value: string): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime())
    ? cachedDateTimeFormat(undefined, { day: "numeric", month: "short", timeZone: "UTC" }).format(date)
    : value;
}
function formatPlannerDateTime(value: string, timeZone: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? cachedDateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short", timeZone }).format(date)
    : "a later time";
}
function formatAvailabilityTime(value: string, timeZone: string): string {
  return cachedDateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short", timeZone }).format(new Date(value));
}
function isFollowingScope(scope: unknown): boolean {
  return scope === "following" || scope === "seriesFuture" || scope === "thisAndFollowing" || scope === "future";
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
    recurrence: event.recurrence, recurrenceLines: recurrenceLinesFromStored(event.googleRecurrence, event.recurrence), attendees: event.attendees, reminders: event.reminders, remindersUseDefault: event.remindersUseDefault,
    transparency: event.transparency, visibility: event.visibility, timeZone: event.timeZone,
    attachments: event.attachments, eventType: event.eventType, focusTimeProperties: event.focusTimeProperties,
    outOfOfficeProperties: event.outOfOfficeProperties, workingLocationProperties: event.workingLocationProperties,
    selfResponseStatus: event.selfResponseStatus, hcbKind: event.hcbKind ?? null, tags: event.tags ?? []
  };
}
function eventUpdatePayload(event: JsonRecord): JsonRecord { return eventCreatePayload(event); }
function requiredText(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new CoreStoreError(`${label} is required`);
  return value.trim();
}

function normalizedCalendarEventTimeZone(value: unknown, fallback: string): string {
  const timeZone = typeof value === "string" && value.trim() ? value.trim() : fallback;
  try {
    Intl.DateTimeFormat(undefined, { timeZone }).format();
  } catch {
    throw new CoreStoreError("Event time zone must be a valid IANA time-zone name.");
  }
  return timeZone;
}
