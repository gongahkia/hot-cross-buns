import { createHash } from "node:crypto";
import type { SecretStore } from "../credentials/secretStore";

const HCB_VAULT_HOST_SECRET_SERVICE = "Hot Cross Buns Vault Hosts";

export interface HcbVaultHostCredentials {
  endpoint: string;
  token: string;
  passphrase: string;
}

interface StoredHcbVaultHostCredentials {
  version: 1;
  endpoint: string;
  token: string;
  passphrase: string;
}

export class HcbVaultHostCredentialStore {
  constructor(private readonly secretStore: SecretStore) {}

  status() {
    return this.secretStore.status();
  }

  async read(endpoint: string): Promise<HcbVaultHostCredentials | null> {
    const raw = await this.secretStore.read(secretKey(endpoint));
    if (!raw) {
      return null;
    }

    return parseStoredCredentials(raw, endpoint);
  }

  async write(credentials: HcbVaultHostCredentials): Promise<void> {
    await this.secretStore.write(
      secretKey(credentials.endpoint),
      JSON.stringify({
        version: 1,
        endpoint: credentials.endpoint,
        token: credentials.token,
        passphrase: credentials.passphrase
      } satisfies StoredHcbVaultHostCredentials)
    );
  }

  async delete(endpoint: string): Promise<void> {
    await this.secretStore.delete(secretKey(endpoint));
  }
}

function secretKey(endpoint: string) {
  return {
    service: HCB_VAULT_HOST_SECRET_SERVICE,
    account: `endpoint:${createHash("sha256").update(endpoint).digest("hex")}`
  };
}

function parseStoredCredentials(raw: string, endpoint: string): HcbVaultHostCredentials {
  const parsed = JSON.parse(raw) as Partial<StoredHcbVaultHostCredentials>;
  if (
    parsed.version !== 1 ||
    parsed.endpoint !== endpoint ||
    typeof parsed.token !== "string" ||
    typeof parsed.passphrase !== "string" ||
    parsed.token.length < 8 ||
    parsed.passphrase.length < 8
  ) {
    throw new Error("Stored HCB vault host credentials are invalid.");
  }

  return {
    endpoint,
    token: parsed.token,
    passphrase: parsed.passphrase
  };
}
