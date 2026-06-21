import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { StaticMcpCredentialAdapter } from "../src/main/mcp/credentials";
import { writeMcpRuntimeFile } from "../src/main/mcp/runtimeFile";
import { LocalMcpServer } from "../src/main/mcp/server";
import { createMcpTestDomainServices } from "../src/main/mcp/testDomainDoubles";
import { McpToolRegistry } from "../src/main/mcp/toolRegistry";
import { MemorySecretStore } from "../src/main/credentials/secretStore";
import { createServiceContainer } from "../src/main/services/serviceContainer";
import {
  packagedHosterSmokeRequested,
  packagedMcpSmokeChildEnv,
  packagedMcpSmokePersistedChildEnv,
  packagedMcpSmokeRequested,
  runPackagedMcpSmoke
} from "./packaged-mcp-smoke";

describe("packaged MCP smoke", () => {
  it("sets the child app env required by packaged smoke startup", () => {
    expect(packagedMcpSmokeRequested({ HCB_PACKAGED_MCP_SMOKE: "1" })).toBe(true);
    expect(packagedMcpSmokeRequested({})).toBe(false);
    expect(packagedHosterSmokeRequested({
      HCB_PACKAGED_MCP_SMOKE: "1",
      HCB_PACKAGED_HOSTER_SMOKE: "1"
    })).toBe(true);
    const env = packagedMcpSmokeChildEnv("/tmp/hcb-smoke", { PATH: "/usr/bin" }, "/opt/hcb/Hot Cross Buns");

    expect(env).toMatchObject({
      HCB_ALLOW_PACKAGED_USER_DATA_DIR: "1",
      HCB_MCP_SAFE_STORAGE_BINARY: "/opt/hcb/Hot Cross Buns",
      HCB_PACKAGED_MCP_SMOKE: "1",
      HCB_USER_DATA_DIR: "/tmp/hcb-smoke",
      PATH: "/usr/bin"
    });
    expect(env.HCB_MCP_BEARER_TOKEN).toEqual(expect.any(String));
    expect(env.HCB_PACKAGED_MCP_SMOKE_TOKEN).toBe(env.HCB_MCP_BEARER_TOKEN);
  });

  it("sets restart env that forces CLI auth through persisted safeStorage", () => {
    const env = packagedMcpSmokePersistedChildEnv("/tmp/hcb-smoke", {
      HCB_MCP_BEARER_TOKEN: "seed-token",
      HCB_PACKAGED_MCP_SMOKE_TOKEN: "seed-token",
      PATH: "/usr/bin"
    }, "/opt/hcb/Hot Cross Buns");

    expect(env).toMatchObject({
      HCB_ALLOW_PACKAGED_USER_DATA_DIR: "1",
      HCB_MCP_SAFE_STORAGE_BINARY: "/opt/hcb/Hot Cross Buns",
      HCB_PACKAGED_MCP_SMOKE: "1",
      HCB_USER_DATA_DIR: "/tmp/hcb-smoke",
      PATH: "/usr/bin"
    });
    expect(env.HCB_MCP_BEARER_TOKEN).toBeUndefined();
    expect(env.HCB_PACKAGED_MCP_SMOKE_TOKEN).toBeUndefined();
  });

  it("verifies runtime discovery, unauthorized rejection, and CLI doctor", async () => {
    const directory = mkdtempSync(join(tmpdir(), "hcb-packaged-mcp-smoke-"));
    const runtimeFile = join(directory, "config", "mcp-runtime.json");
    const token = "packaged-smoke-token";
    const server = new LocalMcpServer({
      credentialAdapter: new StaticMcpCredentialAdapter(token, "smoke"),
      permissionProvider: {
        getMode: () => "read-only"
      },
      toolRegistry: new McpToolRegistry(createMcpTestDomainServices())
    });

    try {
      const port = await server.start(0);
      writeMcpRuntimeFile(runtimeFile, port);

      await expect(runPackagedMcpSmoke({
        env: {
          HCB_MCP_RUNTIME_FILE: runtimeFile,
          HCB_MCP_BEARER_TOKEN: token
        },
        platform: "linux",
        timeoutMs: 1_000
      })).resolves.toEqual([
        expect.stringContaining("Packaged MCP runtime file resolved port"),
        "Packaged MCP rejected an unauthorized request.",
        "Packaged HCB CLI doctor succeeded through CLI runtime discovery and smoke token auth."
      ]);
    } finally {
      await server.stop();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("verifies hoster lifecycle and signal dispatch through packaged smoke", async () => {
    const directory = mkdtempSync(join(tmpdir(), "hcb-packaged-hoster-smoke-"));
    const runtimeFile = join(directory, "config", "mcp-runtime.json");
    const token = "packaged-hoster-smoke-token";
    const services = createServiceContainer({
      appSupportDirectory: join(directory, "app-support"),
      secretStore: new MemorySecretStore(),
      mcpBearerTokenSeed: token
    });
    const server = new LocalMcpServer({
      credentialAdapter: new StaticMcpCredentialAdapter(token, "hoster-smoke"),
      permissionProvider: {
        getMode: () => "confirm-writes"
      },
      toolRegistry: services.mcpTools
    });

    try {
      const port = await server.start(0);
      writeMcpRuntimeFile(runtimeFile, port);

      await expect(runPackagedMcpSmoke({
        env: {
          HCB_MCP_RUNTIME_FILE: runtimeFile,
          HCB_MCP_BEARER_TOKEN: token,
          HCB_PACKAGED_MCP_SMOKE: "1",
          HCB_PACKAGED_HOSTER_SMOKE: "1"
        },
        platform: "linux",
        timeoutMs: 1_000
      })).resolves.toEqual([
        expect.stringContaining("Packaged MCP runtime file resolved port"),
        "Packaged MCP rejected an unauthorized request.",
        "Packaged HCB CLI doctor succeeded through CLI runtime discovery and smoke token auth.",
        expect.stringContaining("Packaged hoster started on port"),
        "Packaged HCB CLI created a hoster profile through MCP confirmation.",
        "Packaged HCB CLI sent a loopback hoster signal."
      ]);
    } finally {
      await server.stop();
      await services.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("fails when the packaged runtime file is not created", async () => {
    const directory = mkdtempSync(join(tmpdir(), "hcb-packaged-mcp-missing-"));

    try {
      await expect(runPackagedMcpSmoke({
        env: {
          HCB_MCP_RUNTIME_FILE: join(directory, "missing.json"),
          HCB_MCP_BEARER_TOKEN: "token"
        },
        platform: "linux",
        timeoutMs: 50
      })).rejects.toThrow("Packaged MCP runtime file was not ready");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
