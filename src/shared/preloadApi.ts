import type { HcbResult } from "./result";
import type { HealthCheckResponse, StartupTimingSnapshot } from "./diagnostics";
import type { AppSettings, SettingsDataInfo } from "./settings";
import type {
  PlannerCompleteTaskRequest,
  PlannerSaveTaskRequest,
  PlannerSyncStatus,
  PlannerTaskListRequest,
  PlannerTaskMutationResult,
  PlannerTaskPage,
  PlannerWorkspace
} from "./planner";

export interface HcbApi {
  diagnostics: {
    health: () => Promise<HcbResult<HealthCheckResponse>>;
    markShellVisible: () => Promise<HcbResult<StartupTimingSnapshot>>;
  };
  planner: {
    workspace: () => Promise<HcbResult<PlannerWorkspace>>;
    listTasks: (request: PlannerTaskListRequest) => Promise<HcbResult<PlannerTaskPage>>;
    saveTask: (request: PlannerSaveTaskRequest) => Promise<HcbResult<PlannerTaskMutationResult>>;
    completeTask: (
      request: PlannerCompleteTaskRequest
    ) => Promise<HcbResult<PlannerTaskMutationResult>>;
    syncStatus: () => Promise<HcbResult<PlannerSyncStatus>>;
  };
  settings: {
    get: () => Promise<HcbResult<AppSettings>>;
    save: (settings: AppSettings) => Promise<HcbResult<AppSettings>>;
    dataInfo: () => Promise<HcbResult<SettingsDataInfo>>;
  };
}
