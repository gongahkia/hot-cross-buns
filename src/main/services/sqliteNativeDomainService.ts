import type { NativeCapabilitiesResponse, NativeNotificationPermissionResponse } from "@shared/ipc/contracts";
import {
  buildNativeCapabilityReport,
  capabilityDiagnostic,
  defaultNativeAppPaths,
  nativePlatform as detectNativePlatform
} from "../native/capabilityReport";
import type { NativeDomainService } from "./domainInterfaces";

export function createSqliteNativeDomainService(): NativeDomainService {
  return {
    capabilities: () => nativeCapabilities(),
    checkForUpdates: () => ({
      state: "unsupported",
      message: "Preview update checks are unavailable through the fallback domain service."
    }),
    openExternalUrl: () => ({
      state: "unsupported",
      message: "External URL opening is unavailable through the fallback domain service."
    }),
    requestNotificationPermission: () => nativeNotificationPermission(),
    listFontFamilies: () => ({
      platform: detectNativePlatform(),
      families: []
    })
  };
}

function nativeCapabilities(): NativeCapabilitiesResponse {
  const platform = detectNativePlatform();
  const report = buildNativeCapabilityReport({
    platform,
    adapterId: "domain-fallback",
    appPaths: defaultNativeAppPaths(),
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
      requiresSignedBuildForNotifications: platform === "win32",
      ...(platform === "linux"
        ? {
            hasWaylandSession: process.env.XDG_SESSION_TYPE === "wayland",
            hasPortalShortcutSupport: false
          }
        : {})
    },
    capabilityOverrides: {
      oauthLoopback: {
        state: "pending",
        message: "OAuth loopback is shared code; platform browser handoff is not verified by the fallback service."
      },
      mcpLoopback: {
        state: "pending",
        message: "MCP loopback is shared code; native lifecycle is not owned by the fallback service."
      }
    },
    diagnostics: [
      capabilityDiagnostic(
        "packaging",
        "warning",
        "Native capability status is from the fallback domain service, not a platform adapter."
      )
    ]
  });

  return {
    platform,
    notifications: false,
    globalShortcuts: false,
    tray: false,
    deepLinks: false,
    trayStatus: {
      state: "unsupported",
      message: "Tray/menu bar is unavailable through the fallback domain service."
    },
    notificationsStatus: {
      permission: "unsupported",
      scheduledCount: 0,
      state: "unsupported",
      message: "Notifications are unavailable through the fallback domain service."
    },
    deepLinkStatus: {
      scheme: "hotcrossbuns",
      registered: false,
      state: "unsupported",
      message: "Deep links are unavailable through the fallback domain service."
    },
    updaterStatus: {
      state: "unsupported",
      message: "Preview update checks are not configured for this build."
    },
    mcpStatus: {
      state: "disabled",
      message: "MCP local agent access is disabled."
    },
    capabilityReport: report,
    deferredStartup: {
      state: "pending"
    }
  };
}

function nativeNotificationPermission(): NativeNotificationPermissionResponse {
  return {
    state: "unsupported"
  };
}
