import {
  BrowserWindow,
  Notification,
  Tray,
  app,
  globalShortcut,
  nativeImage,
  Menu,
  screen,
  shell,
  type Rectangle,
  type NativeImage,
  type MenuItemConstructorOptions
} from "electron";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import type { NativeRoute } from "@shared/ipc/contracts";
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
const menuBarPanelGap = 2;
const execFileAsync = promisify(execFile);
const macFontFamiliesScript = `
ObjC.import("AppKit");
const fonts = $.NSFontManager.sharedFontManager.availableFontFamilies;
const families = [];
for (let index = 0; index < fonts.count; index += 1) {
  families.push(ObjC.unwrap(fonts.objectAtIndex(index)));
}
JSON.stringify(families);
`;

export function createElectronMacNativeAdapter(): NativePlatformAdapter {
  return new ElectronMacNativeAdapter();
}

class ElectronMacNativeAdapter implements NativePlatformAdapter {
  private tray: Tray | undefined;
  private menuBarPanelWindow: BrowserWindow | undefined;
  private trayRefreshTimer: NodeJS.Timeout | undefined;
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
      supportsAutostart: isMac && app.isPackaged,
      supportsInPlaceAutoUpdate: false,
      supportsInstallerMetadata: isMac,
      supportsExternalUrlOpen: true,
      supportsDiagnosticsCollection: true,
      supportsCredentialStorage: isMac,
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
            state: isMac ? "ready" : "unsupported",
            message: isMac
              ? "macOS Keychain storage is wired for main-process Google and MCP secrets."
              : "Keychain-backed credential storage is unavailable outside macOS."
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
            state: "ready",
            message: "OAuth loopback is wired through the main process and macOS browser handoff."
          },
          mcpLoopback: {
            state: "ready",
            message: "MCP loopback is wired with Keychain-backed bearer-token storage."
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
            "updater",
            "warning",
            "In-place auto-update is intentionally disabled for unsigned preview builds."
          )
        ]
      })
    };
  }

  credentialStorageStatus(): NativeOperationResult {
    if (process.platform !== "darwin") {
      return unsupported("Keychain-backed credential storage is unavailable outside macOS.");
    }

    return {
      ok: true,
      state: "ready",
      message: "macOS Keychain storage is available for main-process secrets."
    };
  }

  installAppMenu(actions: NativeTrayActions): NativeOperationResult {
    if (process.platform !== "darwin") {
      return unsupported("macOS application menu is unavailable on this platform.");
    }

    app.setName(macAppDisplayName());

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
      this.clearTrayRefreshTimer();
      this.tray = new Tray(image);
      this.tray.setIgnoreDoubleClickEvents(true);
      this.refreshTrayPresentation(actions);
      this.tray.on("click", () => {
        const snapshot = this.refreshTrayPresentation(actions);

        if (snapshot.primaryClickAction === "open-menu") {
          void this.toggleMenuBarPanel(actions, snapshot);
          return;
        }

        actions.primaryClick();
      });
      this.tray.on("right-click", () => {
        this.refreshTrayPresentation(actions);
        this.tray?.popUpContextMenu(trayUtilityMenu(actions));
      });
      this.trayRefreshTimer = setInterval(() => {
        this.refreshTrayPresentation(actions);
      }, 60_000);
      this.trayRefreshTimer.unref?.();

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
    const title = snapshot.statusLabel ?? snapshot.badgeLabel ?? "";

    this.tray?.setImage(image);
    this.tray?.setToolTip(snapshot.tooltip);
    this.tray?.setTitle(title);
    app.dock?.setBadge(snapshot.dockBadgeLabel ?? "");

    return snapshot;
  }

  destroyTray(): void {
    this.destroyMenuBarPanel();
    this.clearTrayRefreshTimer();
    this.tray?.destroy();
    this.tray = undefined;
    app.dock?.setBadge("");
  }

  private clearTrayRefreshTimer(): void {
    if (!this.trayRefreshTimer) {
      return;
    }

    clearInterval(this.trayRefreshTimer);
    this.trayRefreshTimer = undefined;
  }

  private async toggleMenuBarPanel(
    actions: NativeTrayActions,
    snapshot: NativeMenuBarSnapshot
  ): Promise<void> {
    if (!this.tray) {
      return;
    }

    if (this.menuBarPanelWindow?.isVisible()) {
      this.menuBarPanelWindow.hide();
      return;
    }

    try {
      const panel = this.ensureMenuBarPanel(actions);
      panel.setBounds(menuBarPanelBounds(this.tray.getBounds(), snapshot));
      await panel.loadURL(menuBarPanelDataUrl(snapshot));
      panel.show();
      panel.focus();
    } catch {
      this.tray.popUpContextMenu(menuBarPanelMenu(actions, snapshot));
    }
  }

  private ensureMenuBarPanel(actions: NativeTrayActions): BrowserWindow {
    if (this.menuBarPanelWindow && !this.menuBarPanelWindow.isDestroyed()) {
      return this.menuBarPanelWindow;
    }

    const panel = new BrowserWindow({
      width: 340,
      height: 640,
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      movable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      title: "Hot Cross Buns 2 menu bar panel",
      backgroundColor: "#00000000",
      webPreferences: {
        contextIsolation: true,
        javascript: false,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true
      }
    });

    panel.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    panel.setAlwaysOnTop(true, "pop-up-menu");
    panel.on("blur", () => panel.hide());
    panel.on("closed", () => {
      if (this.menuBarPanelWindow === panel) {
        this.menuBarPanelWindow = undefined;
      }
    });
    panel.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    panel.webContents.on("will-navigate", (event, url) => {
      if (!url.startsWith("hcb-panel://")) {
        event.preventDefault();
        return;
      }

      event.preventDefault();
      this.handleMenuBarPanelNavigation(url, actions);
    });

    this.menuBarPanelWindow = panel;
    return panel;
  }

  private handleMenuBarPanelNavigation(url: string, actions: NativeTrayActions): void {
    this.menuBarPanelWindow?.hide();

    const parsed = parseMenuBarPanelUrl(url);

    if (!parsed) {
      return;
    }

    if (parsed.kind === "route") {
      actions.openRoute(parsed.route);
    } else if (parsed.action === "quickCapture") {
      actions.quickCapture();
    } else if (parsed.action === "refresh") {
      actions.refresh();
    } else if (parsed.action === "openSettings") {
      actions.openSettings();
    } else if (parsed.action === "showWindow") {
      actions.openMainWindow();
    } else if (parsed.action === "quit") {
      actions.quit();
    }
  }

  private destroyMenuBarPanel(): void {
    if (!this.menuBarPanelWindow || this.menuBarPanelWindow.isDestroyed()) {
      this.menuBarPanelWindow = undefined;
      return;
    }

    this.menuBarPanelWindow.destroy();
    this.menuBarPanelWindow = undefined;
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

  async listFontFamilies(): Promise<string[]> {
    if (process.platform !== "darwin") {
      return [];
    }

    try {
      const { stdout } = await execFileAsync(
        "/usr/bin/osascript",
        ["-l", "JavaScript", "-e", macFontFamiliesScript],
        {
          maxBuffer: 512 * 1024,
          timeout: 2_000
        }
      );
      const parsed = JSON.parse(String(stdout).trim()) as unknown;

      return Array.isArray(parsed)
        ? parsed.filter((family): family is string => typeof family === "string")
        : [];
    } catch {
      return [];
    }
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

    if (!app.isPackaged) {
      return developmentAutostartResult(enabled);
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

    if (!app.isPackaged) {
      return developmentAutostartResult(false);
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
    this.destroyMenuBarPanel();
    this.clearTrayRefreshTimer();
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

function developmentAutostartResult(enabled: boolean): NativeOperationResult {
  return {
    ok: !enabled,
    state: enabled ? "unsupported" : "disabled",
    message: enabled
      ? "Open-at-login is only applied from a packaged macOS app."
      : "Open-at-login is not modified during development runs."
  };
}

function menuBarPanelBounds(trayBounds: Rectangle, snapshot: NativeMenuBarSnapshot): Rectangle {
  const display = screen.getDisplayMatching(trayBounds);
  const workArea = display.workArea;
  const size = menuBarPanelSize(snapshot, Math.max(240, workArea.height - 48));
  const x = clamp(
    Math.round(trayBounds.x + trayBounds.width / 2 - size.width / 2),
    workArea.x + menuBarPanelGap,
    workArea.x + workArea.width - size.width - menuBarPanelGap
  );
  const menuBarIsAboveWorkArea = trayBounds.y < workArea.y + workArea.height / 2;
  const y = menuBarIsAboveWorkArea
    ? Math.min(
        trayBounds.y + trayBounds.height + menuBarPanelGap,
        workArea.y + workArea.height - size.height - menuBarPanelGap
      )
    : Math.max(
        workArea.y + menuBarPanelGap,
        trayBounds.y - size.height - menuBarPanelGap
      );

  return {
    x,
    y: Math.round(y),
    width: size.width,
    height: size.height
  };
}

function menuBarPanelSize(
  snapshot: NativeMenuBarSnapshot,
  maxHeight: number
): { width: number; height: number } {
  if (snapshot.panelStyle === "calendar") {
    const selectedRows = snapshot.calendar?.selectedItems.length ?? 0;
    return {
      width: 320,
      height: Math.min(maxHeight, Math.max(620, 474 + Math.min(selectedRows, 7) * 42))
    };
  }

  const rowCount = snapshot.sections.reduce((total, section) => total + section.items.length, 0);
  const accountHeight = snapshot.account ? 78 : 0;

  return {
    width: 340,
    height: Math.min(maxHeight, Math.max(300, 132 + rowCount * 44 + accountHeight + 112))
  };
}

function menuBarPanelDataUrl(snapshot: NativeMenuBarSnapshot): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(menuBarPanelHtml(snapshot))}`;
}

function menuBarPanelHtml(snapshot: NativeMenuBarSnapshot): string {
  const panel =
    snapshot.panelStyle === "calendar" && snapshot.calendar
      ? calendarPanelMarkup(snapshot)
      : adaptivePanelMarkup(snapshot);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src 'unsafe-inline'; navigate-to hcb-panel:"
    >
    <meta name="color-scheme" content="light dark">
    <title>Hot Cross Buns 2 menu bar panel</title>
    <style>
      :root {
        color-scheme: light dark;
        font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, sans-serif;
        background: transparent;
        color: #262626;
        --panel: rgba(255, 255, 255, 0.98);
        --panel-border: rgba(0, 0, 0, 0.18);
        --separator: rgba(0, 0, 0, 0.11);
        --muted: rgba(0, 0, 0, 0.52);
        --faint: rgba(0, 0, 0, 0.22);
        --hover: rgba(0, 0, 0, 0.06);
        --accent: #74aef1;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        overflow: hidden;
        background: transparent;
        -webkit-font-smoothing: antialiased;
      }
      .popover {
        position: relative;
        width: 100vw;
        height: 100vh;
        padding-top: 9px;
      }
      .popover::before {
        content: "";
        position: absolute;
        top: 3px;
        left: calc(50% - 7px);
        width: 14px;
        height: 14px;
        transform: rotate(45deg);
        border-left: 1px solid var(--panel-border);
        border-top: 1px solid var(--panel-border);
        border-top-left-radius: 3px;
        background: var(--panel);
      }
      .panel {
        position: relative;
        width: 100%;
        height: calc(100vh - 9px);
        display: flex;
        flex-direction: column;
        overflow: hidden;
        border: 1px solid var(--panel-border);
        border-radius: 13px;
        background: var(--panel);
        box-shadow: 0 18px 44px rgba(0, 0, 0, 0.28);
      }
      .panel-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 14px 18px 9px;
      }
      .panel-header h1 {
        margin: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 17px;
        line-height: 22px;
        font-weight: 500;
      }
      .sync-label,
      .section-count,
      .secondary {
        color: var(--muted);
      }
      .sync-label {
        font-size: 12px;
        font-weight: 600;
      }
      .scroll-body {
        min-height: 0;
        flex: 1;
        overflow-y: auto;
        padding: 0 14px 10px;
      }
      .native-section {
        margin-top: 10px;
      }
      .section-heading {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        padding: 0 2px 6px;
        color: var(--muted);
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0;
      }
      .native-row {
        display: grid;
        grid-template-columns: 22px minmax(0, 1fr);
        gap: 8px;
        min-height: 38px;
        align-items: center;
        padding: 4px 4px;
        border-radius: 7px;
        color: inherit;
        text-decoration: none;
      }
      .native-row:hover { background: var(--hover); }
      .row-icon {
        width: 18px;
        height: 18px;
        justify-self: center;
        opacity: 0.58;
        position: relative;
      }
      .row-icon.event::before,
      .row-icon.placeholder::before {
        content: "";
        position: absolute;
        inset: 2px;
        border: 1.5px solid currentColor;
        border-radius: 3px;
      }
      .row-icon.event::after {
        content: "";
        position: absolute;
        left: 6px;
        top: 7px;
        width: 2px;
        height: 2px;
        background: currentColor;
        box-shadow: 4px 0 0 currentColor, 0 4px 0 currentColor, 4px 4px 0 currentColor;
      }
      .row-icon.task {
        border: 1.5px solid currentColor;
        border-radius: 50%;
      }
      .row-icon.task::after {
        content: "";
        position: absolute;
        left: 5px;
        top: 5px;
        width: 7px;
        height: 4px;
        border-left: 1.5px solid currentColor;
        border-bottom: 1.5px solid currentColor;
        transform: rotate(-45deg);
      }
      .row-title,
      .row-detail {
        display: block;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .row-title {
        font-size: 13px;
        line-height: 18px;
        font-weight: 500;
      }
      .row-detail {
        color: var(--muted);
        font-size: 12px;
        line-height: 16px;
      }
      .disabled {
        pointer-events: none;
        color: var(--muted);
      }
      .divider {
        border-top: 1px solid var(--separator);
        margin: 10px 0;
      }
      .account {
        display: grid;
        grid-template-columns: 28px minmax(0, 1fr) 18px;
        align-items: center;
        gap: 8px;
        padding: 4px 0;
      }
      .avatar {
        width: 20px;
        height: 20px;
        border: 1.5px solid var(--muted);
        border-radius: 50%;
        position: relative;
        opacity: 0.75;
      }
      .avatar::before {
        content: "";
        position: absolute;
        left: 6px;
        top: 4px;
        width: 6px;
        height: 6px;
        border: 1.5px solid currentColor;
        border-radius: 50%;
      }
      .avatar::after {
        content: "";
        position: absolute;
        left: 4px;
        bottom: 3px;
        width: 10px;
        height: 5px;
        border: 1.5px solid currentColor;
        border-radius: 8px 8px 3px 3px;
      }
      .account-kicker {
        display: block;
        font-size: 12px;
        font-weight: 700;
        color: var(--muted);
      }
      .account-name {
        display: block;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 13px;
        line-height: 17px;
        font-weight: 700;
      }
      .account-email {
        display: block;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--muted);
        font-size: 12px;
        line-height: 16px;
      }
      .chevrons {
        color: var(--muted);
        font-size: 16px;
        font-weight: 700;
      }
      .quick-actions {
        display: grid;
        gap: 2px;
        padding-bottom: 2px;
      }
      .quick-action {
        display: block;
        min-height: 26px;
        padding: 3px 2px;
        border-radius: 6px;
        color: var(--muted);
        font-size: 13px;
        line-height: 19px;
        text-decoration: none;
      }
      .quick-action:hover { background: var(--hover); color: inherit; }
      .calendar-wrap {
        padding: 13px 18px 0;
      }
      .calendar-header {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 24px 24px 24px;
        align-items: center;
        gap: 4px;
        margin-bottom: 12px;
      }
      .calendar-title {
        color: var(--muted);
        font-size: 17px;
        line-height: 22px;
        font-weight: 400;
      }
      .calendar-control {
        display: grid;
        place-items: center;
        width: 24px;
        height: 24px;
        border-radius: 6px;
        color: var(--muted);
        text-decoration: none;
        font-size: 21px;
        line-height: 1;
      }
      .calendar-control:hover { background: var(--hover); }
      .calendar-dot {
        font-size: 18px;
      }
      .weekday-grid,
      .day-grid {
        display: grid;
        grid-template-columns: repeat(7, minmax(0, 1fr));
        gap: 4px;
      }
      .weekday {
        text-align: center;
        color: var(--muted);
        font-size: 12px;
        font-weight: 700;
      }
      .day {
        display: grid;
        place-items: center;
        height: 29px;
        border-radius: 7px;
        color: inherit;
        font-size: 15px;
        font-variant-numeric: tabular-nums;
        text-decoration: none;
      }
      .day.muted { color: var(--faint); }
      .day.selected {
        color: white;
        background: var(--accent);
        font-weight: 700;
      }
      .day.today:not(.selected) {
        background: rgba(116, 174, 241, 0.18);
      }
      .selected-agenda {
        border-top: 1px solid var(--separator);
        margin-top: 15px;
        padding-top: 12px;
      }
      .selected-header {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 10px;
        margin-bottom: 8px;
      }
      .selected-title {
        font-size: 13px;
        font-weight: 700;
      }
      .quick-add {
        display: block;
        margin-top: 10px;
        padding: 6px 8px;
        border: 1px solid var(--separator);
        border-radius: 7px;
        color: var(--muted);
        font-size: 13px;
        line-height: 17px;
        text-decoration: none;
      }
      .quick-add:hover { background: var(--hover); }
      @media (prefers-color-scheme: dark) {
        :root {
          color: #f2f2f2;
          --panel: rgba(36, 36, 36, 0.98);
          --panel-border: rgba(255, 255, 255, 0.16);
          --separator: rgba(255, 255, 255, 0.13);
          --muted: rgba(255, 255, 255, 0.58);
          --faint: rgba(255, 255, 255, 0.24);
          --hover: rgba(255, 255, 255, 0.08);
          --accent: #5e9de6;
        }
      }
    </style>
  </head>
  <body>
    <div class="popover">
      ${panel}
    </div>
  </body>
</html>`;
}

function adaptivePanelMarkup(snapshot: NativeMenuBarSnapshot): string {
  return `
    <main class="panel adaptive-panel">
      <header class="panel-header">
        <h1>${escapeHtml(snapshot.title)}</h1>
        <span class="sync-label">${escapeHtml(snapshot.syncLabel)}</span>
      </header>
      <div class="scroll-body">
        ${nativeSectionsMarkup(snapshot.sections)}
        ${accountMarkup(snapshot)}
        ${quickActionsMarkup()}
      </div>
    </main>`;
}

function calendarPanelMarkup(snapshot: NativeMenuBarSnapshot): string {
  const calendar = snapshot.calendar;

  if (!calendar) {
    return adaptivePanelMarkup(snapshot);
  }

  const days = calendar.days
    .map((day) => {
      const classes = [
        "day",
        day.inCurrentMonth ? "" : "muted",
        day.isToday ? "today" : "",
        day.isSelected ? "selected" : ""
      ].filter(Boolean).join(" ");

      return `<span class="${classes}">${escapeHtml(day.label)}</span>`;
    })
    .join("");
  const weekdays = calendar.weekdayLabels
    .map((label) => `<span class="weekday">${escapeHtml(label)}</span>`)
    .join("");

  return `
    <main class="panel calendar-panel">
      <div class="scroll-body calendar-wrap">
        <section>
          <div class="calendar-header">
            <div class="calendar-title">${escapeHtml(calendar.monthLabel)}</div>
            <a class="calendar-control" href="${panelRouteHref({ kind: "calendar" })}" aria-label="Previous month">&lsaquo;</a>
            <a class="calendar-control calendar-dot" href="${panelRouteHref({ kind: "calendar" })}" aria-label="Today">&bull;</a>
            <a class="calendar-control" href="${panelRouteHref({ kind: "calendar" })}" aria-label="Next month">&rsaquo;</a>
          </div>
          <div class="weekday-grid">${weekdays}</div>
          <div class="day-grid">${days}</div>
        </section>
        <section class="selected-agenda">
          <div class="selected-header">
            <div class="selected-title">${escapeHtml(calendar.selectedLabel)}</div>
            <div class="secondary">${escapeHtml(calendar.selectedMeta)}</div>
          </div>
          ${rowsMarkup(calendar.selectedItems)}
          <a class="quick-add" href="${panelActionHref("quickCapture")}">Add a task - tmr 9am #work</a>
        </section>
        ${accountMarkup(snapshot)}
        ${quickActionsMarkup()}
      </div>
    </main>`;
}

function compactPanelMarkup(snapshot: NativeMenuBarSnapshot): string {
  return `
    <main class="panel compact-panel">
      <header class="panel-header">
        <h1>${escapeHtml(snapshot.title)}</h1>
        <span class="sync-label">${escapeHtml(snapshot.syncLabel)}</span>
      </header>
      <div class="scroll-body">
        ${nativeSectionsMarkup(snapshot.sections)}
        ${accountMarkup(snapshot)}
        ${quickActionsMarkup()}
      </div>
    </main>`;
}

function nativeSectionsMarkup(sections: NativeMenuBarSnapshot["sections"]): string {
  return sections.map((section) => {
    const count = section.items.filter((item) => item.route || item.action).length;

    return `
      <section class="native-section">
        ${section.title ? `
          <div class="section-heading">
            <span>${escapeHtml(section.title)}</span>
            ${count > 0 ? `<span class="section-count">${count}</span>` : ""}
          </div>` : ""}
        ${rowsMarkup(section.items)}
      </section>`;
  }).join("");
}

function rowsMarkup(items: NativeMenuBarItem[]): string {
  return items.map((item) => {
    const href = menuBarItemHref(item);
    const disabled = href === "#";
    const kind = item.route?.kind === "event"
      ? "event"
      : item.route?.kind === "task"
        ? "task"
        : "placeholder";

    return `
      <a class="native-row ${disabled ? "disabled" : ""}" href="${escapeHtml(href)}" aria-disabled="${disabled}">
        <span class="row-icon ${kind}" aria-hidden="true"></span>
        <span class="row-text">
          <span class="row-title">${escapeHtml(item.label)}</span>
          ${item.detail ? `<span class="row-detail">${escapeHtml(item.detail)}</span>` : ""}
        </span>
      </a>`;
  }).join("");
}

function accountMarkup(snapshot: NativeMenuBarSnapshot): string {
  if (!snapshot.account) {
    return "";
  }

  return `
    <div class="divider"></div>
    <section class="account">
      <span class="avatar" aria-hidden="true"></span>
      <span class="account-copy">
        <span class="account-kicker">Google account</span>
        <span class="account-name">${escapeHtml(snapshot.account.displayName)}</span>
        ${snapshot.account.email ? `<span class="account-email">${escapeHtml(snapshot.account.email)}</span>` : ""}
      </span>
      <span class="chevrons" aria-hidden="true">v</span>
    </section>`;
}

function quickActionsMarkup(): string {
  return `
    <div class="divider"></div>
    <nav class="quick-actions" aria-label="Menu bar actions">
      <a class="quick-action" href="${panelActionHref("showWindow")}">Open Hot Cross Buns</a>
      <a class="quick-action" href="${panelActionHref("refresh")}">Refresh</a>
      <a class="quick-action" href="${panelActionHref("openSettings")}">Settings</a>
      <a class="quick-action" href="${panelActionHref("quit")}">Quit</a>
    </nav>`;
}

function menuBarItemHref(item: NativeMenuBarItem): string {
  if (item.route) {
    return panelRouteHref(item.route);
  }

  if (item.action) {
    return panelActionHref(item.action);
  }

  return "#";
}

function panelRouteHref(route: NativeRoute): string {
  const params = new URLSearchParams({ kind: route.kind });

  if (route.id) {
    params.set("id", route.id);
  }

  if (route.query) {
    params.set("query", route.query);
  }

  return `hcb-panel://route?${params.toString()}`;
}

function panelActionHref(action: NonNullable<NativeMenuBarItem["action"]>): string {
  return `hcb-panel://action?name=${encodeURIComponent(action)}`;
}

type MenuBarPanelNavigation =
  | { kind: "route"; route: NativeRoute }
  | { kind: "action"; action: NonNullable<NativeMenuBarItem["action"]> };

function parseMenuBarPanelUrl(url: string): MenuBarPanelNavigation | null {
  let parsed: URL;

  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  if (parsed.protocol !== "hcb-panel:") {
    return null;
  }

  if (parsed.hostname === "route") {
    return parseMenuBarPanelRoute(parsed.searchParams);
  }

  if (parsed.hostname === "action") {
    return parseMenuBarPanelAction(parsed.searchParams);
  }

  return null;
}

function parseMenuBarPanelRoute(params: URLSearchParams): MenuBarPanelNavigation | null {
  const kind = params.get("kind");

  if (
    kind !== "today" &&
    kind !== "tasks" &&
    kind !== "task" &&
    kind !== "calendar" &&
    kind !== "event" &&
    kind !== "notes" &&
    kind !== "note" &&
    kind !== "settings" &&
    kind !== "search"
  ) {
    return null;
  }

  const route: NativeRoute = { kind };
  const id = params.get("id")?.trim();
  const query = params.get("query")?.trim();

  if (id) {
    route.id = id;
  }

  if (query) {
    route.query = query;
  }

  return { kind: "route", route };
}

function parseMenuBarPanelAction(params: URLSearchParams): MenuBarPanelNavigation | null {
  const action = params.get("name");

  if (
    action !== "quickCapture" &&
    action !== "refresh" &&
    action !== "openSettings" &&
    action !== "showWindow" &&
    action !== "quit"
  ) {
    return null;
  }

  return { kind: "action", action };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "\"":
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return character;
    }
  });
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) {
    return min;
  }

  return Math.min(max, Math.max(min, value));
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

function macAppDisplayName(): string {
  const currentName = app.name?.trim();
  return currentName && currentName !== "Electron" ? currentName : "Hot Cross Buns";
}

function appMenuTemplate(actions: NativeTrayActions): MenuItemConstructorOptions[] {
  const appName = macAppDisplayName();

  return [
    {
      label: appName,
      submenu: [
        { label: `About ${appName}`, role: "about" },
        { type: "separator" },
        {
          label: "Settings...",
          accelerator: "Command+,",
          click: actions.openSettings
        },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { label: `Hide ${appName}`, role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        {
          label: `Quit ${appName}`,
          accelerator: "Command+Q",
          click: actions.quit
        }
      ]
    },
    {
      label: "File",
      submenu: [
        {
          label: "Quick Capture",
          accelerator: "Command+Shift+Space",
          click: actions.quickCapture
        },
        {
          label: "Open Today",
          accelerator: "Command+1",
          click: () => actions.openRoute({ kind: "today" })
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
        {
          label: "Today",
          accelerator: "Command+1",
          click: () => actions.openRoute({ kind: "today" })
        },
        {
          label: "Tasks",
          accelerator: "Command+2",
          click: () => actions.openRoute({ kind: "tasks" })
        },
        {
          label: "Calendar",
          accelerator: "Command+3",
          click: () => actions.openRoute({ kind: "calendar" })
        },
        {
          label: "Notes",
          accelerator: "Command+4",
          click: () => actions.openRoute({ kind: "notes" })
        },
        {
          label: "Search",
          accelerator: "Command+5",
          click: () => actions.openRoute({ kind: "search" })
        },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "togglefullscreen" }
      ]
    },
    {
      label: "Sync",
      submenu: [
        {
          label: "Sync Now",
          accelerator: "Command+R",
          click: actions.refresh
        },
        {
          label: "Sync Settings",
          click: actions.openSettings
        }
      ]
    },
    {
      label: "Tasks",
      submenu: [
        {
          label: "Open Tasks",
          accelerator: "Command+2",
          click: () => actions.openRoute({ kind: "tasks" })
        },
        {
          label: "Quick Capture",
          accelerator: "Command+Shift+Space",
          click: actions.quickCapture
        },
        {
          label: "Search Tasks",
          click: () => actions.openRoute({ kind: "search", query: "tasks" })
        }
      ]
    },
    {
      label: "Calendar",
      submenu: [
        {
          label: "Open Calendar",
          accelerator: "Command+3",
          click: () => actions.openRoute({ kind: "calendar" })
        },
        {
          label: "Open Today",
          accelerator: "Command+1",
          click: () => actions.openRoute({ kind: "today" })
        },
        {
          label: "Refresh Calendar",
          click: actions.refresh
        }
      ]
    },
    {
      label: "Window",
      submenu: [
        {
          label: `Show ${appName}`,
          click: actions.openMainWindow
        },
        {
          label: "Hide Window",
          click: actions.showOrHideMainWindow
        },
        { type: "separator" },
        { role: "minimize" },
        { role: "zoom" },
        { type: "separator" },
        { role: "front" }
      ]
    },
    {
      role: "help",
      submenu: [
        {
          label: "Search",
          accelerator: "Command+5",
          click: () => actions.openRoute({ kind: "search" })
        },
        {
          label: "Settings",
          click: actions.openSettings
        }
      ]
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
