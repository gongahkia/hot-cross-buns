import type { McpSetEnabledRequest, McpStatusResponse } from "@shared/ipc/contracts";
import { appLogger } from "./diagnostics/appLogger";
import type { MaybePromise } from "./services/domainInterfaces";

interface PackagedMcpSmokeServices {
  domain: {
    mcp: {
      setEnabled: (request: McpSetEnabledRequest) => MaybePromise<McpStatusResponse>;
    };
  };
}

const smokeRequest: McpSetEnabledRequest = {
  enabled: true,
  permissionMode: "read-only",
  port: 0
};

export function shouldEnablePackagedMcpSmoke(env: NodeJS.ProcessEnv, isPackaged: boolean): boolean {
  return isPackaged &&
    env.HCB_PACKAGED_MCP_SMOKE === "1" &&
    env.HCB_ALLOW_PACKAGED_USER_DATA_DIR === "1";
}

export async function applyPackagedMcpSmokeSettings(
  services: PackagedMcpSmokeServices,
  env: NodeJS.ProcessEnv,
  isPackaged: boolean
): Promise<boolean> {
  if (!shouldEnablePackagedMcpSmoke(env, isPackaged)) {
    return false;
  }

  const status = await services.domain.mcp.setEnabled(smokeRequest);

  if (!status.running || !status.url) {
    throw new Error("Packaged MCP smoke could not start the local loopback server.");
  }

  appLogger.info("packaged MCP smoke enabled", "mcp", {
    port: status.port,
    permissionMode: status.permissionMode
  });
  return true;
}
