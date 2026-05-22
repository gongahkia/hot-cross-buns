import {
  Notification,
  Tray,
  app,
  globalShortcut,
  nativeImage,
  Menu,
  shell,
  type NativeImage,
  type MenuItemConstructorOptions
} from "electron";
import { join } from "node:path";
import {
  HCB_DEEP_LINK_SCHEME,
  type NativeAppPaths,
  type NativeMenuBarItem,
  type NativeMenuBarSnapshot,
  type NativeNotificationRequest,
  type NativeOperationResult,
  type NativePlatformAdapter,
  type NativePlatformCapabilities,
  type NativeTrayActions,
  type ScheduledNativeNotification
} from "./types";
import { brandImage } from "./brandAssets";
import {
  buildNativeCapabilityReport,
  capabilityDiagnostic,
  nativePlatform
} from "./capabilityReport";

const fallbackTrayIconBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAOUlEQVR4nGNgGArgP7macGGyDSHZufgMwGkgPqcT5SKKDCBFM1UMoV0gUmQAPu+QBKiSEklyLtkAAHbWV6m7KwjdAAAAAElFTkSuQmCC";
const maxNotificationDelayMs = 2_147_483_647;

export function createElectronMacNativeAdapter(): NativePlatformAdapter {
  return new ElectronMacNativeAdapter();
}

class ElectronMacNativeAdapter implements NativePlatformAdapter {
  private tray: Tray | undefined;
  private readonly shortcuts = new Set<string>();
  private readonly notificationTimers = new Map<string, NodeJS.Timeout>();

  appPaths(): NativeAppPaths {
    const userData = app.getPath("userData");
    const logs = safeAppPath("logs", join(userData, "logs"));
    const temp = safeAppPath("temp", join(userData, "tmp"));

    return {
      configDirectory: join(userData, "config"),
      dataDirectory: join(userData, "data"),
      cacheDirectory: join(userData, "cache"),
      logsDirectory: logs,
      diagnosticsDirectory: join(userData, "diagnostics"),
      tempDirectory: join(temp, "hot-cross-buns-2")
    };
  }

  capabilities(): NativePlatformCapabilities {
    const isMac = process.platform === "darwin";
    const appPaths = this.appPaths();
    const notifications = isMac && Notification.isSupported();
    const flags = {
      supportsAppPaths: true,
      supportsTray: isMac,
      supportsAppMenu: isMac,
      supportsGlobalShortcut: isMac,
      supportsNotifications: notifications,
      supportsNotificationPermissionQuery: false,
      supportsProtocolRegistration: isMac,
      supportsProtocolRegistrationCheck: isMac,
      supportsAutostart: isMac,
      supportsInPlaceAutoUpdate: false,
      supportsInstallerMetadata: isMac,
      supportsExternalUrlOpen: true,
      supportsDiagnosticsCollection: true,
      supportsCredentialStorage: false,
      supportsOAuthLoopback: true,
      supportsMcpLoopback: true,
      requiresSignedBuildForNotifications: false
    };

    return {
      platform: isMac ? "darwin" : nativePlatform(),
      adapterId: "electron-mac",
      notifications,
      globalShortcuts: isMac,
      tray: isMac,
      deepLinks: isMac,
      updaterChecks: false,
      capabilityReport: buildNativeCapabilityReport({
        platform: isMac ? "darwin" : nativePlatform(),
        adapterId: "electron-mac",
        appPaths,
        packageFormat: app.isPackaged ? "unknown" : "development",
        flags,
        capabilityOverrides: {
          credentialStorage: {
            state: "unsupported",
            message: "Keychain-backed credential storage is not wired in this adapter yet."
          },
          notifications: {
            state: notifications ? "ready" : "unsupported",
            message: notifications
              ? "Electron notifications are available; exact OS permission state is inferred through delivery."
              : "Electron notifications are unavailable for this runtime."
          },
          updater: {
            state: "unsupported",
            message: "Preview builds support release checks only after updater metadata is added."
          },
          oauthLoopback: {
            state: "pending",
            message: "OAuth loopback is shared code; macOS browser handoff still needs manual release QA."
          },
          mcpLoopback: {
            state: "pending",
            message: "MCP loopback is shared code; persistent bearer-token storage is not wired."
          },
          packaging: {
            state: app.isPackaged ? "ready" : "pending",
            message: app.isPackaged
              ? "Packaged macOS artifact metadata is available."
              : "Development runtime has no installed package metadata."
          }
        },
        diagnostics: [
          capabilityDiagnostic(
            "credentialStorage",
            "blocker",
            "Google and MCP secrets still need OS credential storage before non-Mac ports."
          ),
          capabilityDiagnostic(
            "updater",
            "warning",
            "In-place auto-update is intentionally disabled for unsigned preview builds."
          )
        ]
      })
    };
  }

  credentialStorageStatus(): NativeOperationResult {
    return unsupported("Keychain-backed credential storage is not wired in this adapter yet.");
  }

  installAppMenu(actions: NativeTrayActions): NativeOperationResult {
    if (process.platform !== "darwin") {
      return unsupported("macOS application menu is unavailable on this platform.");
    }

    const dockIcon = brandImage("app-icon.png");
    if (!dockIcon.isEmpty()) {
      app.dock?.setIcon(dockIcon);
    }

    Menu.setApplicationMenu(Menu.buildFromTemplate(appMenuTemplate(actions)));

    return {
      ok: true,
      state: "ready",
      message: "macOS application menu is installed."
    };
  }

  createTray(actions: NativeTrayActions): NativeOperationResult {
    if (process.platform !== "darwin") {
      return unsupported("macOS menu bar item is unavailable on this platform.");
    }

    try {
      const image = trayIconImage();
      image.setTemplateImage(true);
      this.tray?.destroy();
      this.tray = new Tray(image);
      this.tray.setIgnoreDoubleClickEvents(true);
      this.refreshTrayPresentation(actions);
      this.tray.on("click", () => {
        const snapshot = this.refreshTrayPresentation(actions);

        if (snapshot.primaryClickAction === "open-menu") {
          this.tray?.popUpContextMenu(menuBarPanelMenu(actions, snapshot));
          return;
        }

        actions.primaryClick();
      });
      this.tray.on("right-click", () => {
        this.refreshTrayPresentation(actions);
        this.tray?.popUpContextMenu(trayUtilityMenu(actions));
      });

      return {
        ok: true,
        state: "ready",
        message: "macOS menu bar item is installed."
      };
    } catch (error) {
      return {
        ok: false,
        state: "error",
        message: error instanceof Error ? error.message : "Could not create the menu bar item."
      };
    }
  }

  private refreshTrayPresentation(actions: NativeTrayActions): NativeMenuBarSnapshot {
    const snapshot = actions.snapshot();
    const image = trayIconImage();
    image.setTemplateImage(true);

    this.tray?.setImage(image);
    this.tray?.setToolTip(snapshot.tooltip);
    this.tray?.setTitle(snapshot.badgeLabel ?? "", { fontType: "monospacedDigit" });

    return snapshot;
  }

  destroyTray(): void {
    this.tray?.destroy();
    this.tray = undefined;
  }

  registerGlobalShortcut(accelerator: string, action: () => void): NativeOperationResult {
    if (process.platform !== "darwin") {
      return unsupported("Global shortcuts are not registered by this platform adapter.");
    }

    try {
      const registered = globalShortcut.register(accelerator, action);

      if (!registered) {
        return {
          ok: false,
          state: "conflict",
          message: `${accelerator} is already in use or blocked by macOS. Choose another quick capture shortcut in Settings.`
        };
      }

      this.shortcuts.add(accelerator);

      return {
        ok: true,
        state: "ready",
        message: `${accelerator} is registered for quick capture.`
      };
    } catch (error) {
      return {
        ok: false,
        state: "error",
        message:
          error instanceof Error
            ? error.message
            : `${accelerator} could not be registered as a global shortcut.`
      };
    }
  }

  unregisterGlobalShortcut(accelerator?: string): void {
    if (accelerator) {
      globalShortcut.unregister(accelerator);
      this.shortcuts.delete(accelerator);
      return;
    }

    for (const shortcut of this.shortcuts) {
      globalShortcut.unregister(shortcut);
    }

    this.shortcuts.clear();
  }

  registerProtocolClient(scheme: typeof HCB_DEEP_LINK_SCHEME): NativeOperationResult {
    if (process.platform !== "darwin") {
      return unsupported("Protocol registration is not handled by this platform adapter.");
    }

    const defaultApp = (process as NodeJS.Process & { defaultApp?: boolean }).defaultApp;
    const ok = defaultApp && process.argv.length >= 2
      ? app.setAsDefaultProtocolClient(scheme, process.execPath, [process.argv[1]])
      : app.setAsDefaultProtocolClient(scheme);

    return {
      ok,
      state: ok ? "ready" : "error",
      message: ok
        ? `${scheme}:// links are registered for this app.`
        : `${scheme}:// links could not be registered for this app.`
    };
  }

  requestNotificationPermission() {
    if (process.platform !== "darwin" || !Notification.isSupported()) {
      return {
        state: "unsupported" as const
      };
    }

    const notification = new Notification({
      title: "Notifications enabled",
      body: "Due tasks and upcoming events can appear here."
    });
    notification.show();

    return {
      state: "prompt" as const
    };
  }

  scheduleNotification(
    request: NativeNotificationRequest,
    onClick: () => void
  ): ScheduledNativeNotification | undefined {
    if (process.platform !== "darwin" || !Notification.isSupported()) {
      return undefined;
    }

    const delayMs = Math.max(0, request.deliveryDate.getTime() - Date.now());

    if (delayMs > maxNotificationDelayMs) {
      return undefined;
    }

    const timer = setTimeout(() => {
      this.notificationTimers.delete(request.id);
      const notification = new Notification({
        title: request.title,
        body: request.body
      });
      notification.on("click", onClick);
      notification.show();
    }, delayMs);

    timer.unref?.();
    this.notificationTimers.set(request.id, timer);

    return {
      id: request.id,
      cancel: () => {
        clearTimeout(timer);
        this.notificationTimers.delete(request.id);
      }
    };
  }

  clearScheduledNotifications(): void {
    for (const timer of this.notificationTimers.values()) {
      clearTimeout(timer);
    }

    this.notificationTimers.clear();
  }

  setAutostart(enabled: boolean): NativeOperationResult {
    if (process.platform !== "darwin") {
      return unsupported("Open-at-login is not handled by this platform adapter.");
    }

    try {
      app.setLoginItemSettings({
        openAtLogin: enabled
      });
      const status = app.getLoginItemSettings();

      return {
        ok: status.openAtLogin === enabled,
        state: status.openAtLogin === enabled ? "ready" : "error",
        message:
          status.openAtLogin === enabled
            ? enabled
              ? "Open-at-login is enabled."
              : "Open-at-login is disabled."
            : "Open-at-login did not match the requested setting."
      };
    } catch (error) {
      return {
        ok: false,
        state: "error",
        message: error instanceof Error ? error.message : "Open-at-login could not be updated."
      };
    }
  }

  autostartStatus(): NativeOperationResult {
    if (process.platform !== "darwin") {
      return unsupported("Open-at-login is not handled by this platform adapter.");
    }

    try {
      const status = app.getLoginItemSettings();

      return {
        ok: true,
        state: status.openAtLogin ? "ready" : "disabled",
        message: status.openAtLogin ? "Open-at-login is enabled." : "Open-at-login is disabled."
      };
    } catch (error) {
      return {
        ok: false,
        state: "error",
        message: error instanceof Error ? error.message : "Open-at-login status could not be read."
      };
    }
  }

  checkForUpdates(): NativeOperationResult {
    return unsupported("Preview update checks are not configured for this build.");
  }

  async openExternalUrl(url: string): Promise<NativeOperationResult> {
    try {
      await shell.openExternal(url);

      return {
        ok: true,
        state: "ready",
        message: "External URL was opened by the operating system."
      };
    } catch (error) {
      return {
        ok: false,
        state: "error",
        message: error instanceof Error ? error.message : "External URL could not be opened."
      };
    }
  }

  async openPath(path: string): Promise<NativeOperationResult> {
    const result = await shell.openPath(path);

    return result
      ? {
          ok: false,
          state: "error",
          message: result
        }
      : {
          ok: true,
          state: "ready",
          message: "Path was opened by the operating system."
        };
  }

  collectDiagnostics(): NativeOperationResult {
    return {
      ok: true,
      state: "ready",
      message: "macOS native adapter diagnostics are available through the capability report."
    };
  }

  dispose(): void {
    this.clearScheduledNotifications();
    this.unregisterGlobalShortcut();
    this.tray?.destroy();
    this.tray = undefined;
  }
}

function trayIconImage(): NativeImage {
  const image = brandImage("menubar-template.png");

  return image.isEmpty()
    ? nativeImage.createFromDataURL(`data:image/png;base64,${fallbackTrayIconBase64}`)
    : image;
}

function menuBarPanelMenu(actions: NativeTrayActions, snapshot: NativeMenuBarSnapshot): Menu {
  const template: MenuItemConstructorOptions[] = [
    {
      label: snapshot.title,
      sublabel: snapshot.subtitle,
      enabled: false
    }
  ];

  for (const section of snapshot.sections) {
    template.push({ type: "separator" });

    if (section.title) {
      template.push({
        label: section.title,
        enabled: false
      });
    }

    template.push(...section.items.map((item) => menuItemFromSnapshotItem(actions, item)));
  }

  template.push(
    { type: "separator" },
    {
      label: "Quick Capture",
      click: actions.quickCapture
    },
    {
      label: "Refresh Tasks and Calendar",
      click: actions.refresh
    },
    {
      label: "Open Hot Cross Buns 2",
      click: actions.openMainWindow
    },
    {
      label: "Settings",
      click: actions.openSettings
    },
    { type: "separator" },
    {
      label: "Quit",
      click: actions.quit
    }
  );

  return Menu.buildFromTemplate(template);
}

function trayUtilityMenu(actions: NativeTrayActions): Menu {
  return Menu.buildFromTemplate([
    {
      label: "Open Hot Cross Buns 2",
      click: actions.openMainWindow
    },
    {
      label: "Quick Capture",
      click: actions.quickCapture
    },
    {
      label: "Refresh Tasks and Calendar",
      click: actions.refresh
    },
    { type: "separator" },
    {
      label: "Settings",
      click: actions.openSettings
    },
    { type: "separator" },
    {
      label: "Quit",
      click: actions.quit
    }
  ]);
}

function menuItemFromSnapshotItem(
  actions: NativeTrayActions,
  item: NativeMenuBarItem
): MenuItemConstructorOptions {
  return {
    label: item.label,
    sublabel: item.detail,
    enabled: Boolean(item.route || item.action),
    click: () => {
      if (item.route) {
        actions.openRoute(item.route);
        return;
      }

      if (item.action === "quickCapture") {
        actions.quickCapture();
      } else if (item.action === "refresh") {
        actions.refresh();
      } else if (item.action === "openSettings") {
        actions.openSettings();
      } else if (item.action === "showWindow") {
        actions.openMainWindow();
      }
    }
  };
}

function appMenuTemplate(actions: NativeTrayActions): MenuItemConstructorOptions[] {
  return [
    {
      label: app.name || "Hot Cross Buns 2",
      submenu: [
        { role: "about" },
        { type: "separator" },
        {
          label: "Settings",
          accelerator: "CommandOrControl+,",
          click: actions.openSettings
        },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" }
      ]
    },
    {
      label: "File",
      submenu: [
        {
          label: "Quick Capture",
          click: actions.quickCapture
        },
        {
          label: "Refresh",
          accelerator: "CommandOrControl+R",
          click: actions.refresh
        },
        { type: "separator" },
        { role: "close" }
      ]
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "pasteAndMatchStyle" },
        { role: "delete" },
        { role: "selectAll" }
      ]
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" }
      ]
    },
    {
      label: "Window",
      submenu: [{ role: "minimize" }, { role: "zoom" }, { type: "separator" }, { role: "front" }]
    }
  ];
}

function unsupported(message: string): NativeOperationResult {
  return {
    ok: false,
    state: "unsupported",
    message
  };
}

function safeAppPath(name: Parameters<typeof app.getPath>[0], fallback: string): string {
  try {
    return app.getPath(name);
  } catch {
    return fallback;
  }
}
