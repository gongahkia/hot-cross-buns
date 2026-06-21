import { createHash, randomBytes } from "node:crypto";
import type { McpCredentialAdapter } from "./types";

export class StaticMcpCredentialAdapter implements McpCredentialAdapter {
  private token: string;
  private revision: string;

  constructor(token = generateMcpBearerToken(), revision = "static") {
    this.token = token;
    this.revision = revision;
  }

  loadBearerToken(): string {
    return this.token;
  }

  credentialRevision(): string {
    return this.revision;
  }

  reset(token = generateMcpBearerToken()): string {
    this.token = token;
    this.revision = createCredentialFingerprint(token);
    return this.token;
  }
}

export function generateMcpBearerToken(): string {
  return randomBytes(32).toString("base64url");
}

export function createCredentialFingerprint(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function constantTimeEquals(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  const length = Math.max(leftBytes.length, rightBytes.length);
  let difference = leftBytes.length ^ rightBytes.length;

  for (let index = 0; index < length; index += 1) {
    const leftByte = index < leftBytes.length ? leftBytes[index] : 0;
    const rightByte = index < rightBytes.length ? rightBytes[index] : 0;
    difference |= leftByte ^ rightByte;
  }

  return difference === 0;
}

export function bearerAuthorizationMatches(headerValue: string | undefined, token: string): boolean {
  const prefix = "Bearer ";

  if (!headerValue?.startsWith(prefix)) {
    return false;
  }

  return constantTimeEquals(headerValue.slice(prefix.length), token);
}
