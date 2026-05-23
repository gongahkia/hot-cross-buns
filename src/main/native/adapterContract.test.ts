import { describe, expect, it, vi } from "vitest";
import {
  nativeCapabilitiesResponseSchema,
  type SettingsSnapshot
} from "@shared/ipc/contracts";
import { createNoopNativeAdapter } from "./noopAdapter";
import { NativeShellService } from "./service";

function defaultSettings(overrides: Partial<SettingsSnapshot> = {}): SettingsSnapshot {
  return {
    theme: "system",
    colorTheme: "notion",
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

describe("native adapter contract", () => {
  it("reports every required capability through the noop adapter without claiming Linux support", () => {
    const adapter = createNoopNativeAdapter("linux");
    const report = adapter.capabilities().capabilityReport;

    expect(report.platform).toBe("linux");
    expect(report.flags).toMatchObject({
      supportsAppPaths: true,
      supportsTray: false,
      supportsGlobalShortcut: false,
      supportsNotifications: false,
      supportsCredentialStorage: false,
      supportsInPlaceAutoUpdate: false
    });
    expect(report.diagnostics).toContainEqual(
      expect.objectContaining({
        key: "packaging",
        severity: "blocker"
      })
    );
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
  });

  it("keeps unsupported platform operations recoverable and schema-valid", () => {
    const adapter = createNoopNativeAdapter("win32");
    const service = new NativeShellService({
      adapter,
      planner: {
        listTasks: () => ({ items: [] }),
        listCalendarEvents: () => ({ items: [] })
      },
      settings: {
        get: () => defaultSettings()
      },
      windows: {
        showMainWindow: vi.fn(),
        hideMainWindow: vi.fn(),
        showOrHideMainWindow: vi.fn(),
        quit: vi.fn(),
        dispatchAction: vi.fn()
      },
      sync: {
        runNow: vi.fn()
      }
    });

    const parsed = nativeCapabilitiesResponseSchema.safeParse(service.capabilities());

    expect(parsed.success).toBe(true);
    expect(adapter.setAutostart(true)).toMatchObject({
      ok: false,
      state: "unsupported"
    });
    expect(adapter.credentialStorageStatus()).toMatchObject({
      ok: false,
      state: "unsupported"
    });
    expect(adapter.openExternalUrl("https://accounts.google.com")).toMatchObject({
      ok: false,
      state: "unsupported"
    });
  });
});
