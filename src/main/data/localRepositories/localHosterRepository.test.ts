import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MemorySecretStore, type SecretStore, type SecretStoreKey } from "../../credentials/secretStore";
import { runLocalDataMigrations } from "../migrations";
import { createTemporarySqliteConnection, type TemporarySqliteConnection } from "../sqliteConnection";
import { LocalHosterRepository } from "./localHosterRepository";

let temp: TemporarySqliteConnection | undefined;
let directory: string | undefined;

afterEach(() => {
  temp?.cleanup();
  temp = undefined;
  if (directory) {
    rmSync(directory, { recursive: true, force: true });
    directory = undefined;
  }
});

describe("local hoster repository", () => {
  it("exports and imports encrypted .hcbhost packages", async () => {
    const repository = testRepository();
    directory = mkdtempSync(join(tmpdir(), "hcbhost-"));
    const created = await repository.create(
      { name: "Terminal host", permissionMode: "confirm-writes" },
      "http://127.0.0.1:4777/hcb/v1/signal",
      "2026-06-19T00:00:00.000Z"
    );

    const exported = await repository.export({
      id: created.id,
      out: join(directory, "terminal.hcbhost")
    });
    const imported = await repository.import({ path: exported.path ?? "" });

    expect(exported.manifest).toMatchObject({
      formatVersion: 1,
      kind: "hot-cross-buns-2-local-hoster",
      hosterId: created.id,
      payloadFile: "payload.hcbenc",
      manifestSignature: {
        algorithm: "HMAC-SHA256",
        signedFields: "manifest-without-manifestSignature"
      }
    });
    expect(readFileSync(join(exported.path ?? "", "payload.hcbenc"), "utf8")).not.toContain("Terminal host");
    expect(imported.profile).toMatchObject({ id: created.id, name: "Terminal host" });
  });

  it("rejects signed manifest tampering while accepting unsigned v1 legacy packages", async () => {
    const repository = testRepository();
    directory = mkdtempSync(join(tmpdir(), "hcbhost-"));
    const created = await repository.create(
      { name: "Signed host" },
      "http://127.0.0.1:4777/hcb/v1/signal",
      "2026-06-19T00:00:00.000Z"
    );
    const exported = await repository.export({
      id: created.id,
      out: join(directory, "signed.hcbhost")
    });
    const manifestPath = join(exported.path ?? "", "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;

    writeFileSync(manifestPath, `${JSON.stringify({ ...manifest, name: "Tampered host" }, null, 2)}\n`, "utf8");
    await expect(repository.import({ path: exported.path ?? "" })).rejects.toThrow("manifest signature mismatch");

    const { manifestSignature: _signature, ...legacyManifest } = manifest;
    writeFileSync(manifestPath, `${JSON.stringify(legacyManifest, null, 2)}\n`, "utf8");
    await expect(repository.import({ path: exported.path ?? "" })).resolves.toMatchObject({
      profile: { id: created.id, name: "Signed host" }
    });
  });

  it("imports passphrase-wrapped .hcbhost packages into a fresh secret store", async () => {
    directory = mkdtempSync(join(tmpdir(), "hcbhost-"));
    const source = createTemporarySqliteConnection("hcbhost-source-");
    const target = createTemporarySqliteConnection("hcbhost-target-");
    try {
      runLocalDataMigrations(source.connection);
      runLocalDataMigrations(target.connection);
      const sourceRepository = new LocalHosterRepository(source.connection, new MemorySecretStore());
      const targetRepository = new LocalHosterRepository(target.connection, new MemorySecretStore());
      const created = await sourceRepository.create(
        { name: "Portable host" },
        "http://127.0.0.1:4777/hcb/v1/signal",
        "2026-06-19T00:00:00.000Z"
      );
      const exported = await sourceRepository.export({
        id: created.id,
        out: join(directory, "portable.hcbhost"),
        passphrase: "correct horse battery"
      });

      expect(exported.manifest?.appVersion).toMatch(/^\d+\.\d+\.\d+/);
      expect(exported.manifest?.keyWrap).toMatchObject({
        algorithm: "scrypt-AES-256-GCM",
        kdf: "scrypt"
      });
      await expect(targetRepository.import({
        path: exported.path ?? "",
        passphrase: "wrong horse battery"
      })).rejects.toThrow();

      const imported = await targetRepository.import({
        path: exported.path ?? "",
        passphrase: "correct horse battery"
      });
      expect(imported.profile).toMatchObject({ id: created.id, name: "Portable host" });
    } finally {
      source.cleanup();
      target.cleanup();
    }
  });

  it("rejects payload checksum mismatch and encrypted payload tampering", async () => {
    const repository = testRepository();
    directory = mkdtempSync(join(tmpdir(), "hcbhost-"));
    const created = await repository.create(
      { name: "Tamper host" },
      "http://127.0.0.1:4777/hcb/v1/signal"
    );
    const exported = await repository.export({
      id: created.id,
      out: join(directory, "tamper.hcbhost")
    });
    const payloadPath = join(exported.path ?? "", "payload.hcbenc");
    const manifestPath = join(exported.path ?? "", "manifest.json");

    writeFileSync(payloadPath, `${readFileSync(payloadPath, "utf8")}x`, "utf8");
    await expect(repository.import({ path: exported.path ?? "" })).rejects.toThrow("checksum mismatch");

    const payload = JSON.parse(readFileSync(payloadPath, "utf8").slice(0, -1)) as Record<string, string>;
    payload.ciphertextBase64 = `${payload.ciphertextBase64.slice(0, -4)}AAAA`;
    const payloadText = `${JSON.stringify(payload, null, 2)}\n`;
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
    manifest.payloadSha256 = await sha256(payloadText);
    writeFileSync(payloadPath, payloadText, "utf8");
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    await expect(repository.import({ path: exported.path ?? "" })).rejects.toThrow();
  });

  it("rejects unsupported packages and non-loopback endpoints", async () => {
    const repository = testRepository();
    directory = mkdtempSync(join(tmpdir(), "hcbhost-"));
    const packagePath = join(directory, "bad.hcbhost");

    await expect(repository.create({ name: "LAN" }, "http://0.0.0.0:4777/hcb/v1/signal"))
      .rejects.toThrow("127.0.0.1");

    const created = await repository.create({ name: "Unsupported" }, "http://127.0.0.1:4777/hcb/v1/signal");
    const exported = await repository.export({ id: created.id, out: packagePath });
    const manifestPath = join(exported.path ?? "", "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
    manifest.formatVersion = 2;
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    await expect(repository.import({ path: exported.path ?? "" })).rejects.toThrow();
  });

  it("round-trips signal encryption", async () => {
    const repository = testRepository();
    const created = await repository.create({ name: "Signal" }, "http://127.0.0.1:4777/hcb/v1/signal");

    await expect(repository.test({ id: created.id, privatePayload: true })).resolves.toMatchObject({
      id: created.id,
      message: "Local hoster signal encryption round-trip passed."
    });
  });

  it("fails closed when SecretStore create or export operations fail", async () => {
    const createRepository = testRepository(new FailingSecretStore("write"));
    await expect(createRepository.create(
      { name: "No secret" },
      "http://127.0.0.1:4777/hcb/v1/signal"
    )).rejects.toThrow("SecretStore write failed");
    expect(createRepository.listProfiles()).toEqual([]);
    temp?.cleanup();
    temp = undefined;

    const exportStore = new MemorySecretStore();
    const exportRepository = testRepository(exportStore);
    const created = await exportRepository.create(
      { name: "Read fail" },
      "http://127.0.0.1:4777/hcb/v1/signal"
    );
    const activeTemp = temp as TemporarySqliteConnection | undefined;
    if (!activeTemp) {
      throw new Error("missing test connection");
    }
    const readFailRepository = new LocalHosterRepository(activeTemp.connection, new FailingSecretStore("read"));
    directory = mkdtempSync(join(tmpdir(), "hcbhost-"));

    await expect(readFailRepository.export({
      id: created.id,
      out: join(directory, "read-fail.hcbhost")
    })).rejects.toThrow("SecretStore read failed");
  });
});

function testRepository(secretStore: SecretStore = new MemorySecretStore()): LocalHosterRepository {
  temp = createTemporarySqliteConnection("hcbhost-repo-");
  runLocalDataMigrations(temp.connection);
  return new LocalHosterRepository(temp.connection, secretStore);
}

class FailingSecretStore implements SecretStore {
  constructor(private readonly operation: "read" | "write" | "delete") {}

  async read(_key: SecretStoreKey): Promise<string | null> {
    if (this.operation === "read") {
      throw new Error("SecretStore read failed");
    }
    return null;
  }

  async write(_key: SecretStoreKey, _secret: string): Promise<void> {
    if (this.operation === "write") {
      throw new Error("SecretStore write failed");
    }
  }

  async delete(_key: SecretStoreKey): Promise<void> {
    if (this.operation === "delete") {
      throw new Error("SecretStore delete failed");
    }
  }

  status() {
    return {
      ok: this.operation === "delete",
      state: this.operation === "delete" ? "ready" as const : "error" as const,
      message: `SecretStore ${this.operation} failed`
    };
  }
}

async function sha256(value: string): Promise<string> {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(value).digest("hex");
}
