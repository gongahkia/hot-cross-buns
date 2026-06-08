import { Buffer } from "node:buffer";
import { createServer, type Server, type Socket } from "node:net";
import { performance } from "node:perf_hooks";
import { argumentKeysDescription, sanitizeAuditText } from "./audit";
import { bearerAuthorizationMatches, createCredentialFingerprint } from "./credentials";
import { jsonRpcErrorCode, McpToolError } from "./errors";
import {
  MCP_HTTP_PATH,
  MCP_MAX_HTTP_REQUEST_BYTES,
  McpHttpResponse,
  parseMcpHttpRequest,
  type ParsedMcpHttpRequest
} from "./http";
import { createMcpMetrics } from "./metrics";
import {
  defaultMcpRateLimit,
  McpRateLimiter,
  type McpRateLimitConfiguration
} from "./rateLimiter";
import { McpToolRegistry } from "./toolRegistry";
import { McpPromptRegistry } from "./promptRegistry";
import { McpResourceRegistry } from "./resourceRegistry";
import type {
  JsonObject,
  JsonValue,
  McpAuditEvent,
  McpAuditOutcome,
  McpAuditRecorder,
  McpCredentialAdapter,
  McpMetricOutcome,
  McpMetricsRecorder,
  McpPermissionMode,
  McpPermissionProvider,
  McpToolResponse
} from "./types";

export interface LocalMcpServerOptions {
  credentialAdapter: McpCredentialAdapter;
  permissionProvider: McpPermissionProvider;
  toolRegistry: McpToolRegistry;
  auditRecorder?: McpAuditRecorder;
  metrics?: McpMetricsRecorder;
  rateLimit?: McpRateLimitConfiguration;
  now?: () => Date;
}

export interface McpRequestClientContext {
  remoteIsLocal?: boolean;
  remoteAddress?: string;
  clientKey?: string;
  clientDescription?: string;
}

interface JsonRpcRequest {
  id?: JsonValue;
  method: string;
  params: Record<string, unknown>;
}

interface RequestTimingContext {
  startedAt: number;
  method: string;
  toolName?: string;
}

export class LocalMcpServer {
  private readonly rateLimiter: McpRateLimiter;
  private readonly metrics: McpMetricsRecorder;
  private readonly now: () => Date;
  private readonly prompts: McpPromptRegistry;
  private readonly resources: McpResourceRegistry;
  private server: Server | undefined;

  constructor(private readonly options: LocalMcpServerOptions) {
    this.rateLimiter = new McpRateLimiter(options.rateLimit ?? defaultMcpRateLimit);
    this.metrics = options.metrics ?? createMcpMetrics();
    this.now = options.now ?? (() => new Date());
    this.prompts = new McpPromptRegistry();
    this.resources = new McpResourceRegistry(options.toolRegistry);
  }

  getMetricsSnapshot() {
    return this.metrics.snapshot();
  }

  async start(port: number): Promise<number> {
    if (this.server) {
      const address = this.server.address();

      if (address && typeof address === "object") {
        return address.port;
      }
    }

    this.server = createServer((socket) => {
      this.handleSocket(socket);
    });

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
      this.server?.listen({
        host: "127.0.0.1",
        port: Math.max(0, Math.min(65535, port))
      });
    });

    const address = this.server.address();

    if (!address || typeof address !== "object") {
      throw new Error("MCP server did not bind to a TCP port.");
    }

    return address.port;
  }

  async stop(): Promise<void> {
    const activeServer = this.server;
    this.server = undefined;
    this.options.toolRegistry.clearConfirmations();

    if (!activeServer || !activeServer.listening) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      activeServer.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }

  async handleRawHttpRequest(
    data: Buffer,
    clientContext: McpRequestClientContext = {}
  ): Promise<McpHttpResponse> {
    const timing: RequestTimingContext = {
      startedAt: performance.now(),
      method: "HTTP"
    };
    const parsed = parseMcpHttpRequest(data);

    if (parsed.kind === "too_large") {
      return this.finish(timing, McpHttpResponse.plain(413, "Payload Too Large"), "rejected");
    }

    if (parsed.kind !== "complete") {
      return this.finish(timing, McpHttpResponse.plain(400, "Bad Request"), "rejected");
    }

    const request = parsed.request;
    const clientDescription = clientDescriptionForRequest(request, clientContext);
    const clientKey =
      clientContext.clientKey ?? clientContext.remoteAddress ?? clientDescription ?? "loopback";

    if (request.path !== MCP_HTTP_PATH) {
      return this.finish(timing, McpHttpResponse.plain(404, "Not Found"), "rejected");
    }

    if (clientContext.remoteIsLocal === false || !remoteAddressIsLocal(clientContext.remoteAddress)) {
      return this.finish(timing, McpHttpResponse.plain(403, "Forbidden"), "rejected");
    }

    const now = this.now();

    if (!this.rateLimiter.allows(clientKey, now)) {
      const response = McpHttpResponse.plain(429, "Too Many Requests", {
        "Retry-After": String(Math.ceil((this.options.rateLimit ?? defaultMcpRateLimit).windowMs / 1000))
      });
      await this.recordRateLimitAudit(clientDescription, now);
      return this.finish(timing, response, "rate_limited");
    }

    if (request.method !== "POST") {
      return this.finish(
        timing,
        McpHttpResponse.plain(
          405,
          "MCP Streamable HTTP GET/SSE is not implemented in Hot Cross Buns 2 v1."
        ),
        "rejected"
      );
    }

    if (!originIsAllowed(request.headers.origin)) {
      return this.finish(timing, McpHttpResponse.plain(403, "Forbidden origin"), "rejected");
    }

    const token = await this.options.credentialAdapter.loadBearerToken();

    if (!token || !bearerAuthorizationMatches(request.headers.authorization, token)) {
      return this.finish(
        timing,
        McpHttpResponse.plain(401, "Unauthorized", { "WWW-Authenticate": "Bearer" }),
        "rejected"
      );
    }

    const credentialRevision =
      (await this.options.credentialAdapter.credentialRevision?.()) ??
      createCredentialFingerprint(token);
    const permissionMode = await this.options.permissionProvider.getMode();

    return this.handleJsonRpcBody(request.body, {
      client: clientDescription,
      credentialRevision,
      permissionMode,
      clientKey,
      timing
    });
  }

  private async handleJsonRpcBody(
    body: Buffer,
    context: {
      client: string;
      clientKey: string;
      credentialRevision: string;
      permissionMode: McpPermissionMode;
      timing: RequestTimingContext;
    }
  ): Promise<McpHttpResponse> {
    const parsed = parseJsonRpcRequest(body);

    if (!parsed) {
      return this.finish(
        context.timing,
        jsonRpcError(null, -32700, "Parse error", 400),
        "rejected"
      );
    }

    context.timing.method = parsed.method;
    context.timing.toolName = toolNameFromRequest(parsed);

    if (parsed.id === undefined) {
      return this.finish(context.timing, McpHttpResponse.empty(202), "success");
    }

    try {
      const result = await this.handleJsonRpcRequest(parsed, context);
      await this.recordWriteAuditIfNeeded({
        request: parsed,
        client: context.client,
        permissionMode: context.permissionMode,
        result,
        error: undefined
      });
      return this.finish(
        context.timing,
        McpHttpResponse.json(200, {
          jsonrpc: "2.0",
          id: parsed.id,
          result: result as unknown as JsonObject
        }),
        "success"
      );
    } catch (error) {
      const toolError =
        error instanceof McpToolError
          ? error
          : new McpToolError("MUTATION_FAILED", "Internal error.");
      await this.recordWriteAuditIfNeeded({
        request: parsed,
        client: context.client,
        permissionMode: context.permissionMode,
        result: undefined,
        error: toolError
      });

      return this.finish(
        context.timing,
        jsonRpcError(
          parsed.id,
          jsonRpcErrorCode(toolError),
          toolError.message,
          200,
          toolError.confirmationId ? { confirmationId: toolError.confirmationId } : undefined
        ),
        "error"
      );
    }
  }

  private async handleJsonRpcRequest(
    request: JsonRpcRequest,
    context: {
      credentialRevision: string;
      clientKey: string;
      permissionMode: McpPermissionMode;
    }
  ): Promise<JsonObject> {
    switch (request.method) {
      case "initialize":
        return {
          protocolVersion: "2025-06-18",
          capabilities: {
            tools: {
              listChanged: false
            },
            resources: {
              listChanged: false
            },
            prompts: {
              listChanged: false
            }
          },
          serverInfo: {
            name: "Hot Cross Buns 2",
            version: "0.0.0"
          },
          instructions:
            "Hot Cross Buns 2 exposes local tasks, notes, calendar events, diagnostics, resources, prompts, and CLI-like tools. Start diagnostics with hcb_doctor or hcb://doctor. Debug reads: hcb_status, hcb_log, hcb_tail, hcb_diff, hcb_pending_mutations, and hcb_show. Planning reads: hcb_search, hcb_today, hcb_week, hcb_brief, and hcb_plan. Queue controls: hcb_sync_now, hcb_retry_mutation, hcb_cancel_mutation. Writes obey the user's MCP permission mode."
        };
      case "tools/list":
        return {
          tools: this.options.toolRegistry.listTools() as unknown as JsonValue
        };
      case "resources/list":
        return {
          resources: this.resources.listResources() as unknown as JsonValue
        };
      case "resources/templates/list":
        return {
          resourceTemplates: this.resources.listResourceTemplates() as unknown as JsonValue
        };
      case "resources/read": {
        const uri = stringParam(request.params, "uri");
        return await this.resources.readResource(uri, {
          permissionMode: "read-only",
          credentialRevision: context.credentialRevision,
          clientKey: context.clientKey,
          now: this.now()
        });
      }
      case "prompts/list":
        return {
          prompts: this.prompts.listPrompts() as unknown as JsonValue
        };
      case "prompts/get": {
        const name = stringParam(request.params, "name");
        const argumentsObject = objectParam(request.params, "arguments", {});
        return this.prompts.getPrompt(name, argumentsObject as JsonObject);
      }
      case "tools/call": {
        const name = stringParam(request.params, "name");
        const argumentsObject = objectParam(request.params, "arguments", {});
        const structured = await this.options.toolRegistry.callTool(name, argumentsObject, {
          permissionMode: context.permissionMode,
          credentialRevision: context.credentialRevision,
          clientKey: context.clientKey,
          now: this.now()
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(structured)
            }
          ],
          structuredContent: structured as unknown as JsonValue,
          isError: false
        };
      }
      default:
        throw new McpToolError("UNKNOWN_TOOL", "Unknown JSON-RPC method.");
    }
  }

  private async recordWriteAuditIfNeeded(input: {
    request: JsonRpcRequest;
    client: string;
    permissionMode: McpPermissionMode;
    result?: JsonObject;
    error?: McpToolError;
  }): Promise<void> {
    const toolName = toolNameFromRequest(input.request);

    if (!toolName || !this.options.toolRegistry.isWriteTool(toolName)) {
      return;
    }

    const argumentsObject = safeArgumentsObject(input.request.params);
    const structured = input.result?.structuredContent as McpToolResponse | undefined;
    const outcome = auditOutcome(structured, input.error);
    const metadata: Record<string, string> = {
      client: sanitizeAuditText(input.client),
      method: input.request.method,
      tool: toolName,
      outcome,
      permissionMode: input.permissionMode,
      argumentKeys: argumentKeysDescription(argumentsObject),
      dryRunRequested: String(argumentsObject.dryRun === true),
      confirmationSupplied: String(typeof argumentsObject.confirmationId === "string")
    };

    if (structured) {
      metadata.applied = String(structured.applied);
      metadata.dryRun = String(structured.dryRun);
      metadata.requiresConfirmation = String(structured.requiresConfirmation);
      metadata.confirmationIssued = String(Boolean(structured.confirmationId));
    }

    if (input.error) {
      metadata.errorCode = input.error.code;
    }

    await this.options.auditRecorder?.record({
      timestamp: this.now().toISOString(),
      client: sanitizeAuditText(input.client),
      method: input.request.method,
      toolName,
      outcome,
      isWrite: true,
      metadata
    });
  }

  private async recordRateLimitAudit(client: string, now: Date): Promise<void> {
    await this.options.auditRecorder?.record({
      timestamp: now.toISOString(),
      client: sanitizeAuditText(client),
      method: "HTTP",
      outcome: "rate_limited",
      isWrite: false,
      metadata: {
        client: sanitizeAuditText(client),
        outcome: "rate_limited"
      }
    });
  }

  private finish(
    timing: RequestTimingContext,
    response: McpHttpResponse,
    outcome: McpMetricOutcome
  ): McpHttpResponse {
    this.metrics.record({
      method: timing.method,
      ...(timing.toolName === undefined ? {} : { toolName: timing.toolName }),
      status: response.status,
      outcome,
      durationMs: Math.max(0, Math.round((performance.now() - timing.startedAt) * 100) / 100)
    });

    return response;
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

      if (parsed.kind === "too_large") {
        socket.end(McpHttpResponse.plain(413, "Payload Too Large").toBuffer());
        return;
      }

      if (parsed.kind === "malformed") {
        socket.end(McpHttpResponse.plain(400, "Bad Request").toBuffer());
        return;
      }

      void this.handleRawHttpRequest(buffer, {
        remoteAddress,
        remoteIsLocal: remoteAddressIsLocal(remoteAddress),
        clientKey: remoteAddress ?? "loopback"
      }).then((response) => {
        socket.end(response.toBuffer());
      });
    });

    socket.on("error", () => {
      socket.destroy();
    });
  }
}

function parseJsonRpcRequest(body: Buffer): JsonRpcRequest | undefined {
  let parsed: unknown;

  try {
    parsed = JSON.parse(body.toString("utf8"));
  } catch {
    return undefined;
  }

  if (!isPlainObject(parsed) || parsed.jsonrpc !== "2.0" || typeof parsed.method !== "string") {
    return undefined;
  }

  return {
    id: parsed.id as JsonValue | undefined,
    method: parsed.method,
    params: isPlainObject(parsed.params) ? parsed.params : {}
  };
}

function jsonRpcError(
  id: JsonValue | null | undefined,
  code: number,
  message: string,
  status: number,
  data?: JsonObject
): McpHttpResponse {
  return McpHttpResponse.json(status, {
    jsonrpc: "2.0",
    id: id ?? null,
    error: {
      code,
      message,
      ...(data === undefined ? {} : { data })
    }
  });
}

function toolNameFromRequest(request: JsonRpcRequest): string | undefined {
  if (request.method !== "tools/call") {
    return undefined;
  }

  return typeof request.params.name === "string" ? request.params.name : undefined;
}

function auditOutcome(
  structured: McpToolResponse | undefined,
  error: McpToolError | undefined
): McpAuditOutcome {
  if (error) {
    switch (error.code) {
      case "PERMISSION_DENIED":
        return "denied";
      case "CONFIRMATION_REQUIRED":
        return "confirmation_required";
      case "MUTATION_FAILED":
        return "failed";
      case "UNKNOWN_TOOL":
      case "INVALID_ARGUMENTS":
      case "CONFIRMATION_MISMATCH":
      case "NOT_FOUND":
        return "invalid";
    }
  }

  if (structured?.dryRun) {
    return "dry_run";
  }

  if (structured?.applied) {
    return "applied";
  }

  return "succeeded";
}

function stringParam(params: Record<string, unknown>, key: string): string {
  const value = params[key];

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new McpToolError("INVALID_ARGUMENTS", `tools/call requires '${key}'.`);
  }

  return value.trim();
}

function objectParam(
  params: Record<string, unknown>,
  key: string,
  fallback: Record<string, unknown>
): Record<string, unknown> {
  const value = params[key];

  if (value === undefined) {
    return fallback;
  }

  if (!isPlainObject(value)) {
    throw new McpToolError("INVALID_ARGUMENTS", `'${key}' must be an object.`);
  }

  return value;
}

function safeArgumentsObject(params: Record<string, unknown>): Record<string, unknown> {
  const value = params.arguments;
  return isPlainObject(value) ? value : {};
}

function originIsAllowed(origin: string | undefined): boolean {
  return origin === undefined || origin.trim().length === 0;
}

function clientDescriptionForRequest(
  request: ParsedMcpHttpRequest,
  clientContext: McpRequestClientContext
): string {
  const userAgent = request.headers["user-agent"];
  const origin = request.headers.origin;

  if (clientContext.clientDescription) {
    return sanitizeAuditText(clientContext.clientDescription);
  }

  if (userAgent && origin) {
    return sanitizeAuditText(`${userAgent} @ ${origin}`);
  }

  if (userAgent) {
    return sanitizeAuditText(userAgent);
  }

  return sanitizeAuditText(clientContext.remoteAddress ?? "Local client");
}

function remoteAddressIsLocal(remoteAddress: string | undefined): boolean {
  if (!remoteAddress) {
    return true;
  }

  return (
    remoteAddress === "127.0.0.1" ||
    remoteAddress === "::1" ||
    remoteAddress === "::ffff:127.0.0.1" ||
    remoteAddress.toLowerCase() === "localhost"
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
