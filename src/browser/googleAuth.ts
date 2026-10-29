import type { GoogleOptionalWorkspaceService, GoogleStatusResponse } from "../shared/ipc/contracts";
import { conflictError, ok, validationError, type HcbResult } from "../shared/result";

const baseScopes = ["openid", "email", "profile", "https://www.googleapis.com/auth/tasks", "https://www.googleapis.com/auth/calendar"];
const optionalScopes: Record<GoogleOptionalWorkspaceService, string> = {
  drive: "https://www.googleapis.com/auth/drive.metadata.readonly",
  driveUpload: "https://www.googleapis.com/auth/drive.file",
  gmail: "https://www.googleapis.com/auth/gmail.readonly"
};

export interface BrowserGoogleSession {
  accessToken: string;
  expiresAt: number;
  account: { id: string; email?: string; name?: string; picture?: string };
  scopes: string[];
}
interface TokenResponse { access_token?: string; expires_in?: number | string; scope?: string; error?: string }
export interface GoogleTokenClientConfig {
  client_id: string;
  scope: string;
  include_granted_scopes: boolean;
  callback: (response: TokenResponse) => void;
  error_callback: (error: { type?: string }) => void;
}
export interface GoogleIdentityServices {
  initTokenClient(config: GoogleTokenClientConfig): { requestAccessToken(options?: { prompt?: string }): void };
}
interface AuthorizationInput { accountId?: string; requestedServices?: GoogleOptionalWorkspaceService[] }
interface AuthOptions {
  clientId?: string;
  onToken: (session: BrowserGoogleSession, expectedAccountId?: string) => Promise<HcbResult<GoogleStatusResponse>>;
  onDisconnect: (accountId: string, reason: "disconnect" | "expired") => Promise<HcbResult<GoogleStatusResponse>>;
  getIdentityServices?: () => GoogleIdentityServices | undefined;
  fetch?: typeof fetch;
  now?: () => number;
}

/** GIS popup tokens only: no client secret, refresh token, or persistent credential storage. */
export function createBrowserGoogleAuth(options: AuthOptions) {
  const clientId = options.clientId?.trim() || null;
  const identityServices = options.getIdentityServices ?? (() => (window as Window & {
    google?: { accounts?: { oauth2?: GoogleIdentityServices } }
  }).google?.accounts?.oauth2);
  const fetchIdentity = options.fetch ?? globalThis.fetch.bind(globalThis);
  const now = options.now ?? Date.now;
  const expiryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  let authorizationError: string | null = null;
  let pending: { cancel: () => HcbResult<{ cancelled: boolean }> } | null = null;
  let loading: Promise<void> | undefined;

  function status() {
    return { oauthClientConfigured: Boolean(clientId), clientId, hasClientSecret: false,
      authorizationInProgress: pending !== null, authorizationError };
  }

  function preload(): Promise<void> {
    if (!clientId || identityServices()) return Promise.resolve();
    if (loading) return loading;
    loading = new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.onload = () => identityServices() ? resolve() : reject(new Error("Google sign-in did not initialize."));
      script.onerror = () => reject(new Error("Google sign-in could not load. Check your connection and content blockers, then retry."));
      document.head.appendChild(script);
    }).catch((error: unknown) => {
      loading = undefined;
      authorizationError = error instanceof Error ? error.message : "Google sign-in could not load.";
      throw error;
    });
    return loading;
  }

  // Do not insert an await before requestAccessToken: popup activation belongs to the user's click.
  function authorize(input: AuthorizationInput = {}, replaceOptionalScopes = false): Promise<HcbResult<GoogleStatusResponse>> {
    if (!clientId) return Promise.resolve(conflictError("Google sign-in is not configured for this site. Set VITE_GOOGLE_CLIENT_ID to a Web application OAuth client ID and authorize this site's origin. Existing saved workspaces remain available offline."));
    const services = input.requestedServices ?? [];
    if (!Array.isArray(services) || services.some((service) => !Object.hasOwn(optionalScopes, service))) {
      return Promise.resolve(validationError("Choose only Drive links, Drive uploads, or Gmail read-only access."));
    }
    if (pending) return Promise.resolve(conflictError("Finish or cancel the Google authorization already in progress."));
    const gis = identityServices();
    if (!gis) {
      void preload().catch(() => undefined);
      return Promise.resolve(conflictError(authorizationError ?? "Google sign-in is loading. Try Connect Google again in a moment."));
    }
    authorizationError = null;
    return new Promise((resolve) => {
      let settled = false;
      let finalizing = false;
      const finish = (result: HcbResult<GoogleStatusResponse>) => {
        if (settled) return;
        settled = true;
        pending = null;
        if (!result.ok) authorizationError = result.error.message;
        resolve(result);
      };
      pending = { cancel: () => {
        if (finalizing) return conflictError("Google account verification is complete and the connection is being saved. Wait for it to finish, then disconnect if needed.");
        finish(conflictError("Google authorization was cancelled. Your local workspace is unchanged."));
        return ok({ cancelled: true });
      } };
      const receiveToken = async (response: TokenResponse) => {
        if (settled) return;
        if (response.error || !response.access_token) {
          finish(conflictError(response.error === "access_denied"
            ? "Google access was denied. Reconnect and choose the access you want."
            : "Google did not issue an access token. Reconnect to try again."));
          return;
        }
        const expiresIn = Number(response.expires_in);
        if (!Number.isFinite(expiresIn) || expiresIn <= 0) {
          finish(conflictError("Google returned an expired or invalid session. Reconnect to try again."));
          return;
        }
        const expiresAt = now() + expiresIn * 1000;
        try {
          const identityResponse = await fetchIdentity("https://openidconnect.googleapis.com/v1/userinfo", {
            headers: { Authorization: `Bearer ${response.access_token}` }, credentials: "omit", cache: "no-store"
          });
          if (!identityResponse.ok) throw new Error("identity");
          const identity: unknown = await identityResponse.json();
          if (!identity || typeof identity !== "object" || !("sub" in identity) || typeof identity.sub !== "string" || !identity.sub.trim()) throw new Error("identity");
          if (settled) return;
          if (expiresAt <= now()) { finish(conflictError("Your Google session expired while verifying your account. Reconnect to try again.")); return; }
          const profile = identity as Record<string, unknown>;
          finalizing = true;
          const result = await options.onToken({
            accessToken: response.access_token,
            expiresAt,
            account: { id: identity.sub,
              ...(typeof profile.email === "string" ? { email: profile.email } : {}),
              ...(typeof profile.name === "string" ? { name: profile.name } : {}),
              ...(typeof profile.picture === "string" && profile.picture.startsWith("https://") ? { picture: profile.picture } : {}) },
            scopes: typeof response.scope === "string" ? [...new Set(response.scope.split(/\s+/).filter(Boolean))] : []
          }, input.accountId);
          if (result.ok) {
            const accountId = result.data.accounts.find((account) => account.googleAccountId === identity.sub)?.accountId
              ?? (result.data.account?.googleAccountId === identity.sub ? result.data.account.accountId : undefined);
            if (accountId) {
              clearTimeout(expiryTimers.get(accountId));
              expiryTimers.set(accountId, setTimeout(() => {
                expiryTimers.delete(accountId);
                void options.onDisconnect(accountId, "expired").catch(() => undefined);
              }, Math.min(2_147_483_647, Math.max(0, expiresAt - now()))));
            }
          }
          finish(result);
        } catch {
          finish(conflictError("Google account verification or connection failed. Check your connection and reconnect; no unverified account was connected."));
        }
      };
      try {
        const client = gis.initTokenClient({
          client_id: clientId,
          scope: [...baseScopes, ...services.map((service) => optionalScopes[service])].join(" "),
          include_granted_scopes: !replaceOptionalScopes,
          callback: (response) => { void receiveToken(response); },
          error_callback: (error) => finish(conflictError(error.type === "popup_failed_to_open"
            ? "Google's sign-in popup was blocked. Allow popups for this site and click Connect Google again."
            : error.type === "popup_closed" ? "Google's sign-in popup was closed. Reconnect when you are ready."
              : "Google sign-in could not start. Check your connection and try again."))
        });
        client.requestAccessToken({ prompt: replaceOptionalScopes ? "consent" : "select_account" });
      } catch { finish(conflictError("Google sign-in could not open. Allow popups for this site and try again.")); }
    });
  }

  return {
    preload, status,
    beginOAuth: (input?: AuthorizationInput) => authorize(input),
    reconfigureOptionalAccess: (input: AuthorizationInput & { confirmation?: string }) => {
      if (!input.accountId || input.confirmation !== "RECONFIGURE_OPTIONAL_ACCESS") return Promise.resolve(validationError("Confirm which Google account's optional access should change."));
      return authorize(input, true);
    },
    cancelOAuth() { return Promise.resolve(pending?.cancel() ?? ok({ cancelled: false })); },
    async disconnect(input: { accountId: string }) {
      const cancellation = pending?.cancel();
      if (cancellation && !cancellation.ok) return cancellation;
      clearTimeout(expiryTimers.get(input.accountId));
      expiryTimers.delete(input.accountId);
      return options.onDisconnect(input.accountId, "disconnect");
    }
  };
}
