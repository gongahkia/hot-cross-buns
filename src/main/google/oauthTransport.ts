import { redactErrorMessage } from "@shared/redaction";
import type {
  GoogleOAuthAuthorizationCodeTransport,
  GoogleOAuthExchangeRequest,
  GoogleOAuthExchangeResult
} from "./oauth";
import type { GoogleOAuthRefreshTransport } from "./credentials";
import type { GoogleStoredTokenSet } from "./types";

interface GoogleTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
}

export class GoogleOAuthHttpTransport
  implements GoogleOAuthAuthorizationCodeTransport, GoogleOAuthRefreshTransport
{
  constructor(
    private readonly options: {
      tokenEndpoint?: string;
      fetchImpl?: typeof fetch;
      now?: () => Date;
    } = {}
  ) {}

  async exchangeAuthorizationCode(
    request: GoogleOAuthExchangeRequest
  ): Promise<GoogleOAuthExchangeResult> {
    const response = await this.requestToken({
      grant_type: "authorization_code",
      code: request.code,
      code_verifier: request.codeVerifier,
      redirect_uri: request.redirectUri,
      client_id: request.clientId,
      ...(request.clientSecret === undefined ? {} : { client_secret: request.clientSecret })
    });

    return {
      tokenSet: tokenSetFromResponse(response, this.now()),
      account: {},
      grantedScopes: response.scope
    };
  }

  async refreshAccessToken(request: {
    clientId: string;
    clientSecret?: string;
    refreshToken: string;
  }): Promise<{
    accessToken: string;
    expiresInSeconds?: number;
    scope?: string;
    tokenType?: string;
  }> {
    const response = await this.requestToken({
      grant_type: "refresh_token",
      refresh_token: request.refreshToken,
      client_id: request.clientId,
      ...(request.clientSecret === undefined ? {} : { client_secret: request.clientSecret })
    });

    if (!response.access_token) {
      throw new Error("Google OAuth refresh did not return an access token.");
    }

    return {
      accessToken: response.access_token,
      ...(response.expires_in === undefined ? {} : { expiresInSeconds: response.expires_in }),
      ...(response.scope === undefined ? {} : { scope: response.scope }),
      ...(response.token_type === undefined ? {} : { tokenType: response.token_type })
    };
  }

  private async requestToken(params: Record<string, string>): Promise<GoogleTokenResponse> {
    const body = new URLSearchParams(params);
    const fetchImpl = this.options.fetchImpl ?? fetch;
    let response: Response;

    try {
      response = await fetchImpl(this.options.tokenEndpoint ?? "https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body
      });
    } catch {
      throw new Error("Google OAuth request failed before a response was received.");
    }

    const text = await response.text();
    const decoded = decodeTokenResponse(text);

    if (!response.ok || decoded.error) {
      const description = decoded.error_description ?? decoded.error ?? `HTTP ${response.status}`;
      throw new Error(redactErrorMessage(`Google OAuth failed: ${description}`));
    }

    return decoded;
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }
}

function tokenSetFromResponse(response: GoogleTokenResponse, now: Date): GoogleStoredTokenSet {
  if (!response.access_token) {
    throw new Error("Google OAuth exchange did not return an access token.");
  }

  return {
    accessToken: response.access_token,
    ...(response.refresh_token === undefined ? {} : { refreshToken: response.refresh_token }),
    ...(response.expires_in === undefined
      ? {}
      : { expiresAt: new Date(now.getTime() + response.expires_in * 1000).toISOString() }),
    ...(response.scope === undefined ? {} : { scope: response.scope }),
    ...(response.token_type === undefined ? {} : { tokenType: response.token_type })
  };
}

function decodeTokenResponse(text: string): GoogleTokenResponse {
  if (text.length === 0) {
    return {};
  }

  try {
    return JSON.parse(text) as GoogleTokenResponse;
  } catch {
    throw new Error("Google OAuth response was not valid JSON.");
  }
}
