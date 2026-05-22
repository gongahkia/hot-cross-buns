import { Buffer } from "node:buffer";
import type { JsonObject } from "./types";

export const MCP_HTTP_PATH = "/mcp";
export const MCP_MAX_HTTP_HEADER_BYTES = 16 * 1024;
export const MCP_MAX_HTTP_BODY_BYTES = 1024 * 1024;
export const MCP_MAX_HTTP_REQUEST_BYTES =
  MCP_MAX_HTTP_HEADER_BYTES + MCP_MAX_HTTP_BODY_BYTES + 4;

export interface ParsedMcpHttpRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: Buffer;
  totalLength: number;
}

export type McpHttpParseResult =
  | { kind: "complete"; request: ParsedMcpHttpRequest }
  | { kind: "incomplete" }
  | { kind: "malformed" }
  | { kind: "too_large" };

export class McpHttpResponse {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly body: Buffer;

  constructor(status: number, body: Buffer | string = "", headers: Record<string, string> = {}) {
    this.status = status;
    this.body = Buffer.isBuffer(body) ? body : Buffer.from(body, "utf8");
    this.headers = headers;
  }

  static plain(
    status: number,
    body: string,
    headers: Record<string, string> = {}
  ): McpHttpResponse {
    return new McpHttpResponse(status, body, {
      "Content-Type": "text/plain; charset=utf-8",
      ...headers
    });
  }

  static json(status: number, object: JsonObject): McpHttpResponse {
    return new McpHttpResponse(status, JSON.stringify(object), {
      "Content-Type": "application/json"
    });
  }

  static empty(status: number): McpHttpResponse {
    return new McpHttpResponse(status);
  }

  toBuffer(): Buffer {
    const headers: Record<string, string> = {
      "Content-Length": String(this.body.byteLength),
      Connection: "close",
      ...this.headers
    };
    const lines = [`HTTP/1.1 ${this.status} ${reasonPhrase(this.status)}`];

    for (const [key, value] of Object.entries(headers)) {
      lines.push(`${key}: ${value}`);
    }

    lines.push("", "");

    return Buffer.concat([Buffer.from(lines.join("\r\n"), "utf8"), this.body]);
  }
}

export function parseMcpHttpRequest(data: Buffer): McpHttpParseResult {
  if (data.byteLength > MCP_MAX_HTTP_REQUEST_BYTES) {
    return { kind: "too_large" };
  }

  const headerEnd = data.indexOf("\r\n\r\n");

  if (headerEnd === -1) {
    return data.byteLength > MCP_MAX_HTTP_HEADER_BYTES
      ? { kind: "too_large" }
      : { kind: "incomplete" };
  }

  if (headerEnd > MCP_MAX_HTTP_HEADER_BYTES) {
    return { kind: "too_large" };
  }

  const headerText = data.subarray(0, headerEnd).toString("utf8");
  const lines = headerText.split("\r\n");
  const requestLine = lines[0];

  if (!requestLine) {
    return { kind: "malformed" };
  }

  const [method, path, protocol] = requestLine.split(" ");

  if (!method || !path || !protocol || (protocol !== "HTTP/1.1" && protocol !== "HTTP/1.0")) {
    return { kind: "malformed" };
  }

  const headers: Record<string, string> = {};

  for (const line of lines.slice(1)) {
    if (line.length === 0) {
      continue;
    }

    const colon = line.indexOf(":");

    if (colon <= 0) {
      return { kind: "malformed" };
    }

    const name = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();

    if (!name || headers[name] !== undefined) {
      return { kind: "malformed" };
    }

    headers[name] = value;
  }

  const contentLength = parseContentLength(headers["content-length"]);

  if (contentLength === undefined) {
    return { kind: "malformed" };
  }

  if (contentLength > MCP_MAX_HTTP_BODY_BYTES) {
    return { kind: "too_large" };
  }

  const bodyStart = headerEnd + 4;

  if (bodyStart + contentLength > MCP_MAX_HTTP_REQUEST_BYTES) {
    return { kind: "too_large" };
  }

  const totalLength = bodyStart + contentLength;

  if (data.byteLength < totalLength) {
    return { kind: "incomplete" };
  }

  if (data.byteLength !== totalLength) {
    return { kind: "malformed" };
  }

  return {
    kind: "complete",
    request: {
      method: method.toUpperCase(),
      path,
      headers,
      body: data.subarray(bodyStart, totalLength),
      totalLength
    }
  };
}

function parseContentLength(value: string | undefined): number | undefined {
  if (value === undefined || value.length === 0) {
    return 0;
  }

  if (!/^\d+$/.test(value)) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function reasonPhrase(status: number): string {
  switch (status) {
    case 200:
      return "OK";
    case 202:
      return "Accepted";
    case 400:
      return "Bad Request";
    case 401:
      return "Unauthorized";
    case 403:
      return "Forbidden";
    case 404:
      return "Not Found";
    case 405:
      return "Method Not Allowed";
    case 413:
      return "Payload Too Large";
    case 429:
      return "Too Many Requests";
    case 500:
      return "Internal Server Error";
    default:
      return "HTTP";
  }
}
