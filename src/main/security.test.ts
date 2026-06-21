import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  shell: {
    openExternal: vi.fn()
  }
}));

import { shell } from "electron";
import {
  PRODUCTION_CONTENT_SECURITY_POLICY,
  configureNavigationLockdown,
  configureEmbeddedWebContentsLockdown,
  configureEmbeddedWebviewLockdown,
  configureSessionHardening,
  contentSecurityPolicy,
  isAllowedEmbeddedWebUrl,
  isAllowedAppNavigation,
  isApprovedExternalUrl
} from "./security";

describe("Electron security policy", () => {
  it("defines a production CSP without remote script or connect access", () => {
    expect(contentSecurityPolicy(true)).toBe(PRODUCTION_CONTENT_SECURITY_POLICY);
    expect(PRODUCTION_CONTENT_SECURITY_POLICY).toContain("default-src 'none'");
    expect(PRODUCTION_CONTENT_SECURITY_POLICY).toContain("script-src 'self'");
    expect(PRODUCTION_CONTENT_SECURITY_POLICY).toContain("img-src 'self' data: https: http:");
    expect(PRODUCTION_CONTENT_SECURITY_POLICY).toContain("connect-src 'none'");
    expect(PRODUCTION_CONTENT_SECURITY_POLICY).toContain("object-src 'none'");
    expect(PRODUCTION_CONTENT_SECURITY_POLICY).toContain("frame-src 'none'");
    expect(PRODUCTION_CONTENT_SECURITY_POLICY).not.toContain("script-src 'unsafe-inline'");
    expect(PRODUCTION_CONTENT_SECURITY_POLICY).not.toContain("http://127.0.0.1");
  });

  it("allows Vite React Refresh only in the development CSP", () => {
    const developmentPolicy = contentSecurityPolicy(false);

    expect(developmentPolicy).toContain("script-src 'self' 'unsafe-inline'");
    expect(developmentPolicy).toContain("http://localhost:*");
    expect(developmentPolicy).toContain("ws://localhost:*");
    expect(PRODUCTION_CONTENT_SECURITY_POLICY).not.toContain("script-src 'self' 'unsafe-inline'");
    expect(PRODUCTION_CONTENT_SECURITY_POLICY).not.toContain("ws://localhost");
  });

  it("injects CSP headers and denies renderer permission prompts", () => {
    let permissionHandler:
      | ((_contents: unknown, _permission: string, callback: (allowed: boolean) => void) => void)
      | undefined;
    let headersCallback:
      | ((
          details: { responseHeaders?: Record<string, string[]> },
          callback: (response: { responseHeaders: Record<string, string[]> }) => void
        ) => void)
      | undefined;
    const session = {
      setPermissionRequestHandler: vi.fn((handler) => {
        permissionHandler = handler;
      }),
      webRequest: {
        onHeadersReceived: vi.fn((callback) => {
          headersCallback = callback;
        })
      }
    };

    configureSessionHardening(session as never, { isPackaged: true });

    const permissionResult = vi.fn();
    permissionHandler?.({}, "notifications", permissionResult);
    expect(permissionResult).toHaveBeenCalledWith(false);

    const response = vi.fn();
    headersCallback?.({ responseHeaders: { "X-Test": ["1"] } }, response);
    expect(response).toHaveBeenCalledWith({
      responseHeaders: expect.objectContaining({
        "Content-Security-Policy": [PRODUCTION_CONTENT_SECURITY_POLICY]
      })
    });
  });

  it("allows only the active app file URL or configured local dev origin", () => {
    expect(
      isAllowedAppNavigation(
        "file:///Applications/Hot%20Cross%20Buns/index.html#tasks",
        "file:///Applications/Hot%20Cross%20Buns/index.html#today"
      )
    ).toBe(true);
    expect(
      isAllowedAppNavigation(
        "file:///Users/person/secret.html",
        "file:///Applications/Hot%20Cross%20Buns/index.html"
      )
    ).toBe(false);
    expect(
      isAllowedAppNavigation(
        "http://localhost:5173/settings",
        "http://localhost:5173/",
        "http://localhost:5173/"
      )
    ).toBe(true);
    expect(
      isAllowedAppNavigation(
        "https://example.com",
        "http://localhost:5173/",
        "http://localhost:5173/"
      )
    ).toBe(false);
  });

  it("opens only approved external allowlist URLs from new-window requests", () => {
    expect(isApprovedExternalUrl("https://accounts.google.com/o/oauth2/v2/auth")).toBe(true);
    expect(isApprovedExternalUrl("mailto:support@example.invalid")).toBe(true);
    expect(isApprovedExternalUrl("https://example.com/phish")).toBe(false);
    expect(isApprovedExternalUrl("file:///Users/person/private")).toBe(false);

    let newWindowHandler: ((details: { url: string }) => { action: "deny" }) | undefined;
    const preventDefault = vi.fn();
    const window = {
      webContents: {
        setWindowOpenHandler: vi.fn((handler) => {
          newWindowHandler = handler;
        }),
        on: vi.fn((_eventName, listener) => {
          listener({ preventDefault }, "https://example.com/phish");
        }),
        getURL: vi.fn(() => "file:///Applications/Hot%20Cross%20Buns/index.html")
      }
    };

    configureNavigationLockdown(window as never);

    expect(newWindowHandler?.({ url: "https://accounts.google.com/o/oauth2/v2/auth" })).toEqual({
      action: "deny"
    });
    expect(shell.openExternal).toHaveBeenCalledWith(
      "https://accounts.google.com/o/oauth2/v2/auth"
    );
    expect(newWindowHandler?.({ url: "https://example.com/phish" })).toEqual({ action: "deny" });
    expect(shell.openExternal).not.toHaveBeenCalledWith("https://example.com/phish");
    expect(preventDefault).toHaveBeenCalled();
  });

  it("allows only http web URLs for embedded split panes", () => {
    expect(isAllowedEmbeddedWebUrl("https://example.com")).toBe(true);
    expect(isAllowedEmbeddedWebUrl("http://localhost:5173/docs")).toBe(true);
    expect(isAllowedEmbeddedWebUrl("mailto:a@example.com")).toBe(false);
    expect(isAllowedEmbeddedWebUrl("file:///tmp/secret")).toBe(false);
    expect(isAllowedEmbeddedWebUrl("javascript:alert(1)")).toBe(false);
  });

  it("hardens webview attachments for split panes", () => {
    let attachHandler:
      | ((
          event: { preventDefault: () => void },
          webPreferences: {
            allowRunningInsecureContent?: boolean;
            contextIsolation?: boolean;
            nodeIntegration?: boolean;
            preload?: string;
            sandbox?: boolean;
          },
          params: { src?: string }
        ) => void)
      | undefined;
    const window = {
      webContents: {
        on: vi.fn((eventName, listener) => {
          if (eventName === "will-attach-webview") {
            attachHandler = listener;
          }
        })
      }
    };
    const preventDefault = vi.fn();
    const webPreferences = {
      allowRunningInsecureContent: true,
      contextIsolation: false,
      nodeIntegration: true,
      preload: "/tmp/preload.js",
      sandbox: false
    };

    configureEmbeddedWebviewLockdown(window as never);
    attachHandler?.({ preventDefault }, webPreferences, { src: "https://example.com" });

    expect(preventDefault).not.toHaveBeenCalled();
    expect(webPreferences).toMatchObject({
      allowRunningInsecureContent: false,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    });
    expect("preload" in webPreferences).toBe(false);

    attachHandler?.({ preventDefault }, {}, { src: "file:///tmp/secret" });
    expect(preventDefault).toHaveBeenCalledTimes(1);
  });

  it("blocks popups and unsafe navigation inside embedded webviews", () => {
    let createdHandler:
      | ((_event: unknown, contents: {
          getType: () => string;
          on: (eventName: string, listener: (...args: never[]) => void) => void;
          setWindowOpenHandler: (handler: (details: { url: string }) => { action: "deny" }) => void;
        }) => void)
      | undefined;
    let newWindowHandler: ((details: { url: string }) => { action: "deny" }) | undefined;
    let navigateHandler:
      | ((event: { preventDefault: () => void }, url: string) => void)
      | undefined;
    const app = {
      on: vi.fn((eventName, listener) => {
        if (eventName === "web-contents-created") {
          createdHandler = listener;
        }
      })
    };
    const preventDefault = vi.fn();

    configureEmbeddedWebContentsLockdown(app as never);
    createdHandler?.({}, {
      getType: () => "webview",
      on: (_eventName, listener) => {
        navigateHandler = listener as typeof navigateHandler;
      },
      setWindowOpenHandler: (handler) => {
        newWindowHandler = handler;
      }
    });

    expect(newWindowHandler?.({ url: "https://example.com" })).toEqual({ action: "deny" });
    navigateHandler?.({ preventDefault }, "https://example.com/next");
    expect(preventDefault).not.toHaveBeenCalled();
    navigateHandler?.({ preventDefault }, "file:///tmp/secret");
    expect(preventDefault).toHaveBeenCalledTimes(1);
  });
});
