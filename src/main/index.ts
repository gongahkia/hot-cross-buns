import { app, BrowserWindow, session } from "electron";
import { join } from "node:path";
import { IPC_CHANNELS, type NativeAction } from "@shared/ipc/contracts";
import { registerHcbIpc } from "./ipc";
import { brandAssetPath } from "./native/brandAssets";
import { createElectronMacNativeAdapter } from "./native/electronMacAdapter";
import { configureNavigationLockdown, configureSessionHardening } from "./security";
import { createServiceContainer, type ServiceContainer } from "./services/serviceContainer";
import { markStartupTiming } from "./startupTiming";

let mainWindow: BrowserWindow | null = null;
let services: ServiceContainer | null = null;
const nativeAdapter = createElectronMacNativeAdapter();
const pendingDeepLinks: string[] = [];
const pendingNativeActions: NativeAction[] = [];

if (process.env.HCB_USER_DATA_DIR && !app.isPackaged) {
  app.setPath("userData", process.env.HCB_USER_DATA_DIR);
}

markStartupTiming("processStartedMs");

app.on("open-url", (event, url) => {
  event.preventDefault();

  if (!services) {
    pendingDeepLinks.push(url);
    return;
  }

  services.nativeShell.handleDeepLink(url);
});

function flushPendingNativeActions(): void {
  const target = mainWindow;

  if (!target || target.webContents.isLoading()) {
    return;
  }

  for (const action of pendingNativeActions.splice(0)) {
    target.webContents.send(IPC_CHANNELS.nativeAction, action);
  }
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

  mainWindow.show();
  mainWindow.focus();
}

function hideMainWindow(): void {
  mainWindow?.hide();
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
      webviewTag: false
    }
  });

  markStartupTiming("windowCreatedMs");
  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  configureNavigationLockdown(window, {
    allowedDevOrigin: rendererUrl,
    externalOpener: nativeAdapter
  });

  window.once("ready-to-show", () => {
    window.show();
  });

  window.webContents.once("did-finish-load", () => {
    markStartupTiming("rendererLoadedMs");
    flushPendingNativeActions();
    setTimeout(() => {
      services?.nativeShell.startDeferredStartup();
      services?.startDeferredRuntime();
    }, 2_500);
  });

  if (rendererUrl) {
    void window.loadURL(rendererUrl);
  } else {
    void window.loadFile(join(__dirname, "../renderer/index.html"));
  }

  return window;
}

app.whenReady().then(() => {
  markStartupTiming("appReadyMs");
  configureSessionHardening(session.defaultSession, { isPackaged: app.isPackaged });
  services = createServiceContainer({
    appPaths: nativeAdapter.appPaths(),
    nativeAdapter,
    nativeWindows: {
      showMainWindow,
      hideMainWindow,
      showOrHideMainWindow,
      quit: () => app.quit(),
      dispatchAction: dispatchNativeAction
    }
  });
  services.nativeShell.installAppMenu();
  registerHcbIpc(services);
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
});

app.on("window-all-closed", () => {
  mainWindow = null;

  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  services?.close();
  services = null;
});
