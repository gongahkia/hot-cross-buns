import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { HcbVaultManifest } from "@shared/ipc/contracts";
import {
  HCB_VAULT_ALGORITHM,
  HCB_VAULT_FORMAT_VERSION,
  HCB_VAULT_KIND,
  HCB_VAULT_PAYLOAD_FILE
} from "@shared/ipc/contracts";
import {
  HcbVaultHostServer,
  downloadHcbVaultPackage,
  fetchHcbVaultHostInfo,
  readHcbVaultPackage,
  uploadHcbVaultPackage,
  vaultHostUrl,
  writeHcbVaultPackage
} from "./vaultServer";

let directory: string | undefined;
let server: HcbVaultHostServer | undefined;

afterEach(async () => {
  await server?.stop();
  server = undefined;
  if (directory) {
    rmSync(directory, { recursive: true, force: true });
    directory = undefined;
  }
});

describe("HCB vault host server", () => {
  it("stores and serves encrypted .hcbvault packages with bearer auth", async () => {
    directory = mkdtempSync(join(tmpdir(), "hcb-vault-host-"));
    const source = join(directory, "source.hcbvault");
    const hosted = join(directory, "hosted.hcbvault");
    const pulled = join(directory, "pulled.hcbvault");
    writeHcbVaultPackage(source, testVaultPackage("2026-06-19T00:00:00.000Z"));
    server = new HcbVaultHostServer({
      vaultPath: hosted,
      token: "remote-token-at-least-16"
    });
    const started = await server.start({ port: 0 });
    const endpoint = `http://127.0.0.1:${started.port}/hcb/v1/vault`;

    const unauthorized = await fetch(`${endpoint}/info`);
    expect(unauthorized.status).toBe(401);

    const empty = await fetchHcbVaultHostInfo(endpoint, "remote-token-at-least-16");
    expect(empty).toMatchObject({ hasVault: false, vaultName: "hosted.hcbvault" });

    const pushed = await uploadHcbVaultPackage(endpoint, "remote-token-at-least-16", source);
    expect(pushed).toMatchObject({ hasVault: true });

    const downloaded = await downloadHcbVaultPackage(endpoint, "remote-token-at-least-16", pulled);
    expect(downloaded.manifest.stateSha256).toBe(readHcbVaultPackage(source).manifest.stateSha256);
    expect(readHcbVaultPackage(pulled).payloadText).toBe(readHcbVaultPackage(source).payloadText);
  });

  it("rejects non-loopback HTTP endpoints unless explicitly allowed", () => {
    expect(() => vaultHostUrl("http://192.168.1.50:7420", "/hcb/v1/vault")).toThrow("HTTPS");
    expect(vaultHostUrl("http://192.168.1.50:7420", "/hcb/v1/vault", true))
      .toBe("http://192.168.1.50:7420/hcb/v1/vault");
  });

  it("rejects payload checksum mismatches before writing", () => {
    directory = mkdtempSync(join(tmpdir(), "hcb-vault-host-"));
    const target = join(directory, "bad.hcbvault");
    const pkg = testVaultPackage("2026-06-19T00:00:00.000Z");
    expect(() => writeHcbVaultPackage(target, {
      ...pkg,
      payloadText: `${pkg.payloadText}x`
    })).toThrow("checksum mismatch");
  });
});

function testVaultPackage(exportedAt: string) {
  const payloadText = `${JSON.stringify({ ciphertextBase64: Buffer.from("payload").toString("base64") }, null, 2)}\n`;
  const manifest: HcbVaultManifest = {
    formatVersion: HCB_VAULT_FORMAT_VERSION,
    kind: HCB_VAULT_KIND,
    exportedAt,
    appVersion: "5.0.0",
    stateEncoding: "hcb-portable-state-json",
    stateSha256: sha256("state"),
    payloadFile: HCB_VAULT_PAYLOAD_FILE,
    payloadSha256: sha256(payloadText),
    encryption: {
      algorithm: HCB_VAULT_ALGORITHM,
      kdf: "scrypt",
      saltBase64: Buffer.from("salt").toString("base64"),
      ivBase64: Buffer.from("iv-1234567890").toString("base64"),
      tagBase64: Buffer.from("tag-123456789012").toString("base64"),
      keyLength: 32,
      cost: 32_768,
      blockSize: 8,
      parallelization: 1
    },
    notes: ["test package"]
  };
  return { manifest, payloadText };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
