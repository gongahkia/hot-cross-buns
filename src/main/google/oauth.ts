import { createHash, randomBytes } from "node:crypto";
import type { GoogleCredentialAdapter } from "./credentials";
import {
  REQUIRED_GOOGLE_SCOPES,
  normalizeGoogleScopes,
  sanitizeGoogleAccountConnectionStatus,
  type GoogleAccountConnectionRecord,
  type GoogleAccountConnectionStatusDto,
  type GoogleStoredTokenSet
} from "./types";

export interface DesktopGoogleOAuthClientConfig {
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
  authorizationEndpoint?: string;
  scopes?: readonly string[];
}

export interface GoogleOAuthExchangeRequest {
  code: string;
  codeVerifier: string;
  redirectUri: string;
  clientId: string;
  clientSecret?: string;
  scopes: readonly string[];
}

export interface GoogleOAuthExchangeResult {
  tokenSet: GoogleStoredTokenSet;
  account: {
    googleAccountId?: string;
    email?: string;
    displayName?: string | null;
    avatarUrl?: string | null;
    locale?: string | null;
    timeZone?: string | null;
  };
  grantedScopes?: readonly string[] | string;
}

export interface GoogleOAuthAuthorizationCodeTransport {
  exchangeAuthorizationCode(request: GoogleOAuthExchangeRequest): Promise<GoogleOAuthExchangeResult>;
}

export interface GoogleOAuthAccountStatusStore {
  saveStatus(status: GoogleAccountConnectionStatusDto): Promise<void>;
  getStatus(accountId: string): Promise<GoogleAccountConnectionStatusDto | null>;
  listStatuses(): Promise<readonly GoogleAccountConnectionStatusDto[]>;
}

export class MemoryGoogleOAuthAccountStatusStore implements GoogleOAuthAccountStatusStore {
  private readonly statusesByAccountId = new Map<string, GoogleAccountConnectionStatusDto>();

  async saveStatus(status: GoogleAccountConnectionStatusDto): Promise<void> {
    this.statusesByAccountId.set(status.accountId, {
      ...status,
      grantedScopes: [...status.grantedScopes],
      missingScopes: [...status.missingScopes]
    });
  }

  async getStatus(accountId: string): Promise<GoogleAccountConnectionStatusDto | null> {
    const status = this.statusesByAccountId.get(accountId);

    return status === undefined
      ? null
      : {
          ...status,
          grantedScopes: [...status.grantedScopes],
          missingScopes: [...status.missingScopes]
        };
  }

  async listStatuses(): Promise<readonly GoogleAccountConnectionStatusDto[]> {
    return [...this.statusesByAccountId.values()].map((status) => ({
      ...status,
      grantedScopes: [...status.grantedScopes],
      missingScopes: [...status.missingScopes]
    }));
  }
}

export interface DesktopGoogleOAuthServiceOptions {
  clientConfig: DesktopGoogleOAuthClientConfig;
  credentialAdapter: GoogleCredentialAdapter;
  authorizationCodeTransport: GoogleOAuthAuthorizationCodeTransport;
  accountStatusStore?: GoogleOAuthAccountStatusStore;
  now?: () => Date;
}

export interface GoogleOAuthAuthorizationRequestDto {
  authorizationUrl: string;
  state: string;
  expiresAt: string;
  scopes: readonly string[];
}

interface PendingOAuthRequest {
  state: string;
  codeVerifier: string;
  expiresAtMs: number;
  scopes: readonly string[];
}

const DEFAULT_AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

export class DesktopGoogleOAuthService {
  private readonly clientConfig: DesktopGoogleOAuthClientConfig;
  private readonly credentialAdapter: GoogleCredentialAdapter;
  private readonly authorizationCodeTransport: GoogleOAuthAuthorizationCodeTransport;
  private readonly accountStatusStore: GoogleOAuthAccountStatusStore;
  private readonly now: () => Date;
  private readonly pendingRequests = new Map<string, PendingOAuthRequest>();

  constructor(options: DesktopGoogleOAuthServiceOptions) {
    this.clientConfig = options.clientConfig;
    this.credentialAdapter = options.credentialAdapter;
    this.authorizationCodeTransport = options.authorizationCodeTransport;
    this.accountStatusStore = options.accountStatusStore ?? new MemoryGoogleOAuthAccountStatusStore();
    this.now = options.now ?? (() => new Date());
  }

  beginAuthorization(): GoogleOAuthAuthorizationRequestDto {
    const state = randomBase64Url(24);
    const codeVerifier = randomBase64Url(64);
    const scopes = this.clientConfig.scopes ?? REQUIRED_GOOGLE_SCOPES;
    const expiresAtMs = this.now().getTime() + OAUTH_STATE_TTL_MS;
    const authorizationUrl = this.authorizationUrl({
      state,
      codeChallenge: pkceChallenge(codeVerifier),
      scopes
    });

    this.pendingRequests.set(state, {
      state,
      codeVerifier,
      expiresAtMs,
      scopes
    });

    return {
      authorizationUrl,
      state,
      expiresAt: new Date(expiresAtMs).toISOString(),
      scopes: [...scopes]
    };
  }

  async completeAuthorization(callback: {
    code: string;
    state: string;
  }): Promise<GoogleAccountConnectionStatusDto> {
    const pending = this.pendingRequests.get(callback.state);

    if (pending === undefined) {
      throw new Error("OAuth state is not recognized");
    }

    this.pendingRequests.delete(callback.state);

    if (pending.expiresAtMs <= this.now().getTime()) {
      throw new Error("OAuth state expired");
    }

    const exchange = await this.authorizationCodeTransport.exchangeAuthorizationCode({
      code: callback.code,
      codeVerifier: pending.codeVerifier,
      redirectUri: this.clientConfig.redirectUri,
      clientId: this.clientConfig.clientId,
      ...(this.clientConfig.clientSecret === undefined
        ? {}
        : { clientSecret: this.clientConfig.clientSecret }),
      scopes: pending.scopes
    });
    const nowIso = this.now().toISOString();
    const grantedScopes = normalizeGoogleScopes(exchange.grantedScopes ?? exchange.tokenSet.scope);
    const accountId = stableGoogleAccountId(exchange.account.googleAccountId, exchange.account.email);

    await this.credentialAdapter.saveTokenSet(accountId, exchange.tokenSet);

    const status = sanitizeGoogleAccountConnectionStatus({
      accountId,
      googleAccountId: exchange.account.googleAccountId,
      email: exchange.account.email,
      displayName: exchange.account.displayName,
      avatarUrl: exchange.account.avatarUrl,
      locale: exchange.account.locale,
      timeZone: exchange.account.timeZone,
      connectionState: "connected",
      grantedScopes,
      lastAuthenticatedAt: nowIso,
      updatedAt: nowIso
    } satisfies GoogleAccountConnectionRecord);

    await this.accountStatusStore.saveStatus(status);

    return status;
  }

  async disconnect(accountId: string): Promise<GoogleAccountConnectionStatusDto> {
    await this.credentialAdapter.deleteTokenSet(accountId);

    const nowIso = this.now().toISOString();
    const prior = await this.accountStatusStore.getStatus(accountId);
    const status = sanitizeGoogleAccountConnectionStatus({
      accountId,
      ...(prior?.googleAccountId === undefined ? {} : { googleAccountId: prior.googleAccountId }),
      ...(prior?.email === undefined ? {} : { email: prior.email }),
      ...(prior?.displayName === undefined ? {} : { displayName: prior.displayName }),
      ...(prior?.avatarUrl === undefined ? {} : { avatarUrl: prior.avatarUrl }),
      ...(prior?.locale === undefined ? {} : { locale: prior.locale }),
      ...(prior?.timeZone === undefined ? {} : { timeZone: prior.timeZone }),
      connectionState: "signed_out",
      grantedScopes: [],
      updatedAt: nowIso
    });

    await this.accountStatusStore.saveStatus(status);

    return status;
  }

  listConnectionStatuses(): Promise<readonly GoogleAccountConnectionStatusDto[]> {
    return this.accountStatusStore.listStatuses();
  }

  private authorizationUrl(request: {
    state: string;
    codeChallenge: string;
    scopes: readonly string[];
  }): string {
    const url = new URL(this.clientConfig.authorizationEndpoint ?? DEFAULT_AUTHORIZATION_ENDPOINT);

    url.searchParams.set("client_id", this.clientConfig.clientId);
    url.searchParams.set("redirect_uri", this.clientConfig.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", request.scopes.join(" "));
    url.searchParams.set("state", request.state);
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
    url.searchParams.set("code_challenge", request.codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");

    return url.toString();
  }
}

function stableGoogleAccountId(googleAccountId: string | undefined, email: string | undefined): string {
  if (googleAccountId !== undefined && googleAccountId.length > 0) {
    return `google:${googleAccountId}`;
  }

  if (email !== undefined && email.length > 0) {
    return `google-email:${email.toLowerCase()}`;
  }

  return `google:${randomBase64Url(16)}`;
}

function pkceChallenge(codeVerifier: string): string {
  return createHash("sha256").update(codeVerifier).digest("base64url");
}

function randomBase64Url(byteLength: number): string {
  return randomBytes(byteLength).toString("base64url");
}
