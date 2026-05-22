import { describe, expect, it, vi } from "vitest";
import { MemoryGoogleCredentialAdapter } from "./credentials";
import {
  DesktopGoogleOAuthService,
  MemoryGoogleOAuthAccountStatusStore,
  type GoogleOAuthAuthorizationCodeTransport
} from "./oauth";
import { GOOGLE_CALENDAR_SCOPE, GOOGLE_TASKS_SCOPE } from "./types";

describe("desktop Google OAuth boundary", () => {
  it("delegates token storage and returns sanitized connection status", async () => {
    const credentialAdapter = new MemoryGoogleCredentialAdapter();
    const accountStatusStore = new MemoryGoogleOAuthAccountStatusStore();
    const transport: GoogleOAuthAuthorizationCodeTransport = {
      exchangeAuthorizationCode: vi.fn(async () => ({
        tokenSet: {
          accessToken: "fake-access-token",
          refreshToken: "fake-refresh-token",
          expiresAt: "2026-05-22T12:00:00.000Z",
          scope: `${GOOGLE_TASKS_SCOPE} ${GOOGLE_CALENDAR_SCOPE}`,
          tokenType: "Bearer"
        },
        account: {
          googleAccountId: "google-user-1",
          email: "user@example.com",
          displayName: "User Example"
        },
        grantedScopes: [GOOGLE_TASKS_SCOPE, GOOGLE_CALENDAR_SCOPE]
      }))
    };
    const service = new DesktopGoogleOAuthService({
      clientConfig: {
        clientId: "desktop-client-id",
        redirectUri: "http://127.0.0.1:42813/oauth/google/callback"
      },
      credentialAdapter,
      accountStatusStore,
      authorizationCodeTransport: transport,
      now: () => new Date("2026-05-22T10:00:00.000Z")
    });

    const authorization = service.beginAuthorization();
    const authorizationUrl = new URL(authorization.authorizationUrl);

    expect(authorizationUrl.searchParams.get("scope")).toContain(GOOGLE_TASKS_SCOPE);
    expect(authorizationUrl.searchParams.get("scope")).toContain(GOOGLE_CALENDAR_SCOPE);
    expect(authorizationUrl.searchParams.get("scope")).not.toContain("drive");
    expect(authorizationUrl.searchParams.get("code_challenge_method")).toBe("S256");

    const status = await service.completeAuthorization({
      code: "oauth-code",
      state: authorization.state
    });

    expect(transport.exchangeAuthorizationCode).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "oauth-code",
        clientId: "desktop-client-id",
        redirectUri: "http://127.0.0.1:42813/oauth/google/callback",
        scopes: [GOOGLE_TASKS_SCOPE, GOOGLE_CALENDAR_SCOPE]
      })
    );
    expect(await credentialAdapter.readTokenSet("google:google-user-1")).toMatchObject({
      accessToken: "fake-access-token",
      refreshToken: "fake-refresh-token"
    });
    expect(status).toMatchObject({
      accountId: "google:google-user-1",
      email: "user@example.com",
      connectionState: "connected",
      missingScopes: []
    });
    expect(JSON.stringify(status)).not.toContain("fake-access-token");
    expect(JSON.stringify(status)).not.toContain("fake-refresh-token");
    expect(JSON.stringify(await accountStatusStore.listStatuses())).not.toContain("fake-access-token");
  });
});
