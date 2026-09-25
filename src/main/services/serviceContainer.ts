import { join } from "node:path";
import { FilePlannerPersistence, PlannerStore } from "./plannerStore";
import { FileSettingsPersistence, SettingsStore } from "./settingsStore";
import type { SettingsDataInfo } from "@shared/settings";

export interface ServiceContainer {
  planner: PlannerStore;
  settings: SettingsStore;
  settingsDataInfo: SettingsDataInfo;
}

export async function createServiceContainer(userDataDirectory: string): Promise<ServiceContainer> {
  const plannerFile = join(userDataDirectory, "planner-v1.json");
  const settingsFile = join(userDataDirectory, "settings-v1.json");
  const planner = new PlannerStore({
    persistence: new FilePlannerPersistence(plannerFile)
  });
  const settings = new SettingsStore(new FileSettingsPersistence(settingsFile));

  // Validate existing local state before exposing any IPC surface.
  await Promise.all([planner.workspace(), settings.load()]);

  return {
    planner,
    settings,
    settingsDataInfo: { settingsFile, plannerFile }
  };
}
