import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { StaticMcpCredentialAdapter } from "../src/main/mcp/credentials";
import { writeMcpRuntimeFile } from "../src/main/mcp/runtimeFile";
import { LocalMcpServer } from "../src/main/mcp/server";
import { createMcpTestDomainServices } from "../src/main/mcp/testDomainDoubles";
import { McpToolRegistry } from "../src/main/mcp/toolRegistry";
import {
  packagedMcpSmokeChildEnv,
  packagedMcpSmokeRequested,
  runPackagedMcpSmoke
} from "./packaged-mcp-smoke";

describe("packaged MCP smoke", () => {
  it("sets the child app env required by packaged smoke startup", () => {
    expect(packagedMcpSmokeRequested({ HCB_PACKAGED_MCP_SMOKE: "1" })).toBe(true);
    expect(packagedMcpSmokeRequested({})).toBe(false);
    expect(packagedMcpSmokeChildEnv("/tmp/hcb-smoke", { PATH: "/usr/bin" }, "/opt/hcb/Hot Cross Buns 2")).toMatchObject({
      HCB_ALLOW_PACKAGED_USER_DATA_DIR: "1",
      HCB_MCP_SAFE_STORAGE_BINARY: "/opt/hcb/Hot Cross Buns 2",
      HCB_PACKAGED_MCP_SMOKE: "1",
      HCB_USER_DATA_DIR: "/tmp/hcb-smoke",
      PATH: "/usr/bin"
    });
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
        "Packaged HCB CLI doctor succeeded through CLI runtime/token discovery."
      ]);
    } finally {
      await server.stop();
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
