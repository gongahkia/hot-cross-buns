import type { GoogleSyncRepository } from "../sync/readSyncRepository";
import type { GoogleOAuthAccountStatusStore } from "./oauth";
import type { GoogleAccountConnectionStatusDto } from "./types";

export class RepositoryGoogleOAuthAccountStatusStore implements GoogleOAuthAccountStatusStore {
  constructor(private readonly repository: GoogleSyncRepository) {}

  async saveStatus(status: GoogleAccountConnectionStatusDto): Promise<void> {
    this.repository.upsertAccountStatus(status);
  }

  async getStatus(accountId: string): Promise<GoogleAccountConnectionStatusDto | null> {
    return this.repository.accountStatus(accountId);
  }

  async listStatuses(): Promise<readonly GoogleAccountConnectionStatusDto[]> {
    const latest = this.repository.latestAccountStatus();

    return latest === null ? [] : [latest];
  }
}
