import type { GoogleIdentity } from "@/types";

interface GoogleTokenResponse {
  readonly access_token?: string;
  readonly expires_in?: number;
  readonly scope?: string;
  readonly error?: string;
  readonly error_description?: string;
}

interface GoogleTokenClient {
  requestAccessToken(options?: { prompt?: "" | "consent" | "select_account" }): void;
}

interface GoogleAccounts {
  oauth2: {
    initTokenClient(configuration: {
      client_id: string;
      scope: string;
      include_granted_scopes?: boolean;
      callback: (response: GoogleTokenResponse) => void;
      error_callback?: (error: { type?: string; message?: string }) => void;
    }): GoogleTokenClient;
    revoke(token: string, callback: (response: { successful?: boolean; error?: string }) => void): void;
  };
}

declare global {
  interface Window {
    google?: { accounts: GoogleAccounts };
  }
}

const GOOGLE_IDENTITY_SCRIPT = "https://accounts.google.com/gsi/client";
let identityScript: Promise<void> | undefined;

export class GoogleAuthorizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoogleAuthorizationError";
  }
}

export interface BrowserAccessToken {
  readonly value: string;
  readonly expiresAt: number;
  readonly scopes: readonly string[];
}

export async function loadGoogleIdentityServices(): Promise<void> {
  if (window.google?.accounts.oauth2) {
    return;
  }
  identityScript ??= new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GOOGLE_IDENTITY_SCRIPT}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new GoogleAuthorizationError("Google Identity Services failed to load")), {
        once: true
      });
      return;
    }
    const script = document.createElement("script");
    script.src = GOOGLE_IDENTITY_SCRIPT;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new GoogleAuthorizationError("Google Identity Services failed to load"));
    document.head.append(script);
  });
  await identityScript;
  if (!window.google?.accounts.oauth2) {
    throw new GoogleAuthorizationError("Google Identity Services did not initialize");
  }
}

export async function requestGoogleAccessToken(
  clientId: string,
  scopes: readonly string[],
  prompt: "" | "consent" | "select_account" = ""
): Promise<BrowserAccessToken> {
  const normalizedClientId = clientId.trim();
  if (normalizedClientId.length < 10 || normalizedClientId.length > 500 || normalizedClientId.includes("\0")) {
    throw new GoogleAuthorizationError("Enter a valid Google Web OAuth client ID");
  }
  await loadGoogleIdentityServices();
  return new Promise<BrowserAccessToken>((resolve, reject) => {
    const oauth = window.google?.accounts.oauth2;
    if (!oauth) {
      reject(new GoogleAuthorizationError("Google Identity Services did not initialize"));
      return;
    }
    const tokenClient = oauth.initTokenClient({
      client_id: normalizedClientId,
      scope: scopes.join(" "),
      include_granted_scopes: true,
      callback: (response) => {
        if (!response.access_token || !response.expires_in) {
          reject(
            new GoogleAuthorizationError(
              response.error_description ?? response.error ?? "Google did not grant the requested access"
            )
          );
          return;
        }
        resolve({
          value: response.access_token,
          expiresAt: Date.now() + response.expires_in * 1000,
          scopes: (response.scope ?? "").split(" ").filter(Boolean)
        });
      },
      error_callback: (error) => reject(new GoogleAuthorizationError(error.message ?? error.type ?? "Google authorization was cancelled"))
    });
    tokenClient.requestAccessToken({ prompt });
  });
}

export async function revokeGoogleAccessToken(accessToken: string): Promise<void> {
  if (!accessToken) {
    return;
  }
  await loadGoogleIdentityServices();
  await new Promise<void>((resolve, reject) => {
    window.google?.accounts.oauth2.revoke(accessToken, (response) => {
      if (response.error) {
        reject(new GoogleAuthorizationError(response.error));
        return;
      }
      resolve();
    });
  });
}

export async function fetchGoogleIdentity(accessToken: string): Promise<GoogleIdentity> {
  const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!response.ok) {
    throw new GoogleAuthorizationError("Google could not identify the authorized account");
  }
  const body = (await response.json()) as Record<string, unknown>;
  if (typeof body.sub !== "string" || body.sub.length === 0) {
    throw new GoogleAuthorizationError("Google returned an invalid account identity");
  }
  return {
    subject: body.sub,
    email: typeof body.email === "string" ? body.email : undefined,
    name: typeof body.name === "string" ? body.name : undefined,
    picture: typeof body.picture === "string" ? body.picture : undefined
  };
}
