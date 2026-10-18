import { join } from "node:path";
import { rm } from "node:fs/promises";
import { CoreStore } from "./coreStore";
import { GoogleOAuthController, type GoogleOAuthPlatform } from "./googleOAuth";
import { GoogleSyncService } from "./googleSync";
import { LocalBackupService } from "./localBackups";

export interface ServiceContainer {
  core: CoreStore;
  googleOAuth: GoogleOAuthController;
  googleSync: GoogleSyncService;
  backups: LocalBackupService;
}

export async function createServiceContainer(userDataDirectory: string, platform: GoogleOAuthPlatform): Promise<ServiceContainer> {
  const databaseFile = join(userDataDirectory, "hcb.sqlite");
  const core = new CoreStore(databaseFile);
  if (core.didResetDeveloperData) {
    // Credentials are account-scoped in v3. The old single-account envelope
    // cannot be safely associated with a new account row, so clear it as part
    // of the explicitly approved developer reset.
    await rm(join(userDataDirectory, "credentials-v1.bin"), { force: true });
  }
  const googleOAuth = new GoogleOAuthController(userDataDirectory, core, platform);
  const googleSync = new GoogleSyncService(core, googleOAuth);
  const backups = new LocalBackupService(core, userDataDirectory);

  return {
    core,
    googleOAuth,
    googleSync,
    backups
  };
}
