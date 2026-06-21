import type { GoogleSyncRepository } from "../sync/readSyncRepository";
import {
  GoogleApiError,
  GoogleHttpApiTransport,
  type GoogleApiRequest,
  type GoogleApiResponseMetadata,
  type GoogleApiTransport,
  type GoogleAccessTokenProvider
} from "./transport";

export class LatestGoogleAccountApiTransport implements GoogleApiTransport {
  constructor(
    private readonly options: {
      repository: GoogleSyncRepository;
      tokenProvider: GoogleAccessTokenProvider;
      baseUrl?: string;
      fetchImpl?: typeof fetch;
    }
  ) {}

  async getJson<T>(request: GoogleApiRequest): Promise<T> {
    return this.transport().getJson<T>(request);
  }

  async getJsonWithMetadata<T>(request: GoogleApiRequest): Promise<{
    data: T;
    metadata: GoogleApiResponseMetadata;
  }> {
    return this.transport().getJsonWithMetadata<T>(request);
  }

  async send(request: GoogleApiRequest): Promise<void> {
    await this.transport().send(request);
  }

  private transport(): GoogleHttpApiTransport {
    const account = this.options.repository.latestAccountStatus();

    if (account?.connectionState !== "connected") {
      throw new GoogleApiError({
        kind: "unauthorized",
        message: "Google account is not connected."
      });
    }

    return new GoogleHttpApiTransport({
      accountId: account.accountId,
      tokenProvider: this.options.tokenProvider,
      ...(this.options.baseUrl === undefined ? {} : { baseUrl: this.options.baseUrl }),
      ...(this.options.fetchImpl === undefined ? {} : { fetchImpl: this.options.fetchImpl })
    });
  }
}
