import type { GoogleStoredTokenSet } from "./types";

export interface GoogleCredentialAdapter {
  saveTokenSet(accountId: string, tokenSet: GoogleStoredTokenSet): Promise<void>;
  readTokenSet(accountId: string): Promise<GoogleStoredTokenSet | null>;
  deleteTokenSet(accountId: string): Promise<void>;
}

export class MemoryGoogleCredentialAdapter implements GoogleCredentialAdapter {
  private readonly tokensByAccountId = new Map<string, GoogleStoredTokenSet>();

  async saveTokenSet(accountId: string, tokenSet: GoogleStoredTokenSet): Promise<void> {
    this.tokensByAccountId.set(accountId, { ...tokenSet });
  }

  async readTokenSet(accountId: string): Promise<GoogleStoredTokenSet | null> {
    const tokenSet = this.tokensByAccountId.get(accountId);

    return tokenSet === undefined ? null : { ...tokenSet };
  }

  async deleteTokenSet(accountId: string): Promise<void> {
    this.tokensByAccountId.delete(accountId);
  }
}

export interface GoogleOAuthRefreshTransport {
  refreshAccessToken(request: {
    clientId: string;
    clientSecret?: string;
    refreshToken: string;
  }): Promise<{
    accessToken: string;
    expiresInSeconds?: number;
    scope?: string;
    tokenType?: string;
  }>;
}

export interface CredentialBackedGoogleAccessTokenProviderOptions {
  clientId: string;
  clientSecret?: string;
  credentialAdapter: GoogleCredentialAdapter;
  refreshTransport?: GoogleOAuthRefreshTransport;
  expirationSkewMs?: number;
  now?: () => Date;
}

export class CredentialBackedGoogleAccessTokenProvider {
  private readonly clientId: string;
  private readonly clientSecret: string | undefined;
  private readonly credentialAdapter: GoogleCredentialAdapter;
  private readonly refreshTransport: GoogleOAuthRefreshTransport | undefined;
  private readonly expirationSkewMs: number;
  private readonly now: () => Date;

  constructor(options: CredentialBackedGoogleAccessTokenProviderOptions) {
    this.clientId = options.clientId;
    this.clientSecret = options.clientSecret;
    this.credentialAdapter = options.credentialAdapter;
    this.refreshTransport = options.refreshTransport;
    this.expirationSkewMs = options.expirationSkewMs ?? 60_000;
    this.now = options.now ?? (() => new Date());
  }

  async accessToken(accountId: string): Promise<string> {
    const tokenSet = await this.credentialAdapter.readTokenSet(accountId);

    if (tokenSet === null) {
      throw new Error("Google account is not authenticated");
    }

    if (!this.needsRefresh(tokenSet)) {
      return tokenSet.accessToken;
    }

    if (tokenSet.refreshToken === undefined || this.refreshTransport === undefined) {
      throw new Error("Google account requires reauthentication");
    }

    const refreshed = await this.refreshTransport.refreshAccessToken({
      clientId: this.clientId,
      ...(this.clientSecret === undefined ? {} : { clientSecret: this.clientSecret }),
      refreshToken: tokenSet.refreshToken
    });
    const nextTokenSet: GoogleStoredTokenSet = {
      ...tokenSet,
      accessToken: refreshed.accessToken,
      ...(refreshed.expiresInSeconds === undefined
        ? {}
        : { expiresAt: new Date(this.now().getTime() + refreshed.expiresInSeconds * 1000).toISOString() }),
      ...(refreshed.scope === undefined ? {} : { scope: refreshed.scope }),
      ...(refreshed.tokenType === undefined ? {} : { tokenType: refreshed.tokenType })
    };

    await this.credentialAdapter.saveTokenSet(accountId, nextTokenSet);

    return nextTokenSet.accessToken;
  }

  private needsRefresh(tokenSet: GoogleStoredTokenSet): boolean {
    if (tokenSet.expiresAt === undefined) {
      return false;
    }

    const expiresAtMs = Date.parse(tokenSet.expiresAt);

    return Number.isFinite(expiresAtMs) && expiresAtMs - this.now().getTime() <= this.expirationSkewMs;
  }
}
