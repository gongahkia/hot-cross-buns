import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPkceChallengeFromVerifier, googleAuthorizationUrl, parseOAuthRedirect } from "./oauth";

describe("browser extension OAuth helpers", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("creates the RFC 7636 S256 challenge", async () => {
    await expect(createPkceChallengeFromVerifier("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"))
      .resolves
      .toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("builds a Google authorization URL with readonly scopes and PKCE", () => {
    const url = new URL(googleAuthorizationUrl({
      clientId: "client.apps.googleusercontent.com",
      redirectUri: "https://example.test/google",
      state: "state",
      challenge: "challenge"
    }));

    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("scope")).toContain("https://www.googleapis.com/auth/tasks.readonly");
    expect(url.searchParams.get("scope")).toContain("https://www.googleapis.com/auth/calendar.readonly");
  });

  it("parses an authorization code redirect", () => {
    expect(parseOAuthRedirect("https://example.test/google?state=state&code=code", "state")).toBe("code");
  });

  it("rejects mismatched OAuth state", () => {
    expect(() => parseOAuthRedirect("https://example.test/google?state=other&code=code", "state"))
      .toThrow("OAuth state mismatch.");
  });
});
