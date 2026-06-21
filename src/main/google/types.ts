export const GOOGLE_TASKS_SCOPE = "https://www.googleapis.com/auth/tasks";
export const GOOGLE_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar";
export const GOOGLE_OPENID_SCOPE = "openid";
export const GOOGLE_EMAIL_SCOPE = "email";
export const GOOGLE_PROFILE_SCOPE = "profile";

export const REQUIRED_GOOGLE_SCOPES = [GOOGLE_TASKS_SCOPE, GOOGLE_CALENDAR_SCOPE] as const;
export const DEFAULT_GOOGLE_AUTHORIZATION_SCOPES = [
  GOOGLE_TASKS_SCOPE,
  GOOGLE_CALENDAR_SCOPE,
  GOOGLE_OPENID_SCOPE,
  GOOGLE_EMAIL_SCOPE,
  GOOGLE_PROFILE_SCOPE
] as const;

export type GoogleOAuthScope = (typeof DEFAULT_GOOGLE_AUTHORIZATION_SCOPES)[number] | string;

export type GoogleConnectionState =
  | "signed_out"
  | "connected"
  | "reauth_required"
  | "sync_paused";

export interface GoogleStoredTokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
  scope?: string;
  tokenType?: string;
}

export interface GoogleAccountConnectionRecord {
  accountId: string;
  googleAccountId?: string;
  email?: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  locale?: string | null;
  timeZone?: string | null;
  connectionState: GoogleConnectionState;
  grantedScopes?: readonly string[] | string;
  lastAuthenticatedAt?: string;
  createdAt?: string;
  updatedAt: string;
}

export interface GoogleAccountConnectionStatusDto {
  accountId: string;
  googleAccountId?: string;
  email?: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  locale?: string | null;
  timeZone?: string | null;
  connectionState: GoogleConnectionState;
  grantedScopes: readonly string[];
  missingScopes: readonly string[];
  lastAuthenticatedAt?: string;
  updatedAt: string;
}

export function normalizeGoogleScopes(scopes: readonly string[] | string | undefined): string[] {
  if (scopes === undefined) {
    return [];
  }

  const rawScopes: readonly string[] =
    typeof scopes === "string" ? scopes.split(/\s+/) : scopes;

  return [...new Set(rawScopes.map((scope: string) => scope.trim()).filter((scope) => scope.length > 0))].sort();
}

export function missingRequiredGoogleScopes(scopes: readonly string[] | string | undefined): string[] {
  const granted = new Set(normalizeGoogleScopes(scopes));

  return REQUIRED_GOOGLE_SCOPES.filter((scope) => !granted.has(scope));
}

export function sanitizeGoogleAccountConnectionStatus(
  record: GoogleAccountConnectionRecord
): GoogleAccountConnectionStatusDto {
  const grantedScopes = normalizeGoogleScopes(record.grantedScopes);
  const missingScopes = missingRequiredGoogleScopes(grantedScopes);
  const connectionState =
    record.connectionState === "connected" && missingScopes.length > 0
      ? "reauth_required"
      : record.connectionState;

  return {
    accountId: record.accountId,
    ...(record.googleAccountId === undefined ? {} : { googleAccountId: record.googleAccountId }),
    ...(record.email === undefined ? {} : { email: record.email }),
    ...(record.displayName === undefined ? {} : { displayName: record.displayName }),
    ...(record.avatarUrl === undefined ? {} : { avatarUrl: record.avatarUrl }),
    ...(record.locale === undefined ? {} : { locale: record.locale }),
    ...(record.timeZone === undefined ? {} : { timeZone: record.timeZone }),
    connectionState,
    grantedScopes,
    missingScopes,
    ...(record.lastAuthenticatedAt === undefined
      ? {}
      : { lastAuthenticatedAt: record.lastAuthenticatedAt }),
    updatedAt: record.updatedAt
  };
}
