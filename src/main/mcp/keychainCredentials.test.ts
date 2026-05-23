import { describe, expect, it } from "vitest";
import { MemorySecretStore } from "../credentials/secretStore";
import { KeychainMcpCredentialAdapter } from "./keychainCredentials";

describe("Keychain MCP credential adapter", () => {
  it("generates, persists, fingerprints, and rotates bearer tokens without exposing storage details", async () => {
    const adapter = new KeychainMcpCredentialAdapter(new MemorySecretStore());

    expect(await adapter.isConfigured()).toBe(false);

    const token = await adapter.loadBearerToken();
    const secondRead = await adapter.loadBearerToken();
    const revision = await adapter.credentialRevision();

    expect(token).toHaveLength(43);
    expect(secondRead).toBe(token);
    expect(revision).toHaveLength(64);
    expect(await adapter.isConfigured()).toBe(true);

    const rotated = await adapter.resetBearerToken();

    expect(rotated).not.toBe(token);
    expect(await adapter.loadBearerToken()).toBe(rotated);
  });
});
