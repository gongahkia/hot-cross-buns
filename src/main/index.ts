import { app, BrowserWindow, session } from "electron";
import { join } from "node:path";
import { registerDiagnosticsIpc } from "./ipc/diagnostics";
import { configureNavigationLockdown, configureSessionHardening } from "./security";
import { createServiceContainer } from "./services/serviceContainer";
import { markStartupTiming } from "./startupTiming";

let mainWindow: BrowserWindow | null = null;

markStartupTiming("processStartedMs");

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 960,
    minHeight: 620,
    show: false,
    title: "Hot Cross Buns 2",
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

app.whenReady().then(() => {
  markStartupTiming("appReadyMs");
  configureSessionHardening(session.defaultSession);
  registerDiagnosticsIpc();
  void createServiceContainer();
  mainWindow = createMainWindow();

  app.on("activate", () => {
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
