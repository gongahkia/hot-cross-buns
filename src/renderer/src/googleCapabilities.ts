import type { GoogleStatusResponse } from "@shared/ipc/contracts";

export const googleScopes = {
  driveSearch: "https://www.googleapis.com/auth/drive.metadata.readonly",
  driveUpload: "https://www.googleapis.com/auth/drive.file",
  gmailCapture: "https://www.googleapis.com/auth/gmail.readonly"
} as const;

export function hasGoogleScope(status: GoogleStatusResponse, accountId: string | undefined, scope: string): boolean {
  const account = accountId
    ? status.accounts.find((candidate) => candidate.accountId === accountId)
    : status.account ?? status.accounts.find((candidate) => candidate.connectionState === "connected");
  return account?.grantedScopes?.includes(scope) ?? false;
}

/** A cached linked account survives token expiry; local placeholders do not qualify. */
export function hasLinkedGoogleAccount(status: GoogleStatusResponse): boolean {
  return status.accounts.some(account => Boolean(account.googleAccountId) &&
    account.accountId !== "local" && account.googleAccountId !== "local" &&
    ["connected", "reauth_required", "error"].includes(account.connectionState));
}
