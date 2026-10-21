import { get } from "node:http";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const electronMocks = vi.hoisted(() => ({
  decryptString: vi.fn<(value: Buffer) => string>(),
  encryptString: vi.fn<(value: string) => Buffer>(),
  isEncryptionAvailable: vi.fn<() => boolean>(),
  openExternal: vi.fn<(url: string) => Promise<void>>(async () => undefined)
}));

const testPlatform = {
  decryptString: (value: Uint8Array) => electronMocks.decryptString(Buffer.from(value)),
  encryptString: (value: string) => electronMocks.encryptString(value),
  isEncryptionAvailable: () => electronMocks.isEncryptionAvailable(),
  openExternal: (url: string) => electronMocks.openExternal(url)
};

import { GoogleOAuthController } from "./googleOAuth";

const credentialDirectories: string[] = [];
function credentialFixture() {
  const directory = mkdtempSync(join(tmpdir(), "hcb-credential-race-"));
  credentialDirectories.push(directory);
  const path = join(directory, "credentials-v1.bin");
  writeFileSync(path, JSON.stringify({ clientSecret: "original-client-secret", accounts: {
    a: { refreshToken: "refresh-a", accessToken: "old-a", expiresAt: 0 },
    b: { refreshToken: "refresh-b", accessToken: "old-b", expiresAt: 0 }
  } }));
  const platform = {
    isEncryptionAvailable: () => true,
    decryptString: (value: Uint8Array) => Buffer.from(value).toString(),
    encryptString: vi.fn(async (value: string) => Buffer.from(value)),
    openExternal: async () => undefined
  };
  const store = {
    oauthClientId: () => "client-id",
    setOAuthClientId: vi.fn(), dispatch: () => ({}),
    googleAccounts: () => [{ accountId: "a" }, { accountId: "b" }],
    removeGoogleAccount: vi.fn(), updateGoogleAccountState: vi.fn(),
    upsertGoogleAccount: () => ({ accountId: "c" }), retireLocalFallback: vi.fn()
  };
  const controller = new GoogleOAuthController(directory, store as never, platform);
  const read = () => JSON.parse(readFileSync(path, "utf8"));
  return { controller, store, platform, read, directory, path };
}

afterEach(() => {
  for (const directory of credentialDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function requestCallback(url: URL): Promise<number | undefined> {
  return new Promise((resolve, reject) => {
    get(url, (response) => {
      response.resume();
      response.once("end", () => resolve(response.statusCode));
    }).once("error", reject);
  });
}

describe("GoogleOAuthController", () => {
  it("coalesces same-account refreshes and preserves concurrent refreshes for different accounts", async () => {
    const { controller, read } = credentialFixture();
    const responses = new Map<string, (response: Response) => void>();
    const tokenCalls: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      if (String(url) === "https://oauth2.googleapis.com/token") {
        const refreshToken = new URLSearchParams(String(init?.body)).get("refresh_token")!;
        tokenCalls.push(refreshToken);
        return new Promise<Response>((resolve) => { responses.set(refreshToken, resolve); });
      }
      return new Response(null, { status: 200 });
    });
    const requests = Promise.all([
      controller.googleFetch("a", "https://example.test/first"),
      controller.googleFetch("b", "https://example.test/second"),
      controller.googleFetch("a", "https://example.test/third")
    ]);
    await vi.waitFor(() => expect(responses.size).toBe(2));
    responses.get("refresh-b")!(Response.json({ access_token: "new-b", expires_in: 3600 }));
    responses.get("refresh-a")!(Response.json({ access_token: "new-a", expires_in: 3600 }));
    await requests;
    expect(tokenCalls.sort()).toEqual(["refresh-a", "refresh-b"]);
    expect(read()).toMatchObject({ clientSecret: "original-client-secret", accounts: {
      a: { accessToken: "new-a", refreshToken: "refresh-a" }, b: { accessToken: "new-b", refreshToken: "refresh-b" }
    } });
  });

  it("retains a client-secret edit made while a refresh is in flight", async () => {
    const { controller, read } = credentialFixture();
    let finishRefresh!: (response: Response) => void;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => String(url).endsWith("/token")
      ? new Promise<Response>((resolve) => { finishRefresh = resolve; })
      : new Response(null, { status: 200 }));
    const request = controller.googleFetch("a", "https://example.test/resource");
    await vi.waitFor(() => expect(finishRefresh).toBeTypeOf("function"));
    await controller.saveClient({ clientId: "client-id", clientSecret: "edited-client-secret" });
    finishRefresh(Response.json({ access_token: "new-a", expires_in: 3600 }));
    await request;
    expect(read()).toMatchObject({ clientSecret: "edited-client-secret", accounts: { a: { accessToken: "new-a" }, b: { refreshToken: "refresh-b" } } });
  });

  it("does not restore credentials disconnected during an in-flight refresh", async () => {
    const { controller, read, store } = credentialFixture();
    let finishRefresh!: (response: Response) => void;
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Promise<Response>((resolve) => { finishRefresh = resolve; }));
    const request = controller.googleFetch("a", "https://example.test/resource");
    await vi.waitFor(() => expect(finishRefresh).toBeTypeOf("function"));
    await controller.disconnect({ accountId: "a" });
    const rejected = expect(request).rejects.toThrow("authorization changed");
    finishRefresh(Response.json({ access_token: "stale-refresh-result", expires_in: 3600 }));
    await rejected;
    expect(read().accounts).not.toHaveProperty("a");
    expect(read().accounts.b.refreshToken).toBe("refresh-b");
    expect(store.removeGoogleAccount).toHaveBeenCalledWith("a");
  });

  it("recovers after a credential write fails and removes temporary files", async () => {
    const { controller, platform, read, directory } = credentialFixture();
    platform.encryptString.mockRejectedValueOnce(new Error("Simulated encryption failure"));
    await expect(controller.saveClient({ clientId: "client-id", clientSecret: "failed-edit" })).rejects.toThrow("Simulated encryption failure");
    expect(read().clientSecret).toBe("original-client-secret");
    await controller.saveClient({ clientId: "client-id", clientSecret: "successful-edit" });
    expect(read()).toMatchObject({ clientSecret: "successful-edit", accounts: { a: { refreshToken: "refresh-a" }, b: { refreshToken: "refresh-b" } } });
    expect(readdirSync(directory)).toEqual(["credentials-v1.bin"]);
  });

  it("reuses an already refreshed token when another request returns a late 401", async () => {
    const { controller, path, read } = credentialFixture();
    const secrets = read();
    secrets.accounts.a.expiresAt = Date.now() + 3_600_000;
    writeFileSync(path, JSON.stringify(secrets));
    let late401!: (response: Response) => void;
    let refreshes = 0;
    const authorizations: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      if (String(url).endsWith("/token")) { refreshes += 1; return Response.json({ access_token: "new-a", expires_in: 3600 }); }
      const authorization = new Headers(init?.headers).get("authorization")!;
      authorizations.push(authorization);
      if (authorization === "Bearer new-a") return new Response(null, { status: 200 });
      if (String(url).endsWith("/late")) return new Promise<Response>((resolve) => { late401 = resolve; });
      return new Response(null, { status: 401 });
    });
    const first = controller.googleFetch("a", "https://example.test/first");
    const late = controller.googleFetch("a", "https://example.test/late");
    expect((await first).status).toBe(200);
    await vi.waitFor(() => expect(late401).toBeTypeOf("function"));
    late401(new Response(null, { status: 401 }));
    expect((await late).status).toBe(200);
    expect(refreshes).toBe(1);
    expect(authorizations.filter((value) => value === "Bearer new-a")).toHaveLength(2);
  });

  it("merges completed authorization into current credentials instead of restoring a disconnected account", async () => {
    const { controller, read } = credentialFixture();
    let finishExchange!: (response: Response) => void;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => String(url).endsWith("/token")
      ? new Promise<Response>((resolve) => { finishExchange = resolve; })
      : Response.json({ id: "google-c", email: "c@example.test" }));
    const internal = controller as unknown as {
      completeAuthorization: (authorization: { callback: { waitForCode: () => Promise<string> }; clientId: string; redirectUri: string; requestedScopes: string[]; verifier: string }, attempt: { cancelled: boolean }) => Promise<void>;
    };
    const connecting = internal.completeAuthorization({ callback: { waitForCode: async () => "code" }, clientId: "client-id", redirectUri: "http://127.0.0.1/callback", requestedScopes: [], verifier: "verifier" }, { cancelled: false });
    await vi.waitFor(() => expect(finishExchange).toBeTypeOf("function"));
    await controller.disconnect({ accountId: "b" });
    finishExchange(Response.json({ access_token: "access-c", refresh_token: "refresh-c", expires_in: 3600 }));
    await connecting;
    expect(Object.keys(read().accounts).sort()).toEqual(["a", "c"]);
  });

  it("sends the OAuth bearer token without dropping existing headers", async () => {
    const store = {
      dispatch: vi.fn(() => ({ accounts: [], hasClientSecret: false, oauthClientConfigured: true })),
      oauthClientId: () => "test-desktop-client-id"
    };
    const controller = new GoogleOAuthController("/tmp/hcb-oauth-test", store as never, testPlatform);
    const internals = controller as unknown as {
      accessToken: ReturnType<typeof vi.fn>;
    };
    internals.accessToken = vi.fn(async () => "access-token");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));

    await controller.googleFetch("test-account", "https://example.test/api", {
      headers: { "x-hcb-test": "present" }
    });

    const requestInit = fetchSpy.mock.calls[0]?.[1];
    const headers = new Headers(requestInit?.headers);
    expect(headers.get("authorization")).toBe("Bearer access-token");
    expect(headers.get("x-hcb-test")).toBe("present");
    expect(internals.accessToken).toHaveBeenCalledWith("test-account", false);
    fetchSpy.mockRestore();
  });

  it("adds a one-time state value and rejects a callback with the wrong state", async () => {
    const store = {
      dispatch: vi.fn(() => ({ accounts: [], hasClientSecret: false, oauthClientConfigured: true })),
      oauthClientId: () => "test-desktop-client-id"
    };
    const controller = new GoogleOAuthController("/tmp/hcb-oauth-test", store as never, testPlatform);
    const tokenFetch = vi.spyOn(globalThis, "fetch");

    await controller.begin();

    await vi.waitFor(() => expect(electronMocks.openExternal).toHaveBeenCalledTimes(1));
    const authorizationUrl = new URL(String(electronMocks.openExternal.mock.calls[0]?.[0]));
    const state = authorizationUrl.searchParams.get("state");
    expect(state).toMatch(/^[A-Za-z0-9_-]{40,}$/);

    const callbackUrl = new URL(authorizationUrl.searchParams.get("redirect_uri")!);
    callbackUrl.searchParams.set("code", "untrusted-code");
    callbackUrl.searchParams.set("state", "wrong-state");

    await expect(requestCallback(callbackUrl)).resolves.toBe(400);
    expect(tokenFetch).not.toHaveBeenCalled();
  });

  it("requests the narrow Drive upload scope only when the user enables uploads", async () => {
    const store = {
      dispatch: vi.fn(() => ({ accounts: [], hasClientSecret: false, oauthClientConfigured: true })),
      oauthClientId: () => "test-desktop-client-id"
    };
    const controller = new GoogleOAuthController("/tmp/hcb-oauth-test", store as never, testPlatform);

    await controller.begin({ requestedServices: ["drive", "driveUpload"] });
    await vi.waitFor(() => expect(electronMocks.openExternal).toHaveBeenCalled());
    const authorizationUrl = new URL(String(electronMocks.openExternal.mock.calls.at(-1)?.[0]));
    const scopes = authorizationUrl.searchParams.get("scope")?.split(" ") ?? [];

    expect(scopes).toContain("https://www.googleapis.com/auth/drive.metadata.readonly");
    expect(scopes).toContain("https://www.googleapis.com/auth/drive.file");
    await controller.cancel();
  });

  it("revokes an account before reopening consent with only the selected optional access", async () => {
    const directory = mkdtempSync(join(tmpdir(), "hcb-oauth-test-"));
    const removeGoogleAccount = vi.fn();
    const store = {
      dispatch: vi.fn(() => ({ accounts: [], hasClientSecret: false, oauthClientConfigured: true })),
      googleAccount: vi.fn(() => ({ accountId: "google-account", connectionState: "connected" })),
      oauthClientId: () => "test-desktop-client-id",
      removeGoogleAccount,
      unresolvedSyncMutationCount: () => 0
    };
    electronMocks.isEncryptionAvailable.mockReturnValue(true);
    electronMocks.encryptString.mockImplementation((value) => Buffer.from(value));
    electronMocks.decryptString.mockImplementation((value) => value.toString());
    const controller = new GoogleOAuthController(directory, store as never, testPlatform);
    const internals = controller as unknown as {
      readSecrets: () => Promise<{ accounts?: Record<string, unknown> }>;
      writeSecrets: (value: unknown) => Promise<void>;
    };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));

    try {
      await internals.writeSecrets({ accounts: { "google-account": { refreshToken: "test-refresh-credential" } } });
      const result = await controller.reconfigureOptionalAccess({
        accountId: "google-account",
        confirmation: "RECONFIGURE_OPTIONAL_ACCESS",
        requestedServices: ["drive"]
      });

      expect(result.message).toContain("Continue in your browser");
      expect(fetchSpy).toHaveBeenCalledWith(
        "https://oauth2.googleapis.com/revoke",
        expect.objectContaining({ method: "POST" })
      );
      expect(removeGoogleAccount).toHaveBeenCalledWith("google-account");
      expect((await internals.readSecrets()).accounts).not.toHaveProperty("google-account");
      await vi.waitFor(() => expect(electronMocks.openExternal).toHaveBeenCalled());
      const authorizationUrl = new URL(String(electronMocks.openExternal.mock.calls.at(-1)?.[0]));
      const scopes = authorizationUrl.searchParams.get("scope")?.split(" ") ?? [];
      expect(scopes).toContain("https://www.googleapis.com/auth/drive.metadata.readonly");
      expect(scopes).not.toContain("https://www.googleapis.com/auth/drive.file");
      expect(scopes).not.toContain("https://www.googleapis.com/auth/gmail.readonly");
      expect(authorizationUrl.searchParams.get("include_granted_scopes")).toBe("false");
      await controller.cancel();
    } finally {
      fetchSpy.mockRestore();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("does not revoke an account with unresolved Google changes", async () => {
    const store = {
      googleAccount: () => ({ accountId: "google-account", connectionState: "connected" }),
      unresolvedSyncMutationCount: () => 2
    };
    const controller = new GoogleOAuthController("/tmp/hcb-oauth-test", store as never, testPlatform);
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    try {
      await expect(controller.reconfigureOptionalAccess({
        accountId: "google-account",
        confirmation: "RECONFIGURE_OPTIONAL_ACCESS",
        requestedServices: []
      })).rejects.toThrow("Finish syncing 2 pending Google changes");
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("retires the starter workspace only after OAuth tokens are stored", async () => {
    const directory = mkdtempSync(join(tmpdir(), "hcb-oauth-test-"));
    const retireLocalFallback = vi.fn();
    const store = {
      oauthClientId: () => "test-desktop-client-id",
      retireLocalFallback,
      upsertGoogleAccount: vi.fn(() => ({ accountId: "google-account" }))
    };
    electronMocks.isEncryptionAvailable.mockReturnValue(true);
    electronMocks.encryptString.mockImplementation((value) => Buffer.from(value));
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ access_token: "access", refresh_token: "refresh", expires_in: 3600, scope: "openid email" }))
      .mockResolvedValueOnce(Response.json({ id: "google-id", email: "person@example.test", name: "Person" }));
    const controller = new GoogleOAuthController(directory, store as never, testPlatform);
    const internals = controller as unknown as {
      completeAuthorization: (
        authorization: { callback: { waitForCode: () => Promise<string> }; clientId: string; redirectUri: string; requestedScopes: string[]; verifier: string },
        attempt: { cancelled: boolean }
      ) => Promise<void>;
    };

    try {
      await internals.completeAuthorization({
        callback: { waitForCode: async () => "authorization-code" },
        clientId: "test-desktop-client-id",
        redirectUri: "http://127.0.0.1:9999/oauth/callback",
        requestedScopes: ["openid"],
        verifier: "verifier"
      }, { cancelled: false });

      expect(store.upsertGoogleAccount).toHaveBeenCalledWith(expect.objectContaining({
        googleAccountId: "google-id",
        email: "person@example.test",
        connectionState: "connected"
      }));
      expect(retireLocalFallback).toHaveBeenCalledTimes(1);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    } finally {
      fetchSpy.mockRestore();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("explains when Google rejects a mismatched OAuth client ID and secret", async () => {
    const directory = mkdtempSync(join(tmpdir(), "hcb-oauth-test-"));
    const controller = new GoogleOAuthController(directory, {} as never, testPlatform);
    const internals = controller as unknown as {
      completeAuthorization: (
        authorization: { callback: { waitForCode: () => Promise<string> }; clientId: string; redirectUri: string; requestedScopes: string[]; verifier: string },
        attempt: { cancelled: boolean }
      ) => Promise<void>;
    };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ error: "invalid_client" }, { status: 401 }));

    try {
      await expect(internals.completeAuthorization({
        callback: { waitForCode: async () => "authorization-code" },
        clientId: "test-desktop-client-id",
        redirectUri: "http://127.0.0.1:9999/oauth/callback",
        requestedScopes: ["openid"],
        verifier: "verifier"
      }, { cancelled: false })).rejects.toThrow("belong to the same Desktop OAuth client");
    } finally {
      fetchSpy.mockRestore();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
