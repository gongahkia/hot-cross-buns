import { get } from "node:http";
import { describe, expect, it, vi } from "vitest";

const electronMocks = vi.hoisted(() => ({
  openExternal: vi.fn<(url: string) => Promise<void>>(async () => undefined)
}));

vi.mock("electron", () => ({
  safeStorage: {
    decryptString: vi.fn(),
    encryptString: vi.fn(),
    isEncryptionAvailable: vi.fn()
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
});
