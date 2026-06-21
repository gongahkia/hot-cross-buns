import type { SecretStore } from "../credentials/secretStore";
import {
  createCredentialFingerprint,
  generateMcpBearerToken
} from "./credentials";
import type { McpCredentialAdapter } from "./types";

const MCP_TOKEN_SERVICE = "Hot Cross Buns MCP";
const MCP_TOKEN_ACCOUNT = "loopback-bearer-token";

export class KeychainMcpCredentialAdapter implements McpCredentialAdapter {
  constructor(
    private readonly store: SecretStore,
    private readonly options: { seedToken?: string } = {}
  ) {}

  async loadBearerToken(): Promise<string> {
    const existing = await this.store.read(tokenKey());

    if (existing) {
      return existing;
    }

    const token = this.options.seedToken?.trim() || generateMcpBearerToken();
    await this.store.write(tokenKey(), token);
    return token;
  }

  async credentialRevision(): Promise<string> {
    return createCredentialFingerprint(await this.loadBearerToken());
  }

  async resetBearerToken(): Promise<string> {
    const token = generateMcpBearerToken();
    await this.store.write(tokenKey(), token);
    return token;
  }

  async isConfigured(): Promise<boolean> {
    return (await this.store.read(tokenKey())) !== null;
  }
}

function tokenKey() {
  return {
    service: MCP_TOKEN_SERVICE,
    account: MCP_TOKEN_ACCOUNT
  };
}
