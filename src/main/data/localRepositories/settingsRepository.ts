import { createHash, randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, normalize } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  portableArchiveManifestSchema,
  defaultSemanticSearchModels,
  type LocalPointerListRequest,
  type LocalPointerListResponse,
  type LocalPointerRepairRequest,
  type LocalPointerRepairResponse,
  type PortableArchiveManifest,
  type PortableExportResponse,
  type PortableImportPreview,
  type PortableImportResponse,
  type SettingsSnapshot,
  type SettingsUpdateRequest
} from "@shared/ipc/contracts";
import {
  defaultHistoryCategoryVisibility,
  defaultKeybindings,
  defaultLeaderKey,
  defaultLeaderKeybindings,
  defaultNavigationTabOrder,
  defaultToolbarActionOrder,
  hotkeyActionIds
} from "@shared/settingsCatalog";
import type { SqliteConnection } from "../sqliteConnection";
import { systemTimeZone, uniqueIds, validationFailure } from "./shared";

const PORTABLE_FORMAT_VERSION = 1;
const PORTABLE_STATE_FILE = "hot-cross-buns-2-state.json";
const PORTABLE_ATTACHMENT_DIR = "Attachments";
const PORTABLE_TABLES = [
  "google_accounts",
  "google_task_lists",
  "google_tasks",
  "google_calendar_lists",
  "google_calendar_events",
  "google_calendar_event_instances",
  "local_scheduled_task_blocks",
  "google_sync_checkpoints",
  "google_pending_mutations",
  "local_settings",
  "local_tags",
  "local_entity_tags",
  "local_agent_actions",
  "local_webhook_subscriptions",
  "local_webhook_deliveries",
  "local_ics_subscriptions",
  "local_semantic_embeddings",
  "local_chat_sessions",
  "local_chat_messages",
  "local_history_entries",
  "local_undo_entries",
  "local_search_index_state"
] as const;

const DEFAULT_SETTINGS: SettingsSnapshot = {
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
  navigationTabOrder: defaultNavigationTabOrder,
  toolbarActionOrder: defaultToolbarActionOrder,
  hiddenCalendarViewModes: [],
  showCompletedInCalendarViews: true,
  eventCompletionDefaultScope: "occurrence",
  calendarTimelineDensity: "compact",
  monthScrollPastMonths: 0,
  monthScrollFutureMonths: 1,
  quickCreateExpandedByDefault: false,
  restoreWindowStateEnabled: true,
  startOnLogin: false,
  keybindings: defaultKeybindings,
  leaderKey: defaultLeaderKey,
  leaderKeybindings: defaultLeaderKeybindings,
  selectedTaskListIds: [],
  selectedCalendarIds: [],
  setupCompletedAt: null,
  syncMode: "balanced",
  syncTasksEnabled: true,
  syncCalendarEventsEnabled: true,
  eventRetentionDaysBack: 0,
  completedTaskRetentionDaysBack: 365,
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
    tasks: {
      useCustomFilter: false,
      selectedTaskListIds: []
    },
    notes: {
      useCustomFilter: false,
      selectedTaskListIds: []
    }
  },
  portableExportOnlySelectedTaskLists: false,
  portableExportOnlySelectedCalendars: false,
  portableExportOnlyFutureCurrentEvents: false,
  dailyLocalBackupEnabled: false,
  localBackupRetentionCount: 14,
  lastLocalBackupAt: null,
  visibleHistoryEntryCount: 50,
  historyStorageCap: 5_000,
  historyCategoryVisibility: defaultHistoryCategoryVisibility,
  dismissedDuplicateGroupIds: [],
  taskTemplates: [],
  eventTemplates: [],
  noteTemplates: [],
  lastUpdateCheckAt: null,
  mcpEnabled: false,
  mcpPermissionMode: "confirm-writes",
  mcpPort: 0,
  defaultTimeZone: systemTimeZone(),
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
  semanticSearchModels: defaultSemanticSearchModels,
  agentActionTrayEnabled: true,
  webhooksEnabled: false
};

export class LocalSettingsRepository {
  private settingsReadCache: Map<string, string> | null = null;
  private cachedSnapshot: SettingsSnapshot | null = null;

  constructor(private readonly connection: SqliteConnection) {}

  get(): SettingsSnapshot {
    if (this.cachedSnapshot) {
      return this.cachedSnapshot;
    }

    const previousCache = this.settingsReadCache;
    this.settingsReadCache = this.readSettingsMap();
    const customMenuBarIcons = normalizeCustomMenuBarIcons(
      this.readSetting("tray", "customIcons", DEFAULT_SETTINGS.customMenuBarIcons)
    );
    const menuBarCalendarIconId = normalizeMenuBarCalendarIconId(
      this.readSetting("tray", "calendarIconId", DEFAULT_SETTINGS.menuBarCalendarIconId),
      customMenuBarIcons
    );

    try {
      const snapshot: SettingsSnapshot = {
      theme: this.readSetting("appearance", "theme", DEFAULT_SETTINGS.theme),
      colorTheme: this.readSetting("appearance", "colorTheme", DEFAULT_SETTINGS.colorTheme),
      customBackground: this.readSetting(
        "appearance",
        "customBackground",
        DEFAULT_SETTINGS.customBackground
      ),
      useInferredBackgroundTheme: this.readSetting(
        "appearance",
        "useInferredBackgroundTheme",
        DEFAULT_SETTINGS.useInferredBackgroundTheme
      ),
      appLanguage: this.readSetting("app", "language", DEFAULT_SETTINGS.appLanguage),
      uiFontName: this.readSetting("appearance", "uiFontName", DEFAULT_SETTINGS.uiFontName),
      uiTextSizePoints: this.readSetting(
        "appearance",
        "uiTextSizePoints",
        DEFAULT_SETTINGS.uiTextSizePoints
      ),
      perSurfaceFontOverrides: this.readSetting(
        "appearance",
        "perSurfaceFontOverrides",
        DEFAULT_SETTINGS.perSurfaceFontOverrides
      ),
      calendarEventColorOverrides: this.readSetting(
        "calendar",
        "eventColorOverrides",
        DEFAULT_SETTINGS.calendarEventColorOverrides
      ),
      autoTagRules: this.readSetting("tags", "autoRules", DEFAULT_SETTINGS.autoTagRules),
      autoTagBackgroundReapplyMode: this.readSetting(
        "tags",
        "backgroundReapplyMode",
        DEFAULT_SETTINGS.autoTagBackgroundReapplyMode
      ),
      disableAnimations: this.readSetting(
        "appearance",
        "disableAnimations",
        DEFAULT_SETTINGS.disableAnimations
      ),
      uiLayoutScale: this.readSetting("appearance", "uiLayoutScale", DEFAULT_SETTINGS.uiLayoutScale),
      navigationPlacement: this.readSetting(
        "appearance",
        "navigationPlacement",
        DEFAULT_SETTINGS.navigationPlacement
      ),
      hiddenNavigationTabs: this.readSetting(
        "appearance",
        "hiddenNavigationTabs",
        DEFAULT_SETTINGS.hiddenNavigationTabs
      ),
      navigationTabOrder: normalizeOrder(
        this.readSetting("appearance", "navigationTabOrder", DEFAULT_SETTINGS.navigationTabOrder),
        defaultNavigationTabOrder
      ),
      toolbarActionOrder: normalizeOrder(
        this.readSetting("appearance", "toolbarActionOrder", DEFAULT_SETTINGS.toolbarActionOrder),
        defaultToolbarActionOrder
      ),
      hiddenCalendarViewModes: this.readSetting(
        "appearance",
        "hiddenCalendarViewModes",
        DEFAULT_SETTINGS.hiddenCalendarViewModes
      ),
      showCompletedInCalendarViews: this.readSetting(
        "calendar",
        "showCompletedInViews",
        DEFAULT_SETTINGS.showCompletedInCalendarViews
      ),
      eventCompletionDefaultScope: normalizeEventCompletionDefaultScope(
        this.readSetting(
          "calendar",
          "eventCompletionDefaultScope",
          DEFAULT_SETTINGS.eventCompletionDefaultScope
        )
      ),
      calendarTimelineDensity: this.readSetting(
        "calendar",
        "timelineDensity",
        DEFAULT_SETTINGS.calendarTimelineDensity
      ),
      monthScrollPastMonths: this.readSetting(
        "appearance",
        "monthScrollPastMonths",
        DEFAULT_SETTINGS.monthScrollPastMonths
      ),
      monthScrollFutureMonths: this.readSetting(
        "appearance",
        "monthScrollFutureMonths",
        DEFAULT_SETTINGS.monthScrollFutureMonths
      ),
      quickCreateExpandedByDefault: this.readSetting(
        "appearance",
        "quickCreateExpandedByDefault",
        DEFAULT_SETTINGS.quickCreateExpandedByDefault
      ),
      restoreWindowStateEnabled: this.readSetting(
        "appearance",
        "restoreWindowStateEnabled",
        DEFAULT_SETTINGS.restoreWindowStateEnabled
      ),
      startOnLogin: this.readSetting("app", "startOnLogin", DEFAULT_SETTINGS.startOnLogin),
      keybindings: this.readKeybindings(),
      leaderKey: this.readSetting("hotkeys", "leaderKey", DEFAULT_SETTINGS.leaderKey),
      leaderKeybindings: this.readLeaderKeybindings(),
      selectedTaskListIds: this.readSetting(
        "google",
        "selectedTaskListIds",
        this.defaultSelectedTaskListIds()
      ),
      selectedCalendarIds: this.readSetting(
        "google",
        "selectedCalendarIds",
        this.defaultSelectedCalendarIds()
      ),
      setupCompletedAt: this.readSetting(
        "app",
        "setupCompletedAt",
        DEFAULT_SETTINGS.setupCompletedAt
      ),
      syncMode: this.readSetting("sync", "mode", DEFAULT_SETTINGS.syncMode),
      syncTasksEnabled: this.readSetting("sync", "tasksEnabled", DEFAULT_SETTINGS.syncTasksEnabled),
      syncCalendarEventsEnabled: this.readSetting(
        "sync",
        "calendarEventsEnabled",
        DEFAULT_SETTINGS.syncCalendarEventsEnabled
      ),
      eventRetentionDaysBack: this.readSetting(
        "sync",
        "eventRetentionDaysBack",
        DEFAULT_SETTINGS.eventRetentionDaysBack
      ),
      completedTaskRetentionDaysBack: this.readSetting(
        "sync",
        "completedTaskRetentionDaysBack",
        DEFAULT_SETTINGS.completedTaskRetentionDaysBack
      ),
      showTrayIcon: this.readSetting("tray", "showIcon", DEFAULT_SETTINGS.showTrayIcon),
      trayClickAction: normalizeTrayClickAction(
        this.readSetting("tray", "clickAction", DEFAULT_SETTINGS.trayClickAction)
      ),
      menuBarPanelStyle: normalizeMenuBarPanelStyle(
        this.readSetting("tray", "panelStyle", DEFAULT_SETTINGS.menuBarPanelStyle)
      ),
      menuBarIconName: normalizeMenuBarIconName(
        this.readSetting("tray", "iconName", DEFAULT_SETTINGS.menuBarIconName)
      ),
      menuBarCalendarIconId,
      menuBarCalendarDoneMode: normalizeMenuBarCalendarDoneMode(
        this.readSetting("tray", "calendarDoneMode", DEFAULT_SETTINGS.menuBarCalendarDoneMode)
      ),
      customMenuBarIcons,
      showMenuBarBadge: this.readSetting("tray", "showBadge", DEFAULT_SETTINGS.showMenuBarBadge),
      showDockBadge: this.readSetting("dock", "showBadge", DEFAULT_SETTINGS.showDockBadge),
      notificationsEnabled: this.readSetting(
        "notifications",
        "enabled",
        DEFAULT_SETTINGS.notificationsEnabled
      ),
      notificationLeadMinutes: this.readSetting(
        "notifications",
        "leadMinutes",
        DEFAULT_SETTINGS.notificationLeadMinutes
      ),
      taskCompletionSoundEnabled: this.readSetting(
        "sounds",
        "taskCompletionEnabled",
        DEFAULT_SETTINGS.taskCompletionSoundEnabled
      ),
      taskCompletionSoundId: this.readSetting(
        "sounds",
        "taskCompletionId",
        DEFAULT_SETTINGS.taskCompletionSoundId
      ),
      eventCompletionSoundEnabled: this.readSetting(
        "sounds",
        "eventCompletionEnabled",
        DEFAULT_SETTINGS.eventCompletionSoundEnabled
      ),
      eventCompletionSoundId: this.readSetting(
        "sounds",
        "eventCompletionId",
        DEFAULT_SETTINGS.eventCompletionSoundId
      ),
      importedSoundCount: this.readSetting(
        "sounds",
        "importedCount",
        DEFAULT_SETTINGS.importedSoundCount
      ),
      perTabListFilters: this.readSetting(
        "filters",
        "perTabListFilters",
        DEFAULT_SETTINGS.perTabListFilters
      ),
      portableExportOnlySelectedTaskLists: this.readSetting(
        "portable",
        "onlySelectedTaskLists",
        DEFAULT_SETTINGS.portableExportOnlySelectedTaskLists
      ),
      portableExportOnlySelectedCalendars: this.readSetting(
        "portable",
        "onlySelectedCalendars",
        DEFAULT_SETTINGS.portableExportOnlySelectedCalendars
      ),
      portableExportOnlyFutureCurrentEvents: this.readSetting(
        "portable",
        "onlyFutureCurrentEvents",
        DEFAULT_SETTINGS.portableExportOnlyFutureCurrentEvents
      ),
      dailyLocalBackupEnabled: this.readSetting(
        "backups",
        "dailyEnabled",
        DEFAULT_SETTINGS.dailyLocalBackupEnabled
      ),
      localBackupRetentionCount: this.readSetting(
        "backups",
        "retentionCount",
        DEFAULT_SETTINGS.localBackupRetentionCount
      ),
      lastLocalBackupAt: this.readSetting(
        "backups",
        "lastBackupAt",
        DEFAULT_SETTINGS.lastLocalBackupAt
      ),
      visibleHistoryEntryCount: this.readSetting(
        "history",
        "visibleEntryCount",
        DEFAULT_SETTINGS.visibleHistoryEntryCount
      ),
      historyStorageCap: this.readSetting(
        "history",
        "storageCap",
        DEFAULT_SETTINGS.historyStorageCap
      ),
      historyCategoryVisibility: this.readSetting(
        "history",
        "categoryVisibility",
        DEFAULT_SETTINGS.historyCategoryVisibility
      ),
      dismissedDuplicateGroupIds: this.readSetting(
        "duplicates",
        "dismissedGroupIds",
        DEFAULT_SETTINGS.dismissedDuplicateGroupIds
      ),
      taskTemplates: this.readSetting("templates", "tasks", DEFAULT_SETTINGS.taskTemplates),
      eventTemplates: this.readSetting("templates", "events", DEFAULT_SETTINGS.eventTemplates),
      noteTemplates: this.readSetting("templates", "notes", DEFAULT_SETTINGS.noteTemplates),
      lastUpdateCheckAt: this.readSetting(
        "updates",
        "lastCheckAt",
        DEFAULT_SETTINGS.lastUpdateCheckAt
      ),
      mcpEnabled: this.readSetting("mcp", "enabled", DEFAULT_SETTINGS.mcpEnabled),
      mcpPermissionMode: this.readSetting(
        "mcp",
        "permissionMode",
        DEFAULT_SETTINGS.mcpPermissionMode
      ),
      mcpPort: this.readSetting("mcp", "port", DEFAULT_SETTINGS.mcpPort),
      defaultTimeZone: this.readSetting(
        "calendar",
        "defaultTimeZone",
        DEFAULT_SETTINGS.defaultTimeZone
      ),
      todayCapacityMinutes: this.readSetting(
        "today",
        "capacityMinutes",
        DEFAULT_SETTINGS.todayCapacityMinutes
      ),
      todayWorkingHoursStart: this.readSetting(
        "today",
        "workingHoursStart",
        DEFAULT_SETTINGS.todayWorkingHoursStart
      ),
      todayWorkingHoursEnd: this.readSetting(
        "today",
        "workingHoursEnd",
        DEFAULT_SETTINGS.todayWorkingHoursEnd
      ),
      diagnosticsIncludePerformance: this.readSetting(
        "diagnostics",
        "includePerformance",
        DEFAULT_SETTINGS.diagnosticsIncludePerformance
      ),
      rawGoogleDiagnosticsEnabled: this.readSetting(
        "diagnostics",
        "rawGooglePayloads",
        DEFAULT_SETTINGS.rawGoogleDiagnosticsEnabled
      ),
      savedSearchViews: this.readSetting(
        "search",
        "savedViews",
        DEFAULT_SETTINGS.savedSearchViews
      ),
      pinnedSavedSearchViewIds: this.readSetting(
        "search",
        "pinnedSavedViewIds",
        DEFAULT_SETTINGS.pinnedSavedSearchViewIds
      ),
      savedTaskViews: this.readSetting(
        "tasks",
        "savedViews",
        DEFAULT_SETTINGS.savedTaskViews
      ),
      semanticSearchEnabled: this.readSetting(
        "search",
        "semanticEnabled",
        DEFAULT_SETTINGS.semanticSearchEnabled
      ),
      semanticSearchMode: this.readSetting(
        "search",
        "semanticMode",
        DEFAULT_SETTINGS.semanticSearchMode
      ),
      embeddingModelId: this.readSetting(
        "search",
        "embeddingModelId",
        DEFAULT_SETTINGS.embeddingModelId
      ),
      semanticSearchModels: normalizeSemanticModels(this.readSetting(
        "search",
        "semanticModels",
        DEFAULT_SETTINGS.semanticSearchModels
      )),
      agentActionTrayEnabled: this.readSetting(
        "agent",
        "actionTrayEnabled",
        DEFAULT_SETTINGS.agentActionTrayEnabled
      ),
      webhooksEnabled: this.readSetting("webhooks", "enabled", DEFAULT_SETTINGS.webhooksEnabled)
      };

      this.cachedSnapshot = snapshot;
      return snapshot;
    } finally {
      this.settingsReadCache = previousCache;
    }
  }

  update(request: SettingsUpdateRequest): SettingsSnapshot {
    const now = new Date().toISOString();

    if (request.theme !== undefined) {
      this.writeSetting("appearance", "theme", request.theme, now);
    }

    if (request.colorTheme !== undefined) {
      this.writeSetting("appearance", "colorTheme", request.colorTheme, now);
    }

    if (request.customBackground !== undefined) {
      this.writeSetting("appearance", "customBackground", request.customBackground, now);
    }

    if (request.useInferredBackgroundTheme !== undefined) {
      this.writeSetting("appearance", "useInferredBackgroundTheme", request.useInferredBackgroundTheme, now);
    }

    if (request.appLanguage !== undefined) {
      this.writeSetting("app", "language", request.appLanguage, now);
    }

    if (request.uiFontName !== undefined) {
      this.writeSetting("appearance", "uiFontName", request.uiFontName, now);
    }

    if (request.uiTextSizePoints !== undefined) {
      this.writeSetting("appearance", "uiTextSizePoints", request.uiTextSizePoints, now);
    }

    if (request.perSurfaceFontOverrides !== undefined) {
      this.writeSetting("appearance", "perSurfaceFontOverrides", request.perSurfaceFontOverrides, now);
    }

    if (request.calendarEventColorOverrides !== undefined) {
      this.writeSetting("calendar", "eventColorOverrides", request.calendarEventColorOverrides, now);
    }

    if (request.autoTagRules !== undefined) {
      this.writeSetting("tags", "autoRules", request.autoTagRules, now);
    }

    if (request.autoTagBackgroundReapplyMode !== undefined) {
      this.writeSetting("tags", "backgroundReapplyMode", request.autoTagBackgroundReapplyMode, now);
    }

    if (request.disableAnimations !== undefined) {
      this.writeSetting("appearance", "disableAnimations", request.disableAnimations, now);
    }

    if (request.uiLayoutScale !== undefined) {
      this.writeSetting("appearance", "uiLayoutScale", request.uiLayoutScale, now);
    }

    if (request.navigationPlacement !== undefined) {
      this.writeSetting("appearance", "navigationPlacement", request.navigationPlacement, now);
    }

    if (request.hiddenNavigationTabs !== undefined) {
      this.writeSetting("appearance", "hiddenNavigationTabs", request.hiddenNavigationTabs, now);
    }

    if (request.navigationTabOrder !== undefined) {
      this.writeSetting(
        "appearance",
        "navigationTabOrder",
        normalizeOrder(request.navigationTabOrder, defaultNavigationTabOrder),
        now
      );
    }

    if (request.toolbarActionOrder !== undefined) {
      this.writeSetting(
        "appearance",
        "toolbarActionOrder",
        normalizeOrder(request.toolbarActionOrder, defaultToolbarActionOrder),
        now
      );
    }

    if (request.hiddenCalendarViewModes !== undefined) {
      this.writeSetting("appearance", "hiddenCalendarViewModes", request.hiddenCalendarViewModes, now);
    }

    if (request.showCompletedInCalendarViews !== undefined) {
      this.writeSetting("calendar", "showCompletedInViews", request.showCompletedInCalendarViews, now);
    }

    if (request.eventCompletionDefaultScope !== undefined) {
      this.writeSetting(
        "calendar",
        "eventCompletionDefaultScope",
        request.eventCompletionDefaultScope,
        now
      );
    }

    if (request.calendarTimelineDensity !== undefined) {
      this.writeSetting("calendar", "timelineDensity", request.calendarTimelineDensity, now);
    }

    if (request.monthScrollPastMonths !== undefined) {
      this.writeSetting("appearance", "monthScrollPastMonths", request.monthScrollPastMonths, now);
    }

    if (request.monthScrollFutureMonths !== undefined) {
      this.writeSetting("appearance", "monthScrollFutureMonths", request.monthScrollFutureMonths, now);
    }

    if (request.quickCreateExpandedByDefault !== undefined) {
      this.writeSetting(
        "appearance",
        "quickCreateExpandedByDefault",
        request.quickCreateExpandedByDefault,
        now
      );
    }

    if (request.restoreWindowStateEnabled !== undefined) {
      this.writeSetting(
        "appearance",
        "restoreWindowStateEnabled",
        request.restoreWindowStateEnabled,
        now
      );
    }

    if (request.startOnLogin !== undefined) {
      this.writeSetting("app", "startOnLogin", request.startOnLogin, now);
    }

    if (request.keybindings !== undefined) {
      const keybindings = normalizeKeybindings(request.keybindings);
      this.writeSetting("hotkeys", "keybindings", keybindings, now);
    }

    if (request.leaderKey !== undefined) {
      this.writeSetting("hotkeys", "leaderKey", request.leaderKey, now);
    }

    if (request.leaderKeybindings !== undefined) {
      this.writeSetting("hotkeys", "leaderKeybindings", normalizeLeaderKeybindings(request.leaderKeybindings), now);
    }

    if (request.selectedTaskListIds !== undefined) {
      this.writeSetting("google", "selectedTaskListIds", uniqueIds(request.selectedTaskListIds), now);
    }

    if (request.selectedCalendarIds !== undefined) {
      this.writeSetting("google", "selectedCalendarIds", uniqueIds(request.selectedCalendarIds), now);
    }

    if (request.setupCompletedAt !== undefined) {
      this.writeSetting("app", "setupCompletedAt", request.setupCompletedAt, now);
    }

    if (request.syncMode !== undefined) {
      this.writeSetting("sync", "mode", request.syncMode, now);
    }

    if (request.syncTasksEnabled !== undefined) {
      this.writeSetting("sync", "tasksEnabled", request.syncTasksEnabled, now);
    }

    if (request.syncCalendarEventsEnabled !== undefined) {
      this.writeSetting("sync", "calendarEventsEnabled", request.syncCalendarEventsEnabled, now);
    }

    if (request.eventRetentionDaysBack !== undefined) {
      this.writeSetting("sync", "eventRetentionDaysBack", request.eventRetentionDaysBack, now);
    }

    if (request.completedTaskRetentionDaysBack !== undefined) {
      this.writeSetting(
        "sync",
        "completedTaskRetentionDaysBack",
        request.completedTaskRetentionDaysBack,
        now
      );
    }

    if (request.showTrayIcon !== undefined) {
      this.writeSetting("tray", "showIcon", request.showTrayIcon, now);
    }

    if (request.trayClickAction !== undefined) {
      this.writeSetting("tray", "clickAction", request.trayClickAction, now);
    }

    if (request.menuBarPanelStyle !== undefined) {
      this.writeSetting("tray", "panelStyle", request.menuBarPanelStyle, now);
    }

    if (request.menuBarIconName !== undefined) {
      this.writeSetting("tray", "iconName", request.menuBarIconName, now);
    }

    if (request.menuBarCalendarIconId !== undefined) {
      this.writeSetting("tray", "calendarIconId", request.menuBarCalendarIconId, now);
    }

    if (request.menuBarCalendarDoneMode !== undefined) {
      this.writeSetting("tray", "calendarDoneMode", request.menuBarCalendarDoneMode, now);
    }

    if (request.customMenuBarIcons !== undefined) {
      this.writeSetting("tray", "customIcons", request.customMenuBarIcons, now);
    }

    if (request.showMenuBarBadge !== undefined) {
      this.writeSetting("tray", "showBadge", request.showMenuBarBadge, now);
    }

    if (request.showDockBadge !== undefined) {
      this.writeSetting("dock", "showBadge", request.showDockBadge, now);
    }

    if (request.notificationsEnabled !== undefined) {
      this.writeSetting("notifications", "enabled", request.notificationsEnabled, now);
    }

    if (request.notificationLeadMinutes !== undefined) {
      this.writeSetting("notifications", "leadMinutes", request.notificationLeadMinutes, now);
    }

    if (request.taskCompletionSoundEnabled !== undefined) {
      this.writeSetting("sounds", "taskCompletionEnabled", request.taskCompletionSoundEnabled, now);
    }

    if (request.taskCompletionSoundId !== undefined) {
      this.writeSetting("sounds", "taskCompletionId", request.taskCompletionSoundId, now);
    }

    if (request.eventCompletionSoundEnabled !== undefined) {
      this.writeSetting("sounds", "eventCompletionEnabled", request.eventCompletionSoundEnabled, now);
    }

    if (request.eventCompletionSoundId !== undefined) {
      this.writeSetting("sounds", "eventCompletionId", request.eventCompletionSoundId, now);
    }

    if (request.importedSoundCount !== undefined) {
      this.writeSetting("sounds", "importedCount", request.importedSoundCount, now);
    }

    if (request.perTabListFilters !== undefined) {
      this.writeSetting("filters", "perTabListFilters", request.perTabListFilters, now);
    }

    if (request.portableExportOnlySelectedTaskLists !== undefined) {
      this.writeSetting("portable", "onlySelectedTaskLists", request.portableExportOnlySelectedTaskLists, now);
    }

    if (request.portableExportOnlySelectedCalendars !== undefined) {
      this.writeSetting("portable", "onlySelectedCalendars", request.portableExportOnlySelectedCalendars, now);
    }

    if (request.portableExportOnlyFutureCurrentEvents !== undefined) {
      this.writeSetting("portable", "onlyFutureCurrentEvents", request.portableExportOnlyFutureCurrentEvents, now);
    }

    if (request.dailyLocalBackupEnabled !== undefined) {
      this.writeSetting("backups", "dailyEnabled", request.dailyLocalBackupEnabled, now);
    }

    if (request.localBackupRetentionCount !== undefined) {
      this.writeSetting("backups", "retentionCount", request.localBackupRetentionCount, now);
    }

    if (request.lastLocalBackupAt !== undefined) {
      this.writeSetting("backups", "lastBackupAt", request.lastLocalBackupAt, now);
    }

    if (request.visibleHistoryEntryCount !== undefined) {
      this.writeSetting("history", "visibleEntryCount", request.visibleHistoryEntryCount, now);
    }

    if (request.historyStorageCap !== undefined) {
      this.writeSetting("history", "storageCap", request.historyStorageCap, now);
    }

    if (request.historyCategoryVisibility !== undefined) {
      this.writeSetting("history", "categoryVisibility", request.historyCategoryVisibility, now);
    }

    if (request.dismissedDuplicateGroupIds !== undefined) {
      this.writeSetting("duplicates", "dismissedGroupIds", uniqueIds(request.dismissedDuplicateGroupIds), now);
    }

    if (request.taskTemplates !== undefined) {
      this.writeSetting("templates", "tasks", request.taskTemplates, now);
    }

    if (request.eventTemplates !== undefined) {
      this.writeSetting("templates", "events", request.eventTemplates, now);
    }

    if (request.noteTemplates !== undefined) {
      this.writeSetting("templates", "notes", request.noteTemplates, now);
    }

    if (request.lastUpdateCheckAt !== undefined) {
      this.writeSetting("updates", "lastCheckAt", request.lastUpdateCheckAt, now);
    }

    if (request.mcpEnabled !== undefined) {
      this.writeSetting("mcp", "enabled", request.mcpEnabled, now);
    }

    if (request.mcpPermissionMode !== undefined) {
      this.writeSetting("mcp", "permissionMode", request.mcpPermissionMode, now);
    }

    if (request.mcpPort !== undefined) {
      this.writeSetting("mcp", "port", request.mcpPort, now);
    }

    if (request.defaultTimeZone !== undefined) {
      this.writeSetting("calendar", "defaultTimeZone", request.defaultTimeZone, now);
    }

    if (request.todayCapacityMinutes !== undefined) {
      this.writeSetting("today", "capacityMinutes", request.todayCapacityMinutes, now);
    }

    if (request.todayWorkingHoursStart !== undefined) {
      this.writeSetting("today", "workingHoursStart", request.todayWorkingHoursStart, now);
    }

    if (request.todayWorkingHoursEnd !== undefined) {
      this.writeSetting("today", "workingHoursEnd", request.todayWorkingHoursEnd, now);
    }

    if (request.diagnosticsIncludePerformance !== undefined) {
      this.writeSetting(
        "diagnostics",
        "includePerformance",
        request.diagnosticsIncludePerformance,
        now
      );
    }

    if (request.rawGoogleDiagnosticsEnabled !== undefined) {
      this.writeSetting(
        "diagnostics",
        "rawGooglePayloads",
        request.rawGoogleDiagnosticsEnabled,
        now
      );
    }

    if (request.savedSearchViews !== undefined) {
      this.writeSetting("search", "savedViews", request.savedSearchViews, now);
    }

    if (request.pinnedSavedSearchViewIds !== undefined) {
      this.writeSetting("search", "pinnedSavedViewIds", request.pinnedSavedSearchViewIds, now);
    }

    if (request.savedTaskViews !== undefined) {
      this.writeSetting("tasks", "savedViews", request.savedTaskViews, now);
    }

    if (request.semanticSearchEnabled !== undefined) {
      this.writeSetting("search", "semanticEnabled", request.semanticSearchEnabled, now);
    }

    if (request.semanticSearchMode !== undefined) {
      this.writeSetting("search", "semanticMode", request.semanticSearchMode, now);
    }

    if (request.embeddingModelId !== undefined) {
      this.writeSetting("search", "embeddingModelId", request.embeddingModelId, now);
    }

    if (request.semanticSearchModels !== undefined) {
      this.writeSetting("search", "semanticModels", normalizeSemanticModels(request.semanticSearchModels), now);
    }

    if (request.agentActionTrayEnabled !== undefined) {
      this.writeSetting("agent", "actionTrayEnabled", request.agentActionTrayEnabled, now);
    }

    if (request.webhooksEnabled !== undefined) {
      this.writeSetting("webhooks", "enabled", request.webhooksEnabled, now);
    }

    return this.get();
  }

  resetMcpTokenRevision(now = new Date().toISOString()): { tokenState: "rotated"; resetAt: string } {
    this.writeSetting("mcp", "tokenRevision", `rev:${randomUUID()}`, now);
    this.writeSetting("mcp", "tokenResetAt", now, now);

    return {
      tokenState: "rotated",
      resetAt: now
    };
  }

  mcpTokenState(): {
    tokenState: "not_configured" | "configured" | "rotated";
    lastTokenResetAt?: string;
  } {
    const tokenRevision = this.readSetting<string | null>("mcp", "tokenRevision", null);
    const lastTokenResetAt = this.readSetting<string | null>("mcp", "tokenResetAt", null);

    if (lastTokenResetAt) {
      return {
        tokenState: "rotated",
        lastTokenResetAt
      };
    }

    return {
      tokenState: tokenRevision ? "configured" : "not_configured"
    };
  }

  createLocalBackup(now = new Date().toISOString()): { path: string; backedUpAt: string } {
    const backupsDirectory = join(dirname(this.connection.databasePath), "Backups");
    const fileSafeTimestamp = now.replace(/[:.]/g, "-");
    const backupPath = join(backupsDirectory, `hot-cross-buns-2-${fileSafeTimestamp}.sqlite3`);

    mkdirSync(backupsDirectory, { recursive: true });
    this.connection.run("PRAGMA wal_checkpoint(FULL);");
    copyFileSync(this.connection.databasePath, backupPath);
    this.writeSetting("backups", "lastBackupAt", now, now);

    return {
      path: backupPath,
      backedUpAt: now
    };
  }

  exportPortableArchive(now = new Date().toISOString()): PortableExportResponse {
    const exportDirectory = join(
      dirname(this.connection.databasePath),
      "PortableExports",
      `hot-cross-buns-2-${now.replace(/[:.]/g, "-")}.hcbexport`
    );
    const attachmentDirectory = join(exportDirectory, PORTABLE_ATTACHMENT_DIR);
    const state = this.portableState(now, this.get());
    const attachments = this.collectPortableAttachments(state, attachmentDirectory);
    const stateJson = `${stableJson(state)}\n`;
    const manifest: PortableArchiveManifest = {
      formatVersion: PORTABLE_FORMAT_VERSION,
      exportedAt: now,
      appVersion: "0.0.0",
      stateFile: PORTABLE_STATE_FILE,
      stateSha256: sha256Buffer(Buffer.from(stateJson, "utf8")),
      attachmentDirectory: PORTABLE_ATTACHMENT_DIR,
      attachments: attachments.attachments,
      skippedPointers: attachments.skippedPointers,
      notes: [
        "Portable migration archive. Import replaces the local cache after preview and backup.",
        "Google remains the source of truth for synced tasks and calendar data."
      ]
    };

    mkdirSync(exportDirectory, { recursive: true });
    mkdirSync(attachmentDirectory, { recursive: true });
    writeFileSync(join(exportDirectory, PORTABLE_STATE_FILE), stateJson, "utf8");
    writeFileSync(join(exportDirectory, "manifest.json"), `${stableJson(manifest)}\n`, "utf8");

    return {
      path: exportDirectory,
      exportedAt: now,
      manifest
    };
  }

  previewPortableImport(archivePath: string): PortableImportPreview {
    const archive = this.readPortableArchive(archivePath);
    const current = this.portableState();
    const attachmentHealth = this.portableAttachmentHealth(archivePath, archive.manifest);

    return {
      path: archivePath,
      exportedAt: archive.manifest.exportedAt,
      formatVersion: archive.manifest.formatVersion,
      destructive: true,
      tasks: portableTableDiff(current, archive.state, "google_tasks"),
      events: portableTableDiff(current, archive.state, "google_calendar_events"),
      calendars: portableTableDiff(current, archive.state, "google_calendar_lists"),
      taskLists: portableTableDiff(current, archive.state, "google_task_lists"),
      settingsWillChange:
        stableJson(current.tables.local_settings?.rows ?? []) !==
        stableJson(archive.state.tables.local_settings?.rows ?? []),
      queuedMutationCount: archive.state.tables.google_pending_mutations?.rows.length ?? 0,
      attachments: {
        bundled: archive.manifest.attachments.length,
        missing: attachmentHealth.missing,
        corrupt: attachmentHealth.corrupt,
        skipped: archive.manifest.skippedPointers.length
      },
      items: {
        tasks: portableTableDiffItems(current, archive.state, "google_tasks", "title"),
        events: portableTableDiffItems(current, archive.state, "google_calendar_events", "summary"),
        calendars: portableTableDiffItems(current, archive.state, "google_calendar_lists", "summary"),
        taskLists: portableTableDiffItems(current, archive.state, "google_task_lists", "title")
      }
    };
  }

  importPortableArchive(archivePath: string, now = new Date().toISOString()): PortableImportResponse {
    const archive = this.readPortableArchive(archivePath);
    const preview = this.previewPortableImport(archivePath);
    const backup = this.createLocalBackup(now);
    const rewrittenState = this.rewritePortableAttachmentPointers(archivePath, archive.state, archive.manifest);
    const operations = this.portableImportOperations(rewrittenState);

    this.connection.executeTransaction(operations);
    this.rebuildPortableFts();
    this.cachedSnapshot = null;
    this.settingsReadCache = null;

    return {
      importedAt: now,
      backupPath: backup.path,
      preview
    };
  }

  listLocalPointers(request: LocalPointerListRequest): LocalPointerListResponse {
    const limit = Math.max(1, Math.min(500, request.limit ?? 100));
    const includeHealthy = request.includeHealthy === true;
    const rows = this.localPointerRows()
      .filter((row) => includeHealthy || !row.exists)
      .slice(0, limit);

    return {
      items: rows,
      totalKnown: rows.length
    };
  }

  repairLocalPointer(
    request: LocalPointerRepairRequest,
    now = new Date().toISOString()
  ): LocalPointerRepairResponse {
    const replacementPointer = request.replacementPath.trim().startsWith("file://")
      ? request.replacementPath.trim()
      : pathToFileURL(request.replacementPath.trim()).href;
    const affected = this.localPointerRows()
      .filter((row) => row.pointer === request.pointer);
    let updated = 0;
    const operations = [];

    for (const row of affected) {
      if (row.kind === "event") {
        const event = this.connection.get<{
          id: string;
          accountId: string;
          description: string | null;
        }>(
          `SELECT id, account_id AS accountId, description
           FROM google_calendar_events
           WHERE id = ? AND deleted_at IS NULL
           LIMIT 1;`,
          [row.entityId]
        );
        const next = replaceExactPointer(event?.description ?? "", request.pointer, replacementPointer);

        if (!event || next === (event.description ?? "")) {
          continue;
        }

        operations.push(
          {
            kind: "run" as const,
            sql: "UPDATE google_calendar_events SET description = ?, updated_at = ? WHERE id = ?;",
            params: [next, now, row.entityId]
          },
          pendingMutationOperation({
            id: `mutation:event:${randomUUID()}`,
            accountId: event.accountId,
            resourceType: "event",
            resourceId: row.entityId,
            operation: "calendar.events.update",
            payload: { id: row.entityId, pointerRepair: true },
            now
          })
        );
        updated += 1;
      } else {
        const task = this.connection.get<{
          id: string;
          accountId: string | null;
          notes: string | null;
        }>(
          `SELECT id, account_id AS accountId, notes
           FROM google_tasks
           WHERE id = ? AND deleted_at IS NULL
           LIMIT 1;`,
          [row.entityId]
        );
        const next = replaceExactPointer(task?.notes ?? "", request.pointer, replacementPointer);

        if (!task || next === (task.notes ?? "")) {
          continue;
        }

        operations.push(
          {
            kind: "run" as const,
            sql: "UPDATE google_tasks SET notes = ?, updated_at = ? WHERE id = ?;",
            params: [next, now, row.entityId]
          },
          pendingMutationOperation({
            id: `mutation:task:${randomUUID()}`,
            accountId: task.accountId,
            resourceType: "task",
            resourceId: row.entityId,
            operation: "task.update",
            payload: { id: row.entityId, pointerRepair: true },
            now
          })
        );
        updated += 1;
      }
    }

    this.connection.executeTransaction(operations);

    return {
      pointer: request.pointer,
      replacementPointer,
      updated,
      queued: updated > 0,
      revision: now
    };
  }

  private localPointerRows(): LocalPointerListResponse["items"] {
    const rows: LocalPointerListResponse["items"] = [];
    const tasks = this.connection.query<{
      id: string;
      title: string;
      notes: string | null;
    }>(
      `SELECT id, title, notes
       FROM google_tasks
       WHERE deleted_at IS NULL
         AND notes IS NOT NULL
         AND notes LIKE '%file://%';`
    );
    const events = this.connection.query<{
      id: string;
      title: string;
      description: string | null;
    }>(
      `SELECT id, summary AS title, description
       FROM google_calendar_events
       WHERE deleted_at IS NULL
         AND status != 'cancelled'
         AND description IS NOT NULL
         AND description LIKE '%file://%';`
    );

    for (const task of tasks) {
      for (const pointer of filePointersFromText(task.notes ?? "")) {
        rows.push({
          pointer,
          kind: "task",
          entityId: task.id,
          title: task.title,
          exists: pointerExists(pointer)
        });
      }
    }

    for (const event of events) {
      for (const pointer of filePointersFromText(event.description ?? "")) {
        rows.push({
          pointer,
          kind: "event",
          entityId: event.id,
          title: event.title,
          exists: pointerExists(pointer)
        });
      }
    }

    return rows;
  }

  private portableState(now?: string, settings?: SettingsSnapshot): PortableState {
    const tables: PortableState["tables"] = {};

    for (const table of PORTABLE_TABLES) {
      if (!this.tableExists(table)) {
        continue;
      }

      const columns = this.tableColumns(table);
      const selectColumns = columns.map((column) => quoteIdent(column.name)).join(", ");
      const orderColumns = columns
        .filter((column) => column.pk > 0)
        .sort((left, right) => left.pk - right.pk)
        .map((column) => column.name);
      const fallbackOrder = columns.map((column) => column.name);
      const orderBy = (orderColumns.length > 0 ? orderColumns : fallbackOrder)
        .map((column) => quoteIdent(column))
        .join(", ");
      const rows = this.connection.query<Record<string, unknown>>(
        `SELECT ${selectColumns} FROM ${quoteIdent(table)} ORDER BY ${orderBy};`
      );

      tables[table] = {
        columns: columns.map((column) => column.name),
        rows: rows.map((row) => orderedRow(row, columns.map((column) => column.name)))
      };
    }

    if (settings) {
      applyPortableExportFilters(tables, settings, now ?? new Date().toISOString());
    }

    return {
      formatVersion: PORTABLE_FORMAT_VERSION,
      tables
    };
  }

  private readPortableArchive(archivePath: string): {
    manifest: PortableArchiveManifest;
    state: PortableState;
  } {
    const manifestPath = join(archivePath, "manifest.json");
    const statePath = join(archivePath, PORTABLE_STATE_FILE);

    if (!existsSync(manifestPath) || !existsSync(statePath)) {
      throw validationFailure("Portable archive must contain manifest.json and hot-cross-buns-2-state.json.");
    }

    const manifest = portableArchiveManifestSchema.parse(JSON.parse(readFileSync(manifestPath, "utf8")));
    const stateBuffer = readFileSync(statePath);

    if (sha256Buffer(stateBuffer) !== manifest.stateSha256) {
      throw validationFailure("Portable archive state checksum does not match the manifest.");
    }

    const state = parsePortableState(JSON.parse(stateBuffer.toString("utf8")));

    return { manifest, state };
  }

  private collectPortableAttachments(
    state: PortableState,
    attachmentDirectory: string
  ): {
    attachments: PortableArchiveManifest["attachments"];
    skippedPointers: string[];
  } {
    const pointers = portableFilePointers(state);
    const attachments: PortableArchiveManifest["attachments"] = [];
    const skippedPointers: string[] = [];
    const seen = new Set<string>();

    for (const pointer of pointers) {
      if (seen.has(pointer)) {
        continue;
      }

      seen.add(pointer);

      try {
        const sourcePath = fileURLToPath(pointer);
        const stat = statSync(sourcePath);

        if (!stat.isFile()) {
          skippedPointers.push(pointer);
          continue;
        }

        mkdirSync(attachmentDirectory, { recursive: true });
        const bytes = readFileSync(sourcePath);
        const digest = sha256Buffer(bytes);
        const fileName = `${digest.slice(0, 16)}-${safePortableFileName(basename(sourcePath))}`;
        const bundledRelativePath = `${PORTABLE_ATTACHMENT_DIR}/${fileName}`;

        copyFileSync(sourcePath, join(attachmentDirectory, fileName));
        attachments.push({
          kind: portableAttachmentKind(sourcePath),
          displayName: basename(sourcePath),
          originalURL: pointer,
          bundledRelativePath,
          sha256: digest,
          byteCount: stat.size
        });
      } catch {
        skippedPointers.push(pointer);
      }
    }

    return { attachments, skippedPointers };
  }

  private portableAttachmentHealth(
    archivePath: string,
    manifest: PortableArchiveManifest
  ): { missing: number; corrupt: number } {
    let missing = 0;
    let corrupt = 0;

    for (const attachment of manifest.attachments) {
      const path = safeArchiveChildPath(archivePath, attachment.bundledRelativePath);

      if (!path || !existsSync(path)) {
        missing += 1;
        continue;
      }

      const bytes = readFileSync(path);

      if (bytes.byteLength !== attachment.byteCount || sha256Buffer(bytes) !== attachment.sha256) {
        corrupt += 1;
      }
    }

    return { missing, corrupt };
  }

  private rewritePortableAttachmentPointers(
    archivePath: string,
    state: PortableState,
    manifest: PortableArchiveManifest
  ): PortableState {
    const next = structuredClonePortableState(state);
    const attachmentDirectory = join(dirname(this.connection.databasePath), PORTABLE_ATTACHMENT_DIR);
    const replacements = new Map<string, string>();

    mkdirSync(attachmentDirectory, { recursive: true });

    for (const attachment of manifest.attachments) {
      const sourcePath = safeArchiveChildPath(archivePath, attachment.bundledRelativePath);

      if (!sourcePath || !existsSync(sourcePath)) {
        continue;
      }

      const bytes = readFileSync(sourcePath);

      if (bytes.byteLength !== attachment.byteCount || sha256Buffer(bytes) !== attachment.sha256) {
        continue;
      }

      const targetPath = join(
        attachmentDirectory,
        `${attachment.sha256.slice(0, 16)}-${safePortableFileName(attachment.displayName)}`
      );

      copyFileSync(sourcePath, targetPath);
      replacements.set(attachment.originalURL, pathToFileURL(targetPath).href);
    }

    rewritePortableTableText(next, "google_tasks", "notes", replacements);
    rewritePortableTableText(next, "google_calendar_events", "description", replacements);
    return next;
  }

  private portableImportOperations(state: PortableState) {
    const operations = [];

    for (const table of [...PORTABLE_TABLES].reverse()) {
      if (this.tableExists(table)) {
        operations.push({
          kind: "run" as const,
          sql: `DELETE FROM ${quoteIdent(table)};`
        });
      }
    }

    for (const table of PORTABLE_TABLES) {
      const tableState = state.tables[table];

      if (!tableState || !this.tableExists(table) || tableState.rows.length === 0) {
        continue;
      }

      const existingColumns = new Set(this.tableColumns(table).map((column) => column.name));

      for (const column of tableState.columns) {
        if (!existingColumns.has(column)) {
          throw validationFailure(`Portable archive column ${table}.${column} is not supported by this app version.`);
        }
      }

      const placeholders = tableState.columns.map(() => "?").join(", ");
      const columns = tableState.columns.map(quoteIdent).join(", ");

      for (const row of tableState.rows) {
        operations.push({
          kind: "run" as const,
          sql: `INSERT INTO ${quoteIdent(table)} (${columns}) VALUES (${placeholders});`,
          params: tableState.columns.map((column) => sqlitePortableValue(row[column]))
        });
      }
    }

    return operations;
  }

  private rebuildPortableFts(): void {
    for (const table of [
      "google_task_lists_fts",
      "google_tasks_fts",
      "google_calendar_lists_fts",
      "google_calendar_events_fts"
    ]) {
      if (this.tableExists(table)) {
        this.connection.run(`INSERT INTO ${quoteIdent(table)}(${quoteIdent(table)}) VALUES ('rebuild');`);
      }
    }
  }

  private tableExists(table: string): boolean {
    return this.connection.get<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE name = ? AND type IN ('table', 'view') LIMIT 1;`,
      [table]
    ) !== undefined;
  }

  private tableColumns(table: string): Array<{ name: string; pk: number }> {
    return this.connection.query<{ name: string; pk: number }>(`PRAGMA table_info(${quoteIdent(table)});`);
  }

  private readSetting<T>(scope: string, key: string, fallback: T): T {
    const cached = this.settingsReadCache?.get(settingsCacheKey(scope, key));
    if (cached !== undefined) {
      return parseSettingValue(cached, fallback);
    }

    const row = this.connection.get<{ valueJson: string }>(
      `SELECT value_json AS valueJson
       FROM local_settings
       WHERE scope = ? AND key = ?
       LIMIT 1;`,
      [scope, key]
    );

    if (!row) {
      return fallback;
    }

    return parseSettingValue(row.valueJson, fallback);
  }

  private readSettingsMap(): Map<string, string> {
    const rows = this.connection.query<{ scope: string; key: string; valueJson: string }>(
      `SELECT scope, key, value_json AS valueJson
       FROM local_settings;`
    );

    return new Map(rows.map((row) => [settingsCacheKey(row.scope, row.key), row.valueJson]));
  }

  private writeSetting(scope: string, key: string, value: unknown, now: string): void {
    this.cachedSnapshot = null;
    this.connection.run(
      `INSERT INTO local_settings (scope, key, value_json, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(scope, key) DO UPDATE SET
         value_json = excluded.value_json,
         updated_at = excluded.updated_at;`,
      [scope, key, JSON.stringify(value), now]
    );
  }

  private readKeybindings(): SettingsSnapshot["keybindings"] {
    const saved = this.readSetting<Partial<SettingsSnapshot["keybindings"]>>(
      "hotkeys",
      "keybindings",
      {}
    );
    return normalizeKeybindings(saved);
  }

  private readLeaderKeybindings(): SettingsSnapshot["leaderKeybindings"] {
    const saved = this.readSetting<Partial<SettingsSnapshot["leaderKeybindings"]>>(
      "hotkeys",
      "leaderKeybindings",
      {}
    );
    return normalizeLeaderKeybindings(saved);
  }

  private defaultSelectedTaskListIds(): string[] {
    const rows = this.connection.query<{ id: string }>(
      `SELECT id
       FROM google_task_lists
       WHERE deleted_at IS NULL
       ORDER BY sort_order ASC, title COLLATE NOCASE ASC, id ASC
       LIMIT 100;`
    );

    return rows.map((row) => row.id);
  }

  private defaultSelectedCalendarIds(): string[] {
    const rows = this.connection.query<{ id: string }>(
      `SELECT id
       FROM google_calendar_lists
       WHERE deleted_at IS NULL
         AND is_hidden = 0
         AND is_selected = 1
       ORDER BY is_primary DESC, summary COLLATE NOCASE ASC, id ASC
       LIMIT 100;`
    );

    return rows.map((row) => row.id);
  }
}

function settingsCacheKey(scope: string, key: string): string {
  return `${scope}\0${key}`;
}

interface PortableTableState {
  columns: string[];
  rows: Record<string, unknown>[];
}

interface PortableState {
  formatVersion: 1;
  tables: Partial<Record<(typeof PORTABLE_TABLES)[number], PortableTableState>>;
}

function parsePortableState(value: unknown): PortableState {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    (value as { formatVersion?: unknown }).formatVersion !== PORTABLE_FORMAT_VERSION
  ) {
    throw validationFailure("Portable archive state has an unsupported format.");
  }

  const state = value as PortableState;

  if (typeof state.tables !== "object" || state.tables === null) {
    throw validationFailure("Portable archive state is missing required fields.");
  }

  for (const table of Object.keys(state.tables)) {
    if (!PORTABLE_TABLES.includes(table as (typeof PORTABLE_TABLES)[number])) {
      throw validationFailure(`Portable archive table ${table} is not supported.`);
    }
  }

  return state;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }

  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`).join(",")}}`;
}

function sha256Buffer(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function quoteIdent(value: string): string {
  return `"${value.replace(/"/g, "\"\"")}"`;
}

function orderedRow(row: Record<string, unknown>, columns: string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const column of columns) {
    result[column] = row[column] ?? null;
  }

  return result;
}

function sqlitePortableValue(value: unknown): string | number | boolean | null {
  return typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
    ? value
    : JSON.stringify(value);
}

function portableTableDiff(
  current: PortableState,
  archive: PortableState,
  table: (typeof PORTABLE_TABLES)[number]
): { added: number; removed: number; changed: number } {
  const currentRows = portableRowsByKey(current.tables[table]);
  const archiveRows = portableRowsByKey(archive.tables[table]);
  let added = 0;
  let removed = 0;
  let changed = 0;

  for (const [key, row] of archiveRows) {
    const currentRow = currentRows.get(key);

    if (currentRow === undefined) {
      added += 1;
    } else if (currentRow !== row) {
      changed += 1;
    }
  }

  for (const key of currentRows.keys()) {
    if (!archiveRows.has(key)) {
      removed += 1;
    }
  }

  return { added, removed, changed };
}

function portableTableDiffItems(
  current: PortableState,
  archive: PortableState,
  table: (typeof PORTABLE_TABLES)[number],
  titleColumn: string
): Array<{ id: string; title: string; change: "added" | "removed" | "changed" }> {
  const currentRows = new Map((current.tables[table]?.rows ?? []).map((row) => [portableRowKey(row), row]));
  const archiveRows = new Map((archive.tables[table]?.rows ?? []).map((row) => [portableRowKey(row), row]));
  const items: Array<{ id: string; title: string; change: "added" | "removed" | "changed" }> = [];

  for (const [key, row] of archiveRows) {
    if (!currentRows.has(key)) {
      items.push(portablePreviewItem(row, titleColumn, "added"));
    } else if (stableJson(currentRows.get(key)) !== stableJson(row)) {
      items.push(portablePreviewItem(row, titleColumn, "changed"));
    }
  }

  for (const [key, row] of currentRows) {
    if (!archiveRows.has(key)) {
      items.push(portablePreviewItem(row, titleColumn, "removed"));
    }
  }

  return items.slice(0, 50);
}

function portablePreviewItem(
  row: Record<string, unknown>,
  titleColumn: string,
  change: "added" | "removed" | "changed"
): { id: string; title: string; change: "added" | "removed" | "changed" } {
  const id = typeof row.id === "string" ? row.id : portableRowKey(row);
  const rawTitle = row[titleColumn];
  const title = typeof rawTitle === "string" && rawTitle.trim() ? rawTitle.trim() : id;

  return { id, title: title.slice(0, 500), change };
}

function portableRowsByKey(table: PortableTableState | undefined): Map<string, string> {
  const rows = new Map<string, string>();

  for (const row of table?.rows ?? []) {
    rows.set(portableRowKey(row), stableJson(row));
  }

  return rows;
}

function portableRowKey(row: Record<string, unknown>): string {
  if (typeof row.id === "string") {
    return row.id;
  }

  if (typeof row.scope === "string" && typeof row.key === "string") {
    return `${row.scope}\0${row.key}`;
  }

  return stableJson(row);
}

function portableFilePointers(state: PortableState): string[] {
  const values = [
    ...portableColumnValues(state, "google_tasks", "notes"),
    ...portableColumnValues(state, "google_calendar_events", "description")
  ];
  const pointers: string[] = [];

  for (const value of values) {
    pointers.push(...filePointersFromText(value));
  }

  return pointers;
}

function filePointersFromText(value: string): string[] {
  const pointers: string[] = [];
  const pointerPattern = /file:\/\/[^\s)'"<>]+/g;

  for (const match of value.matchAll(pointerPattern)) {
    pointers.push(match[0]);
  }

  return pointers;
}

function replaceExactPointer(value: string, pointer: string, replacement: string): string {
  return value.split(pointer).join(replacement);
}

function pointerExists(pointer: string): boolean {
  try {
    return existsSync(fileURLToPath(pointer));
  } catch {
    return false;
  }
}

function pendingMutationOperation(input: {
  id: string;
  accountId: string | null;
  resourceType: "task" | "event";
  resourceId: string;
  operation: "task.update" | "calendar.events.update";
  payload: Record<string, unknown>;
  now: string;
}) {
  return {
    kind: "run" as const,
    sql: `INSERT INTO google_pending_mutations (
      id, account_id, resource_type, resource_id, operation, payload_json, status,
      attempt_count, next_retry_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, NULL, ?, ?);`,
    params: [
      input.id,
      input.accountId,
      input.resourceType,
      input.resourceId,
      input.operation,
      JSON.stringify(input.payload),
      input.now,
      input.now
    ]
  };
}

function applyPortableExportFilters(
  tables: PortableState["tables"],
  settings: SettingsSnapshot,
  now: string
): void {
  const keptTaskListIds = settings.portableExportOnlySelectedTaskLists && settings.selectedTaskListIds.length > 0
    ? new Set(settings.selectedTaskListIds)
    : null;
  const keptCalendarIds = settings.portableExportOnlySelectedCalendars && settings.selectedCalendarIds.length > 0
    ? new Set(settings.selectedCalendarIds)
    : null;
  const taskFilterActive = keptTaskListIds !== null;
  const eventFilterActive =
    keptCalendarIds !== null || settings.portableExportOnlyFutureCurrentEvents;
  const keptTaskIds = new Set<string>();
  const keptEventIds = new Set<string>();

  if (keptTaskListIds) {
    filterRows(tables.google_task_lists, (row) => stringSetHas(keptTaskListIds, row.id));
    filterRows(tables.google_tasks, (row) => stringSetHas(keptTaskListIds, row.task_list_id));
  }

  for (const row of tables.google_tasks?.rows ?? []) {
    if (typeof row.id === "string") {
      keptTaskIds.add(row.id);
    }
  }

  if (keptCalendarIds) {
    filterRows(tables.google_calendar_lists, (row) => stringSetHas(keptCalendarIds, row.id));
    filterRows(tables.google_calendar_events, (row) => stringSetHas(keptCalendarIds, row.calendar_id));
    filterRows(tables.google_calendar_event_instances, (row) => stringSetHas(keptCalendarIds, row.calendar_id));
  }

  if (settings.portableExportOnlyFutureCurrentEvents) {
    const cutoffMs = Date.parse(now);
    filterRows(tables.google_calendar_events, (row) => {
      const endMs = typeof row.end_at === "string" ? Date.parse(row.end_at) : NaN;
      return !Number.isFinite(cutoffMs) || !Number.isFinite(endMs) || endMs >= cutoffMs || row.recurrence_rule != null;
    });
    const visibleEventIds = new Set(
      (tables.google_calendar_events?.rows ?? [])
        .map((row) => row.id)
        .filter((id): id is string => typeof id === "string")
    );
    filterRows(tables.google_calendar_event_instances, (row) => stringSetHas(visibleEventIds, row.event_id));
  }

  for (const row of tables.google_calendar_events?.rows ?? []) {
    if (typeof row.id === "string") {
      keptEventIds.add(row.id);
    }
  }

  filterRows(tables.local_scheduled_task_blocks, (row) =>
    (!taskFilterActive || stringSetHas(keptTaskIds, row.task_id)) &&
    (!eventFilterActive || stringSetHas(keptEventIds, row.calendar_event_id))
  );
  filterRows(tables.local_entity_tags, (row) => {
    if (row.entity_kind === "event") {
      return !eventFilterActive || stringSetHas(keptEventIds, row.entity_id);
    }

    if (row.entity_kind === "task" || row.entity_kind === "note") {
      return !taskFilterActive || stringSetHas(keptTaskIds, row.entity_id);
    }

    return true;
  });
  filterRows(tables.google_pending_mutations, (row) => {
    if (row.resource_type === "event") {
      return !eventFilterActive || stringSetHas(keptEventIds, row.resource_id);
    }

    if (row.resource_type === "task") {
      return !taskFilterActive || stringSetHas(keptTaskIds, row.resource_id);
    }

    if (row.resource_type === "task_list") {
      return !keptTaskListIds || stringSetHas(keptTaskListIds, row.resource_id);
    }

    if (row.resource_type === "calendar") {
      return !keptCalendarIds || stringSetHas(keptCalendarIds, row.resource_id);
    }

    return true;
  });
  filterRows(tables.google_sync_checkpoints, (row) => {
    if (row.resource_type === "task_list") {
      return !keptTaskListIds || stringSetHas(keptTaskListIds, row.resource_id);
    }

    if (row.resource_type === "calendar") {
      return !keptCalendarIds || stringSetHas(keptCalendarIds, row.resource_id);
    }

    return true;
  });
}

function filterRows(
  table: PortableTableState | undefined,
  predicate: (row: Record<string, unknown>) => boolean
): void {
  if (table) {
    table.rows = table.rows.filter(predicate);
  }
}

function stringSetHas(values: Set<string>, value: unknown): boolean {
  return typeof value === "string" && values.has(value);
}

function portableColumnValues(
  state: PortableState,
  table: (typeof PORTABLE_TABLES)[number],
  column: string
): string[] {
  return (state.tables[table]?.rows ?? [])
    .map((row) => row[column])
    .filter((value): value is string => typeof value === "string" && value.length > 0);
}

function portableAttachmentKind(path: string): "image" | "file" {
  return /\.(avif|gif|jpe?g|png|webp|heic|tiff?)$/i.test(path) ? "image" : "file";
}

function safePortableFileName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 160);
  return cleaned || "attachment";
}

function safeArchiveChildPath(archivePath: string, relativePath: string): string | null {
  if (isAbsolute(relativePath)) {
    return null;
  }

  const normalized = normalize(relativePath);

  if (normalized.startsWith("..")) {
    return null;
  }

  return join(archivePath, normalized);
}

function structuredClonePortableState(state: PortableState): PortableState {
  return JSON.parse(JSON.stringify(state)) as PortableState;
}

function rewritePortableTableText(
  state: PortableState,
  table: (typeof PORTABLE_TABLES)[number],
  column: string,
  replacements: Map<string, string>
): void {
  for (const row of state.tables[table]?.rows ?? []) {
    const value = row[column];

    if (typeof value !== "string") {
      continue;
    }

    let next = value;

    for (const [from, to] of replacements) {
      next = next.split(from).join(to);
    }

    row[column] = next;
  }
}

function parseSettingValue<T>(valueJson: string, fallback: T): T {
  try {
    return JSON.parse(valueJson) as T;
  } catch {
    return fallback;
  }
}

function normalizeKeybindings(
  value: Partial<SettingsSnapshot["keybindings"]>
): SettingsSnapshot["keybindings"] {
  const normalized: SettingsSnapshot["keybindings"] = { ...DEFAULT_SETTINGS.keybindings };
  const shouldMigrateDiagnosticsDefault =
    value["navigation.diagnostics.toggle"] === "CmdOrCtrl+D" &&
    value["pane.split.horizontal"] === undefined &&
    value["pane.split.vertical"] === undefined;
  const shouldMigratePaneCreateDefault =
    value["pane.create"] === "CmdOrCtrl+T" &&
    value["web.tab.create"] === undefined;

  for (const actionId of hotkeyActionIds) {
    const accelerator = value[actionId];

    if (accelerator === undefined) {
      continue;
    }

    normalized[actionId] = typeof accelerator === "string" && accelerator.trim().length > 0
      ? accelerator.trim()
      : null;
  }

  if (shouldMigrateDiagnosticsDefault) {
    normalized["navigation.diagnostics.toggle"] = DEFAULT_SETTINGS.keybindings["navigation.diagnostics.toggle"];
  }

  if (shouldMigratePaneCreateDefault) {
    normalized["pane.create"] = DEFAULT_SETTINGS.keybindings["pane.create"];
  }

  return normalized;
}

function normalizeLeaderKeybindings(
  value: Partial<SettingsSnapshot["leaderKeybindings"]>
): SettingsSnapshot["leaderKeybindings"] {
  const normalized: SettingsSnapshot["leaderKeybindings"] = { ...DEFAULT_SETTINGS.leaderKeybindings };

  for (const actionId of hotkeyActionIds) {
    const accelerator = value[actionId];

    if (accelerator === undefined) {
      continue;
    }

    normalized[actionId] = typeof accelerator === "string" && accelerator.trim().length > 0
      ? accelerator.trim()
      : null;
  }

  return normalized;
}

function normalizeSemanticModels(
  value: unknown
): SettingsSnapshot["semanticSearchModels"] {
  const byId = new Map(DEFAULT_SETTINGS.semanticSearchModels.map((model) => [model.id, model]));

  if (Array.isArray(value)) {
    for (const entry of value) {
      if (!entry || typeof entry !== "object") {
        continue;
      }

      const model = entry as Partial<SettingsSnapshot["semanticSearchModels"][number]>;
      const base = typeof model.id === "string" ? byId.get(model.id) : undefined;

      if (!base) {
        continue;
      }

      byId.set(base.id, {
        ...base,
        installed: typeof model.installed === "boolean" ? model.installed : base.installed,
        installState: model.installState === "installed" || model.installState === "error" || model.installState === "not-installed"
          ? model.installState
          : base.installState,
        cachePath: typeof model.cachePath === "string" ? model.cachePath.slice(0, 1_000) : null,
        lastError: typeof model.lastError === "string" ? model.lastError.slice(0, 500) : null,
        updatedAt: typeof model.updatedAt === "string" ? model.updatedAt : null
      });
    }
  }

  return [...byId.values()];
}

function normalizeMenuBarPanelStyle(value: unknown): SettingsSnapshot["menuBarPanelStyle"] {
  if (value === "calendar" || value === "agenda") {
    return "calendar";
  }

  return "adaptive";
}

function normalizeOrder<T extends string>(value: readonly T[], defaults: readonly T[]): T[] {
  const allowed = new Set(defaults);
  const next: T[] = [];

  for (const item of value) {
    if (allowed.has(item) && !next.includes(item)) {
      next.push(item);
    }
  }

  for (const item of defaults) {
    if (!next.includes(item)) {
      next.push(item);
    }
  }

  return next;
}

function normalizeTrayClickAction(value: unknown): SettingsSnapshot["trayClickAction"] {
  if (value === "toggle-window" || value === "open-today" || value === "open-menu") {
    return value;
  }

  return "open-menu";
}

function normalizeEventCompletionDefaultScope(
  value: unknown
): SettingsSnapshot["eventCompletionDefaultScope"] {
  if (
    value === "occurrence" ||
    value === "seriesFuture" ||
    value === "seriesAll" ||
    value === "ask"
  ) {
    return value;
  }

  return "occurrence";
}

function normalizeMenuBarIconName(value: unknown): SettingsSnapshot["menuBarIconName"] {
  if (value === "calendar") {
    return value;
  }

  return "calendar";
}

function normalizeMenuBarCalendarIconId(
  value: unknown,
  customIcons: SettingsSnapshot["customMenuBarIcons"]
): SettingsSnapshot["menuBarCalendarIconId"] {
  if (value === "calendar") {
    return "calendar";
  }

  if (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.trim().length <= 120 &&
    customIcons.some((icon) => icon.id === value.trim())
  ) {
    return value.trim();
  }

  return "calendar";
}

function normalizeMenuBarCalendarDoneMode(
  value: unknown
): SettingsSnapshot["menuBarCalendarDoneMode"] {
  if (value === "visibleTodayDone" || value === "tasksOnly" || value === "neverAutoSwitch") {
    return value;
  }

  return "visibleTodayDone";
}

function normalizeCustomMenuBarIcons(value: unknown): SettingsSnapshot["customMenuBarIcons"] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((icon): icon is SettingsSnapshot["customMenuBarIcons"][number] => {
      if (!icon || typeof icon !== "object") {
        return false;
      }
      const candidate = icon as Partial<SettingsSnapshot["customMenuBarIcons"][number]>;
      return (
        typeof candidate.id === "string" &&
        candidate.id.trim().length > 0 &&
        typeof candidate.name === "string" &&
        candidate.name.trim().length > 0 &&
        typeof candidate.fileName === "string" &&
        candidate.fileName.trim().length > 0 &&
        typeof candidate.createdAt === "string" &&
        typeof candidate.updatedAt === "string"
      );
    })
    .slice(0, 50);
}
