import { shell, type BrowserWindow, type Session } from "electron";

export interface ExternalUrlOpener {
  openExternalUrl: (url: string) => unknown | Promise<unknown>;
}

export const PRODUCTION_CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'none'"
].join("; ");

export const DEVELOPMENT_CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'none'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self' http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:*"
].join("; ");

const APPROVED_EXTERNAL_HTTPS_HOSTS = new Set([
  "accounts.google.com",
  "developers.google.com",
  "support.google.com",
  "www.googleapis.com"
]);

function parseUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function normalizeWithoutHash(url: URL): string {
  const normalized = new URL(url.toString());
  normalized.hash = "";
  return normalized.toString();
}

function localhostHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

export function contentSecurityPolicy(isPackaged: boolean): string {
  return isPackaged ? PRODUCTION_CONTENT_SECURITY_POLICY : DEVELOPMENT_CONTENT_SECURITY_POLICY;
}

export function isAllowedAppNavigation(
  navigationUrl: string,
  currentUrl: string,
  allowedDevOrigin?: string
): boolean {
  const next = parseUrl(navigationUrl);
  const current = parseUrl(currentUrl);

  if (!next || !current) {
    return false;
  }

  if (next.protocol === "file:" || current.protocol === "file:") {
    return next.protocol === "file:" && normalizeWithoutHash(next) === normalizeWithoutHash(current);
  }

  if (allowedDevOrigin) {
    const allowed = parseUrl(allowedDevOrigin);

    if (
      allowed &&
      (allowed.protocol === "http:" || allowed.protocol === "https:") &&
      localhostHostname(allowed.hostname)
    ) {
      return next.origin === allowed.origin;
    }
  }

  return false;
}

export function isApprovedExternalUrl(url: string): boolean {
  const parsed = parseUrl(url);

  if (!parsed) {
    return false;
  }

  if (parsed.protocol === "mailto:") {
    return true;
  }

  return parsed.protocol === "https:" && APPROVED_EXTERNAL_HTTPS_HOSTS.has(parsed.hostname.toLowerCase());
}

export function configureSessionHardening(
  session: Session,
  options: { isPackaged?: boolean } = {}
): void {
  session.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });

  session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [contentSecurityPolicy(options.isPackaged ?? false)]
      }
    });
  });
}

export function configureNavigationLockdown(
  window: BrowserWindow,
  options: { allowedDevOrigin?: string; externalOpener?: ExternalUrlOpener } = {}
): void {
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isApprovedExternalUrl(url)) {
      void (options.externalOpener?.openExternalUrl(url) ?? shell.openExternal(url));
    }

    return { action: "deny" };
  });

  window.webContents.on("will-navigate", (event, navigationUrl) => {
    const currentUrl = window.webContents.getURL();

    if (currentUrl && isAllowedAppNavigation(navigationUrl, currentUrl, options.allowedDevOrigin)) {
      return;
    }

    event.preventDefault();
  });
}
