import type { GoogleAccessTokenProvider } from "./transport";
import type { GoogleCredentialAdapter, GoogleOAuthRefreshTransport } from "./credentials";
import type { GoogleOAuthClientConfigStore } from "./runtimeConfig";
import type { GoogleStoredTokenSet } from "./types";

export interface RuntimeGoogleAccessTokenProviderOptions {
  credentialAdapter: GoogleCredentialAdapter;
  configStore: GoogleOAuthClientConfigStore;
  refreshTransport: GoogleOAuthRefreshTransport;
  expirationSkewMs?: number;
  now?: () => Date;
}

export class RuntimeGoogleAccessTokenProvider implements GoogleAccessTokenProvider {
  private readonly expirationSkewMs: number;
  private readonly now: () => Date;

  constructor(private readonly options: RuntimeGoogleAccessTokenProviderOptions) {
    this.expirationSkewMs = options.expirationSkewMs ?? 60_000;
    this.now = options.now ?? (() => new Date());
  }

  async accessToken(accountId: string): Promise<string> {
    const tokenSet = await this.options.credentialAdapter.readTokenSet(accountId);

    if (tokenSet === null) {
      throw new Error("Google account is not authenticated.");
    }

    if (!this.needsRefresh(tokenSet)) {
      return tokenSet.accessToken;
    }

    if (!tokenSet.refreshToken) {
      throw new Error("Google account requires reauthentication.");
    }

    const clientConfig = await this.options.configStore.oauthConfig("http://127.0.0.1/oauth/google/callback");

    if (clientConfig === null) {
      throw new Error("Google OAuth client configuration is missing.");
    }

    const refreshed = await this.options.refreshTransport.refreshAccessToken({
      clientId: clientConfig.clientId,
      ...(clientConfig.clientSecret === undefined ? {} : { clientSecret: clientConfig.clientSecret }),
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

    await this.options.credentialAdapter.saveTokenSet(accountId, nextTokenSet);

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
