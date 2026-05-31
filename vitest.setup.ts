import "@testing-library/jest-dom/vitest";
import { beforeEach, vi } from "vitest";
import type { CalendarEventDetail, TaskDetail } from "./src/shared/ipc/contracts";
import type { HcbApi } from "./src/shared/ipc/preloadApi";
import { ok } from "./src/shared/ipc/result";
import {
  defaultHistoryCategoryVisibility,
  defaultKeybindings
} from "./src/shared/settingsCatalog";

const now = new Date("2026-05-22T00:00:00.000Z").toISOString();
const later = new Date("2026-05-22T01:00:00.000Z").toISOString();

function installTestLocalStorage(): Storage | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  const storage = window.localStorage;

  if (
    typeof storage?.getItem === "function" &&
    typeof storage.setItem === "function" &&
    typeof storage.removeItem === "function"
  ) {
    return storage;
  }

  const values = new Map<string, string>();
  const memoryStorage: Storage = {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(values.keys())[index] ?? null;
    },
    removeItem(key: string) {
      values.delete(key);
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    }
  };

  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: memoryStorage
  });

  return memoryStorage;
}

beforeEach(() => {
  installTestLocalStorage()?.removeItem("hcb.paneWorkspace.v1");
});

function testTask(overrides: Partial<TaskDetail> = {}): TaskDetail {
  return {
    id: "test-task",
    listId: "test-list",
    title: "Test task",
    status: "active" as const,
    updatedAt: now,
    priority: "none" as const,
    dueAt: null,
    notes: "",
    parentId: null,
    ...overrides
  };
}

function testCalendarEvent(overrides: Partial<CalendarEventDetail> = {}): CalendarEventDetail {
  return {
    id: "test-event",
    calendarId: "test-calendar",
    title: "Test event",
    startsAt: now,
    endsAt: later,
    allDay: false,
    updatedAt: now,
    calendarTitle: "Test calendar",
    deepLink: "hotcrossbuns://calendar/test-event",
    location: "",
    notes: "",
    guestEmails: [],
    reminderMinutes: [],
    ...overrides
  };
}

const hcbApi: HcbApi = {
  tasks: {
    listTaskLists: vi.fn(async (request = {}) =>
      ok({
        items: [],
        page: {
          limit: request.limit ?? 50,
          totalKnown: 0
        }
      })
    ),
    list: vi.fn(async (request = {}) =>
      ok({
        items: [],
        page: {
          limit: request.limit ?? 50,
          totalKnown: 0
        }
      })
    ),
    get: vi.fn(async (request) =>
      ok(testTask({ id: request.id }))
    ),
    create: vi.fn(async (request) =>
      ok(testTask({
        id: "task-created",
        listId: request.listId,
        title: request.title,
        notes: request.notes,
        parentId: request.parentId ?? null,
        priority: request.priority ?? "none"
      }))
    ),
    update: vi.fn(async (request) =>
      ok(testTask({
        id: request.id,
        title: request.title ?? "Updated task",
        notes: request.notes ?? "",
        listId: request.listId ?? "test-list",
        parentId: request.parentId ?? null,
        priority: request.priority ?? "none"
      }))
    ),
    complete: vi.fn(async (request) =>
      ok(testTask({ id: request.id, status: "completed" }))
    ),
    reopen: vi.fn(async (request) =>
      ok(testTask({ id: request.id, status: "active" }))
    ),
    move: vi.fn(async (request) =>
      ok(testTask({
        id: request.id,
        listId: request.listId ?? "test-list",
        parentId: request.parentId ?? null
      }))
    ),
    delete: vi.fn(async (request) =>
      ok({
        id: request.id,
        queued: false,
        revision: now
      })
    ),
    createTaskList: vi.fn(async (request) =>
      ok({
        id: "task-list-created",
        title: request.title,
        updatedAt: now,
        taskCount: 0,
        activeTaskCount: 0
      })
    ),
    renameTaskList: vi.fn(async (request) =>
      ok({
        id: request.id,
        title: request.title,
        updatedAt: now,
        taskCount: 0,
        activeTaskCount: 0
      })
    ),
    deleteTaskList: vi.fn(async (request) =>
      ok({
        id: request.id,
        queued: false,
        revision: now
      })
    )
  },
  calendar: {
    listCalendars: vi.fn(async (request = {}) =>
      ok({
        items: [],
        page: {
          limit: request.limit ?? 50,
          totalKnown: 0
        }
      })
    ),
    listEvents: vi.fn(async (request) =>
      ok({
        items: [],
        page: {
          limit: request.limit ?? 100,
          totalKnown: 0
        }
      })
    ),
    get: vi.fn(async (request) =>
      ok(testCalendarEvent({ id: request.id }))
    ),
    create: vi.fn(async (request) =>
      ok(testCalendarEvent({
        id: "event-created",
        calendarId: request.calendarId,
        title: request.title,
        startsAt: request.startsAt,
        endsAt: request.endsAt,
        allDay: request.allDay ?? false,
        location: request.location ?? "",
        notes: request.notes ?? "",
        guestEmails: request.guestEmails ?? [],
        reminderMinutes: request.reminderMinutes ?? []
      }))
    ),
    update: vi.fn(async (request) =>
      ok(testCalendarEvent({
        id: request.id,
        calendarId: request.calendarId ?? "test-calendar",
        title: request.title ?? "Updated event",
        startsAt: request.startsAt ?? now,
        endsAt: request.endsAt ?? later,
        allDay: request.allDay ?? false,
        location: request.location ?? "",
        notes: request.notes ?? "",
        guestEmails: request.guestEmails ?? [],
        reminderMinutes: request.reminderMinutes ?? []
      }))
    ),
    delete: vi.fn(async (request) =>
      ok({
        id: request.id,
        queued: false,
        revision: now
      })
    ),
    listScheduledTaskBlocks: vi.fn(async (request) =>
      ok({
        items: [],
        page: {
          limit: request.limit ?? 100,
          totalKnown: 0
        }
      })
    ),
    scheduleTaskBlock: vi.fn(async (request) =>
      ok({
        id: "block-created",
        taskId: request.taskId,
        calendarEventId: "event-created",
        calendarId: request.calendarId,
        title: "Test task",
        startsAt: request.startsAt,
        endsAt: new Date(Date.parse(request.startsAt) + (request.durationMinutes ?? 30) * 60 * 1000).toISOString(),
        durationMinutes: request.durationMinutes ?? 30,
        status: "scheduled" as const,
        mutationState: "queued" as const,
        updatedAt: now
      })
    ),
    moveScheduledTaskBlock: vi.fn(async (request) =>
      ok({
        id: request.id,
        taskId: "test-task",
        calendarEventId: "event-created",
        calendarId: request.calendarId ?? "test-calendar",
        title: "Test task",
        startsAt: request.startsAt ?? now,
        endsAt: new Date(Date.parse(request.startsAt ?? now) + (request.durationMinutes ?? 30) * 60 * 1000).toISOString(),
        durationMinutes: request.durationMinutes ?? 30,
        status: "scheduled" as const,
        mutationState: "queued" as const,
        updatedAt: now
      })
    ),
    unscheduleTaskBlock: vi.fn(async (request) =>
      ok({
        id: request.id,
        queued: request.deleteCalendarEvent ?? true,
        revision: now
      })
    ),
    scheduleSuggest: vi.fn(async () =>
      ok({
        slots: [],
        unscheduled: [],
        overloadMinutes: 0
      })
    ),
    exportAvailability: vi.fn(async (request) =>
      ok({
        format: "text" as const,
        text: `Availability from ${request.start} to ${request.end}`,
        generatedAt: now,
        busyBlockCount: 0
      })
    )
  },
  notes: {
    list: vi.fn(async (request = {}) =>
      ok({
        items: [],
        lists: [{ id: "note-list:default", title: "Local notes", noteCount: 0, updatedAt: now }],
        page: {
          limit: request.limit ?? 50,
          totalKnown: 0
        }
      })
    ),
    createList: vi.fn(async (request) =>
      ok({
        id: "note-list-created",
        title: request.title,
        noteCount: 0,
        updatedAt: now
      })
    ),
    get: vi.fn(async (request) =>
      ok({
        id: request.id,
        listId: "note-list:default",
        listTitle: "Local notes",
        title: "Test note",
        preview: "",
        body: "",
        updatedAt: now
      })
    ),
    create: vi.fn(async (request) =>
      ok({
        id: "note-created",
        listId: request.listId ?? "note-list:default",
        listTitle: "Local notes",
        title: request.title,
        preview: request.body ?? "",
        body: request.body ?? "",
        updatedAt: now
      })
    ),
    update: vi.fn(async (request) =>
      ok({
        id: request.id,
        listId: request.listId ?? "note-list:default",
        listTitle: "Local notes",
        title: request.title ?? "Updated note",
        preview: request.body ?? "",
        body: request.body ?? "",
        updatedAt: now
      })
    ),
    delete: vi.fn(async (request) =>
      ok({
        id: request.id,
        queued: false,
        revision: now
      })
    ),
    linkSuggest: vi.fn(async () => ok({ items: [] })),
    listBrokenLinks: vi.fn(async () => ok({ items: [] }))
  },
  search: {
    query: vi.fn(async (request) =>
      ok({
        items: [],
        page: {
          limit: request.limit ?? 20,
          totalKnown: 0
        }
      })
    )
  },
  sync: {
    status: vi.fn(async () =>
      ok({
        state: "idle" as const,
        pendingMutationCount: 0
      })
    ),
    runNow: vi.fn(async (request = {}) =>
      ok({
        accepted: true,
        dryRun: request.dryRun ?? false,
        resources: request.resources ?? ["tasks", "calendar"]
      })
    ),
    subscribeStatus: vi.fn(() => () => undefined)
  },
  google: {
    status: vi.fn(async () =>
      ok({
        oauthClientConfigured: false,
        clientId: null,
        hasClientSecret: false
      })
    ),
    saveOAuthClient: vi.fn(async (request) =>
      ok({
        oauthClientConfigured: true,
        clientId: request.clientId,
        hasClientSecret: Boolean(request.clientSecret)
      })
    ),
    beginOAuth: vi.fn(async () =>
      ok({
        accepted: true,
        openedExternalBrowser: true,
        expiresAt: later,
        scopes: [
          "https://www.googleapis.com/auth/tasks",
          "https://www.googleapis.com/auth/calendar"
        ],
        redirectUri: "http://127.0.0.1:42813/oauth/google/callback",
        message: "Google authorization opened in the browser."
      })
    ),
    disconnect: vi.fn(async () =>
      ok({
        oauthClientConfigured: false,
        clientId: null,
        hasClientSecret: false
      })
    )
  },
  settings: {
    get: vi.fn(async () =>
      ok({
        theme: "system" as const,
        colorTheme: "notion" as const,
        appLanguage: "system" as const,
        uiFontName: null,
        uiTextSizePoints: 13,
        perSurfaceFontOverrides: {},
        calendarEventColorOverrides: {},
        performanceMode: "snappy" as const,
        appBackgroundTranslucencyEnabled: false,
        appBackgroundOpacity: 1,
        disableAnimations: false,
        uiLayoutScale: 1,
        navigationPlacement: "left" as const,
        hiddenNavigationTabs: [],
        hiddenCalendarViewModes: [],
        showCompletedInCalendarViews: true,
        calendarTimelineDensity: "compact" as const,
        monthScrollPastMonths: 0,
        monthScrollFutureMonths: 1,
        quickCreateExpandedByDefault: false,
        restoreWindowStateEnabled: true,
        startOnLogin: false,
        selectedTaskListIds: [],
        selectedCalendarIds: [],
        setupCompletedAt: now,
        syncMode: "balanced" as const,
        syncTasksEnabled: true,
        syncCalendarEventsEnabled: true,
        eventRetentionDaysBack: 0,
        completedTaskRetentionDaysBack: 365,
        quickCaptureShortcut: null,
        keybindings: defaultKeybindings,
        showTrayIcon: true,
        trayClickAction: "open-menu" as const,
        menuBarPanelStyle: "adaptive" as const,
        menuBarIconName: "pin" as const,
        showMenuBarBadge: true,
        showDockBadge: true,
        notificationsEnabled: false,
        notificationLeadMinutes: 10,
        taskCompletionSoundEnabled: true,
        taskCompletionSoundId: "glass" as const,
        eventCompletionSoundEnabled: true,
        eventCompletionSoundId: "pop" as const,
        importedSoundCount: 0,
        globalQuickAddHotkeyEnabled: false,
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
        historyStorageCap: 5_000,
        historyCategoryVisibility: defaultHistoryCategoryVisibility,
        dismissedDuplicateGroupIds: [],
        taskTemplates: [],
        eventTemplates: [],
        lastUpdateCheckAt: null,
        mcpEnabled: false,
        mcpPermissionMode: "confirm-writes" as const,
        mcpPort: 0,
        defaultTimeZone: "UTC",
        todayCapacityMinutes: 480,
        todayWorkingHoursStart: 6,
        todayWorkingHoursEnd: 22,
        diagnosticsIncludePerformance: true,
        rawGoogleDiagnosticsEnabled: false,
        savedSearchViews: [],
        savedTaskViews: []
      })
    ),
    update: vi.fn(async (request) =>
      ok({
        theme: request.theme ?? "system",
        colorTheme: request.colorTheme ?? "notion",
        appLanguage: request.appLanguage ?? "system",
        uiFontName: request.uiFontName === undefined ? null : request.uiFontName,
        uiTextSizePoints: request.uiTextSizePoints ?? 13,
        perSurfaceFontOverrides: request.perSurfaceFontOverrides ?? {},
        calendarEventColorOverrides: request.calendarEventColorOverrides ?? {},
        performanceMode: request.performanceMode ?? "snappy",
        appBackgroundTranslucencyEnabled: request.appBackgroundTranslucencyEnabled ?? false,
        appBackgroundOpacity: request.appBackgroundOpacity ?? 1,
        disableAnimations: request.disableAnimations ?? false,
        uiLayoutScale: request.uiLayoutScale ?? 1,
        navigationPlacement: request.navigationPlacement ?? "left",
        hiddenNavigationTabs: request.hiddenNavigationTabs ?? [],
        hiddenCalendarViewModes: request.hiddenCalendarViewModes ?? [],
        showCompletedInCalendarViews: request.showCompletedInCalendarViews ?? true,
        calendarTimelineDensity: request.calendarTimelineDensity ?? "compact",
        monthScrollPastMonths: request.monthScrollPastMonths ?? 0,
        monthScrollFutureMonths: request.monthScrollFutureMonths ?? 1,
        quickCreateExpandedByDefault: request.quickCreateExpandedByDefault ?? false,
        restoreWindowStateEnabled: request.restoreWindowStateEnabled ?? true,
        startOnLogin: request.startOnLogin ?? false,
        selectedTaskListIds: request.selectedTaskListIds ?? [],
        selectedCalendarIds: request.selectedCalendarIds ?? [],
        setupCompletedAt: request.setupCompletedAt === undefined ? now : request.setupCompletedAt,
        syncMode: request.syncMode ?? "balanced",
        syncTasksEnabled: request.syncTasksEnabled ?? true,
        syncCalendarEventsEnabled: request.syncCalendarEventsEnabled ?? true,
        eventRetentionDaysBack: request.eventRetentionDaysBack ?? 0,
        completedTaskRetentionDaysBack: request.completedTaskRetentionDaysBack ?? 365,
        quickCaptureShortcut: request.quickCaptureShortcut ?? null,
        keybindings: request.keybindings ?? defaultKeybindings,
        showTrayIcon: request.showTrayIcon ?? true,
        trayClickAction: request.trayClickAction ?? "open-menu",
        menuBarPanelStyle: request.menuBarPanelStyle ?? "adaptive",
        menuBarIconName: request.menuBarIconName ?? "pin",
        showMenuBarBadge: request.showMenuBarBadge ?? true,
        showDockBadge: request.showDockBadge ?? true,
        notificationsEnabled: request.notificationsEnabled ?? false,
        notificationLeadMinutes: request.notificationLeadMinutes ?? 10,
        taskCompletionSoundEnabled: request.taskCompletionSoundEnabled ?? true,
        taskCompletionSoundId: request.taskCompletionSoundId ?? "glass",
        eventCompletionSoundEnabled: request.eventCompletionSoundEnabled ?? true,
        eventCompletionSoundId: request.eventCompletionSoundId ?? "pop",
        importedSoundCount: request.importedSoundCount ?? 0,
        globalQuickAddHotkeyEnabled: request.globalQuickAddHotkeyEnabled ?? false,
        perTabListFilters: request.perTabListFilters ?? {
          tasks: { useCustomFilter: false, selectedTaskListIds: [] },
          notes: { useCustomFilter: false, selectedTaskListIds: [] }
        },
        portableExportOnlySelectedTaskLists: request.portableExportOnlySelectedTaskLists ?? false,
        portableExportOnlySelectedCalendars: request.portableExportOnlySelectedCalendars ?? false,
        portableExportOnlyFutureCurrentEvents: request.portableExportOnlyFutureCurrentEvents ?? false,
        dailyLocalBackupEnabled: request.dailyLocalBackupEnabled ?? false,
        localBackupRetentionCount: request.localBackupRetentionCount ?? 14,
        lastLocalBackupAt: request.lastLocalBackupAt ?? null,
        visibleHistoryEntryCount: request.visibleHistoryEntryCount ?? 50,
        historyStorageCap: request.historyStorageCap ?? 5_000,
        historyCategoryVisibility: request.historyCategoryVisibility ?? defaultHistoryCategoryVisibility,
        dismissedDuplicateGroupIds: request.dismissedDuplicateGroupIds ?? [],
        taskTemplates: request.taskTemplates ?? [],
        eventTemplates: request.eventTemplates ?? [],
        lastUpdateCheckAt: request.lastUpdateCheckAt ?? null,
        mcpEnabled: request.mcpEnabled ?? false,
        mcpPermissionMode: request.mcpPermissionMode ?? "confirm-writes",
        mcpPort: request.mcpPort ?? 0,
        defaultTimeZone: request.defaultTimeZone ?? "UTC",
        todayCapacityMinutes: request.todayCapacityMinutes ?? 480,
        todayWorkingHoursStart: request.todayWorkingHoursStart ?? 6,
        todayWorkingHoursEnd: request.todayWorkingHoursEnd ?? 22,
        diagnosticsIncludePerformance: request.diagnosticsIncludePerformance ?? true,
        rawGoogleDiagnosticsEnabled: request.rawGoogleDiagnosticsEnabled ?? false,
        savedSearchViews: request.savedSearchViews ?? [],
        savedTaskViews: request.savedTaskViews ?? []
      })
    ),
    recoveryAction: vi.fn(async (request) =>
      ok({
        action: request.action,
        accepted: true,
        destructive: request.action !== "refresh" && request.action !== "resetOnboarding",
        requiresReload: request.action === "clearGoogleCache",
        message: "Recovery action accepted."
      })
    )
  },
  mcp: {
    status: vi.fn(async () =>
      ok({
        enabled: false,
        running: false,
        readOnly: true,
        confirmationRequired: true,
        permissionMode: "read-only" as const,
        port: 0,
        tokenState: "not_configured" as const
      })
    ),
    setEnabled: vi.fn(async (request) =>
      ok({
        enabled: request.enabled,
        running: false,
        readOnly: true,
        confirmationRequired: request.confirmationRequired ?? true,
        permissionMode: request.permissionMode ?? "read-only",
        port: request.port ?? 0,
        tokenState: "not_configured" as const
      })
    )
  },
  native: {
    capabilities: vi.fn(async () =>
      ok({
        platform: "darwin" as const,
        notifications: false,
        globalShortcuts: false,
        tray: false,
        deepLinks: false,
        trayStatus: {
          state: "unsupported" as const,
          message: "Tray/menu bar is unavailable."
        },
        quickCaptureShortcut: {
          accelerator: null,
          registered: false,
          state: "unsupported" as const,
          message: "Global shortcuts are unavailable."
        },
        notificationsStatus: {
          permission: "unsupported" as const,
          scheduledCount: 0,
          state: "unsupported" as const,
          message: "Notifications are unavailable."
        },
        deepLinkStatus: {
          scheme: "hotcrossbuns" as const,
          registered: false,
          state: "unsupported" as const,
          message: "Deep links are unavailable."
        },
        updaterStatus: {
          state: "unsupported" as const,
          message: "Preview update checks are not configured."
        },
        mcpStatus: {
          state: "disabled" as const,
          message: "MCP local agent access is disabled."
        },
        capabilityReport: {
          platform: "darwin" as const,
          adapterId: "test",
          packageFormat: "development" as const,
          flags: {
            supportsAppPaths: true,
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
            supportsDiagnosticsCollection: true,
            supportsCredentialStorage: false,
            supportsOAuthLoopback: true,
            supportsMcpLoopback: true,
            requiresSignedBuildForNotifications: false
          },
          paths: [],
          capabilities: [],
          diagnostics: []
        },
        deferredStartup: {
          state: "pending" as const
        }
      })
    ),
    requestNotificationPermission: vi.fn(async () =>
      ok({
        state: "unsupported" as const
      })
    ),
    listFontFamilies: vi.fn(async () =>
      ok({
        platform: "darwin" as const,
        families: ["Avenir", "SF Pro Text"]
      })
    ),
    subscribeAction: vi.fn(() => () => undefined)
  },
  diagnostics: {
    health: vi.fn(async () =>
      ok({
        status: "ok" as const,
        version: "0.0.0-test",
        environment: "test" as const,
        timestamp: now,
        uptimeMs: 1,
        startup: {
          processStartedMs: 0
        },
        build: {
          appName: "Hot Cross Buns 2",
          version: "0.0.0-test",
          environment: "test" as const,
          nodeVersion: process.versions.node,
          packaged: false
        }
      })
    ),
    markShellVisible: vi.fn(async () =>
      ok({
        processStartedMs: 0,
        shellVisibleMs: 1
      })
    ),
    markCachedDataRendered: vi.fn(async () =>
      ok({
        processStartedMs: 0,
        cachedDataRenderedMs: 2
      })
    ),
    ipcMetrics: vi.fn(async () =>
      ok({
        totalCalls: 0,
        validationFailures: 0,
        serviceFailures: 0,
        responseFailures: 0,
        routes: []
      })
    ),
    performance: vi.fn(async () =>
      ok({
        timings: []
      })
    ),
    summary: vi.fn(async () =>
      ok({
        status: "ok" as const,
        generatedAt: now,
        account: {
          state: "signed_out" as const,
          grantedScopeCount: 0,
          missingScopeCount: 2
        },
        sync: {
          state: "idle" as const,
          pendingMutationCount: 0,
          offline: true,
          stale: true,
          mode: "balanced" as const
        },
        cache: {
          taskListCount: 0,
          taskCount: 0,
          calendarCount: 0,
          eventCount: 0,
          noteCount: 0,
          performanceSampleCount: 0,
          migrationVersion: 2,
          migrationDurationMs: 0
        },
        selectedResources: {
          taskLists: [],
          calendars: []
        },
        checkpoints: {
          totalCount: 0,
          tasksCount: 0,
          calendarCount: 0
        },
        pendingMutations: {
          totalCount: 0,
          pendingCount: 0,
          applyingCount: 0,
          failedCount: 0,
          retryableCount: 0,
          authPausedCount: 0,
          byResourceType: []
        },
        mcp: {
          enabled: false,
          running: false,
          permissionMode: "read-only" as const,
          confirmationRequired: true,
          port: 0,
          tokenState: "not_configured" as const,
          requestCounts: {
            totalRequests: 0,
            successCount: 0,
            rejectedCount: 0,
            errorCount: 0,
            rateLimitedCount: 0
          }
        },
        native: {
          platform: "darwin" as const,
          adapterId: "test",
          packageFormat: "development" as const,
          flags: {
            supportsAppPaths: true,
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
            supportsDiagnosticsCollection: true,
            supportsCredentialStorage: false,
            supportsOAuthLoopback: true,
            supportsMcpLoopback: true,
            requiresSignedBuildForNotifications: false
          },
          paths: [],
          capabilities: [],
          diagnostics: []
        },
        build: {
          appName: "Hot Cross Buns 2",
          version: "0.0.0-test",
          environment: "test" as const,
          nodeVersion: process.versions.node,
          packaged: false
        },
        performance: {
          startup: {
            processStartedMs: 0
          },
          migrationDurationMs: 0,
          slowQuerySamples: [],
          pendingMutationCounts: {
            totalCount: 0,
            failedCount: 0
          },
          mcpRequestCounts: {
            totalRequests: 0,
            successCount: 0,
            rejectedCount: 0,
            errorCount: 0,
            rateLimitedCount: 0
          }
        },
        redaction: {
          credentials: "redacted" as const,
          googlePayloads: "omitted" as const,
          mcpBearerTokens: "redacted" as const,
          sensitiveBodies: "omitted" as const
        }
      })
    ),
    logs: vi.fn(async () =>
      ok({
        entries: [],
        retainedEntryCount: 0,
        persistedText: ""
      })
    ),
    clearLogs: vi.fn(async () =>
      ok({
        clearedAt: now
      })
    ),
    revealLogsFolder: vi.fn(async () =>
      ok({
        opened: true,
        path: "/tmp/hot-cross-buns-2-test/logs",
        message: "Logs folder opened."
      })
    ),
    history: vi.fn(async () =>
      ok({
        entries: [],
        retainedEntryCount: 0
      })
    ),
    pendingMutations: vi.fn(async () =>
      ok({
        mutations: []
      })
    ),
    retryPendingMutation: vi.fn(async (request) =>
      ok({
        id: request.id,
        status: "pending" as const,
        updatedAt: now
      })
    ),
    cancelPendingMutation: vi.fn(async (request) =>
      ok({
        id: request.id,
        status: "cancelled" as const,
        updatedAt: now
      })
    ),
    copyableSummary: vi.fn(async () =>
      ok({
        text: "Hot Cross Buns 2 diagnostics\nStatus: ok",
        generatedAt: now
      })
    ),
    exportBundle: vi.fn(async () =>
      ok({
        exported: true,
        path: "/tmp/hot-cross-buns-2-test/diagnostics.txt",
        message: "Diagnostic bundle exported."
      })
    ),
    rescheduleNotifications: vi.fn(async () =>
      ok({
        status: {
          state: "unsupported" as const,
          permission: "unsupported" as const,
          scheduledCount: 0
        },
        message: "Notification scheduling is unavailable in tests."
      })
    )
  }
};

if (typeof window !== "undefined") {
  Object.defineProperty(window, "hcb", {
    configurable: true,
    value: hcbApi
  });
}
