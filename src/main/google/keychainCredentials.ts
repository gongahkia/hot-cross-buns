import type { SecretStore } from "../credentials/secretStore";
import type { GoogleCredentialAdapter } from "./credentials";
import type { GoogleStoredTokenSet } from "./types";

const GOOGLE_TOKEN_SERVICE = "Hot Cross Buns Google OAuth Tokens";
const GOOGLE_CLIENT_SECRET_SERVICE = "Hot Cross Buns Google OAuth Client";

export class KeychainGoogleCredentialAdapter implements GoogleCredentialAdapter {
  constructor(private readonly store: SecretStore) {}

  async saveTokenSet(accountId: string, tokenSet: GoogleStoredTokenSet): Promise<void> {
    await this.store.write(tokenKey(accountId), JSON.stringify(tokenSet));
  }

  async readTokenSet(accountId: string): Promise<GoogleStoredTokenSet | null> {
    const raw = await this.store.read(tokenKey(accountId));

    if (raw === null) {
      return null;
    }

    try {
      return JSON.parse(raw) as GoogleStoredTokenSet;
    } catch {
      await this.deleteTokenSet(accountId);
      return null;
    }
  }

  async deleteTokenSet(accountId: string): Promise<void> {
    await this.store.delete(tokenKey(accountId));
  }
}

export class KeychainGoogleOAuthClientSecretStore {
  constructor(private readonly store: SecretStore) {}

  async readClientSecret(): Promise<string | null> {
    return this.store.read(clientSecretKey());
  }

  async saveClientSecret(secret: string | null | undefined): Promise<void> {
    const normalized = secret?.trim();

    if (!normalized) {
      await this.store.delete(clientSecretKey());
      return;
    }

    await this.store.write(clientSecretKey(), normalized);
  }

  async hasClientSecret(): Promise<boolean> {
    return (await this.readClientSecret()) !== null;
  }
}

function tokenKey(accountId: string) {
  return {
    service: GOOGLE_TOKEN_SERVICE,
    account: `google-token:${accountId}`
  };
}

function clientSecretKey() {
  return {
    service: GOOGLE_CLIENT_SECRET_SERVICE,
    account: "desktop-oauth-client-secret"
  };
}
