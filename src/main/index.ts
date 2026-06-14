import { app, BrowserWindow, nativeTheme, safeStorage, session } from "electron";
import { join } from "node:path";
import { IPC_CHANNELS, type NativeAction } from "@shared/ipc/contracts";
import { appLogger } from "./diagnostics/appLogger";
import { registerHcbIpc } from "./ipc";
import { brandAssetPath } from "./native/brandAssets";
import { createNativeAdapter } from "./native/createNativeAdapter";
import { extractHotCrossBunsDeepLinksFromArgv } from "./native/deepLinkLaunchArgs";
import { applyWindowsAppIdentity } from "./native/electronWindows/identity";
import type { NativePlatformAdapter } from "./native/types";
import { applyPackagedMcpSmokeSettings } from "./packagedMcpSmoke";
import {
  configureEmbeddedWebContentsLockdown,
  configureEmbeddedWebviewLockdown,
  configureNavigationLockdown,
  configureSessionHardening
} from "./security";
import { createServiceContainer, type ServiceContainer } from "./services/serviceContainer";
import {
  parseSafeStorageTokenHelperArgv,
  readMcpTokenFromSafeStorageFile,
  type SafeStorageTokenHelperRequest
} from "./mcp/safeStorageTokenHelper";
import {
  fallbackSyncStatusTheme,
  resolveSyncStatusTheme,
  syncStatusHtml,
  type SyncStatusTheme
} from "./syncStatusOverlay";
import { markStartupTiming } from "./startupTiming";
import { resolveUserDataDirectoryOverride } from "./userDataOverride";

let mainWindow: BrowserWindow | null = null;
let services: ServiceContainer | null = null;
let nativeAdapter: NativePlatformAdapter | null = null;
const pendingDeepLinks: string[] = [];
const pendingNativeActions: NativeAction[] = [];
const rendererReadyFallbackMs = 8_000;
let revealFallbackTimer: ReturnType<typeof setTimeout> | null = null;
let deferredRuntimeStarted = false;
let quittingAfterSync = false;
let startupSyncInProgress = false;
let startupSyncStarted = false;
let syncStatusWindow: BrowserWindow | null = null;
const macAppDisplayName = "Hot Cross Buns 2";

const userDataDirectoryOverride = resolveUserDataDirectoryOverride(process.env, app.isPackaged);

if (userDataDirectoryOverride) {
  app.setPath("userData", userDataDirectoryOverride);
}

if (process.platform === "linux") {
  app.commandLine.appendSwitch("enable-features", "GlobalShortcutsPortal");
}

applyWindowsAppIdentity();
app.setName(macAppDisplayName);
app.setAboutPanelOptions({ applicationName: macAppDisplayName });

const safeStorageTokenHelperRequest = parseSafeStorageTokenHelperArgv(process.argv);

if (safeStorageTokenHelperRequest) {
  runSafeStorageTokenHelper(safeStorageTokenHelperRequest);
} else {
  markStartupTiming("processStartedMs");
  appLogger.info("app launch", "misc", {
    version: app.getVersion(),
    launchMode: app.isPackaged ? "packaged" : "development"
  });
}

const hasSingleInstanceLock = safeStorageTokenHelperRequest ? false : app.requestSingleInstanceLock();

if (!safeStorageTokenHelperRequest && !hasSingleInstanceLock) {
  app.quit();
} else if (!safeStorageTokenHelperRequest) {
  for (const url of extractHotCrossBunsDeepLinksFromArgv(process.argv)) {
    queueOrHandleDeepLink(url);
  }

  app.on("second-instance", (_event, argv) => {
    for (const url of extractHotCrossBunsDeepLinksFromArgv(argv)) {
      queueOrHandleDeepLink(url);
    }

    if (nativeAdapter) {
      showMainWindow();
    }
  });
}

app.on("open-url", (event, url) => {
  event.preventDefault();
  queueOrHandleDeepLink(url);
});

function runSafeStorageTokenHelper(request: SafeStorageTokenHelperRequest): void {
  void app.whenReady()
    .then(async () => {
      const token = await readMcpTokenFromSafeStorageFile(request, safeStorage);
      process.stdout.write(token);
      app.exit(0);
    })
    .catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      app.exit(1);
    });
}

function queueOrHandleDeepLink(url: string): void {
  if (!services) {
    pendingDeepLinks.push(url);
    return;
  }

  services.nativeShell.handleDeepLink(url);
}

function requireNativeAdapter(): NativePlatformAdapter {
  if (!nativeAdapter) {
    throw new Error("Native adapter was requested before startup initialization.");
  }

  return nativeAdapter;
}

function flushPendingNativeActions(): void {
  const target = mainWindow;

  if (!target || target.webContents.isLoading()) {
    return;
  }

  for (const action of pendingNativeActions.splice(0)) {
    target.webContents.send(IPC_CHANNELS.nativeAction, action);
  }
}

function clearRevealFallbackTimer(): void {
  if (!revealFallbackTimer) {
    return;
  }

  clearTimeout(revealFallbackTimer);
  revealFallbackTimer = null;
}

function startDeferredRuntimeOnce(): void {
  if (deferredRuntimeStarted) {
    return;
  }

  deferredRuntimeStarted = true;
  services?.startDeferredRuntime();
}

function revealMainWindow(window: BrowserWindow | null = mainWindow, focus = false): void {
  if (!window || window.isDestroyed()) {
    return;
  }

  clearRevealFallbackTimer();

  if (!window.isVisible()) {
    window.show();
  }

  if (focus) {
    window.focus();
  }
}

function handleRendererShellVisible(): void {
  revealMainWindow(mainWindow);
  runStartupSyncInBackground(mainWindow);
}

function dispatchNativeAction(action: NativeAction): void {
  const target = mainWindow;

  if (!target || target.webContents.isLoading()) {
    pendingNativeActions.push(action);
    return;
  }

  target.webContents.send(IPC_CHANNELS.nativeAction, action);
}

function showMainWindow(): void {
  if (!mainWindow) {
    mainWindow = createMainWindow();
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  revealMainWindow(mainWindow, true);
}

function showSyncStatusWindow(pendingMutationCount: number, parent: BrowserWindow | null = mainWindow): BrowserWindow {
  const theme = currentSyncStatusTheme();

  if (syncStatusWindow && !syncStatusWindow.isDestroyed()) {
    syncStatusWindow.show();
    return syncStatusWindow;
  }

  syncStatusWindow = new BrowserWindow({
    alwaysOnTop: true,
    backgroundColor: theme.background,
    height: 132,
    maximizable: false,
    minimizable: false,
    modal: Boolean(parent),
    parent: parent ?? undefined,
    resizable: false,
    show: false,
    title: "Hot Cross Buns 2",
    width: 420
  });
  syncStatusWindow.removeMenu();
  syncStatusWindow.on("closed", () => {
    syncStatusWindow = null;
  });
  void syncStatusWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(syncStatusHtml(pendingMutationCount, theme))}`);
  syncStatusWindow.once("ready-to-show", () => {
    syncStatusWindow?.show();
  });
  return syncStatusWindow;
}

function currentSyncStatusTheme(): SyncStatusTheme {
  const activeServices = services;

  if (!activeServices) {
    return fallbackSyncStatusTheme;
  }

  try {
    const settings = activeServices.localData.settingsSupportRepository.applyExternalSettings(
      activeServices.localData.settingsRepository.get()
    );

    return resolveSyncStatusTheme(settings, nativeTheme.shouldUseDarkColors);
  } catch {
    return fallbackSyncStatusTheme;
  }
}

async function runFullSyncWithStatusWindow(reason: "quit" | "startup", parent: BrowserWindow | null = mainWindow): Promise<void> {
  const activeServices = services;

  if (!activeServices) {
    return;
  }

  let pendingMutationCount = 0;

  try {
    pendingMutationCount = (await activeServices.domain.sync.status()).pendingMutationCount;
  } catch {
    pendingMutationCount = 0;
  }

  const statusWindow = showSyncStatusWindow(pendingMutationCount, parent);

  try {
    await activeServices.domain.sync.runNow({ resources: ["tasks", "calendar"] });
  } catch (error) {
    appLogger.warn(`${reason} sync failed`, "sync", {
      message: error instanceof Error ? error.message : String(error)
    });
  } finally {
    if (!statusWindow.isDestroyed()) {
      statusWindow.close();
    }
  }
}

function runStartupSyncInBackground(parent: BrowserWindow | null = mainWindow): void {
  if (startupSyncStarted || !services) {
    return;
  }

  startupSyncStarted = true;
  startupSyncInProgress = true;
  void runFullSyncWithStatusWindow("startup", parent).finally(() => {
    startupSyncInProgress = false;
    startDeferredRuntimeOnce();
  });
}

function hideMainWindow(): void {
  mainWindow?.hide();
}

function destroyMainWindowForQuit(): void {
  const window = mainWindow;

  mainWindow = null;
  clearRevealFallbackTimer();

  if (window && !window.isDestroyed()) {
    window.destroy();
  }
}

function showOrHideMainWindow(): void {
  if (!mainWindow || !mainWindow.isVisible()) {
    showMainWindow();
    return;
  }

  hideMainWindow();
}

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 960,
    minHeight: 620,
    show: false,
    title: "Hot Cross Buns 2",
    icon: brandAssetPath("app-icon.png"),
    backgroundColor: "#1e1e2e",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: true
    }
  });

  markStartupTiming("windowCreatedMs");
  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  configureNavigationLockdown(window, {
    allowedDevOrigin: rendererUrl,
    externalOpener: requireNativeAdapter()
  });
  configureEmbeddedWebviewLockdown(window);

  window.webContents.once("did-finish-load", () => {
    markStartupTiming("rendererLoadedMs");
    flushPendingNativeActions();
  });

  window.webContents.once("did-fail-load", () => {
    revealMainWindow(window);
    services?.nativeShell.startDeferredStartup();
    startDeferredRuntimeOnce();
  });

  window.once("closed", () => {
    if (mainWindow === window) {
      clearRevealFallbackTimer();
    }
  });

  clearRevealFallbackTimer();
  revealFallbackTimer = setTimeout(() => {
    if (mainWindow !== window) {
      return;
    }

    revealMainWindow(window);
    services?.nativeShell.startDeferredStartup();
  }, rendererReadyFallbackMs);

  if (rendererUrl) {
    void window.loadURL(rendererUrl);
  } else {
    void window.loadFile(join(__dirname, "../renderer/index.html"));
  }

  return window;
}

if (!safeStorageTokenHelperRequest && hasSingleInstanceLock) {
  app.whenReady().then(async () => {
    markStartupTiming("appReadyMs");
    const adapter = await createNativeAdapter();
    nativeAdapter = adapter;
    appLogger.configure({ logsDirectory: adapter.appPaths().logsDirectory });
    appLogger.info("app ready", "misc");
    configureSessionHardening(session.defaultSession, { isPackaged: app.isPackaged });
    configureEmbeddedWebContentsLockdown(app);
    services = createServiceContainer({
      appPaths: adapter.appPaths(),
      nativeAdapter: adapter,
      nativeWindows: {
        showMainWindow,
        hideMainWindow,
        showOrHideMainWindow,
        quit: () => app.quit(),
        dispatchAction: dispatchNativeAction
      }
    });
    await applyPackagedMcpSmokeSettings(services, process.env, app.isPackaged);
    services.nativeShell.installAppMenu();
    registerHcbIpc(services, {
      onShellVisible: handleRendererShellVisible
    });
    mainWindow = createMainWindow();

    for (const url of pendingDeepLinks.splice(0)) {
      services.nativeShell.handleDeepLink(url);
    }

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createMainWindow();
      } else {
        showMainWindow();
      }
    });
  }).catch((error) => {
    appLogger.error("startup failed", "misc", {
      message: error instanceof Error ? error.message : String(error)
    });
    quittingAfterSync = true;
    void services?.close();
    services = null;
    app.quit();
  });
}

app.on("window-all-closed", () => {
  mainWindow = null;

  if (startupSyncInProgress) {
    return;
  }

  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", (event) => {
  if (!quittingAfterSync && services) {
    event.preventDefault();
    destroyMainWindowForQuit();
    void runFullSyncWithStatusWindow("quit", null).finally(() => {
      quittingAfterSync = true;
      app.quit();
    });
    return;
  }

  void services?.close();
  services = null;
});
