import { shell, type BrowserWindow, type Session } from "electron";

function parseUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function isSameOriginNavigation(navigationUrl: string, currentUrl: string): boolean {
  const next = parseUrl(navigationUrl);
  const current = parseUrl(currentUrl);

  if (!next || !current) {
    return false;
  }

  return next.origin === current.origin;
}

function isApprovedExternalUrl(url: string): boolean {
  const parsed = parseUrl(url);

  if (!parsed) {
    return false;
  }

  return parsed.protocol === "https:" || parsed.protocol === "mailto:";
}

export function configureSessionHardening(session: Session): void {
  session.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
}

export function configureNavigationLockdown(window: BrowserWindow): void {
  window.webContents.on("will-attach-webview", (event, webPreferences, params) => {
    const embeddedUrl = parseUrl(params.src ?? "");

    if (
      !embeddedUrl ||
      !["http:", "https:"].includes(embeddedUrl.protocol) ||
      !params.partition?.startsWith("persist:hcb-split-pane-")
    ) {
      event.preventDefault();
      return;
    }

    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
    webPreferences.webSecurity = true;
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isApprovedExternalUrl(url)) {
      void shell.openExternal(url);
    }

    return { action: "deny" };
  });

  window.webContents.on("will-navigate", (event, navigationUrl) => {
    const currentUrl = window.webContents.getURL();

    if (currentUrl && isSameOriginNavigation(navigationUrl, currentUrl)) {
      return;
    }

    event.preventDefault();
  });
}
