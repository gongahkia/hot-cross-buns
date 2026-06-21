import type { AppDomainServices } from "./domainInterfaces";
import { createMcpDomainServices } from "./placeholder/mcpServices";
import { createPlaceholderNativeServices } from "./placeholder/nativeServices";
import { createPlaceholderApplicationServices } from "./placeholder/plannerServices";
import { createPlaceholderState } from "./placeholder/state";

export function createPlaceholderDomainServices(): AppDomainServices {
  const state = createPlaceholderState();
  const mcpTools = createMcpDomainServices(state);

  return {
    ...createPlaceholderApplicationServices(state),
    native: createPlaceholderNativeServices(),
    mcpTools
  };
}
