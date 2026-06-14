import { randomBytes } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { discoverRuntime, runHcbCli } from "../src/cli/hcb";

interface RuntimeTarget {
  url: "http://127.0.0.1";
  port: number;
  pid?: number;
}

interface PackagedMcpSmokeOptions {
  env: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform | string;
  timeoutMs?: number;
}

const defaultTimeoutMs = 30_000;

export function packagedMcpSmokeRequested(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.HCB_PACKAGED_MCP_SMOKE === "1";
}

export function packagedMcpSmokeChildEnv(
  userDataDir: string,
  env: NodeJS.ProcessEnv = process.env,
  helperBinary?: string
): NodeJS.ProcessEnv {
  const smokeToken = env.HCB_MCP_BEARER_TOKEN?.trim() ||
    env.HCB_PACKAGED_MCP_SMOKE_TOKEN?.trim() ||
    randomBytes(32).toString("base64url");
  const nextEnv: NodeJS.ProcessEnv = {
    ...env,
    HCB_ALLOW_PACKAGED_USER_DATA_DIR: "1",
    HCB_MCP_BEARER_TOKEN: smokeToken,
    HCB_PACKAGED_MCP_SMOKE: "1",
    HCB_PACKAGED_MCP_SMOKE_TOKEN: smokeToken,
    HCB_USER_DATA_DIR: userDataDir
  };

  if (helperBinary) {
    nextEnv.HCB_MCP_SAFE_STORAGE_BINARY = helperBinary;
  }

  return nextEnv;
}

export function packagedMcpSmokePersistedChildEnv(
  userDataDir: string,
  env: NodeJS.ProcessEnv = process.env,
  helperBinary?: string
): NodeJS.ProcessEnv {
  const nextEnv: NodeJS.ProcessEnv = {
    ...env,
    HCB_ALLOW_PACKAGED_USER_DATA_DIR: "1",
    HCB_PACKAGED_MCP_SMOKE: "1",
    HCB_USER_DATA_DIR: userDataDir
  };

  delete nextEnv.HCB_MCP_BEARER_TOKEN;
  delete nextEnv.HCB_PACKAGED_MCP_SMOKE_TOKEN;

  if (helperBinary) {
    nextEnv.HCB_MCP_SAFE_STORAGE_BINARY = helperBinary;
  }

  return nextEnv;
}

export async function runPackagedMcpSmoke(options: PackagedMcpSmokeOptions): Promise<string[]> {
  const platform = options.platform ?? process.platform;
  const runtime = await waitForRuntime(options.env, platform, options.timeoutMs ?? defaultTimeoutMs);
  await expectUnauthorizedRejected(runtime);
  await expectHcbDoctor(options.env, platform);

  return [
    `Packaged MCP runtime file resolved port ${runtime.port}.`,
    "Packaged MCP rejected an unauthorized request.",
    "Packaged HCB CLI doctor succeeded through CLI runtime discovery and smoke token auth."
  ];
}

async function waitForRuntime(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform | string,
  timeoutMs: number
): Promise<RuntimeTarget> {
  const deadline = Date.now() + timeoutMs;
  let lastError = "HCB MCP server not running.";

  while (Date.now() < deadline) {
    try {
      return discoverRuntime({ env, platform });
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      await delay(250);
    }
  }

  throw new Error(`Packaged MCP runtime file was not ready after ${timeoutMs}ms: ${lastError}`);
}

async function expectUnauthorizedRejected(runtime: RuntimeTarget): Promise<void> {
  const response = await fetch(`${runtime.url}:${runtime.port}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "packaged-mcp-unauthorized-smoke",
      method: "resources/read",
      params: { uri: "hcb://status" }
    })
  });

  if (response.status !== 401) {
    throw new Error(`Packaged MCP unauthorized request returned ${response.status}, expected 401.`);
  }
}

async function expectHcbDoctor(env: NodeJS.ProcessEnv, platform: NodeJS.Platform | string): Promise<void> {
  let stdoutText = "";
  let stderrText = "";
  const exitCode = await runHcbCli(["doctor"], {
    env,
    platform,
    stdout: {
      write: (chunk: string | Uint8Array) => {
        stdoutText += String(chunk);
        return true;
      }
    },
    stderr: {
      write: (chunk: string | Uint8Array) => {
        stderrText += String(chunk);
        return true;
      }
    }
  });

  if (exitCode !== 0 || !stdoutText.includes("HCB doctor:")) {
    throw new Error(`Packaged HCB CLI doctor failed: ${stderrText || stdoutText}`);
  }
}
