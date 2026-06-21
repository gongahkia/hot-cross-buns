import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  KeychainGoogleCredentialAdapter
} from "../google/keychainCredentials";
import { KeychainMcpCredentialAdapter } from "../mcp/keychainCredentials";
import {
  LinuxSecretServiceStore,
  MemorySecretStore,
  WindowsSafeStorageSecretStore,
  linuxSecretServiceStatus,
  type LinuxSafeStorageBackend,
  type LinuxSafeStorageBackendName,
  type WindowsSafeStorageBackend
} from "./secretStore";

class FakeLinuxSafeStorageBackend implements LinuxSafeStorageBackend {
  selectedBackend: LinuxSafeStorageBackendName = "gnome_libsecret";
  encryptionAvailable = true;
  throwOnEncrypt = false;
  throwOnDecrypt = false;
  plaintextDisabled = false;

  decryptString(encrypted: Buffer): string {
    if (this.throwOnDecrypt) {
      throw new Error("backend decrypt failed with token=raw-secret");
    }

    return encrypted.toString("utf8").split("").reverse().join("");
  }

  encryptString(plainText: string): Buffer {
    if (this.throwOnEncrypt) {
      throw new Error("backend encrypt failed with token=raw-secret");
    }

    return Buffer.from(plainText.split("").reverse().join(""), "utf8");
  }

  getSelectedStorageBackend(): LinuxSafeStorageBackendName {
    return this.selectedBackend;
  }

  isEncryptionAvailable(): boolean {
    return this.encryptionAvailable;
  }

  setUsePlainTextEncryption(usePlainText: boolean): void {
    this.plaintextDisabled = !usePlainText;
  }
}

class FakeWindowsSafeStorageBackend implements WindowsSafeStorageBackend {
  encryptionAvailable = true;
  throwOnEncrypt = false;
  throwOnDecrypt = false;

  decryptString(encrypted: Buffer): string {
    if (this.throwOnDecrypt) {
      throw new Error("windows decrypt failed with token=raw-secret");
    }

    return encrypted.toString("utf8").replace(/^windows-encrypted:/, "");
  }

  encryptString(plainText: string): Buffer {
    if (this.throwOnEncrypt) {
      throw new Error("windows encrypt failed with token=raw-secret");
    }

    return Buffer.from(`windows-encrypted:${plainText}`, "utf8");
  }

  isEncryptionAvailable(): boolean {
    return this.encryptionAvailable;
  }
}

async function withLinuxStore<T>(
  run: (input: {
    backend: FakeLinuxSafeStorageBackend;
    storageFile: string;
    store: LinuxSecretServiceStore;
  }) => Promise<T>
): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), "hcb2-linux-secret-store-"));
  const backend = new FakeLinuxSafeStorageBackend();
  const storageFile = join(directory, "secrets.safe-storage.json");
  const store = new LinuxSecretServiceStore({
    backend,
    now: () => new Date("2026-06-13T00:00:00.000Z"),
    platform: "linux",
    storageFile
  });

  try {
    return await run({ backend, storageFile, store });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function withWindowsStore<T>(
  run: (input: {
    backend: FakeWindowsSafeStorageBackend;
    storageFile: string;
    store: WindowsSafeStorageSecretStore;
  }) => Promise<T>
): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), "hcb2-windows-secret-store-"));
  const backend = new FakeWindowsSafeStorageBackend();
  const storageFile = join(directory, "secrets.windows-safe-storage.json");
  const store = new WindowsSafeStorageSecretStore({
    backend,
    now: () => new Date("2026-06-13T00:00:00.000Z"),
    platform: "win32",
    storageFile
  });

  try {
    return await run({ backend, storageFile, store });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe("secret stores", () => {
  it("keeps in-memory secret storage available for tests", async () => {
    const store = new MemorySecretStore();

    await store.write({ service: "svc", account: "acct" }, "secret");

    await expect(store.read({ service: "svc", account: "acct" })).resolves.toBe("secret");
    expect(store.status()).toMatchObject({
      ok: true,
      state: "ready"
    });
  });

  it("persists Linux secrets as encrypted metadata without raw labels or values", async () => {
    await withLinuxStore(async ({ backend, storageFile, store }) => {
      const key = { service: "Hot Cross Buns 2 Test", account: "oauth-token-account" };

      expect(store.status()).toMatchObject({
        ok: true,
        state: "ready"
      });
      expect(backend.plaintextDisabled).toBe(true);

      await store.write(key, "super-secret-token");

      await expect(store.read(key)).resolves.toBe("super-secret-token");
      const raw = await readFile(storageFile, "utf8");
      expect(raw).not.toContain("super-secret-token");
      expect(raw).not.toContain(key.service);
      expect(raw).not.toContain(key.account);

      await store.delete(key);
      await expect(store.read(key)).resolves.toBeNull();
    });
  });

  it("persists Google OAuth token sets through the Linux store", async () => {
    await withLinuxStore(async ({ backend, storageFile, store }) => {
      const adapter = new KeychainGoogleCredentialAdapter(store);

      await adapter.saveTokenSet("acct-1", {
        accessToken: "access-token",
        refreshToken: "refresh-token",
        scope: "tasks calendar",
        tokenType: "Bearer"
      });

      const reloaded = new KeychainGoogleCredentialAdapter(
        new LinuxSecretServiceStore({
          backend,
          platform: "linux",
          storageFile
        })
      );

      await expect(reloaded.readTokenSet("acct-1")).resolves.toEqual({
        accessToken: "access-token",
        refreshToken: "refresh-token",
        scope: "tasks calendar",
        tokenType: "Bearer"
      });
      expect(await readFile(storageFile, "utf8")).not.toContain("refresh-token");
    });
  });

  it("persists MCP bearer tokens through the Linux store", async () => {
    await withLinuxStore(async ({ backend, storageFile, store }) => {
      const adapter = new KeychainMcpCredentialAdapter(store);
      const token = await adapter.loadBearerToken();
      const revision = await adapter.credentialRevision();
      const reloaded = new KeychainMcpCredentialAdapter(
        new LinuxSecretServiceStore({
          backend,
          platform: "linux",
          storageFile
        })
      );

      await expect(reloaded.loadBearerToken()).resolves.toBe(token);
      await expect(reloaded.credentialRevision()).resolves.toBe(revision);
      expect(await readFile(storageFile, "utf8")).not.toContain(token);
    });
  });

  it("persists Google OAuth token sets through the Windows safe storage store", async () => {
    await withWindowsStore(async ({ backend, storageFile, store }) => {
      const adapter = new KeychainGoogleCredentialAdapter(store);

      await adapter.saveTokenSet("acct-1", {
        accessToken: "access-token",
        refreshToken: "refresh-token",
        scope: "tasks calendar",
        tokenType: "Bearer"
      });

      const reloaded = new KeychainGoogleCredentialAdapter(
        new WindowsSafeStorageSecretStore({
          backend,
          platform: "win32",
          storageFile
        })
      );

      await expect(reloaded.readTokenSet("acct-1")).resolves.toEqual({
        accessToken: "access-token",
        refreshToken: "refresh-token",
        scope: "tasks calendar",
        tokenType: "Bearer"
      });
      const raw = await readFile(storageFile, "utf8");
      expect(raw).not.toContain("refresh-token");
      expect(raw).not.toContain("acct-1");
    });
  });

  it("persists MCP bearer tokens through the Windows safe storage store", async () => {
    await withWindowsStore(async ({ backend, storageFile, store }) => {
      const adapter = new KeychainMcpCredentialAdapter(store);
      const token = await adapter.loadBearerToken();
      const revision = await adapter.credentialRevision();
      const reloaded = new KeychainMcpCredentialAdapter(
        new WindowsSafeStorageSecretStore({
          backend,
          platform: "win32",
          storageFile
        })
      );

      await expect(reloaded.loadBearerToken()).resolves.toBe(token);
      await expect(reloaded.credentialRevision()).resolves.toBe(revision);
      expect(await readFile(storageFile, "utf8")).not.toContain(token);
    });
  });

  it("refuses Electron basic_text plaintext fallback on Linux", async () => {
    await withLinuxStore(async ({ backend, store }) => {
      backend.selectedBackend = "basic_text";

      expect(store.status()).toMatchObject({
        ok: false,
        state: "unsupported"
      });
      await expect(
        store.write({ service: "svc", account: "acct" }, "secret")
      ).rejects.toThrow("refusing Electron basic_text plaintext fallback");
    });
  });

  it("reports locked or unavailable Linux Secret Service as an error", async () => {
    await withLinuxStore(async ({ backend, store }) => {
      backend.encryptionAvailable = false;

      expect(store.status()).toMatchObject({
        ok: false,
        state: "error"
      });
      await expect(
        store.read({ service: "svc", account: "acct" })
      ).rejects.toThrow("unavailable or locked");
    });
  });

  it("reports unexpected backend failures without exposing backend error text", async () => {
    await withLinuxStore(async ({ backend, store }) => {
      backend.throwOnEncrypt = true;
      const status = linuxSecretServiceStatus(backend, "linux");

      expect(status).toMatchObject({
        ok: false,
        state: "error",
        message: "Linux Secret Service backend gnome_libsecret failed an encryption smoke check."
      });
      expect(status.message).not.toContain("raw-secret");
      await expect(
        store.write({ service: "svc", account: "acct" }, "secret")
      ).rejects.toThrow("failed an encryption smoke check");
    });
  });

  it("reports locked or unavailable Windows safe storage as an error", async () => {
    await withWindowsStore(async ({ backend, store }) => {
      backend.encryptionAvailable = false;

      expect(store.status()).toMatchObject({
        ok: false,
        state: "error"
      });
      await expect(
        store.read({ service: "svc", account: "acct" })
      ).rejects.toThrow("unavailable or locked");
    });
  });

  it("reports unexpected Windows safe storage failures without exposing backend error text", async () => {
    await withWindowsStore(async ({ backend, store }) => {
      backend.throwOnEncrypt = true;

      expect(store.status()).toMatchObject({
        ok: false,
        state: "error",
        message: "Windows safe storage failed an encryption smoke check."
      });
      expect(store.status().message).not.toContain("raw-secret");
      await expect(
        store.write({ service: "svc", account: "acct" }, "secret")
      ).rejects.toThrow("failed an encryption smoke check");
    });
  });
});
