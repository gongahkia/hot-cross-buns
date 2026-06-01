import { randomUUID } from "node:crypto";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { SettingsSnapshot, SettingsUpdateRequest } from "@shared/ipc/contracts";
import {
  defaultHistoryCategoryVisibility,
  defaultKeybindings,
  defaultNavigationTabOrder,
  defaultToolbarActionOrder,
  hotkeyActionIds
} from "@shared/settingsCatalog";
import type { SqliteConnection } from "../sqliteConnection";
import { systemTimeZone, uniqueIds } from "./shared";

const DEFAULT_SETTINGS: SettingsSnapshot = {
  theme: "system",
  colorTheme: "notion",
  appLanguage: "system",
  uiFontName: null,
  uiTextSizePoints: 13,
  perSurfaceFontOverrides: {},
  calendarEventColorOverrides: {},
  disableAnimations: false,
  uiLayoutScale: 1,
  navigationPlacement: "left",
  hiddenNavigationTabs: [],
  navigationTabOrder: defaultNavigationTabOrder,
  toolbarActionOrder: defaultToolbarActionOrder,
  hiddenCalendarViewModes: [],
  showCompletedInCalendarViews: true,
  calendarTimelineDensity: "compact",
  monthScrollPastMonths: 0,
  monthScrollFutureMonths: 1,
  quickCreateExpandedByDefault: false,
  restoreWindowStateEnabled: true,
  startOnLogin: false,
  keybindings: defaultKeybindings,
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
  menuBarIconName: "bun",
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
  savedTaskViews: []
};

export class LocalSettingsRepository {
  constructor(private readonly connection: SqliteConnection) {}

  get(): SettingsSnapshot {
    return {
      theme: this.readSetting("appearance", "theme", DEFAULT_SETTINGS.theme),
      colorTheme: this.readSetting("appearance", "colorTheme", DEFAULT_SETTINGS.colorTheme),
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
      savedTaskViews: this.readSetting(
        "tasks",
        "savedViews",
        DEFAULT_SETTINGS.savedTaskViews
      )
    };
  }

  update(request: SettingsUpdateRequest): SettingsSnapshot {
    const now = new Date().toISOString();

    if (request.theme !== undefined) {
      this.writeSetting("appearance", "theme", request.theme, now);
    }

    if (request.colorTheme !== undefined) {
      this.writeSetting("appearance", "colorTheme", request.colorTheme, now);
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

    if (request.savedTaskViews !== undefined) {
      this.writeSetting("tasks", "savedViews", request.savedTaskViews, now);
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

  exportPortableArchive(now = new Date().toISOString()): { path: string; exportedAt: string } {
    const exportDirectory = join(
      dirname(this.connection.databasePath),
      "PortableExports",
      `hot-cross-buns-2-${now.replace(/[:.]/g, "-")}`
    );

    mkdirSync(exportDirectory, { recursive: true });
    writeFileSync(
      join(exportDirectory, "settings.json"),
      `${JSON.stringify(this.get(), null, 2)}\n`,
      "utf8"
    );
    this.connection.run("PRAGMA wal_checkpoint(FULL);");
    copyFileSync(this.connection.databasePath, join(exportDirectory, "cache-state.sqlite3"));

    return {
      path: exportDirectory,
      exportedAt: now
    };
  }

  private readSetting<T>(scope: string, key: string, fallback: T): T {
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

    try {
      return JSON.parse(row.valueJson) as T;
    } catch {
      return fallback;
    }
  }

  private writeSetting(scope: string, key: string, value: unknown, now: string): void {
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

function normalizeMenuBarIconName(value: unknown): SettingsSnapshot["menuBarIconName"] {
  if (
    value === "calendar" ||
    value === "bun" ||
    value === "checklist" ||
    value === "target" ||
    value === "bell" ||
    value === "clock" ||
    value === "star" ||
    value === "bolt" ||
    value === "spark" ||
    value === "circle" ||
    value === "diamond"
  ) {
    return value;
  }

  return "bun";
}
