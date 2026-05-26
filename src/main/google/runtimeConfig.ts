import type { SqliteConnection } from "../data/sqliteConnection";
import { KeychainGoogleOAuthClientSecretStore } from "./keychainCredentials";
import type { DesktopGoogleOAuthClientConfig } from "./oauth";
import { DEFAULT_GOOGLE_AUTHORIZATION_SCOPES } from "./types";

export interface GoogleOAuthClientConfigSnapshot {
  configured: boolean;
  clientId: string | null;
  hasClientSecret: boolean;
  updatedAt?: string;
}

export interface GoogleOAuthClientConfigUpdate {
  clientId: string;
  clientSecret?: string | null;
}

export class GoogleOAuthClientConfigStore {
  constructor(
    private readonly connection: SqliteConnection,
    private readonly clientSecretStore: KeychainGoogleOAuthClientSecretStore
  ) {}

  async snapshot(): Promise<GoogleOAuthClientConfigSnapshot> {
    const clientId = this.readClientId();
    const updatedAt = this.readUpdatedAt();

    return {
      configured: clientId !== null,
      clientId,
      hasClientSecret:
        clientId === null ? false : this.readSetting<boolean>("oauthClientSecretConfigured", false),
      ...(updatedAt === null ? {} : { updatedAt })
    };
  }

  async save(update: GoogleOAuthClientConfigUpdate): Promise<GoogleOAuthClientConfigSnapshot> {
    const clientId = normalizeClientId(update.clientId);
    const now = new Date().toISOString();

    this.writeSetting("oauthClientId", clientId, now);

    if ("clientSecret" in update) {
      const hasClientSecret = Boolean(update.clientSecret?.trim());
      await this.clientSecretStore.saveClientSecret(update.clientSecret);
      this.writeSetting("oauthClientSecretConfigured", hasClientSecret, now);
    }

    return this.snapshot();
  }

  async oauthConfig(redirectUri: string): Promise<DesktopGoogleOAuthClientConfig | null> {
    const clientId = this.readClientId();

    if (clientId === null) {
      return null;
    }

    const clientSecret = await this.clientSecretStore.readClientSecret();

    return {
      clientId,
      ...(clientSecret === null ? {} : { clientSecret }),
      redirectUri,
      scopes: DEFAULT_GOOGLE_AUTHORIZATION_SCOPES
    };
  }

  private readClientId(): string | null {
    const value = this.readSetting<string | null>("oauthClientId", null);
    const normalized = typeof value === "string" ? value.trim() : "";

    return normalized.length === 0 ? null : normalized;
  }

  private readUpdatedAt(): string | null {
    return (
      this.connection.get<{ updatedAt: string }>(
        `SELECT updated_at AS updatedAt
         FROM local_settings
         WHERE scope = 'google' AND key = 'oauthClientId'
         LIMIT 1;`
      )?.updatedAt ?? null
    );
  }

  private readSetting<T>(key: string, fallback: T): T {
    const row = this.connection.get<{ valueJson: string }>(
      `SELECT value_json AS valueJson
       FROM local_settings
       WHERE scope = 'google' AND key = ?
       LIMIT 1;`,
      [key]
    );

    if (!row) {
      return fallback;
    }

    try {
      return JSON.parse(row.valueJson) as T;
    } catch {
      return fallback;
    }
  }

  private writeSetting(key: string, value: unknown, now: string): void {
    this.connection.run(
      `INSERT INTO local_settings (scope, key, value_json, updated_at)
       VALUES ('google', ?, ?, ?)
       ON CONFLICT(scope, key) DO UPDATE SET
         value_json = excluded.value_json,
         updated_at = excluded.updated_at;`,
      [key, JSON.stringify(value), now]
    );
  }
}

function normalizeClientId(value: string): string {
  const normalized = value.trim();

  if (normalized.length < 10 || normalized.length > 500) {
    throw new Error("Google OAuth client ID must be configured before connecting.");
  }

  return normalized;
}
