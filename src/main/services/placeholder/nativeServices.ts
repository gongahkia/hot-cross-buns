import type { NativeCapabilitiesResponse } from "@shared/ipc/contracts";
import type { NativeDomainService } from "../domainInterfaces";
import {
  buildNativeCapabilityReport,
  capabilityDiagnostic,
  defaultNativeAppPaths,
  nativePlatform as detectNativePlatform
} from "../../native/capabilityReport";

export function createPlaceholderNativeServices(): NativeDomainService {
  return {
    capabilities: () => nativeCapabilities(),
    checkForUpdates: () => ({
      state: "unsupported",
      message: "Preview update checks are unavailable through placeholder services."
    }),
    openExternalUrl: () => ({
      state: "unsupported",
      message: "External URL opening is unavailable through placeholder services."
    }),
    requestNotificationPermission: () => ({
      state: "unsupported"
    }),
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
    adapterId: "placeholder",
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
        message: "OAuth loopback is shared code; platform browser handoff is not verified by placeholder data."
      },
      mcpLoopback: {
        state: "pending",
        message: "MCP loopback is shared code; native lifecycle is not owned by placeholder data."
      }
    },
    diagnostics: [
      capabilityDiagnostic(
        "packaging",
        "warning",
        "Native capability status is placeholder data and does not claim platform support."
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
      message: "Tray/menu bar is unavailable in placeholder data."
    },
    notificationsStatus: {
      permission: "unsupported",
      scheduledCount: 0,
      state: "unsupported",
      message: "Notifications are unavailable in placeholder data."
    },
    deepLinkStatus: {
      scheme: "hotcrossbuns" as const,
      registered: false,
      state: "unsupported",
      message: "Deep links are unavailable in placeholder data."
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
