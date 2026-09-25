import { join } from "node:path";
import { FilePlannerPersistence, PlannerStore } from "./plannerStore";
import { FileSettingsPersistence, SettingsStore } from "./settingsStore";
import { CoreStore } from "./coreStore";
import { GoogleOAuthController } from "./googleOAuth";
import { GoogleSyncService } from "./googleSync";
import type { SettingsDataInfo } from "@shared/settings";

export interface ServiceContainer {
  core: CoreStore;
  googleOAuth: GoogleOAuthController;
  googleSync: GoogleSyncService;
  planner: PlannerStore;
  settings: SettingsStore;
  settingsDataInfo: SettingsDataInfo;
}

export async function createServiceContainer(userDataDirectory: string): Promise<ServiceContainer> {
  const plannerFile = join(userDataDirectory, "planner-v1.json");
  const settingsFile = join(userDataDirectory, "settings-v1.json");
  const databaseFile = join(userDataDirectory, "hcb.sqlite");
  const planner = new PlannerStore({
    persistence: new FilePlannerPersistence(plannerFile)
  });
  const settings = new SettingsStore(new FileSettingsPersistence(settingsFile));
  const core = new CoreStore(databaseFile);
  const googleOAuth = new GoogleOAuthController(userDataDirectory, core);
  const googleSync = new GoogleSyncService(core, googleOAuth);

  // Validate existing local state before exposing any IPC surface.
  await Promise.all([planner.workspace(), settings.load()]);

  return {
    core,
    googleOAuth,
    googleSync,
    planner,
    settings,
    settingsDataInfo: { settingsFile, plannerFile }
  };
}
