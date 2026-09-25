import { join } from "node:path";
import { rm } from "node:fs/promises";
import { CoreStore } from "./coreStore";
import { GoogleOAuthController } from "./googleOAuth";
import { GoogleSyncService } from "./googleSync";

export interface ServiceContainer {
  core: CoreStore;
  googleOAuth: GoogleOAuthController;
  googleSync: GoogleSyncService;
}

export async function createServiceContainer(userDataDirectory: string): Promise<ServiceContainer> {
  const databaseFile = join(userDataDirectory, "hcb.sqlite");
  const core = new CoreStore(databaseFile);
  if (core.didResetDeveloperData) {
    // Credentials are account-scoped in v3. The old single-account envelope
    // cannot be safely associated with a new account row, so clear it as part
    // of the explicitly approved developer reset.
    await rm(join(userDataDirectory, "credentials-v1.bin"), { force: true });
  }
  const googleOAuth = new GoogleOAuthController(userDataDirectory, core);
  const googleSync = new GoogleSyncService(core, googleOAuth);

  return {
    core,
    googleOAuth,
    googleSync
  };
}
