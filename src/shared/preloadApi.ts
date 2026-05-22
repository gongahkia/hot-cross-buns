import type { HcbResult } from "./result";
import type { HealthCheckResponse, StartupTimingSnapshot } from "./diagnostics";

export interface HcbApi {
  diagnostics: {
    health: () => Promise<HcbResult<HealthCheckResponse>>;
    markShellVisible: () => Promise<HcbResult<StartupTimingSnapshot>>;
  };
}
