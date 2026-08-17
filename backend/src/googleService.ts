import { createHash } from "node:crypto";

import type { BackendConfig } from "./config.js";
import { ManagedStore, type ManagedIdentity } from "./managedStore.js";

const googleApiOrigin = "https://www.googleapis.com";
const tokenEndpoint = "https://oauth2.googleapis.com/token";
const userInfoEndpoint = "https://openidconnect.googleapis.com/v1/userinfo";

interface CodeExchangeResponse {
  readonly access_token?: string;
  readonly refresh_token?: string;
  readonly expires_in?: number;
  readonly scope?: string;
}

interface UserInfoResponse {
  readonly sub?: string;
  readonly email?: string;
  readonly name?: string;
  readonly picture?: string;
}

interface CachedAccessToken {
  readonly value: string;
  readonly expiresAt: number;
}

export class ManagedAuthorizationError extends Error {
  constructor() {
    super("Google authorization needs to be renewed");
    this.name = "ManagedAuthorizationError";
  }
}

export class ManagedGooglePathError extends Error {
  constructor() {
    super("Unsupported Google API path");
    this.name = "ManagedGooglePathError";
  }
}

export class ManagedGoogleService {
  private readonly accessTokens = new Map<string, CachedAccessToken>();

  constructor(private readonly config: BackendConfig, private readonly store: ManagedStore) {}

  authorizationUrl(state: string, verifier: string, scopes: readonly string[]): string {
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const parameters = new URLSearchParams({
      client_id: this.config.googleClientId,
      redirect_uri: `${this.config.publicOrigin}/api/auth/google/callback`,
      response_type: "code",
      scope: scopes.join(" "),
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      state,
      code_challenge: challenge,
      code_challenge_method: "S256"
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${parameters.toString()}`;
  }

  async exchangeCode(code: string, verifier: string): Promise<{ readonly identity: ManagedIdentity; readonly refreshToken?: string; readonly scopes: readonly string[] }> {
    const body = new URLSearchParams({
      code,
      client_id: this.config.googleClientId,
      client_secret: this.config.googleClientSecret,
      redirect_uri: `${this.config.publicOrigin}/api/auth/google/callback`,
      grant_type: "authorization_code",
      code_verifier: verifier
    });
    const response = await fetch(tokenEndpoint, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
    if (!response.ok) throw new ManagedAuthorizationError();
    const token = await response.json() as CodeExchangeResponse;
    if (!token.access_token) throw new ManagedAuthorizationError();
    const identity = await this.userInfo(token.access_token);
    return {
      identity,
      refreshToken: token.refresh_token,
      scopes: token.scope?.split(" ").filter(Boolean) ?? []
    };
  }

  async accessTokenFor(subject: string): Promise<string> {
    const cached = this.accessTokens.get(subject);
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.value;
    const refreshToken = await this.store.refreshTokenFor(subject);
    if (!refreshToken) throw new ManagedAuthorizationError();
    const body = new URLSearchParams({
      client_id: this.config.googleClientId,
      client_secret: this.config.googleClientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token"
    });
    const response = await fetch(tokenEndpoint, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
    if (!response.ok) throw new ManagedAuthorizationError();
    const token = await response.json() as CodeExchangeResponse;
    if (!token.access_token || !token.expires_in) throw new ManagedAuthorizationError();
    this.accessTokens.set(subject, { value: token.access_token, expiresAt: Date.now() + token.expires_in * 1000 });
    return token.access_token;
  }

  forgetAccessToken(subject: string): void {
    this.accessTokens.delete(subject);
  }

  async proxy(subject: string, path: string, init: RequestInit): Promise<Response> {
    const target = validatedGoogleUrl(path);
    const token = await this.accessTokenFor(subject);
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${token}`);
    const response = await fetch(target, { ...init, headers });
    if (response.status !== 401) return response;

    // A rejected cached token can be slightly stale even before its local expiry.
    // Retry once with a freshly minted access token before requiring a new Google grant.
    this.forgetAccessToken(subject);
    const renewedToken = await this.accessTokenFor(subject);
    headers.set("Authorization", `Bearer ${renewedToken}`);
    const retried = await fetch(target, { ...init, headers });
    if (retried.status === 401) {
      this.forgetAccessToken(subject);
      throw new ManagedAuthorizationError();
    }
    return retried;
  }

  async revoke(refreshToken: string | undefined): Promise<void> {
    if (!refreshToken) return;
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refreshToken)}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" }
    }).catch(() => undefined);
  }

  private async userInfo(accessToken: string): Promise<ManagedIdentity> {
    const response = await fetch(userInfoEndpoint, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!response.ok) throw new ManagedAuthorizationError();
    const body = await response.json() as UserInfoResponse;
    if (!body.sub) throw new ManagedAuthorizationError();
    return { subject: body.sub, email: body.email, name: body.name, picture: body.picture };
  }
}

function validatedGoogleUrl(path: string): string {
  if (!path.startsWith("/") || path.includes("\\") || path.includes("://")) throw new ManagedGooglePathError();
  const target = new URL(path, googleApiOrigin);
  if (target.origin !== googleApiOrigin || !(
    target.pathname.startsWith("/tasks/v1/") ||
    target.pathname.startsWith("/calendar/v3/") ||
    target.pathname === "/drive/v3/files" ||
    target.pathname.startsWith("/drive/v3/files/")
  )) throw new ManagedGooglePathError();
  return target.toString();
}
