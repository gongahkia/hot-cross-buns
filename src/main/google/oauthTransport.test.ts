import { describe, expect, it, vi } from "vitest";
import { GoogleOAuthHttpTransport } from "./oauthTransport";

describe("Google OAuth HTTP transport", () => {
  it("fetches OpenID profile details after exchanging an authorization code", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.includes("/token")) {
        return new Response(
          JSON.stringify({
            access_token: "access-token",
            refresh_token: "refresh-token",
            expires_in: 3600,
            scope: "https://www.googleapis.com/auth/tasks https://www.googleapis.com/auth/calendar openid email profile",
            token_type: "Bearer"
          }),
          { status: 200 }
        );
      }

      return new Response(
        JSON.stringify({
          sub: "google-user-1",
          email: "user@example.com",
          name: "User Example",
          picture: "https://lh3.googleusercontent.com/a/user",
          locale: "en"
        }),
        { status: 200 }
      );
    });
    const transport = new GoogleOAuthHttpTransport({
      tokenEndpoint: "https://oauth2.googleapis.test/token",
      userInfoEndpoint: "https://openidconnect.googleapis.test/v1/userinfo",
      fetchImpl,
      now: () => new Date("2026-05-22T10:00:00.000Z")
    });

    const result = await transport.exchangeAuthorizationCode({
      code: "oauth-code",
      codeVerifier: "verifier",
      redirectUri: "http://127.0.0.1:40000/oauth/google/callback",
      clientId: "desktop-client-id",
      scopes: [
        "https://www.googleapis.com/auth/tasks",
        "https://www.googleapis.com/auth/calendar",
        "openid",
        "email",
        "profile"
      ]
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.account).toEqual({
      googleAccountId: "google-user-1",
      email: "user@example.com",
      displayName: "User Example",
      avatarUrl: "https://lh3.googleusercontent.com/a/user",
      locale: "en"
    });
  });
});
