import { app, BrowserWindow, session } from "electron";
import { join } from "node:path";
import { registerDiagnosticsIpc } from "./ipc/diagnostics";
import { registerCoreIpc } from "./ipc/core";
import { configureNavigationLockdown, configureSessionHardening } from "./security";
import { createServiceContainer } from "./services/serviceContainer";
import { markStartupTiming } from "./startupTiming";
import { createNativeAdapter, NativeShellService } from "./native";
import { isLiveGoogleReadOnlyTest, isLiveGoogleTest } from "./liveGoogleTestMode";

let mainWindow: BrowserWindow | null = null;
const pendingDeepLinks: string[] = [];
let routeDeepLink: ((url: string) => void) | null = null;

markStartupTiming("processStartedMs");

app.on("open-url", (event, url) => {
  event.preventDefault();
  if (routeDeepLink) routeDeepLink(url);
  else pendingDeepLinks.push(url);
});

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 960,
    minHeight: 620,
    show: false,
    title: "Hot Cross Buns",
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
  configureNavigationLockdown(window);

  window.once("ready-to-show", () => {
    window.show();
  });

  window.webContents.once("did-finish-load", () => {
    markStartupTiming("rendererLoadedMs");
  });

  const rendererUrl = process.env.ELECTRON_RENDERER_URL;

  if (rendererUrl) {
    void window.loadURL(rendererUrl);
  } else {
    void window.loadFile(join(__dirname, "../renderer/index.html"));
  }

  return window;
}

app.whenReady().then(async () => {
  markStartupTiming("appReadyMs");
  const liveGoogleTest = isLiveGoogleTest();
  configureSessionHardening(session.defaultSession);
  registerDiagnosticsIpc();
  const services = await createServiceContainer(app.getPath("userData"));
  registerCoreIpc(services.core, services.googleOAuth, services.googleSync);
  if (!liveGoogleTest) {
    services.googleSync.startBackgroundSync();
    void services.googleSync.runNow({ reason: "startup" }).catch(() => undefined);
  }
  mainWindow = createMainWindow();
  const nativeShell = new NativeShellService({
    adapter: await createNativeAdapter(),
    planner: {
      listTasks: (request) => services.core.dispatch("tasks", "list", request),
      listCalendarEvents: (request) => services.core.dispatch("calendar", "listEvents", request),
      search: (request) => services.core.dispatch("search", "query", request)
    },
    account: {
      latest: () => {
        const account = services.core.googleAccounts().find((candidate) => candidate.accountId !== "local") ?? null;
        return account ? { email: account.email, displayName: account.displayName, avatarUrl: account.avatarUrl, connectionState: account.connectionState } : null;
      }
    },
    settings: { get: () => services.core.dispatch("settings", "get", {}) },
    windows: {
      showMainWindow: () => mainWindow?.show(),
      hideMainWindow: () => mainWindow?.hide(),
      showOrHideMainWindow: () => mainWindow?.isVisible() ? mainWindow.hide() : mainWindow?.show(),
      quit: () => app.quit(),
      dispatchAction: (action) => mainWindow?.webContents.send("hcb:native-action", action)
    },
    sync: {
      runNow: (request) => services.googleSync.runNow(
        isLiveGoogleReadOnlyTest() ? { ...request, readOnly: true } : request
      )
    },
    recordUpdateCheck: (checkedAt) => services.core.dispatch("settings", "update", { lastUpdateCheckAt: checkedAt })
  });
  nativeShell.installAppMenu();
  if (!liveGoogleTest) {
    nativeShell.startDeferredStartup();
  }
  routeDeepLink = (url) => { nativeShell.handleDeepLink(url); };
  for (const url of pendingDeepLinks.splice(0)) routeDeepLink(url);
  services.core.attachNativeBridge({
    capabilities: () => nativeShell.capabilities(),
    listFontFamilies: () => nativeShell.listFontFamilies(),
    requestNotificationPermission: () => nativeShell.requestNotificationPermission(),
    openExternalUrl: async ({ url }) => ({ opened: true, ...(await nativeShell.openExternalUrl({ url })) }),
    applySettings: (settings) => nativeShell.applySettings(settings as never)
  });

  app.on("activate", () => {
    if (!liveGoogleTest) {
      void services.googleSync.runNow({ reason: "application-activated" }).catch(() => undefined);
    }
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  mainWindow = null;

  if (process.platform !== "darwin") {
    app.quit();
  }
});
