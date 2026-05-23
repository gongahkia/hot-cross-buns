import {
  sanitizeGoogleAccountConnectionStatus,
  type GoogleAccountConnectionStatusDto
} from "./types";
import type {
  GoogleBeginOAuthResponse,
  GoogleDisconnectRequest,
  GoogleSaveOAuthClientRequest,
  GoogleStatusResponse
} from "@shared/ipc/contracts";
import type { GoogleSyncRepository } from "../sync/readSyncRepository";
import type { GoogleCredentialAdapter } from "./credentials";
import type { GoogleOAuthClientConfigStore } from "./runtimeConfig";
import type { GoogleOAuthLoopbackController } from "./oauthLoopback";

export interface GoogleRuntimeServiceOptions {
  configStore: GoogleOAuthClientConfigStore;
  credentialAdapter: GoogleCredentialAdapter;
  syncRepository: GoogleSyncRepository;
  loopback: GoogleOAuthLoopbackController;
}

export class GoogleRuntimeService {
  constructor(private readonly options: GoogleRuntimeServiceOptions) {}

  async status(): Promise<GoogleStatusResponse> {
    const config = await this.options.configStore.snapshot();
    const account = this.options.syncRepository.latestAccountStatus();

    return {
      oauthClientConfigured: config.configured,
      clientId: config.clientId,
      hasClientSecret: config.hasClientSecret,
      ...(account === null ? {} : { account: accountForIpc(account) })
    };
  }

  async saveOAuthClient(request: GoogleSaveOAuthClientRequest): Promise<GoogleStatusResponse> {
    await this.options.configStore.save({
      clientId: request.clientId,
      ...("clientSecret" in request ? { clientSecret: request.clientSecret } : {})
    });

    return this.status();
  }

  async beginOAuth(): Promise<GoogleBeginOAuthResponse> {
    const result = await this.options.loopback.beginAuthorization();

    return {
      accepted: true,
      openedExternalBrowser: result.openedExternalBrowser,
      expiresAt: result.expiresAt,
      scopes: [...result.scopes],
      redirectUri: result.redirectUri,
      message: "Google authorization opened in the browser."
    };
  }

  async disconnect(request: GoogleDisconnectRequest): Promise<GoogleStatusResponse> {
    const accountId = request.accountId ?? this.options.syncRepository.latestAccountStatus()?.accountId;

    if (!accountId) {
      return this.status();
    }

    await this.options.credentialAdapter.deleteTokenSet(accountId);

    const prior = this.options.syncRepository.accountStatus(accountId);
    const now = new Date().toISOString();
    const status = sanitizeGoogleAccountConnectionStatus({
      accountId,
      ...(prior?.googleAccountId === undefined ? {} : { googleAccountId: prior.googleAccountId }),
      ...(prior?.email === undefined ? {} : { email: prior.email }),
      ...(prior?.displayName === undefined ? {} : { displayName: prior.displayName }),
      ...(prior?.avatarUrl === undefined ? {} : { avatarUrl: prior.avatarUrl }),
      ...(prior?.locale === undefined ? {} : { locale: prior.locale }),
      ...(prior?.timeZone === undefined ? {} : { timeZone: prior.timeZone }),
      connectionState: "signed_out",
      grantedScopes: [],
      updatedAt: now
    });

    this.options.syncRepository.upsertAccountStatus(status);

    return this.status();
  }
}

function accountForIpc(
  account: GoogleAccountConnectionStatusDto
): GoogleStatusResponse["account"] {
  return {
    ...account,
    grantedScopes: [...account.grantedScopes],
    missingScopes: [...account.missingScopes]
  };
}
