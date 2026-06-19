import type { McpSetEnabledRequest, McpStatusResponse } from "@shared/ipc/contracts";
import { existsSync } from "node:fs";
import { isAbsolute } from "node:path";
import { appLogger } from "./diagnostics/appLogger";
import type { MaybePromise } from "./services/domainInterfaces";

interface PackagedMcpSmokeServices {
  domain: {
    mcp: {
      setEnabled: (request: McpSetEnabledRequest) => MaybePromise<McpStatusResponse>;
    };
  };
}

export function shouldEnablePackagedMcpSmoke(env: NodeJS.ProcessEnv, isPackaged: boolean): boolean {
  return isPackaged &&
    env.HCB_PACKAGED_MCP_SMOKE === "1" &&
    env.HCB_ALLOW_PACKAGED_USER_DATA_DIR === "1";
}

export function shouldEnablePackagedHosterSmoke(env: NodeJS.ProcessEnv, isPackaged: boolean): boolean {
  return shouldEnablePackagedMcpSmoke(env, isPackaged) &&
    env.HCB_PACKAGED_HOSTER_SMOKE === "1";
}

export function packagedMcpSmokeTokenSeed(env: NodeJS.ProcessEnv, isPackaged: boolean): string | undefined {
  if (!shouldEnablePackagedMcpSmoke(env, isPackaged)) {
    return undefined;
  }

  return env.HCB_PACKAGED_MCP_SMOKE_TOKEN?.trim() || undefined;
}

export function packagedMcpSmokeExitFile(env: NodeJS.ProcessEnv, isPackaged: boolean): string | undefined {
  if (!shouldEnablePackagedMcpSmoke(env, isPackaged)) {
    return undefined;
  }

  const exitFile = env.HCB_PACKAGED_MCP_SMOKE_EXIT_FILE?.trim();
  return exitFile && isAbsolute(exitFile) ? exitFile : undefined;
}

export function startPackagedMcpSmokeExitWatcher(
  env: NodeJS.ProcessEnv,
  isPackaged: boolean,
  quit: () => void,
  intervalMs = 250
): boolean {
  const exitFile = packagedMcpSmokeExitFile(env, isPackaged);

  if (!exitFile) {
    return false;
  }

  const timer = setInterval(() => {
    if (!existsSync(exitFile)) {
      return;
    }

    clearInterval(timer);
    quit();
  }, intervalMs);

  timer.unref?.();
  return true;
}

export async function applyPackagedMcpSmokeSettings(
  services: PackagedMcpSmokeServices,
  env: NodeJS.ProcessEnv,
  isPackaged: boolean
): Promise<boolean> {
  if (!shouldEnablePackagedMcpSmoke(env, isPackaged)) {
    return false;
  }

  const status = await services.domain.mcp.setEnabled({
    enabled: true,
    permissionMode: shouldEnablePackagedHosterSmoke(env, isPackaged) ? "confirm-writes" : "read-only",
    port: 0
  } satisfies McpSetEnabledRequest);

  if (!status.running || !status.url) {
    throw new Error("Packaged MCP smoke could not start the local loopback server.");
  }

  appLogger.info("packaged MCP smoke enabled", "mcp", {
    port: status.port,
    permissionMode: status.permissionMode
  });
  return true;
}
