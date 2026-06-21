import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  localHosterManifestSchema,
  localHosterCreateRequestSchema,
  localHosterExportRequestSchema,
  localHosterImportRequestSchema,
  localHosterRemoveRequestSchema,
  localHosterSignalPayloadSchema,
  localHosterTestRequestSchema,
  LOCAL_HOSTER_HCBHOST_FORMAT_VERSION,
  LOCAL_HOSTER_KIND,
  type LocalHosterCapability,
  type LocalHosterCreateRequest,
  type LocalHosterExportRequest,
  type LocalHosterImportRequest,
  type LocalHosterManifest,
  type LocalHosterMutationResponse,
  type LocalHosterProfile,
  type LocalHosterRemoveRequest,
  type LocalHosterSignalPayload,
  type LocalHosterStatusResponse,
  type LocalHosterTestRequest
} from "@shared/ipc/contracts";
import packageJson from "../../../../package.json";
import type { SecretStore } from "../../credentials/secretStore";
import {
  createLocalHosterSecret,
  decryptHosterPayload,
  decryptSignalEnvelope,
  encryptHosterPayload,
  encryptSignalEnvelope,
  signHosterManifest,
  sha256Hex,
  unwrapHosterPackageKey,
  verifyHosterManifestSignature,
  wrapHosterPackageKey,
  type LocalHosterEncryptedPayload,
  type LocalHosterSecret
} from "../../hoster/crypto";
import type { SqliteConnection } from "../sqliteConnection";
import { validationFailure } from "./shared";

const HOSTER_SECRET_SERVICE = "Hot Cross Buns Local Hosters";
const HCBHOST_FORMAT_VERSION = LOCAL_HOSTER_HCBHOST_FORMAT_VERSION;
const PAYLOAD_FILE = "payload.hcbenc";
const replayPastWindowMs = 5 * 60 * 1000;
const replayFutureWindowMs = 60 * 1000;
const defaultCapabilities: LocalHosterCapability[] = ["host.info", "signal.send", "planner.read"];

interface LocalHosterRow extends Record<string, unknown> {
  id: string;
  name: string;
  capabilitiesJson: string;
  permissionMode: "read-only" | "confirm-writes" | "allow-writes";
  endpoint: string;
  keyFingerprint: string;
  createdAt: string;
  updatedAt: string;
}

interface HosterPackagePayload {
  version: 1;
  profile: LocalHosterProfile;
  secret: LocalHosterSecret;
}

export class LocalHosterRepository {
  constructor(
    private readonly connection: SqliteConnection,
    private readonly secretStore: SecretStore
  ) {}

  async status(base: Omit<LocalHosterStatusResponse, "profiles">): Promise<LocalHosterStatusResponse> {
    return {
      ...base,
      profiles: this.listProfiles()
    };
  }

  listProfiles(): LocalHosterProfile[] {
    return this.connection.query<LocalHosterRow>(
      `${selectHosterRows()}
       WHERE deleted_at IS NULL
       ORDER BY updated_at DESC, id DESC;`
    ).map(profileFromRow);
  }

  async create(request: LocalHosterCreateRequest, endpoint: string, now = new Date().toISOString()): Promise<LocalHosterMutationResponse> {
    request = localHosterCreateRequestSchema.parse(request);
    assertLoopbackEndpoint(endpoint);
    const id = `hoster:${randomUUID()}`;
    const secret = createLocalHosterSecret();
    const capabilities = uniqueCapabilities(request.capabilities ?? defaultCapabilities);
    const permissionMode = request.permissionMode ?? "confirm-writes";

    await this.secretStore.write(secretKey(id), JSON.stringify(secret));
    this.connection.run(
      `INSERT INTO local_hoster_profiles (
         id, name, capabilities_json, permission_mode, endpoint,
         key_fingerprint, created_at, updated_at, deleted_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL);`,
      [id, request.name.trim(), JSON.stringify(capabilities), permissionMode, endpoint, secret.keyFingerprint, now, now]
    );

    return {
      id,
      profile: this.requireProfile(id),
      message: "Local hoster profile created."
    };
  }

  async export(request: LocalHosterExportRequest, now = new Date().toISOString()): Promise<LocalHosterMutationResponse> {
    request = localHosterExportRequestSchema.parse(request);
    const profile = this.requireProfile(request.id);
    const secret = await this.requireSecret(profile.id);
    const outPath = normalizedHosterPath(request.out, profile.id);
    const payload = encryptHosterPayload(
      {
        version: HCBHOST_FORMAT_VERSION,
        profile,
        secret
      } satisfies HosterPackagePayload,
      secret.packageKeyBase64,
      profile.id
    );
    const payloadText = `${JSON.stringify(payload, null, 2)}\n`;
    const manifest = signHosterManifest({
      formatVersion: HCBHOST_FORMAT_VERSION,
      kind: LOCAL_HOSTER_KIND,
      createdAt: now,
      appVersion: packageJson.version,
      hosterId: profile.id,
      name: profile.name,
      capabilities: profile.capabilities,
      permissionMode: profile.permissionMode,
      endpoint: profile.endpoint,
      keyFingerprint: profile.keyFingerprint,
      payloadFile: PAYLOAD_FILE,
      payloadSha256: sha256Hex(payloadText),
      ...(request.passphrase === undefined
        ? {}
        : { keyWrap: wrapHosterPackageKey(secret.packageKeyBase64, request.passphrase, profile.id) })
    }, secret.packageKeyBase64, profile.id);

    rmSync(outPath, { recursive: true, force: true });
    mkdirSync(outPath, { recursive: true });
    writeFileSync(join(outPath, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    writeFileSync(join(outPath, PAYLOAD_FILE), payloadText, { encoding: "utf8", mode: 0o600 });

    return {
      id: profile.id,
      path: outPath,
      profile,
      manifest,
      message: `Local hoster exported to ${outPath}.`
    };
  }

  async import(request: LocalHosterImportRequest, now = new Date().toISOString()): Promise<LocalHosterMutationResponse> {
    request = localHosterImportRequestSchema.parse(request);
    const manifest = localHosterManifestSchema.parse(
      JSON.parse(readFileSync(join(request.path, "manifest.json"), "utf8"))
    );
    const payloadText = readFileSync(join(request.path, manifest.payloadFile), "utf8");
    if (sha256Hex(payloadText) !== manifest.payloadSha256) {
      throw validationFailure("Local hoster payload checksum mismatch.");
    }

    const existingSecret = await this.secretStore.read(secretKey(manifest.hosterId));
    const packageKey = existingSecret
      ? parseSecret(existingSecret).packageKeyBase64
      : manifest.keyWrap && request.passphrase
        ? unwrapHosterPackageKey(manifest.keyWrap, request.passphrase, manifest.hosterId)
        : undefined;
    if (!packageKey) {
      throw validationFailure("Local hoster package can only be imported after its key is present in this OS credential store.");
    }
    if (!verifyHosterManifestSignature(manifest, packageKey, manifest.hosterId)) {
      throw validationFailure("Local hoster manifest signature mismatch.");
    }

    const payload = decryptHosterPayload<HosterPackagePayload>(
      JSON.parse(payloadText) as LocalHosterEncryptedPayload,
      packageKey,
      manifest.hosterId
    );

    if (
      payload.version !== HCBHOST_FORMAT_VERSION ||
      payload.profile.keyFingerprint !== manifest.keyFingerprint ||
      payload.secret.packageKeyBase64 !== packageKey
    ) {
      throw validationFailure("Local hoster package metadata does not match its encrypted payload.");
    }

    await this.secretStore.write(secretKey(payload.profile.id), JSON.stringify(payload.secret));
    this.connection.run(
      `INSERT INTO local_hoster_profiles (
         id, name, capabilities_json, permission_mode, endpoint,
         key_fingerprint, created_at, updated_at, deleted_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         capabilities_json = excluded.capabilities_json,
         permission_mode = excluded.permission_mode,
         endpoint = excluded.endpoint,
         key_fingerprint = excluded.key_fingerprint,
         updated_at = excluded.updated_at,
         deleted_at = NULL;`,
      [
        payload.profile.id,
        payload.profile.name,
        JSON.stringify(payload.profile.capabilities),
        payload.profile.permissionMode,
        payload.profile.endpoint,
        payload.profile.keyFingerprint,
        payload.profile.createdAt,
        now
      ]
    );

    return {
      id: payload.profile.id,
      path: request.path,
      profile: this.requireProfile(payload.profile.id),
      manifest,
      message: "Local hoster imported."
    };
  }

  async remove(request: LocalHosterRemoveRequest, now = new Date().toISOString()): Promise<LocalHosterMutationResponse> {
    request = localHosterRemoveRequestSchema.parse(request);
    const profile = this.requireProfile(request.id);
    this.connection.run(
      "UPDATE local_hoster_profiles SET deleted_at = ?, updated_at = ? WHERE id = ?;",
      [now, now, request.id]
    );
    await this.secretStore.delete(secretKey(request.id));

    return {
      id: request.id,
      profile,
      message: "Local hoster removed."
    };
  }

  async test(request: LocalHosterTestRequest): Promise<LocalHosterMutationResponse> {
    request = localHosterTestRequestSchema.parse(request);
    const profile = request.id ? this.requireProfile(request.id) : this.listProfiles()[0];
    if (!profile) {
      throw validationFailure("Create a local hoster before testing signal encryption.");
    }
    const secret = await this.requireSecret(profile.id);
    const message = {
      hosterId: profile.id,
      privatePayload: request.privatePayload === true,
      nonce: randomUUID()
    };
    const envelope = encryptSignalEnvelope(message, secret.publicKeyDerBase64);
    const decrypted = decryptSignalEnvelope<typeof message>(envelope, secret.privateKeyDerBase64);

    if (decrypted.nonce !== message.nonce) {
      throw validationFailure("Local hoster signal encryption round-trip failed.");
    }

    return {
      id: profile.id,
      profile,
      message: "Local hoster signal encryption round-trip passed."
    };
  }

  async decryptSignal(profileId: string, envelope: unknown): Promise<Record<string, unknown>> {
    const secret = await this.requireSecret(profileId);
    return decryptSignalEnvelope<Record<string, unknown>>(
      envelope as Parameters<typeof decryptSignalEnvelope>[0],
      secret.privateKeyDerBase64
    );
  }

  recordSignalReceipt(
    profileId: string,
    payload: LocalHosterSignalPayload,
    now = new Date()
  ): void {
    const createdAtMs = Date.parse(payload.createdAt);
    if (!Number.isFinite(createdAtMs)) {
      throw validationFailure("Local hoster signal timestamp is invalid.");
    }
    if (createdAtMs < now.getTime() - replayPastWindowMs) {
      throw validationFailure("Local hoster signal timestamp is stale.");
    }
    if (createdAtMs > now.getTime() + replayFutureWindowMs) {
      throw validationFailure("Local hoster signal timestamp is in the future.");
    }

    const parsed = localHosterSignalPayloadSchema.parse(payload);
    const result = this.connection.run(
      `INSERT OR IGNORE INTO local_hoster_signal_receipts (
         profile_id, request_id, created_at, received_at, tool_name
       ) VALUES (?, ?, ?, ?, ?);`,
      [profileId, parsed.requestId, parsed.createdAt, now.toISOString(), parsed.toolName]
    );
    if (result.changes !== 1) {
      throw validationFailure("Local hoster signal request was already processed.");
    }
  }

  private requireProfile(id: string): LocalHosterProfile {
    const row = this.connection.get<LocalHosterRow>(
      `${selectHosterRows()} WHERE id = ? AND deleted_at IS NULL LIMIT 1;`,
      [id]
    );
    if (!row) {
      throw validationFailure("Local hoster profile was not found.");
    }
    return profileFromRow(row);
  }

  private async requireSecret(id: string): Promise<LocalHosterSecret> {
    const value = await this.secretStore.read(secretKey(id));
    if (!value) {
      throw validationFailure("Local hoster key is missing from the OS credential store.");
    }
    return parseSecret(value);
  }
}

function selectHosterRows(): string {
  return `SELECT
           id,
           name,
           capabilities_json AS capabilitiesJson,
           permission_mode AS permissionMode,
           endpoint,
           key_fingerprint AS keyFingerprint,
           created_at AS createdAt,
           updated_at AS updatedAt,
           deleted_at
         FROM local_hoster_profiles`;
}

function profileFromRow(row: LocalHosterRow): LocalHosterProfile {
  return {
    id: row.id,
    name: row.name,
    capabilities: uniqueCapabilities(JSON.parse(row.capabilitiesJson) as LocalHosterCapability[]),
    permissionMode: row.permissionMode,
    endpoint: row.endpoint,
    keyFingerprint: row.keyFingerprint,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function parseSecret(value: string): LocalHosterSecret {
  const parsed = JSON.parse(value) as Partial<LocalHosterSecret>;
  if (
    typeof parsed.packageKeyBase64 !== "string" ||
    typeof parsed.privateKeyDerBase64 !== "string" ||
    typeof parsed.publicKeyDerBase64 !== "string" ||
    typeof parsed.keyFingerprint !== "string"
  ) {
    throw validationFailure("Local hoster key material is invalid.");
  }
  return parsed as LocalHosterSecret;
}

function secretKey(id: string) {
  return {
    service: HOSTER_SECRET_SERVICE,
    account: id
  };
}

function uniqueCapabilities(values: LocalHosterCapability[]): LocalHosterCapability[] {
  const allowed = new Set<LocalHosterCapability>(["host.info", "signal.send", "planner.read", "planner.write"]);
  const unique = [...new Set(values)].filter((value): value is LocalHosterCapability => allowed.has(value));
  return unique.length === 0 ? defaultCapabilities : unique;
}

function normalizedHosterPath(value: string, id: string): string {
  if (value.endsWith(".hcbhost")) {
    return value;
  }
  const safeId = id.replace(/[^A-Za-z0-9_-]/g, "-");
  const name = basename(value);
  if (!name || name === "." || name === "..") {
    return join(dirname(value), `${safeId}.hcbhost`);
  }
  return `${value}.hcbhost`;
}

function assertLoopbackEndpoint(value: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw validationFailure("Local hoster endpoint is invalid.");
  }
  if (parsed.protocol !== "http:" || parsed.hostname !== "127.0.0.1") {
    throw validationFailure("Local hoster endpoint must be http://127.0.0.1:<port>.");
  }
}
