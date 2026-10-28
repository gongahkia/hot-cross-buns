import { afterEach, describe, expect, it, vi } from "vitest";
import type { GoogleStatusResponse } from "../shared/ipc/contracts";
import { ok } from "../shared/result";
import { createBrowserGoogleAuth, type GoogleIdentityServices, type GoogleTokenClientConfig } from "./googleAuth";

const connected: GoogleStatusResponse = { oauthClientConfigured: true, clientId: "web-client", hasClientSecret: false,
  accounts: [{ email: "person@example.test", displayName: "Planner", accountId: "local-uuid", googleAccountId: "verified-sub", connectionState: "connected", grantedScopes: [], missingScopes: [], unresolvedMutationCount: 0 }] };
function harness() {
  let callback!: GoogleTokenClientConfig;
  const requestAccessToken = vi.fn();
  const gis: GoogleIdentityServices = { initTokenClient: vi.fn((config) => { callback = config; return { requestAccessToken }; }) };
  const onToken = vi.fn(async () => ok(connected));
  const onDisconnect = vi.fn(async () => ok({ ...connected, accounts: [] }));
  const fetchIdentity = vi.fn(async () => new Response(JSON.stringify({ sub: "verified-sub", email: "person@example.test", name: "Planner" }), { status: 200 }));
  const auth = createBrowserGoogleAuth({ clientId: "web-client", getIdentityServices: () => gis, fetch: fetchIdentity, onToken, onDisconnect });
  return { auth, onToken, onDisconnect, requestAccessToken, fetchIdentity, response: () => callback };
}
afterEach(() => { vi.useRealTimers(); });

describe("browser Google OAuth", () => {
  it("opens the popup synchronously and installs only a verified subject with actual granted scopes", async () => {
    const h = harness();
    const operation = h.auth.beginOAuth({ accountId: "local-uuid", requestedServices: ["drive", "gmail"] });
    expect(h.requestAccessToken).toHaveBeenCalledOnce();
    expect(h.auth.status().authorizationInProgress).toBe(true);
    h.response().callback({ access_token: "memory-only-secret", expires_in: 3600, scope: "openid email https://www.googleapis.com/auth/tasks" });
    expect((await operation).ok).toBe(true);
    expect(h.fetchIdentity).toHaveBeenCalledWith("https://openidconnect.googleapis.com/v1/userinfo", expect.objectContaining({ headers: { Authorization: "Bearer memory-only-secret" }, credentials: "omit" }));
    expect(h.onToken).toHaveBeenCalledWith(expect.objectContaining({ account: { id: "verified-sub", email: "person@example.test", name: "Planner" }, scopes: ["openid", "email", "https://www.googleapis.com/auth/tasks"] }), "local-uuid");
    expect(JSON.stringify(h.auth.status())).not.toContain("memory-only-secret");
    await h.auth.disconnect({ accountId: "local-uuid" });
  });

  it.each(["popup_closed", "popup_failed_to_open", "unknown"])("reports %s without connecting", async (type) => {
    const h = harness(); const operation = h.auth.beginOAuth();
    h.response().error_callback({ type });
    expect((await operation).ok).toBe(false);
    expect(h.onToken).not.toHaveBeenCalled();
    expect(h.auth.status().authorizationInProgress).toBe(false);
  });

  it("reports consent denial without a token or persistent account", async () => {
    const h = harness(); const operation = h.auth.beginOAuth();
    h.response().callback({ error: "access_denied" });
    const result = await operation;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain("denied");
    expect(h.onToken).not.toHaveBeenCalled();
  });

  it("does not claim cancellation while a verified connection is being committed", async () => {
    const h = harness();
    let finish!: (value: ReturnType<typeof ok<GoogleStatusResponse>>) => void;
    h.onToken.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const operation = h.auth.beginOAuth();
    h.response().callback({ access_token: "secret", expires_in: 3600, scope: "openid" });
    await vi.waitFor(() => expect(h.onToken).toHaveBeenCalled());
    expect((await h.auth.cancelOAuth()).ok).toBe(false);
    finish(ok(connected));
    expect((await operation).ok).toBe(true);
    await h.auth.disconnect({ accountId: "local-uuid" });
  });

  it("rejects identity failure and does not use an email as an account identifier", async () => {
    const h = harness();
    h.fetchIdentity.mockResolvedValueOnce(new Response(JSON.stringify({ email: "person@example.test" })));
    const operation = h.auth.beginOAuth();
    h.response().callback({ access_token: "secret", expires_in: 3600, scope: "openid" });
    expect((await operation).ok).toBe(false);
    expect(h.onToken).not.toHaveBeenCalled();
  });

  it("ignores a token response after explicit cancellation", async () => {
    const h = harness(); const operation = h.auth.beginOAuth();
    await h.auth.cancelOAuth();
    h.response().callback({ access_token: "secret", expires_in: 3600 });
    expect((await operation).ok).toBe(false);
    expect(h.onToken).not.toHaveBeenCalled();
    expect(h.fetchIdentity).not.toHaveBeenCalled();
  });

  it("requests only selected optional scopes when reconfiguring", async () => {
    const h = harness();
    const operation = h.auth.reconfigureOptionalAccess({ accountId: "local-uuid", requestedServices: ["driveUpload"], confirmation: "RECONFIGURE_OPTIONAL_ACCESS" });
    expect(h.response().include_granted_scopes).toBe(false);
    expect(h.response().scope).toContain("https://www.googleapis.com/auth/drive.file");
    expect(h.response().scope).not.toContain("gmail");
    expect(h.requestAccessToken).toHaveBeenCalledWith({ prompt: "consent" });
    await h.auth.cancelOAuth(); await operation;
  });

  it("expires a session without silently requesting another token", async () => {
    vi.useFakeTimers();
    const h = harness(); const operation = h.auth.beginOAuth();
    h.response().callback({ access_token: "secret", expires_in: 1, scope: "openid" });
    await operation;
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.onDisconnect).toHaveBeenCalledWith("local-uuid", "expired");
    expect(h.requestAccessToken).toHaveBeenCalledOnce();
  });

  it("returns actionable state without a configured Web client", async () => {
    const auth = createBrowserGoogleAuth({ onToken: vi.fn(), onDisconnect: vi.fn() });
    const result = await auth.beginOAuth();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain("VITE_GOOGLE_CLIENT_ID");
  });
});
