import { getRedirectUri, launchWebAuthFlow } from "./extensionApi";
import { clearAccessToken, loadAccessToken, loadSettings, saveAccessToken } from "./storage";
import { GOOGLE_READONLY_SCOPES, type AuthStatus, type StoredAccessToken } from "./types";

interface OAuthTokenResponse {
  access_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
}

interface GoogleProfileResponse {
  email?: string;
}

export async function authStatus(now = Date.now()): Promise<AuthStatus> {
  const [settings, token] = await Promise.all([loadSettings(), loadAccessToken(now)]);
  return {
    configured: settings.googleClientId.length > 0,
    signedIn: Boolean(token),
    redirectUri: getRedirectUri("google"),
    ...(token?.expiresAt === undefined ? {} : { expiresAt: token.expiresAt }),
    ...(token?.accountEmail === undefined ? {} : { accountEmail: token.accountEmail })
  };
}

export async function authenticateWithGoogle(now = Date.now(), fetchImpl: typeof fetch = fetch): Promise<AuthStatus> {
  const settings = await loadSettings();

  if (!settings.googleClientId) {
    throw new Error("Google OAuth client ID is not configured.");
  }

  const redirectUri = getRedirectUri("google");
  const verifier = createCodeVerifier();
  const challenge = await createPkceChallengeFromVerifier(verifier);
  const state = createOAuthState();
  const authUrl = googleAuthorizationUrl({
    clientId: settings.googleClientId,
    redirectUri,
    state,
    challenge
  });
  const redirectedTo = await launchWebAuthFlow(authUrl);
  const code = parseOAuthRedirect(redirectedTo, state);
  const token = await exchangeCodeForToken({
    clientId: settings.googleClientId,
    redirectUri,
    code,
    verifier,
    now,
    fetchImpl
  });
  const accountEmail = await fetchGoogleProfile(token.accessToken, fetchImpl).catch(() => undefined);
  const storedToken = {
    ...token,
    ...(accountEmail === undefined ? {} : { accountEmail })
  };
  await saveAccessToken(storedToken);
  return authStatus(now);
}

export async function signOut(): Promise<AuthStatus> {
  await clearAccessToken();
  return authStatus();
}

export function createCodeVerifier(): string {
  return base64Url(randomBytes(64));
}

export function createOAuthState(): string {
  return base64Url(randomBytes(32));
}

export async function createPkceChallengeFromVerifier(verifier: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

export function googleAuthorizationUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
  challenge: string;
}): string {
  const params = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    response_type: "code",
    scope: GOOGLE_READONLY_SCOPES.join(" "),
    state: input.state,
    code_challenge: input.challenge,
    code_challenge_method: "S256",
    include_granted_scopes: "true",
    prompt: "select_account"
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export function parseOAuthRedirect(redirectedTo: string, expectedState: string): string {
  const url = new URL(redirectedTo);
  const query = new URLSearchParams(url.search);
  const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
  const params = query.size > 0 ? query : hash;
  const state = params.get("state");

  if (state !== expectedState) {
    throw new Error("OAuth state mismatch.");
  }

  const error = params.get("error");

  if (error) {
    throw new Error(params.get("error_description") ?? error);
  }

  const code = params.get("code");

  if (!code) {
    throw new Error("OAuth redirect did not include an authorization code.");
  }

  return code;
}

async function exchangeCodeForToken(input: {
  clientId: string;
  redirectUri: string;
  code: string;
  verifier: string;
  now: number;
  fetchImpl: typeof fetch;
}): Promise<StoredAccessToken> {
  const response = await input.fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      client_id: input.clientId,
      redirect_uri: input.redirectUri,
      code: input.code,
      code_verifier: input.verifier,
      grant_type: "authorization_code"
    })
  });
  const payload = await response.json() as OAuthTokenResponse;

  if (!response.ok || payload.error) {
    throw new Error(payload.error_description ?? payload.error ?? "Google token exchange failed.");
  }

  if (!payload.access_token || typeof payload.expires_in !== "number") {
    throw new Error("Google token exchange returned an invalid token payload.");
  }

  return {
    accessToken: payload.access_token,
    expiresAt: input.now + Math.max(0, payload.expires_in - 60) * 1000,
    scope: payload.scope ?? GOOGLE_READONLY_SCOPES.join(" ")
  };
}

async function fetchGoogleProfile(accessToken: string, fetchImpl: typeof fetch): Promise<string | undefined> {
  const response = await fetchImpl("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
    return undefined;
  }

  const payload = await response.json() as GoogleProfileResponse;
  return typeof payload.email === "string" ? payload.email : undefined;
}

function randomBytes(size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return globalThis.btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}
