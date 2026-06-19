import { Buffer } from "node:buffer";
import { createServer, type Server, type Socket } from "node:net";
import {
  localHosterSignalPayloadSchema,
  localHosterSignalRequestSchema,
  type LocalHosterCapability,
  type LocalHosterProfile,
  type LocalHosterSignalPayload
} from "@shared/ipc/contracts";
import { appLogger } from "../diagnostics/appLogger";
import { bearerAuthorizationMatches } from "../mcp/credentials";
import {
  MCP_MAX_HTTP_REQUEST_BYTES,
  McpHttpResponse,
  parseMcpHttpRequest,
  type ParsedMcpHttpRequest
} from "../mcp/http";
import { defaultMcpRateLimit, McpRateLimiter } from "../mcp/rateLimiter";
import type { JsonObject, McpCredentialAdapter, McpPermissionMode, MaybePromise } from "../mcp/types";
import { MCP_READ_TOOL_NAMES, MCP_WRITE_TOOL_NAMES } from "../mcp/toolRegistry";
import type { LocalHosterRepository } from "../data/localRepositories";

export const LOCAL_HOSTER_INFO_PATH = "/hcb/v1/info";
export const LOCAL_HOSTER_SIGNAL_PATH = "/hcb/v1/signal";

export interface LocalHosterServerOptions {
  credentialAdapter: McpCredentialAdapter;
  repository: LocalHosterRepository;
  dispatchSignal?: (request: LocalHosterSignalDispatchRequest) => MaybePromise<JsonObject>;
}

export interface LocalHosterSignalDispatchRequest {
  profileId: string;
  permissionMode: McpPermissionMode;
  payload: LocalHosterSignalPayload;
}

export class LocalHosterServer {
  private readonly rateLimiter = new McpRateLimiter(defaultMcpRateLimit);
  private server: Server | undefined;

  constructor(private readonly options: LocalHosterServerOptions) {}

  async start(port: number): Promise<number> {
    if (this.server) {
      const address = this.server.address();
      if (address && typeof address === "object") {
        return address.port;
      }
    }
    this.server = createServer((socket) => this.handleSocket(socket));
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
      this.server?.listen({ host: "127.0.0.1", port: Math.max(0, Math.min(65535, port)) });
    });
    const address = this.server.address();
    if (!address || typeof address !== "object") {
      throw new Error("Local hoster server did not bind to a TCP port.");
    }
    return address.port;
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

  async handleRawHttpRequest(data: Buffer, remoteAddress?: string): Promise<McpHttpResponse> {
    const parsed = parseMcpHttpRequest(data);
    if (parsed.kind === "too_large") {
      return McpHttpResponse.plain(413, "Payload Too Large");
    }
    if (parsed.kind !== "complete") {
      return McpHttpResponse.plain(400, "Bad Request");
    }
    const request = parsed.request;
    if (request.path !== LOCAL_HOSTER_INFO_PATH && request.path !== LOCAL_HOSTER_SIGNAL_PATH) {
      return McpHttpResponse.plain(404, "Not Found");
    }
    if (!remoteAddressIsLocal(remoteAddress)) {
      return McpHttpResponse.plain(403, "Forbidden");
    }
    if (!this.rateLimiter.allows(remoteAddress ?? "loopback", new Date())) {
      return McpHttpResponse.plain(429, "Too Many Requests", { "Retry-After": "60" });
    }
    if (request.method !== "POST") {
      return McpHttpResponse.plain(405, "Method Not Allowed");
    }
    if (!originIsAllowed(request.headers.origin)) {
      return McpHttpResponse.plain(403, "Forbidden origin");
    }
    const token = await this.options.credentialAdapter.loadBearerToken();
    if (!token || !bearerAuthorizationMatches(request.headers.authorization, token)) {
      return McpHttpResponse.plain(401, "Unauthorized", { "WWW-Authenticate": "Bearer" });
    }
    return this.dispatch(request);
  }

  private async dispatch(request: ParsedMcpHttpRequest): Promise<McpHttpResponse> {
    if (request.path === LOCAL_HOSTER_INFO_PATH) {
      const body = parseJson(request.body) ?? {};
      const profileId = typeof body.profileId === "string" ? body.profileId : undefined;
      const profiles = this.options.repository.listProfiles()
        .filter((profile) => hasCapability(profile, "host.info"))
        .filter((profile) => profileId === undefined || profile.id === profileId);
      if (profileId !== undefined && profiles.length === 0) {
        appLogger.warn("local hoster info denied", "hoster", { profileId, outcome: "capability_denied" });
        return McpHttpResponse.plain(403, "Hoster profile lacks host.info capability.");
      }
      return McpHttpResponse.json(200, {
        kind: "localHosterInfo",
        profiles
      });
    }
    const body = parseJson(request.body);
    if (!body) {
      return McpHttpResponse.plain(400, "Bad Request");
    }
    const signalRequest = localHosterSignalRequestSchema.safeParse(body);
    if (!signalRequest.success) {
      return McpHttpResponse.plain(400, "Invalid signal request.");
    }
    if (signalRequest.data.private === true && !signalRequest.data.envelope) {
      return McpHttpResponse.plain(400, "Private signal payloads require encryption.");
    }
    const profile = this.options.repository.listProfiles().find((item) => item.id === signalRequest.data.profileId);
    if (!profile) {
      return McpHttpResponse.plain(404, "Hoster profile not found.");
    }
    if (!hasCapability(profile, "signal.send")) {
      this.auditSignal(profile.id, undefined, undefined, "capability_denied", 403);
      return McpHttpResponse.plain(403, "Hoster profile lacks signal.send capability.");
    }
    const payload = await this.signalPayload(signalRequest.data, profile.id);
    if (!payload) {
      this.auditSignal(profile.id, undefined, undefined, "invalid", 400);
      return McpHttpResponse.plain(400, "Invalid signal payload.");
    }
    const capabilityDecision = capabilityDecisionForTool(profile, payload.toolName);
    if (capabilityDecision !== "allowed") {
      this.auditSignal(profile.id, payload.requestId, payload.toolName, capabilityDecision, 403);
      return McpHttpResponse.plain(403, signalCapabilityMessage(capabilityDecision));
    }
    try {
      this.options.repository.recordSignalReceipt(profile.id, payload, new Date());
    } catch (error) {
      this.auditSignal(profile.id, payload.requestId, payload.toolName, "replay_rejected", 409);
      return McpHttpResponse.plain(409, error instanceof Error ? error.message : "Signal replay rejected.");
    }
    let result: JsonObject | undefined;
    try {
      result = await this.dispatchSignal(profile.id, profile.permissionMode, payload);
    } catch (error) {
      this.auditSignal(profile.id, payload.requestId, payload.toolName, "dispatch_failed", 400);
      return McpHttpResponse.json(400, {
        kind: "localHosterSignalError",
        profileId: profile.id,
        requestId: payload.requestId,
        message: error instanceof Error ? error.message : "Signal dispatch failed."
      });
    }
    this.auditSignal(profile.id, payload.requestId, payload.toolName, "allowed", 200);

    return McpHttpResponse.json(200, {
      kind: "localHosterSignal",
      profileId: profile.id,
      requestId: payload.requestId,
      payload: jsonObject(payload) ?? {},
      ...(result === undefined ? {} : { result })
    });
  }

  private async signalPayload(
    body: { payload?: unknown; envelope?: unknown },
    profileId: string
  ): Promise<LocalHosterSignalPayload | undefined> {
    let candidate: unknown;
    if (body.envelope) {
      try {
        candidate = await this.options.repository.decryptSignal(profileId, body.envelope);
      } catch {
        return undefined;
      }
    } else {
      candidate = body.payload;
    }

    const parsed = localHosterSignalPayloadSchema.safeParse(candidate);
    return parsed.success ? parsed.data : undefined;
  }

  private async dispatchSignal(
    profileId: string,
    permissionMode: McpPermissionMode,
    payload: LocalHosterSignalPayload
  ): Promise<JsonObject | undefined> {
    if (!this.options.dispatchSignal) {
      return undefined;
    }

    return await this.options.dispatchSignal({
      profileId,
      permissionMode,
      payload
    });
  }

  private auditSignal(
    profileId: string,
    requestId: string | undefined,
    toolName: string | undefined,
    outcome: string,
    status: number
  ): void {
    appLogger.info("local hoster signal", "hoster", {
      profileId,
      ...(requestId === undefined ? {} : { requestId }),
      ...(toolName === undefined ? {} : { toolName }),
      outcome,
      status: String(status)
    });
  }

  private handleSocket(socket: Socket): void {
    let buffer = Buffer.alloc(0);
    const remoteAddress = socket.remoteAddress;
    socket.on("data", (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.byteLength > MCP_MAX_HTTP_REQUEST_BYTES) {
        socket.end(McpHttpResponse.plain(413, "Payload Too Large").toBuffer());
        return;
      }
      const parsed = parseMcpHttpRequest(buffer);
      if (parsed.kind === "incomplete") {
        return;
      }
      void this.handleRawHttpRequest(buffer, remoteAddress).then((response) => {
        socket.end(response.toBuffer());
      }).catch((error) => {
        socket.end(McpHttpResponse.plain(500, error instanceof Error ? error.message : "Internal Server Error").toBuffer());
      });
    });
    socket.on("error", () => socket.destroy());
  }
}

export class LocalHosterServerController {
  private readonly server: LocalHosterServer;
  private runningPort: number | undefined;
  private lastError: string | undefined;

  constructor(options: LocalHosterServerOptions) {
    this.server = new LocalHosterServer(options);
  }

  async applySettings(settings: { localHostersEnabled: boolean; localHosterPort: number }): Promise<void> {
    if (!settings.localHostersEnabled) {
      await this.stop();
      this.lastError = undefined;
      return;
    }
    await this.start(settings.localHosterPort);
  }

  async start(port: number): Promise<void> {
    try {
      this.runningPort = await this.server.start(port);
      this.lastError = undefined;
    } catch (error) {
      this.runningPort = undefined;
      this.lastError = error instanceof Error ? error.message : "Local hoster failed to start.";
    }
  }

  async stop(): Promise<void> {
    await this.server.stop();
    this.runningPort = undefined;
  }

  status(settings: { localHostersEnabled: boolean; localHosterPort: number }) {
    return {
      enabled: settings.localHostersEnabled,
      running: this.runningPort !== undefined,
      port: this.runningPort ?? settings.localHosterPort,
      ...(this.runningPort === undefined ? {} : { url: "http://127.0.0.1" as const }),
      ...(this.lastError === undefined ? {} : { lastError: this.lastError })
    };
  }

  endpoint(): string {
    const port = this.runningPort ?? 0;
    return `http://127.0.0.1:${port}/hcb/v1/signal`;
  }

  async dispose(): Promise<void> {
    await this.stop();
  }
}

function parseJson(body: Buffer): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(body.toString("utf8")) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

function jsonObject(value: unknown): JsonObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? JSON.parse(JSON.stringify(value)) as JsonObject
    : undefined;
}

function originIsAllowed(origin: string | undefined): boolean {
  return origin === undefined || origin.trim().length === 0;
}

const deniedHosterTools = new Set([
  "hcb_doctor",
  "hcb_log",
  "hcb_tail",
  "hcb_settings_update",
  "hcb_google_save_oauth_client",
  "hcb_google_begin_oauth",
  "hcb_mcp_set_enabled",
  "hcb_hoster_status",
  "hcb_hoster_create",
  "hcb_hoster_export",
  "hcb_hoster_import",
  "hcb_hoster_remove",
  "hcb_hoster_test"
]);

function capabilityDecisionForTool(
  profile: LocalHosterProfile,
  toolName: string
): "allowed" | "tool_denied" | "read_capability_denied" | "write_capability_denied" | "unknown_tool" {
  if (deniedHosterTools.has(toolName)) {
    return "tool_denied";
  }
  if (MCP_READ_TOOL_NAMES.has(toolName)) {
    return hasCapability(profile, "planner.read") ? "allowed" : "read_capability_denied";
  }
  if (MCP_WRITE_TOOL_NAMES.has(toolName)) {
    return hasCapability(profile, "planner.write") ? "allowed" : "write_capability_denied";
  }

  return "unknown_tool";
}

function signalCapabilityMessage(decision: ReturnType<typeof capabilityDecisionForTool>): string {
  switch (decision) {
    case "tool_denied":
      return "Hoster dispatch cannot call admin or security tools.";
    case "read_capability_denied":
      return "Hoster profile lacks planner.read capability.";
    case "write_capability_denied":
      return "Hoster profile lacks planner.write capability.";
    case "unknown_tool":
      return "Unknown hoster signal tool.";
    case "allowed":
      return "Allowed.";
  }
}

function hasCapability(profile: LocalHosterProfile, capability: LocalHosterCapability): boolean {
  return profile.capabilities.includes(capability);
}

function remoteAddressIsLocal(remoteAddress: string | undefined): boolean {
  return (
    !remoteAddress ||
    remoteAddress === "127.0.0.1" ||
    remoteAddress === "::1" ||
    remoteAddress === "::ffff:127.0.0.1" ||
    remoteAddress.toLowerCase() === "localhost"
  );
}
