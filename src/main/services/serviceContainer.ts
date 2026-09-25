import { join } from "node:path";
import { FilePlannerPersistence, PlannerStore } from "./plannerStore";

export interface ServiceContainer {
  planner: PlannerStore;
}

export async function createServiceContainer(userDataDirectory: string): Promise<ServiceContainer> {
  const planner = new PlannerStore({
    persistence: new FilePlannerPersistence(join(userDataDirectory, "planner-v1.json"))
  });

  // Validate existing local state before exposing any IPC surface.
  await planner.workspace();

  return { planner };
}
