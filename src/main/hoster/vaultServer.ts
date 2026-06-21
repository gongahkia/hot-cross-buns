import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { basename, dirname, join } from "node:path";
import {
  hcbVaultManifestSchema,
  HCB_VAULT_FORMAT_VERSION,
  HCB_VAULT_PAYLOAD_FILE,
  type HcbVaultManifest
} from "@shared/ipc/contracts";
import { constantTimeEquals } from "../mcp/credentials";

export const HCB_VAULT_HOST_INFO_PATH = "/hcb/v1/vault/info";
export const HCB_VAULT_HOST_PACKAGE_PATH = "/hcb/v1/vault";
export const HCB_VAULT_HOST_PROTOCOL_VERSION = 1;
const DEFAULT_MAX_VAULT_PACKAGE_BYTES = 128 * 1024 * 1024;

export interface HcbVaultPackage {
  manifest: HcbVaultManifest;
  payloadText: string;
}

export interface HcbVaultHostPackageTransport {
  kind: "hcbVaultPackage";
  protocolVersion: typeof HCB_VAULT_HOST_PROTOCOL_VERSION;
  manifest: HcbVaultManifest;
  payloadBase64: string;
}

export interface HcbVaultHostInfo {
  kind: "hcbVaultHostInfo";
  protocolVersion: typeof HCB_VAULT_HOST_PROTOCOL_VERSION;
  hcbVaultFormatVersions: [typeof HCB_VAULT_FORMAT_VERSION];
  routes: [typeof HCB_VAULT_HOST_INFO_PATH, typeof HCB_VAULT_HOST_PACKAGE_PATH];
  hasVault: boolean;
  vaultName: string;
  maxPackageBytes: number;
  packageSha256?: string;
  manifest?: HcbVaultManifest;
}

export interface HcbVaultHostServerOptions {
  vaultPath: string;
  token: string;
  maxPackageBytes?: number;
}

export interface HcbVaultHostStartOptions {
  host?: string;
  port?: number;
  tlsCertPath?: string;
  tlsKeyPath?: string;
}

export class HcbVaultHostServer {
  private server: Server | undefined;
  private readonly maxPackageBytes: number;

  constructor(private readonly options: HcbVaultHostServerOptions) {
    this.maxPackageBytes = clampMaxBytes(options.maxPackageBytes);
  }

  async start(options: HcbVaultHostStartOptions = {}): Promise<{ host: string; port: number; protocol: "http" | "https" }> {
    if (this.server) {
      const address = this.server.address();
      if (address && typeof address === "object") {
        return {
          host: options.host ?? "127.0.0.1",
          port: address.port,
          protocol: options.tlsCertPath && options.tlsKeyPath ? "https" : "http"
        };
      }
    }

    const protocol = options.tlsCertPath && options.tlsKeyPath ? "https" : "http";
    this.server = protocol === "https"
      ? createHttpsServer({
          cert: readFileSync(options.tlsCertPath ?? ""),
          key: readFileSync(options.tlsKeyPath ?? "")
        }, (request, response) => void this.handle(request, response))
      : createHttpServer((request, response) => void this.handle(request, response));

    const host = options.host ?? "127.0.0.1";
    const port = clampPort(options.port ?? 7420);
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        this.server?.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        this.server?.off("error", onError);
        resolve();
      };
      this.server?.once("error", onError);
      this.server?.once("listening", onListening);
      this.server?.listen({ host, port });
    });

    const address = this.server.address();
    if (!address || typeof address !== "object") {
      throw new Error("HCB vault host did not bind to a TCP port.");
    }

    return { host, port: address.port, protocol };
  }

  async stop(): Promise<void> {
    const active = this.server;
    this.server = undefined;
    if (!active || !active.listening) {
      return;
    }
    await new Promise<void>((resolve, reject) => {
      active.close((error) => error ? reject(error) : resolve());
    });
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      const url = new URL(request.url ?? "/", "http://hcb.local");
      if (url.pathname !== HCB_VAULT_HOST_INFO_PATH && url.pathname !== HCB_VAULT_HOST_PACKAGE_PATH) {
        writeJson(response, 404, { kind: "error", message: "Not Found" });
        return;
      }
      if (!this.authorized(request)) {
        response.setHeader("WWW-Authenticate", "Bearer");
        writeJson(response, 401, { kind: "error", message: "Unauthorized" });
        return;
      }
      if (url.pathname === HCB_VAULT_HOST_INFO_PATH) {
        if (request.method !== "GET") {
          writeJson(response, 405, { kind: "error", message: "Method Not Allowed" });
          return;
        }
        writeJson(response, 200, this.info());
        return;
      }
      if (request.method === "GET") {
        const vault = readHcbVaultPackage(this.options.vaultPath);
        writeJson(response, 200, vaultPackageToTransport(vault));
        return;
      }
      if (request.method === "PUT" || request.method === "POST") {
        this.assertWritePrecondition(request);
        const body = await readRequestBody(request, this.maxPackageBytes);
        const transport = parseVaultTransport(JSON.parse(body.toString("utf8")));
        writeHcbVaultPackage(this.options.vaultPath, transportPackage(transport));
        writeJson(response, 200, {
          kind: "hcbVaultHostWrite",
          protocolVersion: HCB_VAULT_HOST_PROTOCOL_VERSION,
          path: this.options.vaultPath,
          manifest: transport.manifest
        });
        return;
      }
      writeJson(response, 405, { kind: "error", message: "Method Not Allowed" });
    } catch (error) {
      const status = error instanceof VaultHostHttpError ? error.status : 400;
      writeJson(response, status, {
        kind: "error",
        message: error instanceof Error ? error.message : "HCB vault host request failed."
      });
    }
  }

  private authorized(request: IncomingMessage): boolean {
    const header = request.headers.authorization;
    const value = Array.isArray(header) ? header[0] : header;
    const prefix = "Bearer ";
    return Boolean(value?.startsWith(prefix)) &&
      constantTimeEquals(value.slice(prefix.length), this.options.token);
  }

  private info(): HcbVaultHostInfo {
    const vault = safeReadHcbVaultPackage(this.options.vaultPath);
    return {
      kind: "hcbVaultHostInfo",
      protocolVersion: HCB_VAULT_HOST_PROTOCOL_VERSION,
      hcbVaultFormatVersions: [HCB_VAULT_FORMAT_VERSION],
      routes: [HCB_VAULT_HOST_INFO_PATH, HCB_VAULT_HOST_PACKAGE_PATH],
      hasVault: vault !== undefined,
      vaultName: basename(this.options.vaultPath),
      maxPackageBytes: this.maxPackageBytes,
      ...(vault === undefined
        ? {}
        : {
            packageSha256: hcbVaultPackageSha256(vault),
            manifest: vault.manifest
          })
    };
  }

  private assertWritePrecondition(request: IncomingMessage): void {
    const expected = ifMatchSha256(request);
    if (expected === undefined) {
      return;
    }

    const current = safeReadHcbVaultPackage(this.options.vaultPath);
    if (!current || hcbVaultPackageSha256(current) !== expected) {
      throw new VaultHostHttpError(412, "HCB vault host package precondition failed.");
    }
  }
}

export function readHcbVaultPackage(vaultPath: string): HcbVaultPackage {
  const manifestPath = join(vaultPath, "manifest.json");
  const payloadPath = join(vaultPath, HCB_VAULT_PAYLOAD_FILE);
  if (!existsSync(manifestPath) || !existsSync(payloadPath)) {
    throw new Error("HCB vault package must contain manifest.json and payload.hcbenc.");
  }
  const manifest = hcbVaultManifestSchema.parse(JSON.parse(readFileSync(manifestPath, "utf8")));
  const payloadText = readFileSync(join(vaultPath, manifest.payloadFile), "utf8");
  validateVaultPayload(manifest, payloadText);
  return { manifest, payloadText };
}

export function writeHcbVaultPackage(vaultPath: string, value: HcbVaultPackage): void {
  validateVaultPayload(value.manifest, value.payloadText);
  const parent = dirname(vaultPath);
  const staging = join(parent, `.${basename(vaultPath)}.${Date.now()}.tmp`);
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  writeFileSync(join(staging, "manifest.json"), `${stableJson(value.manifest)}\n`, "utf8");
  writeFileSync(join(staging, value.manifest.payloadFile), value.payloadText, { encoding: "utf8", mode: 0o600 });
  rmSync(vaultPath, { recursive: true, force: true });
  renameSync(staging, vaultPath);
}

export function hcbVaultPackageSha256(value: HcbVaultPackage): string {
  return sha256Buffer(Buffer.from(`${stableJson(value.manifest)}\n${value.payloadText}`, "utf8"));
}

export function vaultPackageToTransport(value: HcbVaultPackage): HcbVaultHostPackageTransport {
  return {
    kind: "hcbVaultPackage",
    protocolVersion: HCB_VAULT_HOST_PROTOCOL_VERSION,
    manifest: value.manifest,
    payloadBase64: Buffer.from(value.payloadText, "utf8").toString("base64")
  };
}

export function transportPackage(value: HcbVaultHostPackageTransport): HcbVaultPackage {
  const payloadText = Buffer.from(value.payloadBase64, "base64").toString("utf8");
  validateVaultPayload(value.manifest, payloadText);
  return { manifest: value.manifest, payloadText };
}

export async function fetchHcbVaultHostInfo(
  endpoint: string,
  token: string,
  input: { fetch?: typeof fetch; allowInsecureHttp?: boolean } = {}
): Promise<HcbVaultHostInfo> {
  const url = vaultHostUrl(endpoint, HCB_VAULT_HOST_INFO_PATH, input.allowInsecureHttp === true);
  const response = await (input.fetch ?? fetch)(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` }
  });
  const body = await response.json() as unknown;
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`HCB vault host status failed with HTTP ${response.status}: ${jsonMessage(body)}`);
  }
  return parseVaultInfo(body);
}

export async function uploadHcbVaultPackage(
  endpoint: string,
  token: string,
  vaultPath: string,
  input: { fetch?: typeof fetch; allowInsecureHttp?: boolean; expectedPackageSha256?: string } = {}
): Promise<HcbVaultHostInfo> {
  const url = vaultHostUrl(endpoint, HCB_VAULT_HOST_PACKAGE_PATH, input.allowInsecureHttp === true);
  const transport = vaultPackageToTransport(readHcbVaultPackage(vaultPath));
  const response = await (input.fetch ?? fetch)(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(input.expectedPackageSha256 === undefined ? {} : { "If-Match": `"${input.expectedPackageSha256}"` })
    },
    body: JSON.stringify(transport)
  });
  if (response.status < 200 || response.status >= 300) {
    const body = await response.text();
    throw new Error(`HCB vault host upload failed with HTTP ${response.status}: ${body}`);
  }
  return fetchHcbVaultHostInfo(endpoint, token, input);
}

export async function downloadHcbVaultPackage(
  endpoint: string,
  token: string,
  outPath: string,
  input: { fetch?: typeof fetch; allowInsecureHttp?: boolean } = {}
): Promise<HcbVaultPackage> {
  const url = vaultHostUrl(endpoint, HCB_VAULT_HOST_PACKAGE_PATH, input.allowInsecureHttp === true);
  const response = await (input.fetch ?? fetch)(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` }
  });
  const body = await response.json() as unknown;
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`HCB vault host download failed with HTTP ${response.status}: ${jsonMessage(body)}`);
  }
  const transport = parseVaultTransport(body);
  const pkg = transportPackage(transport);
  writeHcbVaultPackage(outPath, pkg);
  return pkg;
}

export function vaultHostUrl(endpoint: string, path: string, allowInsecureHttp = false): string {
  const url = new URL(endpoint);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && (isLoopbackHost(url.hostname) || allowInsecureHttp))) {
    throw new Error("HCB vault host endpoint must use HTTPS unless it is loopback. Use --allow-insecure-http only for trusted LAN tunnels.");
  }
  url.pathname = path;
  url.search = "";
  url.hash = "";
  return url.toString();
}

function safeReadHcbVaultPackage(vaultPath: string): HcbVaultPackage | undefined {
  try {
    return readHcbVaultPackage(vaultPath);
  } catch {
    return undefined;
  }
}

function parseVaultInfo(value: unknown): HcbVaultHostInfo {
  const object = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  if (
    object.kind !== "hcbVaultHostInfo" ||
    object.protocolVersion !== HCB_VAULT_HOST_PROTOCOL_VERSION ||
    typeof object.hasVault !== "boolean" ||
    typeof object.vaultName !== "string" ||
    typeof object.maxPackageBytes !== "number"
  ) {
    throw new Error("HCB vault host info is malformed.");
  }
  return {
    kind: "hcbVaultHostInfo",
    protocolVersion: HCB_VAULT_HOST_PROTOCOL_VERSION,
    hcbVaultFormatVersions: [HCB_VAULT_FORMAT_VERSION],
    routes: [HCB_VAULT_HOST_INFO_PATH, HCB_VAULT_HOST_PACKAGE_PATH],
    hasVault: object.hasVault,
    vaultName: object.vaultName,
    maxPackageBytes: object.maxPackageBytes,
    ...(typeof object.packageSha256 === "string" ? { packageSha256: object.packageSha256 } : {}),
    ...(object.manifest === undefined
      ? {}
      : { manifest: hcbVaultManifestSchema.parse(object.manifest) })
  };
}

function parseVaultTransport(value: unknown): HcbVaultHostPackageTransport {
  const object = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  if (
    object.kind !== "hcbVaultPackage" ||
    object.protocolVersion !== HCB_VAULT_HOST_PROTOCOL_VERSION ||
    typeof object.payloadBase64 !== "string"
  ) {
    throw new Error("HCB vault host package is malformed.");
  }
  return {
    kind: "hcbVaultPackage",
    protocolVersion: HCB_VAULT_HOST_PROTOCOL_VERSION,
    manifest: hcbVaultManifestSchema.parse(object.manifest),
    payloadBase64: object.payloadBase64
  };
}

function validateVaultPayload(manifest: HcbVaultManifest, payloadText: string): void {
  if (manifest.payloadFile !== HCB_VAULT_PAYLOAD_FILE) {
    throw new Error("HCB vault payload file is unsupported.");
  }
  if (sha256Buffer(Buffer.from(payloadText, "utf8")) !== manifest.payloadSha256) {
    throw new Error("HCB vault payload checksum mismatch.");
  }
}

function ifMatchSha256(request: IncomingMessage): string | undefined {
  const raw = request.headers["if-match"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim().replace(/^"|"$/g, "");
  if (!/^[0-9a-f]{64}$/i.test(trimmed)) {
    throw new VaultHostHttpError(400, "HCB vault host If-Match header is malformed.");
  }
  return trimmed.toLowerCase();
}

async function readRequestBody(request: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.byteLength;
    if (total > maxBytes) {
      throw new VaultHostHttpError(413, "Payload Too Large");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function writeJson(response: ServerResponse, status: number, body: unknown): void {
  const text = `${JSON.stringify(body)}\n`;
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Content-Length", Buffer.byteLength(text));
  response.end(text);
}

function sha256Buffer(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortJson(value), null, 2);
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, sortJson(entry)])
    );
  }
  return value;
}

function jsonMessage(value: unknown): string {
  const object = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
  return typeof object?.message === "string" ? object.message : JSON.stringify(value);
}

function clampPort(port: number): number {
  return Math.max(0, Math.min(65535, Math.trunc(port)));
}

function clampMaxBytes(value: number | undefined): number {
  const parsed = value ?? DEFAULT_MAX_VAULT_PACKAGE_BYTES;
  return Math.max(1024, Math.min(1024 * 1024 * 1024, Math.trunc(parsed)));
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "::1" || hostname === "localhost";
}

class VaultHostHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}
