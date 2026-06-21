import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseSafeStorageTokenHelperArgv,
  readMcpTokenFromSafeStorageFile
} from "./safeStorageTokenHelper";

describe("safeStorage MCP token helper", () => {
  it("parses packaged app helper argv", () => {
    expect(parseSafeStorageTokenHelperArgv([
      "Hot Cross Buns.exe",
      "--hcb-read-mcp-token-safe-storage",
      "win32",
      "C:\\hcb\\secrets.windows-safe-storage.json"
    ])).toEqual({
      platform: "win32",
      storageFile: "C:\\hcb\\secrets.windows-safe-storage.json"
    });
    expect(parseSafeStorageTokenHelperArgv(["Hot Cross Buns.exe"])).toBeNull();
  });

  it("decrypts the MCP bearer token entry", async () => {
    const directory = mkdtempSync(join(tmpdir(), "hcb-safe-storage-helper-"));
    const storageFile = join(directory, "secrets.windows-safe-storage.json");
    const token = "hcb-token";

    try {
      writeFileSync(storageFile, JSON.stringify({
        version: 1,
        values: {
          [hashedSecretKey("Hot Cross Buns MCP", "loopback-bearer-token")]: {
            ciphertextBase64: Buffer.from(`encrypted:${token}`).toString("base64"),
            updatedAt: new Date("2026-06-14T00:00:00.000Z").toISOString()
          }
        }
      }));

      await expect(readMcpTokenFromSafeStorageFile({
        platform: "win32",
        storageFile
      }, {
        decryptString: (encrypted) => encrypted.toString("utf8").replace(/^encrypted:/, ""),
        isEncryptionAvailable: () => true
      })).resolves.toBe(token);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects Linux basic_text plaintext fallback", async () => {
    const directory = mkdtempSync(join(tmpdir(), "hcb-safe-storage-helper-"));
    const storageFile = join(directory, "secrets.safe-storage.json");

    try {
      writeFileSync(storageFile, JSON.stringify({
        version: 1,
        values: {}
      }));

      await expect(readMcpTokenFromSafeStorageFile({
        platform: "linux",
        storageFile
      }, {
        decryptString: () => "token",
        getSelectedStorageBackend: () => "basic_text",
        isEncryptionAvailable: () => true,
        setUsePlainTextEncryption: () => undefined
      })).rejects.toThrow("Refusing Electron basic_text plaintext fallback");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

function hashedSecretKey(service: string, account: string): string {
  return createHash("sha256").update(service).update("\0").update(account).digest("hex");
}
