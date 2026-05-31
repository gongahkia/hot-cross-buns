import type {
  GoogleStatusResponse,
  NativeCapabilitiesResponse,
  SettingsSnapshot,
  SyncStatusResponse
} from "@shared/ipc/contracts";
import {
  defaultHistoryCategoryVisibility,
  defaultKeybindings
} from "@shared/ipc/contracts";
import type { CoreDataSnapshot } from "./types";

export const emptySyncStatus: SyncStatusResponse = {
  state: "idle",
  pendingMutationCount: 0,
  offline: true,
  stale: true
};

export const emptyGoogleStatus: GoogleStatusResponse = {
  oauthClientConfigured: false,
  clientId: null,
  hasClientSecret: false
};

export const emptySettings: SettingsSnapshot = {
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
  hiddenCalendarViewModes: [],
  showCompletedInCalendarViews: true,
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
  quickCaptureShortcut: "Ctrl+Space",
  keybindings: defaultKeybindings,
  showTrayIcon: true,
  trayClickAction: "open-menu",
  menuBarPanelStyle: "adaptive",
  menuBarIconName: "pin",
  showMenuBarBadge: true,
  showDockBadge: true,
  notificationsEnabled: false,
  notificationLeadMinutes: 10,
  taskCompletionSoundEnabled: true,
  taskCompletionSoundId: "glass",
  eventCompletionSoundEnabled: true,
  eventCompletionSoundId: "pop",
  importedSoundCount: 0,
  globalQuickAddHotkeyEnabled: false,
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
  lastUpdateCheckAt: null,
  mcpEnabled: false,
  mcpPermissionMode: "confirm-writes",
  mcpPort: 0,
  defaultTimeZone: "UTC",
  todayCapacityMinutes: 480,
  todayWorkingHoursStart: 6,
  todayWorkingHoursEnd: 22,
  diagnosticsIncludePerformance: true,
  rawGoogleDiagnosticsEnabled: false,
  savedSearchViews: [],
  savedTaskViews: []
};

const emptyCapabilityReport: NativeCapabilitiesResponse["capabilityReport"] = {
  platform: "unknown",
  adapterId: "unavailable",
  packageFormat: "development",
  flags: {
    supportsAppPaths: false,
    supportsTray: false,
    supportsAppMenu: false,
    supportsGlobalShortcut: false,
    supportsNotifications: false,
    supportsNotificationPermissionQuery: false,
    supportsProtocolRegistration: false,
    supportsProtocolRegistrationCheck: false,
    supportsAutostart: false,
    supportsInPlaceAutoUpdate: false,
    supportsInstallerMetadata: false,
    supportsExternalUrlOpen: false,
    supportsDiagnosticsCollection: false,
    supportsCredentialStorage: false,
    supportsOAuthLoopback: false,
    supportsMcpLoopback: false,
    requiresSignedBuildForNotifications: false
  },
  paths: [],
  capabilities: [],
  diagnostics: []
};

export const emptyNativeCapabilities: NativeCapabilitiesResponse = {
  platform: "unknown",
  notifications: false,
  globalShortcuts: false,
  tray: false,
  deepLinks: false,
  trayStatus: {
    state: "unsupported",
    message: "Native shell is unavailable."
  },
  quickCaptureShortcut: {
    accelerator: null,
    registered: false,
    state: "unsupported",
    message: "Global shortcuts are unavailable."
  },
  notificationsStatus: {
    permission: "unsupported",
    scheduledCount: 0,
    state: "unsupported",
    message: "Notifications are unavailable."
  },
  deepLinkStatus: {
    scheme: "hotcrossbuns",
    registered: false,
    state: "unsupported",
    message: "Deep links are unavailable."
  },
  updaterStatus: {
    state: "unsupported",
    message: "Preview update checks are not configured."
  },
  mcpStatus: {
    state: "disabled",
    message: "MCP local agent access is disabled."
  },
  capabilityReport: emptyCapabilityReport,
  deferredStartup: {
    state: "pending"
  }
};

export const emptySnapshot: CoreDataSnapshot = {
  taskLists: [],
  tasks: [],
  calendars: [],
  events: [],
  scheduledTaskBlocks: [],
  scheduleSuggestion: {
    slots: [],
    unscheduled: [],
    overloadMinutes: 0
  },
  notes: [],
  settings: emptySettings,
  syncStatus: emptySyncStatus,
  googleStatus: emptyGoogleStatus,
  native: emptyNativeCapabilities,
  resourceCounts: {
    calendarEvents: 0,
    notes: 0,
    tasks: 0
  }
};
