import { app, BrowserWindow, session } from "electron";
import { join } from "node:path";
import { registerDiagnosticsIpc } from "./ipc/diagnostics";
import { registerCoreIpc } from "./ipc/core";
import { configureNavigationLockdown, configureSessionHardening } from "./security";
import { WorkspaceClient } from "./services/workspaceClient";
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
      webviewTag: false
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
  const services = new WorkspaceClient(app.getPath("userData"));
  let backgroundStarted = false;
  registerCoreIpc(services, () => {
    if (backgroundStarted || liveGoogleTest) return;
    backgroundStarted = true;
    void services.googleSync.startBackgroundSync().catch(() => undefined);
    void services.googleSync.runAutomatic("startup").catch(() => undefined);
    void services.backups.start().catch(() => undefined);
  });
  mainWindow = createMainWindow();
  await services.ready;
  const nativeShell = new NativeShellService({
    adapter: await createNativeAdapter(),
    planner: {
      listTasks: ({ limit, scope }) => ({ items: (scope === "notifications" ? services.snapshot.notificationTasks : services.snapshot.tasks).slice(0, limit) }),
      planningCounts: () => services.snapshot.planningCounts,
      listCalendarEvents: ({ start, end, limit, scope }) => ({ items: services.snapshot.events.filter((event) => event.startsAt < end && (scope === "notifications" ? event.startsAt >= start : event.endsAt > start)).slice(0, limit) }),
      search: ({ query }) => ({ items: [], page: { totalKnown: services.snapshot.searchCounts[query] ?? 0 } })
    },
    account: {
      latest: () => {
        const account = services.snapshot.account;
        return account ? { email: account.email, displayName: account.displayName, avatarUrl: account.avatarUrl, connectionState: account.connectionState } : null;
      }
    },
    settings: { get: () => services.snapshot.settings },
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
    recordUpdateCheck: (checkedAt) => { void services.core.dispatch("settings", "update", { lastUpdateCheckAt: checkedAt }).catch(() => undefined); }
  });
  nativeShell.installAppMenu();
  if (!liveGoogleTest) {
    nativeShell.startDeferredStartup();
  }
  routeDeepLink = (url) => { nativeShell.handleDeepLink(url); };
  for (const url of pendingDeepLinks.splice(0)) routeDeepLink(url);
  services.attachNativeBridge({
    capabilities: () => nativeShell.capabilities(),
    listFontFamilies: () => nativeShell.listFontFamilies(),
    requestNotificationPermission: () => nativeShell.requestNotificationPermission(),
    openExternalUrl: async ({ url }) => ({ opened: true, ...(await nativeShell.openExternalUrl({ url })) }),
    checkForUpdates: () => nativeShell.checkForUpdates(),
    rescheduleNotifications: () => nativeShell.rescheduleNotificationsForDiagnostics(),
    refreshData: () => nativeShell.refreshCachedData(),
    applySettings: (settings) => nativeShell.applySettings(settings as never)
  });

  let quitting = false;
  app.on("before-quit", (event) => {
    if (quitting) return;
    event.preventDefault();
    quitting = true;
    nativeShell.dispose();
    void services.close().finally(() => app.quit());
  });

  app.on("activate", () => {
    if (!liveGoogleTest) {
      void services.googleSync.runAutomatic("application-activated").catch(() => undefined);
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
