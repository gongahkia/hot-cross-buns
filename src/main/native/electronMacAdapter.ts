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
const menuBarPanelWidth = 320;
const menuBarPanelHeight = 442;
const menuBarPanelGap = 8;
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
          void this.toggleMenuBarPanel(actions, snapshot);
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
    this.destroyMenuBarPanel();
    this.tray?.destroy();
    this.tray = undefined;
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
      panel.setBounds(menuBarPanelBounds(this.tray.getBounds()));
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
      width: menuBarPanelWidth,
      height: menuBarPanelHeight,
      show: false,
      frame: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      movable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      title: "Hot Cross Buns 2 menu bar panel",
      backgroundColor: "#f7f3ec",
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

function menuBarPanelBounds(trayBounds: Rectangle): Rectangle {
  const display = screen.getDisplayMatching(trayBounds);
  const workArea = display.workArea;
  const x = clamp(
    Math.round(trayBounds.x + trayBounds.width / 2 - menuBarPanelWidth / 2),
    workArea.x + menuBarPanelGap,
    workArea.x + workArea.width - menuBarPanelWidth - menuBarPanelGap
  );
  const menuBarIsAboveWorkArea = trayBounds.y < workArea.y + workArea.height / 2;
  const y = menuBarIsAboveWorkArea
    ? Math.min(
        trayBounds.y + trayBounds.height + menuBarPanelGap,
        workArea.y + workArea.height - menuBarPanelHeight - menuBarPanelGap
      )
    : Math.max(
        workArea.y + menuBarPanelGap,
        trayBounds.y - menuBarPanelHeight - menuBarPanelGap
      );

  return {
    x,
    y: Math.round(y),
    width: menuBarPanelWidth,
    height: menuBarPanelHeight
  };
}

function menuBarPanelDataUrl(snapshot: NativeMenuBarSnapshot): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(menuBarPanelHtml(snapshot))}`;
}

function menuBarPanelHtml(snapshot: NativeMenuBarSnapshot): string {
  const sections = snapshot.sections
    .map((section) => {
      const items = section.items
        .map((item) => {
          const href = menuBarItemHref(item);
          const disabled = href === "#";

          return `
            <a class="item ${disabled ? "disabled" : ""}" href="${escapeHtml(href)}" aria-disabled="${disabled}">
              <span class="item-main">${escapeHtml(item.label)}</span>
              ${item.detail ? `<span class="item-detail">${escapeHtml(item.detail)}</span>` : ""}
            </a>`;
        })
        .join("");

      return `
        <section class="section">
          ${section.title ? `<h2>${escapeHtml(section.title)}</h2>` : ""}
          <div class="items">${items}</div>
        </section>`;
    })
    .join("");

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
        color: #292522;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        overflow: hidden;
        background: transparent;
        -webkit-font-smoothing: antialiased;
      }
      .panel {
        width: 320px;
        height: 442px;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        border: 1px solid rgba(64, 57, 48, 0.18);
        border-radius: 14px;
        background: rgba(250, 247, 241, 0.98);
        box-shadow: 0 20px 56px rgba(35, 31, 27, 0.24);
      }
      header {
        padding: 12px 14px 10px;
        border-bottom: 1px solid rgba(64, 57, 48, 0.12);
      }
      .eyebrow {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        color: #7b7167;
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0;
        text-transform: uppercase;
      }
      .style {
        max-width: 88px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        border: 1px solid rgba(64, 57, 48, 0.14);
        border-radius: 999px;
        padding: 2px 7px;
        color: #6c6258;
        text-transform: none;
      }
      h1 {
        margin: 8px 0 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 17px;
        line-height: 22px;
      }
      .subtitle {
        margin-top: 2px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: #756b61;
        font-size: 12px;
      }
      main {
        min-height: 0;
        flex: 1;
        overflow-y: auto;
        padding: 8px;
      }
      .section + .section { margin-top: 6px; }
      h2 {
        margin: 7px 8px 5px;
        color: #7b7167;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0;
        text-transform: uppercase;
      }
      .items {
        overflow: hidden;
        border: 1px solid rgba(64, 57, 48, 0.1);
        border-radius: 10px;
        background: rgba(255, 252, 247, 0.78);
      }
      .item {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 10px;
        min-height: 38px;
        align-items: center;
        padding: 8px 10px;
        border-bottom: 1px solid rgba(64, 57, 48, 0.08);
        color: inherit;
        text-decoration: none;
      }
      .item:last-child { border-bottom: 0; }
      .item:hover { background: rgba(238, 231, 220, 0.78); }
      .item-main,
      .item-detail {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .item-main {
        font-size: 13px;
        font-weight: 600;
      }
      .item-detail {
        color: #766b61;
        font-size: 12px;
      }
      .disabled {
        pointer-events: none;
        color: #9a9188;
      }
      footer {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 6px;
        padding: 9px;
        border-top: 1px solid rgba(64, 57, 48, 0.12);
      }
      .action {
        min-width: 0;
        height: 32px;
        display: grid;
        place-items: center;
        border: 1px solid rgba(64, 57, 48, 0.12);
        border-radius: 9px;
        background: rgba(255, 252, 247, 0.82);
        color: #342f2a;
        font-size: 12px;
        font-weight: 700;
        text-decoration: none;
      }
      .action:hover { background: rgba(238, 231, 220, 0.9); }
      @media (prefers-color-scheme: dark) {
        :root { color: #eee8df; }
        .panel {
          border-color: rgba(255, 255, 255, 0.12);
          background: rgba(35, 32, 29, 0.98);
          box-shadow: 0 20px 56px rgba(0, 0, 0, 0.42);
        }
        header, footer { border-color: rgba(255, 255, 255, 0.1); }
        .eyebrow, .subtitle, h2, .item-detail { color: #afa69b; }
        .style, .items, .action { border-color: rgba(255, 255, 255, 0.1); }
        .items, .action { background: rgba(47, 43, 39, 0.78); }
        .item { border-color: rgba(255, 255, 255, 0.08); }
        .item:hover, .action:hover { background: rgba(64, 59, 53, 0.9); }
        .action { color: #f2ece3; }
      }
    </style>
  </head>
  <body>
    <div class="panel">
      <header>
        <div class="eyebrow">
          <span>Hot Cross Buns 2</span>
          <span class="style">${escapeHtml(snapshot.panelStyle)}</span>
        </div>
        <h1>${escapeHtml(snapshot.title)}</h1>
        ${snapshot.subtitle ? `<div class="subtitle">${escapeHtml(snapshot.subtitle)}</div>` : ""}
      </header>
      <main>${sections}</main>
      <footer>
        <a class="action" href="${panelActionHref("quickCapture")}">Capture</a>
        <a class="action" href="${panelActionHref("refresh")}">Refresh</a>
        <a class="action" href="${panelActionHref("showWindow")}">Open</a>
        <a class="action" href="${panelActionHref("openSettings")}">Settings</a>
      </footer>
    </div>
  </body>
</html>`;
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
    action !== "showWindow"
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
