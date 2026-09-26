import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { EventEmitter } from "node:events";
import { createServer } from "node:http";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { safeStorage, shell } from "electron";
import { CoreStore, CoreStoreError } from "./coreStore";

interface AccountSecretPayload {
  refreshToken?: string;
  accessToken?: string;
  expiresAt?: number;
}

interface SecretPayload {
  clientSecret?: string;
  accounts?: Record<string, AccountSecretPayload>;
}

type OptionalWorkspaceService = "drive" | "gmail";

interface PendingAuthorization {
  cancelled: boolean;
  callback?: OAuthLoopbackCallback;
}

interface OAuthLoopbackCallback {
  port: number;
  waitForCode: () => Promise<string>;
  cancel: () => void;
}

const baseScopes = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/tasks",
  "https://www.googleapis.com/auth/calendar"
] as const;

const optionalWorkspaceScopes: Record<OptionalWorkspaceService, string> = {
  // Drive metadata is sufficient to find a file and attach its alternateLink
  // to Calendar; HCB never uploads or modifies Drive content.
  drive: "https://www.googleapis.com/auth/drive.metadata.readonly",
  // Gmail capture reads message metadata/snippets only; it never sends,
  // archives, labels, or deletes mail.
  gmail: "https://www.googleapis.com/auth/gmail.readonly"
};

/**
 * Desktop PKCE OAuth controller. Only non-sensitive connection metadata is
 * mirrored into SQLite; tokens and optional client secrets are encrypted with
 * Electron's OS-backed safeStorage before being written to the app-data
 * credential envelope.
 */
export class GoogleOAuthController {
  private readonly credentialPath: string;
  private activeAuthorization: PendingAuthorization | null = null;
  private authorizationError: string | null = null;
  private readonly events = new EventEmitter();

  constructor(
    userDataDirectory: string,
    private readonly store: CoreStore
  ) {
    this.credentialPath = join(userDataDirectory, "credentials-v1.bin");
  }

  async saveClient(input: Record<string, unknown>): Promise<Record<string, unknown>> {
    const clientId = requiredString(input.clientId, "OAuth client ID");
    const existing = await this.readSecrets();
    const clientSecret = optionalString(input.clientSecret);
    await this.writeSecrets({ ...existing, ...(clientSecret ? { clientSecret } : {}) });
    this.store.setOAuthClientId(clientId);
    return { ...this.store.dispatch("google", "status"), hasClientSecret: Boolean(clientSecret ?? existing.clientSecret) };
  }

  onConnectionChange(listener: () => void): () => void {
    this.events.on("connection-change", listener);
    return () => this.events.off("connection-change", listener);
  }

  async googleFetch(accountId: string, url: string | URL, init: RequestInit = {}): Promise<Response> {
    let response = await fetch(url, {
      ...init,
      headers: { ...headersWithAuthorization(init.headers, await this.accessToken(accountId, false)) }
    });

    if (response.status !== 401) return response;

    response = await fetch(url, {
      ...init,
      headers: { ...headersWithAuthorization(init.headers, await this.accessToken(accountId, true)) }
    });
    return response;
  }

  async begin(input: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    if (this.activeAuthorization) {
      return { ...this.status(), message: "Google authorization is already open in your browser." };
    }

    const clientId = this.store.oauthClientId();
    if (!clientId) {
      throw new CoreStoreError("Add an OAuth client ID before connecting Google.");
    }

    const attempt: PendingAuthorization = { cancelled: false };
    this.activeAuthorization = attempt;
    this.authorizationError = null;
    try {
      const authorization = await this.prepareAuthorization(clientId, optionalServices(input.requestedServices), attempt);
      void this.completeAuthorization(authorization, attempt)
        .catch((error: unknown) => {
          if (!attempt.cancelled) this.authorizationError = safeAuthorizationError(error);
        })
        .finally(() => {
          if (this.activeAuthorization !== attempt) return;
          this.activeAuthorization = null;
          this.events.emit("connection-change");
        });
      return { ...this.status(), message: "Google authorization is open in your browser." };
    } catch (error: unknown) {
      if (this.activeAuthorization === attempt) this.activeAuthorization = null;
      attempt.callback?.cancel();
      this.events.emit("connection-change");
      throw new CoreStoreError(`Could not open Google authorization: ${safeAuthorizationError(error)}`);
    }
  }

  async cancel(): Promise<Record<string, unknown>> {
    const attempt = this.activeAuthorization;
    if (!attempt) return { ...this.status(), message: "No Google authorization is in progress." };
    attempt.cancelled = true;
    attempt.callback?.cancel();
    if (this.activeAuthorization === attempt) this.activeAuthorization = null;
    this.authorizationError = null;
    this.events.emit("connection-change");
    return { ...this.status(), message: "Google authorization was cancelled. You can try again." };
  }

  status(): Record<string, unknown> {
    return {
      ...this.store.dispatch("google", "status"),
      authorizationError: this.authorizationError,
      authorizationInProgress: this.activeAuthorization !== null
    };
  }

  async disconnect(input: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const accountId = optionalString(input.accountId);
    const secrets = await this.readSecrets();
    const accounts = { ...(secrets.accounts ?? {}) };
    if (accountId) {
      delete accounts[accountId];
      this.store.removeGoogleAccount(accountId);
    } else {
      for (const account of this.store.googleAccounts()) {
        if (account.accountId === "local") continue;
        delete accounts[account.accountId];
        this.store.removeGoogleAccount(account.accountId);
      }
    }
    await this.writeSecrets({ clientSecret: secrets.clientSecret, accounts });
    this.events.emit("connection-change");
    return this.status();
  }

  private async prepareAuthorization(clientId: string, requestedServices: OptionalWorkspaceService[], attempt: PendingAuthorization): Promise<{ callback: OAuthLoopbackCallback; clientId: string; redirectUri: string; requestedScopes: string[]; verifier: string }> {
    const verifier = base64Url(randomBytes(32));
    const challenge = base64Url(createHash("sha256").update(verifier).digest());
    const state = base64Url(randomBytes(32));
    const callback = await createLoopbackCallback(state);
    attempt.callback = callback;
    if (attempt.cancelled) {
      callback.cancel();
      throw new CoreStoreError("Google authorization was cancelled.");
    }
    const redirectUri = `http://127.0.0.1:${callback.port}/oauth/callback`;
    const authorizationUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authorizationUrl.searchParams.set("client_id", clientId);
    authorizationUrl.searchParams.set("redirect_uri", redirectUri);
    authorizationUrl.searchParams.set("response_type", "code");
    const requestedScopes = [...baseScopes, ...requestedServices.map((service) => optionalWorkspaceScopes[service])];
    authorizationUrl.searchParams.set("scope", requestedScopes.join(" "));
    authorizationUrl.searchParams.set("code_challenge", challenge);
    authorizationUrl.searchParams.set("code_challenge_method", "S256");
    authorizationUrl.searchParams.set("state", state);
    authorizationUrl.searchParams.set("access_type", "offline");
    authorizationUrl.searchParams.set("prompt", "consent");
    authorizationUrl.searchParams.set("include_granted_scopes", "true");
    await shell.openExternal(authorizationUrl.toString());
    return { callback, clientId, redirectUri, requestedScopes, verifier };
  }

  private async completeAuthorization({ callback, clientId, redirectUri, requestedScopes, verifier }: { callback: OAuthLoopbackCallback; clientId: string; redirectUri: string; requestedScopes: string[]; verifier: string }, attempt: PendingAuthorization): Promise<void> {
    if (attempt.cancelled) throw new CoreStoreError("Google authorization was cancelled.");
    const code = await callback.waitForCode();
    if (attempt.cancelled) throw new CoreStoreError("Google authorization was cancelled.");
    const secrets = await this.readSecrets();
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code, client_id: clientId, redirect_uri: redirectUri, grant_type: "authorization_code", code_verifier: verifier, ...(secrets.clientSecret ? { client_secret: secrets.clientSecret } : {}) })
    });
    if (!tokenResponse.ok) throw new CoreStoreError("Google declined the authorization exchange. Check the OAuth client configuration.");
    const token = await tokenResponse.json() as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string };
    if (!token.access_token || !token.refresh_token) throw new CoreStoreError("Google did not return a reusable authorization token.");
    const identityResponse = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", { headers: { authorization: `Bearer ${token.access_token}` } });
    const identity = identityResponse.ok ? await identityResponse.json() as { id?: string; email?: string; name?: string; picture?: string } : {};
    const account = this.store.upsertGoogleAccount({ googleAccountId: identity.id ?? `unknown-${randomBytes(8).toString("hex")}`, email: identity.email ?? null, displayName: identity.name ?? identity.email ?? "Google account", avatarUrl: identity.picture ?? null, connectionState: "connected", missingScopes: [], grantedScopes: token.scope?.split(/\s+/).filter(Boolean) ?? requestedScopes });
    await this.writeSecrets({ ...secrets, accounts: { ...(secrets.accounts ?? {}), [account.accountId]: { accessToken: token.access_token, refreshToken: token.refresh_token, expiresAt: Date.now() + (token.expires_in ?? 3600) * 1000 } } });
    this.events.emit("connection-change");
  }

  private async accessToken(accountId: string, forceRefresh: boolean): Promise<string> {
    const secrets = await this.readSecrets();
    const accountSecrets = secrets.accounts?.[accountId];
    const expiresSoon = !accountSecrets?.expiresAt || accountSecrets.expiresAt <= Date.now() + 60_000;
    if (!forceRefresh && accountSecrets?.accessToken && !expiresSoon) return accountSecrets.accessToken;
    if (!accountSecrets?.refreshToken) throw new CoreStoreError("Google is not connected. Connect an account before syncing.");
    const clientId = this.store.oauthClientId();
    if (!clientId) throw new CoreStoreError("Google OAuth client configuration is missing.");
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        refresh_token: accountSecrets.refreshToken,
        grant_type: "refresh_token",
        ...(secrets.clientSecret ? { client_secret: secrets.clientSecret } : {})
      })
    });
    if (!response.ok) {
      this.store.updateGoogleAccountState(accountId, "reauth_required", "Google authorization expired or was revoked.");
      this.events.emit("connection-change");
      throw new CoreStoreError("Google authorization expired or was revoked. Reconnect the account.");
    }
    const token = await response.json() as { access_token?: string; expires_in?: number };
    if (!token.access_token) throw new CoreStoreError("Google did not return an access token.");
    await this.writeSecrets({
      ...secrets,
      accounts: { ...(secrets.accounts ?? {}), [accountId]: { ...accountSecrets, accessToken: token.access_token, expiresAt: Date.now() + (token.expires_in ?? 3600) * 1000 } }
    });
    return token.access_token;
  }

  private async readSecrets(): Promise<SecretPayload> {
    try {
      const encrypted = await readFile(this.credentialPath);
      if (!safeStorage.isEncryptionAvailable()) {
        throw new CoreStoreError("OS credential encryption is unavailable on this device.");
      }
      return JSON.parse(safeStorage.decryptString(encrypted)) as SecretPayload;
    } catch (error: unknown) {
      if (isMissing(error)) return {};
      throw error;
    }
  }

  private async writeSecrets(payload: SecretPayload): Promise<void> {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new CoreStoreError("OS credential encryption is unavailable on this device.");
    }
    const directory = dirname(this.credentialPath);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
    const temporary = `${this.credentialPath}.tmp`;
    await writeFile(temporary, safeStorage.encryptString(JSON.stringify(payload)), { mode: 0o600 });
    await rename(temporary, this.credentialPath);
  }
}

function optionalServices(value: unknown): OptionalWorkspaceService[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((service): service is OptionalWorkspaceService => service === "drive" || service === "gmail"))];
}

function createLoopbackCallback(expectedState: string): Promise<OAuthLoopbackCallback> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let listening = false;
    let resolveCode!: (code: string) => void;
    let rejectCode!: (error: Error) => void;
    const codePromise = new Promise<string>((resolveWait, rejectWait) => {
      resolveCode = resolveWait;
      rejectCode = rejectWait;
    });
    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      server.close();
      if (listening) rejectCode(error);
      else reject(error);
    };
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const code = url.searchParams.get("code");
      const error = url.searchParams.get("error");
      const stateMatches = matchesState(url.searchParams.get("state"), expectedState);
      const succeeded = !error && Boolean(code) && stateMatches;
      response.writeHead(succeeded ? 200 : 400, { "content-type": "text/html; charset=utf-8" });
      response.end(succeeded
        ? "<p>Hot Cross Buns is connected. You may close this tab.</p>"
        : "<p>Google authorization did not complete. You may close this tab.</p>");
      if (!settled) {
        settled = true;
        server.close();
        if (!stateMatches) {
          rejectCode(new CoreStoreError("Google authorization callback could not be verified. Please try connecting again."));
        } else if (error || !code) {
          rejectCode(new CoreStoreError("Google authorization was cancelled or denied."));
        } else {
          resolveCode(code);
        }
      }
    });
    server.once("error", (error) => fail(error));
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        fail(new CoreStoreError("Could not open the local OAuth callback port."));
        return;
      }
      listening = true;
      const timeout = setTimeout(() => {
        fail(new CoreStoreError("Google authorization timed out."));
      }, 5 * 60_000);
      codePromise.finally(() => clearTimeout(timeout)).catch(() => undefined);
      resolve({ port: address.port, waitForCode: () => codePromise, cancel: () => fail(new CoreStoreError("Google authorization was cancelled.")) });
    });
  });
}

function matchesState(receivedState: string | null, expectedState: string): boolean {
  if (!receivedState || receivedState.length !== expectedState.length) return false;
  return timingSafeEqual(Buffer.from(receivedState), Buffer.from(expectedState));
}

function safeAuthorizationError(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "Google authorization could not be started.";
}

function headersWithAuthorization(headers: HeadersInit | undefined, accessToken: string): Headers {
  const result = new Headers(headers);
  result.set("authorization", `Bearer ${accessToken}`);
  return result;
}

function base64Url(value: Buffer): string {
  return value.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new CoreStoreError(`${label} is required.`);
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "ENOENT";
}
