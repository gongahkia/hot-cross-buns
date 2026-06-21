import type {
  GoogleBeginOAuthResponse,
  GoogleDisconnectRequest,
  GoogleSaveOAuthClientRequest,
  GoogleStatusResponse
} from "@shared/ipc/contracts";
import { HcbPublicError } from "@shared/ipc/result";
import type { GoogleSyncRepository } from "../sync/readSyncRepository";
import type { GoogleControlDomainService } from "./domainInterfaces";

export function createUnavailableGoogleDomainService(
  repository: GoogleSyncRepository
): GoogleControlDomainService {
  return {
    status: (): GoogleStatusResponse => ({
      oauthClientConfigured: false,
      clientId: null,
      hasClientSecret: false,
      accounts: repository.accountStatuses().map((account) => account as NonNullable<GoogleStatusResponse["account"]>),
      ...(repository.latestAccountStatus() === null
        ? {}
        : { account: repository.latestAccountStatus() as NonNullable<GoogleStatusResponse["account"]> })
    }),
    saveOAuthClient: (_request: GoogleSaveOAuthClientRequest): GoogleStatusResponse => {
      throw unavailableGoogleRuntime("Google OAuth runtime wiring is unavailable in this domain service.");
    },
    beginOAuth: (): GoogleBeginOAuthResponse => {
      throw unavailableGoogleRuntime("Google OAuth browser handoff is unavailable in this domain service.");
    },
    disconnect: (_request: GoogleDisconnectRequest): GoogleStatusResponse => {
      throw unavailableGoogleRuntime("Google OAuth disconnect is unavailable in this domain service.");
    }
  };
}

function unavailableGoogleRuntime(message: string): HcbPublicError {
  return new HcbPublicError({
    code: "SERVICE_UNAVAILABLE",
    message,
    recoverable: true
  });
}
