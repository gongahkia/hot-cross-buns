import { afterEach, describe, expect, it, vi } from "vitest";

import { requestGoogleAccessToken } from "@/auth/googleIdentity";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("requestGoogleAccessToken", () => {
  it("uses the no-repeat-consent prompt by default", async () => {
    const requestAccessToken = vi.fn();
    vi.stubGlobal("google", {
      accounts: {
        oauth2: {
          initTokenClient: (configuration: { callback(response: { access_token?: string; expires_in?: number; scope?: string }): void }) => ({
            requestAccessToken: (options?: { prompt?: "" | "consent" | "select_account" }) => {
              requestAccessToken(options);
              configuration.callback({ access_token: "access-token", expires_in: 3600, scope: "scope-a" });
            }
          }),
          revoke: vi.fn()
        }
      }
    });

    const token = await requestGoogleAccessToken("1234567890-example.apps.googleusercontent.com", ["scope-a"]);

    expect(requestAccessToken).toHaveBeenCalledWith({ prompt: "" });
    expect(token).toMatchObject({ value: "access-token", scopes: ["scope-a"] });
  });
});
