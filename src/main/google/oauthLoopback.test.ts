import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemorySecretStore } from "../credentials/secretStore";
import { createAppSqliteConnection } from "../data/sqliteConnection";
import { runLocalDataMigrations } from "../data/migrations";
import { MemoryGoogleCredentialAdapter } from "./credentials";
import { KeychainGoogleOAuthClientSecretStore } from "./keychainCredentials";
import { GoogleOAuthLoopbackController } from "./oauthLoopback";
import { MemoryGoogleOAuthAccountStatusStore, type GoogleOAuthAuthorizationCodeTransport } from "./oauth";
import { GoogleOAuthClientConfigStore } from "./runtimeConfig";
import { GOOGLE_CALENDAR_SCOPE, GOOGLE_TASKS_SCOPE } from "./types";

describe("Google OAuth loopback controller", () => {
  it("opens the browser, accepts the loopback callback, and stores sanitized account status", async () => {
    const directory = mkdtempSync(join(tmpdir(), "hcb-oauth-loopback-"));
    const connection = createAppSqliteConnection({ appSupportDirectory: directory });
    const configStore = new GoogleOAuthClientConfigStore(
      connection,
      new KeychainGoogleOAuthClientSecretStore(new MemorySecretStore())
    );
    const credentialAdapter = new MemoryGoogleCredentialAdapter();
    const statusStore = new MemoryGoogleOAuthAccountStatusStore();
    const transport: GoogleOAuthAuthorizationCodeTransport = {
      exchangeAuthorizationCode: vi.fn(async () => ({
        tokenSet: {
          accessToken: "access-token",
          refreshToken: "refresh-token",
          scope: `${GOOGLE_TASKS_SCOPE} ${GOOGLE_CALENDAR_SCOPE}`
        },
        account: {
          googleAccountId: "google-user-1",
          email: "user@example.com"
        },
        grantedScopes: [GOOGLE_TASKS_SCOPE, GOOGLE_CALENDAR_SCOPE]
      }))
    };
    const onConnected = vi.fn();
    const openedUrls: string[] = [];
    const controller = new GoogleOAuthLoopbackController({
      configStore,
      credentialAdapter,
      authorizationTransport: transport,
      accountStatusStore: statusStore,
      openExternalUrl: async (url) => {
        openedUrls.push(url);
        return { ok: true };
      },
      onConnected
    });

    try {
      runLocalDataMigrations(connection);
      await configStore.save({ clientId: "desktop-client-id.apps.googleusercontent.com" });

      const begin = await controller.beginAuthorization();
      const state = new URL(openedUrls[0]).searchParams.get("state");

      expect(begin.openedExternalBrowser).toBe(true);
      expect(state).toBeTruthy();

      const callback = await fetch(`${begin.redirectUri}?code=oauth-code&state=${state}`);
      const body = await callback.text();

      expect(callback.status).toBe(200);
      expect(body).toContain("completed");
      expect(onConnected).toHaveBeenCalledWith(
        expect.objectContaining({
          accountId: "google:google-user-1",
          connectionState: "connected"
        })
      );
      expect(JSON.stringify(await statusStore.listStatuses())).not.toContain("access-token");
      expect(await credentialAdapter.readTokenSet("google:google-user-1")).toMatchObject({
        refreshToken: "refresh-token"
      });
    } finally {
      await controller.stop();
      connection.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
