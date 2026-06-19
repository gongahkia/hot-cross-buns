import { Buffer } from "node:buffer";
import { createServer, type Server, type Socket } from "node:net";
import { bearerAuthorizationMatches } from "../mcp/credentials";
import {
  MCP_MAX_HTTP_REQUEST_BYTES,
  McpHttpResponse,
  parseMcpHttpRequest,
  type ParsedMcpHttpRequest
} from "../mcp/http";
import { defaultMcpRateLimit, McpRateLimiter } from "../mcp/rateLimiter";
import type { McpCredentialAdapter } from "../mcp/types";
import type { LocalHosterRepository } from "../data/localRepositories";

export const LOCAL_HOSTER_INFO_PATH = "/hcb/v1/info";
export const LOCAL_HOSTER_SIGNAL_PATH = "/hcb/v1/signal";

export interface LocalHosterServerOptions {
  credentialAdapter: McpCredentialAdapter;
  repository: LocalHosterRepository;
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
      return McpHttpResponse.json(200, {
        kind: "localHosterInfo",
        profiles: this.options.repository.listProfiles()
      });
    }
    const body = parseJson(request.body);
    if (!body) {
      return McpHttpResponse.plain(400, "Bad Request");
    }
    if (body.private === true && !body.envelope) {
      return McpHttpResponse.plain(400, "Private signal payloads require encryption.");
    }
    if (typeof body.profileId !== "string" || !body.envelope) {
      return McpHttpResponse.plain(400, "Signal requires profileId and envelope.");
    }
    const payload = await this.options.repository.decryptSignal(body.profileId, body.envelope);
    return McpHttpResponse.json(200, {
      kind: "localHosterSignal",
      profileId: body.profileId,
      payload
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

function originIsAllowed(origin: string | undefined): boolean {
  return origin === undefined || origin.trim().length === 0;
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
