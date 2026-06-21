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

  it("persists a seed token when no bearer token exists", async () => {
    const store = new MemorySecretStore();
    const adapter = new KeychainMcpCredentialAdapter(store, { seedToken: "seed-token" });

    await expect(adapter.loadBearerToken()).resolves.toBe("seed-token");
    await expect(store.read({
      service: "Hot Cross Buns 2 MCP",
      account: "loopback-bearer-token"
    })).resolves.toBe("seed-token");
  });
});
