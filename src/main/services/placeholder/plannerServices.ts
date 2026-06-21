import type { AppDomainServices } from "../domainInterfaces";
import { createPlaceholderControlServices } from "./controlServices";
import { createPlaceholderPlannerViewService } from "./plannerViewServices";
import type { PlaceholderState } from "./state";

type PlaceholderApplicationServices = Omit<AppDomainServices, "native" | "mcpTools">;

export function createPlaceholderApplicationServices(
  state: PlaceholderState
): PlaceholderApplicationServices {
  return {
    planner: createPlaceholderPlannerViewService(state),
    ...createPlaceholderControlServices(state)
  };
}
