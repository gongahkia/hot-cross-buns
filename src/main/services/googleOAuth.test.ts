import { get } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

const electronMocks = vi.hoisted(() => ({
  decryptString: vi.fn<(value: Buffer) => string>(),
  encryptString: vi.fn<(value: string) => Buffer>(),
  isEncryptionAvailable: vi.fn<() => boolean>(),
  openExternal: vi.fn<(url: string) => Promise<void>>(async () => undefined)
}));

vi.mock("electron", () => ({
  safeStorage: {
    decryptString: electronMocks.decryptString,
    encryptString: electronMocks.encryptString,
    isEncryptionAvailable: electronMocks.isEncryptionAvailable
  },
  shell: { openExternal: electronMocks.openExternal }
}));

import { GoogleOAuthController } from "./googleOAuth";

function requestCallback(url: URL): Promise<number | undefined> {
  return new Promise((resolve, reject) => {
    get(url, (response) => {
      response.resume();
      response.once("end", () => resolve(response.statusCode));
    }).once("error", reject);
  });
}

describe("GoogleOAuthController", () => {
  it("sends the OAuth bearer token without dropping existing headers", async () => {
    const store = {
      dispatch: vi.fn(() => ({ accounts: [], hasClientSecret: false, oauthClientConfigured: true })),
      oauthClientId: () => "test-desktop-client-id"
    };
    const controller = new GoogleOAuthController("/tmp/hcb-oauth-test", store as never);
    const internals = controller as unknown as {
      accessToken: ReturnType<typeof vi.fn>;
    };
    internals.accessToken = vi.fn(async () => "access-token");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));

    await controller.googleFetch("test-account", "https://example.test/api", {
      headers: { "x-hcb-test": "present" }
    });

    const requestInit = fetchSpy.mock.calls[0]?.[1];
    const headers = new Headers(requestInit?.headers);
    expect(headers.get("authorization")).toBe("Bearer access-token");
    expect(headers.get("x-hcb-test")).toBe("present");
    expect(internals.accessToken).toHaveBeenCalledWith("test-account", false);
    fetchSpy.mockRestore();
  });

  it("adds a one-time state value and rejects a callback with the wrong state", async () => {
    const store = {
      dispatch: vi.fn(() => ({ accounts: [], hasClientSecret: false, oauthClientConfigured: true })),
      oauthClientId: () => "test-desktop-client-id"
    };
    const controller = new GoogleOAuthController("/tmp/hcb-oauth-test", store as never);
    const tokenFetch = vi.spyOn(globalThis, "fetch");

    await controller.begin();

    await vi.waitFor(() => expect(electronMocks.openExternal).toHaveBeenCalledTimes(1));
    const authorizationUrl = new URL(String(electronMocks.openExternal.mock.calls[0]?.[0]));
    const state = authorizationUrl.searchParams.get("state");
    expect(state).toMatch(/^[A-Za-z0-9_-]{40,}$/);

    const callbackUrl = new URL(authorizationUrl.searchParams.get("redirect_uri")!);
    callbackUrl.searchParams.set("code", "untrusted-code");
    callbackUrl.searchParams.set("state", "wrong-state");

    await expect(requestCallback(callbackUrl)).resolves.toBe(400);
    expect(tokenFetch).not.toHaveBeenCalled();
  });

  it("retires the starter workspace only after OAuth tokens are stored", async () => {
    const directory = mkdtempSync(join(tmpdir(), "hcb-oauth-test-"));
    const retireLocalFallback = vi.fn();
    const store = {
      oauthClientId: () => "test-desktop-client-id",
      retireLocalFallback,
      upsertGoogleAccount: vi.fn(() => ({ accountId: "google-account" }))
    };
    electronMocks.isEncryptionAvailable.mockReturnValue(true);
    electronMocks.encryptString.mockImplementation((value) => Buffer.from(value));
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ access_token: "access", refresh_token: "refresh", expires_in: 3600, scope: "openid email" }))
      .mockResolvedValueOnce(Response.json({ id: "google-id", email: "person@example.test", name: "Person" }));
    const controller = new GoogleOAuthController(directory, store as never);
    const internals = controller as unknown as {
      completeAuthorization: (
        authorization: { callback: { waitForCode: () => Promise<string> }; clientId: string; redirectUri: string; requestedScopes: string[]; verifier: string },
        attempt: { cancelled: boolean }
      ) => Promise<void>;
    };

    try {
      await internals.completeAuthorization({
        callback: { waitForCode: async () => "authorization-code" },
        clientId: "test-desktop-client-id",
        redirectUri: "http://127.0.0.1:9999/oauth/callback",
        requestedScopes: ["openid"],
        verifier: "verifier"
      }, { cancelled: false });

      expect(store.upsertGoogleAccount).toHaveBeenCalledWith(expect.objectContaining({
        googleAccountId: "google-id",
        email: "person@example.test",
        connectionState: "connected"
      }));
      expect(retireLocalFallback).toHaveBeenCalledTimes(1);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    } finally {
      fetchSpy.mockRestore();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
