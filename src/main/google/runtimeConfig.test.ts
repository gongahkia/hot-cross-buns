import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemorySecretStore } from "../credentials/secretStore";
import { createAppSqliteConnection } from "../data/sqliteConnection";
import { runLocalDataMigrations } from "../data/migrations";
import { KeychainGoogleOAuthClientSecretStore } from "./keychainCredentials";
import { GoogleOAuthClientConfigStore } from "./runtimeConfig";

describe("Google OAuth runtime config", () => {
  it("stores client id in local settings and keeps client secret in the secret store", async () => {
    const directory = mkdtempSync(join(tmpdir(), "hcb-google-config-"));
    const connection = createAppSqliteConnection({ appSupportDirectory: directory });
    const secrets = new MemorySecretStore();
    const clientSecrets = new KeychainGoogleOAuthClientSecretStore(secrets);
    const config = new GoogleOAuthClientConfigStore(connection, clientSecrets);

    try {
      runLocalDataMigrations(connection);
      await config.save({
        clientId: "desktop-client-id.apps.googleusercontent.com",
        clientSecret: "client-secret-value"
      });

      expect(await config.snapshot()).toMatchObject({
        configured: true,
        clientId: "desktop-client-id.apps.googleusercontent.com",
        hasClientSecret: true
      });
      expect(JSON.stringify(connection.query("SELECT * FROM local_settings;"))).not.toContain(
        "client-secret-value"
      );
      expect(await clientSecrets.readClientSecret()).toBe("client-secret-value");

      await config.save({
        clientId: "desktop-client-id.apps.googleusercontent.com",
        clientSecret: null
      });

      expect((await config.snapshot()).hasClientSecret).toBe(false);
    } finally {
      connection.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
