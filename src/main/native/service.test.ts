import { describe, expect, it, vi } from "vitest";
import type {
  CalendarEventSummary,
  NativeAction,
  SettingsSnapshot,
  TaskSummary
} from "@shared/ipc/contracts";
import { NativeShellService, parseHotCrossBunsDeepLink } from "./service";
import {
  buildNativeCapabilityReport,
  defaultNativeAppPaths
} from "./capabilityReport";
import type {
  NativeAppPaths,
  NativeNotificationRequest,
  NativeOperationResult,
  NativePlatformAdapter,
  NativePlatformCapabilities,
  NativeTrayActions,
  ScheduledNativeNotification
} from "./types";

const now = new Date("2026-05-22T12:00:00.000Z");

async function flushNativeStartup(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await Promise.resolve();
  await Promise.resolve();
}

function defaultSettings(overrides: Partial<SettingsSnapshot> = {}): SettingsSnapshot {
  return {
    theme: "system",
    colorTheme: "notion",
    uiFontName: null,
    uiTextSizePoints: 13,
    startOnLogin: false,
    selectedTaskListIds: [],
    selectedCalendarIds: [],
    setupCompletedAt: "2026-05-22T00:00:00.000Z",
    syncMode: "balanced",
    quickCaptureShortcut: "Ctrl+Space",
    showTrayIcon: true,
    trayClickAction: "open-menu",
    menuBarPanelStyle: "adaptive",
    showMenuBarBadge: true,
    notificationsEnabled: true,
    notificationLeadMinutes: 10,
    mcpEnabled: false,
    mcpPermissionMode: "confirm-writes",
    mcpPort: 0,
    defaultTimeZone: "UTC",
    todayCapacityMinutes: 480,
    todayWorkingHoursStart: 6,
    todayWorkingHoursEnd: 22,
    diagnosticsIncludePerformance: true,
    savedSearchViews: [],
    savedTaskViews: [],
    ...overrides
  };
}

class FakeNativeAdapter implements NativePlatformAdapter {
  appPathsValue: NativeAppPaths = defaultNativeAppPaths();
  capabilitiesValue: NativePlatformCapabilities = {
    platform: "darwin",
    adapterId: "fake",
    notifications: true,
    globalShortcuts: true,
    tray: true,
    deepLinks: true,
    updaterChecks: false,
    capabilityReport: buildNativeCapabilityReport({
      platform: "darwin",
      adapterId: "fake",
      appPaths: defaultNativeAppPaths(),
      flags: {
        supportsAppPaths: true,
        supportsTray: true,
        supportsAppMenu: true,
        supportsGlobalShortcut: true,
        supportsNotifications: true,
        supportsNotificationPermissionQuery: false,
        supportsProtocolRegistration: true,
        supportsProtocolRegistrationCheck: true,
        supportsAutostart: true,
        supportsInPlaceAutoUpdate: false,
        supportsInstallerMetadata: true,
        supportsExternalUrlOpen: true,
        supportsDiagnosticsCollection: true,
        supportsCredentialStorage: false,
        supportsOAuthLoopback: true,
        supportsMcpLoopback: true,
        requiresSignedBuildForNotifications: false
      }
    })
  };
  shortcutResult: NativeOperationResult = {
    ok: true,
    state: "ready",
    message: "registered"
  };
  trayResult: NativeOperationResult = {
    ok: true,
    state: "ready",
    message: "tray"
  };
  trayActions: NativeTrayActions | undefined;
  appMenuActions: NativeTrayActions | undefined;
  registeredShortcuts: string[] = [];
  unregisteredShortcuts: string[] = [];
  protocolSchemes: string[] = [];
  scheduledNotifications: NativeNotificationRequest[] = [];
  autostartRequests: boolean[] = [];
  fontFamilies: string[] = ["Avenir", "SF Pro Text"];
  trayCreateCount = 0;
  trayDestroyCount = 0;

  appPaths(): NativeAppPaths {
    return this.appPathsValue;
  }

  capabilities(): NativePlatformCapabilities {
    return this.capabilitiesValue;
  }

  credentialStorageStatus(): NativeOperationResult {
    return {
      ok: false,
      state: "unsupported",
      message: "credentials"
    };
  }

  installAppMenu(actions: NativeTrayActions): NativeOperationResult {
    this.appMenuActions = actions;
    return { ok: true, state: "ready", message: "menu" };
  }

  createTray(actions: NativeTrayActions): NativeOperationResult {
    this.trayActions = actions;
    this.trayCreateCount += 1;
    return this.trayResult;
  }

  destroyTray(): void {
    this.trayDestroyCount += 1;
  }

  registerGlobalShortcut(accelerator: string): NativeOperationResult {
    this.registeredShortcuts.push(accelerator);
    return this.shortcutResult;
  }

  unregisterGlobalShortcut(accelerator?: string): void {
    if (accelerator) {
      this.unregisteredShortcuts.push(accelerator);
    }
  }

  registerProtocolClient(scheme: "hotcrossbuns"): NativeOperationResult {
    this.protocolSchemes.push(scheme);
    return { ok: true, state: "ready", message: "protocol" };
  }

  requestNotificationPermission() {
    return { state: "prompt" as const };
  }

  listFontFamilies(): string[] {
    return this.fontFamilies;
  }

  scheduleNotification(request: NativeNotificationRequest): ScheduledNativeNotification {
    this.scheduledNotifications.push(request);
    return {
      id: request.id,
      cancel: () => undefined
    };
  }

  clearScheduledNotifications(): void {
    this.scheduledNotifications = [];
  }

  setAutostart(enabled: boolean): NativeOperationResult {
    this.autostartRequests.push(enabled);
    return {
      ok: true,
      state: "ready",
      message: enabled ? "Open-at-login is enabled." : "Open-at-login is disabled."
    };
  }

  autostartStatus(): NativeOperationResult {
    return {
      ok: true,
      state: "disabled",
      message: "Open-at-login is disabled."
    };
  }

  checkForUpdates(): NativeOperationResult {
    return {
      ok: false,
      state: "unsupported",
      message: "not configured"
    };
  }

  openExternalUrl(): NativeOperationResult {
    return {
      ok: true,
      state: "ready",
      message: "opened"
    };
  }

  openPath(): NativeOperationResult {
    return {
      ok: true,
      state: "ready",
      message: "opened"
    };
  }

  collectDiagnostics(): NativeOperationResult {
    return {
      ok: true,
      state: "ready",
      message: "diagnostics"
    };
  }

  dispose(): void {
    this.registeredShortcuts = [];
    this.scheduledNotifications = [];
  }
}

function createService(input: {
  adapter?: FakeNativeAdapter;
  settings?: SettingsSnapshot;
  tasks?: TaskSummary[];
  events?: CalendarEventSummary[];
  dispatch?: (action: NativeAction) => void;
} = {}) {
  const adapter = input.adapter ?? new FakeNativeAdapter();
  const settings = { current: input.settings ?? defaultSettings() };
  const dispatch = input.dispatch ?? vi.fn();
  const sync = vi.fn();
  const service = new NativeShellService({
    adapter,
    planner: {
      listTasks: () => ({ items: input.tasks ?? [] }),
      listCalendarEvents: () => ({ items: input.events ?? [] })
    },
    settings: {
      get: () => settings.current
    },
    windows: {
      showMainWindow: vi.fn(),
      hideMainWindow: vi.fn(),
      showOrHideMainWindow: vi.fn(),
      quit: vi.fn(),
      dispatchAction: dispatch
    },
    sync: {
      runNow: sync
    },
    now: () => now
  });

  return { adapter, service, settings, dispatch, sync };
}

describe("native shell service", () => {
  it("defers tray, hotkey, notifications, protocol, updater, and MCP startup", async () => {
    const { adapter, service } = createService({
      tasks: [
        {
          id: "task-1",
          listId: "inbox",
          title: "Pay invoice",
          status: "active",
          dueAt: "2026-05-22T00:00:00.000Z",
          updatedAt: now.toISOString(),
          priority: "none"
        }
      ],
      events: [
        {
          id: "event-1",
          calendarId: "cal-1",
          title: "Standup",
          startsAt: "2026-05-22T12:20:00.000Z",
          endsAt: "2026-05-22T12:40:00.000Z",
          allDay: false,
          updatedAt: now.toISOString(),
          reminderMinutes: []
        }
      ]
    });

    expect(service.capabilities().deferredStartup.state).toBe("pending");
    expect(adapter.trayCreateCount).toBe(0);
    expect(adapter.registeredShortcuts).toEqual([]);

    service.startDeferredStartup();
    await flushNativeStartup();

    expect(adapter.trayCreateCount).toBe(1);
    expect(adapter.registeredShortcuts).toEqual(["Ctrl+Space"]);
    expect(adapter.protocolSchemes).toEqual(["hotcrossbuns"]);
    expect(adapter.scheduledNotifications.map((request) => request.id)).toEqual([
      "task:task-1",
      "event:event-1"
    ]);
    expect(service.capabilities()).toMatchObject({
      deferredStartup: {
        state: "complete"
      },
      quickCaptureShortcut: {
        registered: true,
        state: "ready"
      },
      notificationsStatus: {
        scheduledCount: 2,
        state: "ready"
      }
    });
  });

  it("reports recoverable quick capture shortcut conflicts", async () => {
    const adapter = new FakeNativeAdapter();
    adapter.shortcutResult = {
      ok: false,
      state: "conflict",
      message: "Ctrl+Space is already registered by another app."
    };
    const { service } = createService({ adapter });

    service.startDeferredStartup();
    await flushNativeStartup();

    expect(service.capabilities().quickCaptureShortcut).toEqual({
      accelerator: "Ctrl+Space",
      registered: false,
      state: "conflict",
      message: "Ctrl+Space is already registered by another app."
    });
  });

  it("routes tray menu actions without renderer-native calls", async () => {
    const { adapter, dispatch, service, sync } = createService();

    service.startDeferredStartup();
    await flushNativeStartup();
    adapter.trayActions?.quickCapture();
    adapter.trayActions?.openSettings();
    adapter.trayActions?.refresh();

    expect(dispatch).toHaveBeenCalledWith({ type: "quickCapture" });
    expect(dispatch).toHaveBeenCalledWith({ type: "openSettings" });
    expect(dispatch).toHaveBeenCalledWith({ type: "refresh" });
    expect(sync).toHaveBeenCalledWith({
      resources: ["tasks", "calendar"],
      full: false,
      dryRun: false
    });
  });

  it("lists sanitized native font families without exposing renderer privileges", async () => {
    const adapter = new FakeNativeAdapter();
    adapter.fontFamilies = ["SF Pro Text", " Avenir ", "", "Avenir"];
    const { service } = createService({ adapter });

    await expect(service.listFontFamilies()).resolves.toEqual({
      platform: "darwin",
      families: ["Avenir", "SF Pro Text"]
    });
  });

  it("builds an adaptive menu bar snapshot from cached tasks and events", async () => {
    const { adapter, service } = createService({
      tasks: [
        {
          id: "task-overdue",
          listId: "inbox",
          title: "File overdue report",
          status: "active",
          dueAt: "2026-05-21T01:00:00.000Z",
          updatedAt: now.toISOString(),
          priority: "high"
        },
        {
          id: "task-today",
          listId: "inbox",
          title: "Send launch notes",
          status: "active",
          dueAt: "2026-05-22T02:00:00.000Z",
          updatedAt: now.toISOString(),
          priority: "none"
        }
      ],
      events: [
        {
          id: "event-today",
          calendarId: "cal-1",
          title: "Release sync",
          startsAt: "2026-05-22T13:00:00.000Z",
          endsAt: "2026-05-22T13:30:00.000Z",
          allDay: false,
          updatedAt: now.toISOString(),
          reminderMinutes: []
        }
      ]
    });

    service.startDeferredStartup();
    await flushNativeStartup();

    const snapshot = adapter.trayActions?.snapshot();

    expect(snapshot).toMatchObject({
      panelStyle: "adaptive",
      primaryClickAction: "open-menu",
      title: "1 overdue",
      badgeLabel: "1"
    });
    expect(snapshot?.sections.map((section) => section.title)).toContain("Needs Attention");
    expect(snapshot?.sections.flatMap((section) => section.items.map((item) => item.label))).toEqual(
      expect.arrayContaining(["File overdue report", "Release sync", "Send launch notes"])
    );
  });

  it("parses and dispatches custom protocol deep links safely", () => {
    expect(parseHotCrossBunsDeepLink("hotcrossbuns://task/task-1")).toEqual({
      type: "openRoute",
      route: {
        kind: "task",
        id: "task-1"
      }
    });
    expect(parseHotCrossBunsDeepLink("hotcrossbuns://search?q=invoice")).toEqual({
      type: "openRoute",
      route: {
        kind: "search",
        query: "invoice"
      }
    });
    expect(parseHotCrossBunsDeepLink("https://example.com/task/task-1")).toBeNull();
    expect(parseHotCrossBunsDeepLink("hotcrossbuns://task/%E0%A4%A")).toBeNull();
    expect(parseHotCrossBunsDeepLink(`hotcrossbuns://task/${"a".repeat(257)}`)).toBeNull();
    expect(parseHotCrossBunsDeepLink(`hotcrossbuns://search?q=${"a".repeat(201)}`)).toBeNull();

    const dispatch = vi.fn();
    const { service } = createService({ dispatch });

    expect(service.handleDeepLink("hotcrossbuns://event/event-1")).toBe(true);
    expect(dispatch).toHaveBeenCalledWith({
      type: "openRoute",
      route: {
        kind: "event",
        id: "event-1"
      }
    });
  });

  it("keeps disabled tray and notification settings reflected in native status", async () => {
    const { adapter, service } = createService({
      settings: defaultSettings({
        showTrayIcon: false,
        notificationsEnabled: false
      })
    });

    service.startDeferredStartup();
    await flushNativeStartup();

    expect(adapter.trayCreateCount).toBe(0);
    expect(adapter.scheduledNotifications).toEqual([]);
    expect(service.capabilities()).toMatchObject({
      trayStatus: {
        state: "disabled"
      },
      notificationsStatus: {
        state: "disabled",
        scheduledCount: 0
      }
    });
  });

  it("applies settings changes to tray, hotkey, notifications, and MCP status", async () => {
    const { adapter, service, settings } = createService();

    service.startDeferredStartup();
    await flushNativeStartup();

    settings.current = defaultSettings({
      quickCaptureShortcut: "Alt+Space",
      showTrayIcon: false,
      notificationsEnabled: false,
      mcpEnabled: true,
      mcpPort: 7331
    });
    service.applySettings(settings.current);

    expect(adapter.unregisteredShortcuts).toEqual(["Ctrl+Space"]);
    expect(adapter.registeredShortcuts).toEqual(["Ctrl+Space", "Alt+Space"]);
    expect(adapter.trayDestroyCount).toBe(1);
    expect(service.capabilities()).toMatchObject({
      quickCaptureShortcut: {
        accelerator: "Alt+Space",
        registered: true,
        state: "ready"
      },
      trayStatus: {
        state: "disabled"
      },
      notificationsStatus: {
        state: "disabled",
        scheduledCount: 0
      },
      mcpStatus: {
        state: "pending"
      }
    });

    settings.current = defaultSettings({
      quickCaptureShortcut: null,
      showTrayIcon: true,
      notificationsEnabled: false
    });
    service.applySettings(settings.current);

    expect(adapter.unregisteredShortcuts).toEqual(["Ctrl+Space", "Alt+Space"]);
    expect(adapter.trayCreateCount).toBe(2);
    expect(service.capabilities().quickCaptureShortcut).toMatchObject({
      accelerator: null,
      registered: false,
      state: "disabled"
    });
  });

  it("redacts native adapter status messages before exposing them", async () => {
    const adapter = new FakeNativeAdapter();
    adapter.trayResult = {
      ok: false,
      state: "error",
      message: "access_token=fake-token failed under /Users/example/Library"
    };
    const { service } = createService({ adapter });

    service.startDeferredStartup();
    await flushNativeStartup();

    const message = service.capabilities().trayStatus.message ?? "";

    expect(message).not.toContain("fake-token");
    expect(message).not.toContain("/Users/example");
    expect(message).toContain("[REDACTED]");
  });

  it("exposes a detailed adapter capability report without platform-specific renderer logic", async () => {
    const { service } = createService();

    service.startDeferredStartup();
    await flushNativeStartup();

    const report = service.capabilities().capabilityReport;

    expect(report).toMatchObject({
      adapterId: "fake",
      platform: "darwin",
      flags: {
        supportsTray: true,
        supportsGlobalShortcut: true,
        supportsAutostart: true,
        supportsCredentialStorage: false
      }
    });
    expect(report.capabilities.map((capability) => capability.key)).toEqual(
      expect.arrayContaining([
        "appPaths",
        "credentialStorage",
        "tray",
        "appMenu",
        "globalShortcuts",
        "notifications",
        "customProtocol",
        "autostart",
        "updater",
        "installerMetadata",
        "externalOpen",
        "diagnostics",
        "oauthLoopback",
        "mcpLoopback",
        "packaging"
      ])
    );
    expect(report.capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "tray", label: "Tray icon" }),
        expect.objectContaining({ key: "globalShortcuts", label: "Global shortcuts" }),
        expect.objectContaining({ key: "oauthLoopback", label: "OAuth loopback" }),
        expect.objectContaining({ key: "credentialStorage", label: "Credential storage" }),
        expect.objectContaining({ key: "notifications", label: "Notifications" }),
        expect.objectContaining({ key: "customProtocol", label: "Protocol registration" }),
        expect.objectContaining({ key: "mcpLoopback", label: "MCP loopback" })
      ])
    );
    expect(report.paths.map((path) => path.role)).toEqual(
      expect.arrayContaining(["config", "data", "cache", "logs", "diagnostics", "temp"])
    );
  });

  it("routes open-at-login settings through the native adapter contract", async () => {
    const { adapter, service, settings } = createService();

    service.startDeferredStartup();
    await flushNativeStartup();

    settings.current = defaultSettings({ startOnLogin: true });
    service.applySettings(settings.current);

    expect(adapter.autostartRequests).toContain(true);
    expect(
      service
        .capabilities()
        .capabilityReport.capabilities.find((capability) => capability.key === "autostart")
    ).toMatchObject({
      state: "ready",
      message: "Open-at-login is enabled."
    });
  });
});
