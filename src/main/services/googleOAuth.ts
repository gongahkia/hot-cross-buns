import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { safeStorage, shell } from "electron";
import { CoreStore, CoreStoreError } from "./coreStore";

interface SecretPayload {
  clientSecret?: string;
  refreshToken?: string;
  accessToken?: string;
  expiresAt?: number;
}

/**
 * Desktop PKCE OAuth controller. Only non-sensitive connection metadata is
 * mirrored into SQLite; tokens and optional client secrets are encrypted with
 * Electron's OS-backed safeStorage before being written to the app-data
 * credential envelope.
 */
export class GoogleOAuthController {
  private readonly credentialPath: string;
  private connecting = false;

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
    return this.store.dispatch("google", "status");
  }

  async begin(): Promise<Record<string, unknown>> {
    if (this.connecting) {
      return { message: "Google authorization is already open in your browser." };
    }

    const clientId = this.store.oauthClientId();
    if (!clientId) {
      throw new CoreStoreError("Add an OAuth client ID before connecting Google.");
    }

    this.connecting = true;
    void this.runAuthorization(clientId).finally(() => {
      this.connecting = false;
    });
    return { message: "Opening Google authorization in your browser." };
  }

  async disconnect(): Promise<Record<string, unknown>> {
    const secrets = await this.readSecrets();
    await this.writeSecrets({ clientSecret: secrets.clientSecret });
    this.store.setGoogleAccount(null);
    return this.store.dispatch("google", "status");
  }

  private async runAuthorization(clientId: string): Promise<void> {
    const verifier = base64Url(randomBytes(32));
    const challenge = base64Url(createHash("sha256").update(verifier).digest());
    const callback = await createLoopbackCallback();
    const redirectUri = `http://127.0.0.1:${callback.port}/oauth/callback`;
    const authorizationUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authorizationUrl.searchParams.set("client_id", clientId);
    authorizationUrl.searchParams.set("redirect_uri", redirectUri);
    authorizationUrl.searchParams.set("response_type", "code");
    authorizationUrl.searchParams.set("scope", "https://www.googleapis.com/auth/tasks https://www.googleapis.com/auth/calendar");
    authorizationUrl.searchParams.set("code_challenge", challenge);
    authorizationUrl.searchParams.set("code_challenge_method", "S256");
    authorizationUrl.searchParams.set("access_type", "offline");
    authorizationUrl.searchParams.set("prompt", "consent");

    await shell.openExternal(authorizationUrl.toString());
    const code = await callback.waitForCode();
    const secrets = await this.readSecrets();
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
        code_verifier: verifier,
        ...(secrets.clientSecret ? { client_secret: secrets.clientSecret } : {})
      })
    });

    if (!tokenResponse.ok) {
      throw new CoreStoreError("Google declined the authorization exchange. Check the OAuth client configuration.");
    }

    const token = await tokenResponse.json() as { access_token?: string; refresh_token?: string; expires_in?: number };
    if (!token.access_token || !token.refresh_token) {
      throw new CoreStoreError("Google did not return a reusable authorization token.");
    }

    const identityResponse = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { authorization: `Bearer ${token.access_token}` }
    });
    const identity = identityResponse.ok
      ? await identityResponse.json() as { id?: string; email?: string; name?: string }
      : {};
    await this.writeSecrets({
      ...secrets,
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: Date.now() + (token.expires_in ?? 3600) * 1000
    });
    this.store.setGoogleAccount({
      id: identity.id ?? "google-account",
      email: identity.email ?? null,
      displayName: identity.name ?? identity.email ?? "Google account",
      connectionState: "connected",
      missingScopes: []
    });
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

function createLoopbackCallback(): Promise<{ port: number; waitForCode: () => Promise<string> }> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const code = url.searchParams.get("code");
      const error = url.searchParams.get("error");
      response.writeHead(error || !code ? 400 : 200, { "content-type": "text/html; charset=utf-8" });
      response.end(error || !code ? "<p>Google authorization did not complete. You may close this tab.</p>" : "<p>Hot Cross Buns is connected. You may close this tab.</p>");
      if (!settled) {
        settled = true;
        server.close();
        error || !code ? reject(new CoreStoreError("Google authorization was cancelled or denied.")) : resolveWait(code);
      }
    });
    let resolveWait: (code: string) => void;
    const codePromise = new Promise<string>((resolveCode) => { resolveWait = resolveCode; });
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new CoreStoreError("Could not open the local OAuth callback port."));
        return;
      }
      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          server.close();
          reject(new CoreStoreError("Google authorization timed out."));
        }
      }, 5 * 60_000);
      codePromise.finally(() => clearTimeout(timeout)).catch(() => undefined);
      resolve({ port: address.port, waitForCode: () => codePromise });
    });
  });
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
