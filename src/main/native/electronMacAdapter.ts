import {
  Notification,
  Tray,
  app,
  globalShortcut,
  Menu,
  type MenuItemConstructorOptions
} from "electron";
import {
  HCB_DEEP_LINK_SCHEME,
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

  capabilities(): NativePlatformCapabilities {
    const isMac = process.platform === "darwin";

    return {
      platform: isMac ? "darwin" : nativePlatform(),
      notifications: isMac && Notification.isSupported(),
      globalShortcuts: isMac,
      tray: isMac,
      deepLinks: isMac,
      updaterChecks: false
    };
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

  checkForUpdates(): NativeOperationResult {
    return unsupported("Preview update checks are not configured for this build.");
  }

  dispose(): void {
    this.clearScheduledNotifications();
    this.unregisterGlobalShortcut();
    this.tray?.destroy();
    this.tray = undefined;
  }
}

function brandAssetPath(filename: string): string {
  const relativePath = join("assets", "brand", filename);

  return app.isPackaged
    ? join(process.resourcesPath, relativePath)
    : join(app.getAppPath(), relativePath);
}

function brandImage(filename: string): NativeImage {
  const imagePath = brandAssetPath(filename);

  return existsSync(imagePath) ? nativeImage.createFromPath(imagePath) : nativeImage.createEmpty();
}

function trayIconImage(): NativeImage {
  const image = brandImage("menubar-template.png");

  return image.isEmpty()
    ? nativeImage.createFromDataURL(`data:image/png;base64,${fallbackTrayIconBase64}`)
    : image;
}

function trayMenu(actions: NativeTrayActions): Menu {
  return Menu.buildFromTemplate([
    {
      label: "Show / Hide Hot Cross Buns 2",
      click: actions.showOrHideMainWindow
    },
    {
      label: "Quick Capture",
      click: actions.quickCapture
    },
    {
      label: "Refresh",
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

function nativePlatform(): NativePlatformCapabilities["platform"] {
  if (process.platform === "darwin" || process.platform === "linux" || process.platform === "win32") {
    return process.platform;
  }

  return "unknown";
}
