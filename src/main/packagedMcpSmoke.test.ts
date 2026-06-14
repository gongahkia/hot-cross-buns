import { describe, expect, it, vi } from "vitest";
import { rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyPackagedMcpSmokeSettings,
  packagedMcpSmokeExitFile,
  packagedMcpSmokeTokenSeed,
  shouldEnablePackagedMcpSmoke,
  startPackagedMcpSmokeExitWatcher
} from "./packagedMcpSmoke";

describe("packaged MCP smoke startup gate", () => {
  it("requires packaged mode and explicit packaged user-data override", () => {
    expect(shouldEnablePackagedMcpSmoke({
      HCB_PACKAGED_MCP_SMOKE: "1",
      HCB_ALLOW_PACKAGED_USER_DATA_DIR: "1"
    }, true)).toBe(true);
    expect(shouldEnablePackagedMcpSmoke({
      HCB_PACKAGED_MCP_SMOKE: "1",
      HCB_ALLOW_PACKAGED_USER_DATA_DIR: "1"
    }, false)).toBe(false);
    expect(shouldEnablePackagedMcpSmoke({
      HCB_PACKAGED_MCP_SMOKE: "1"
    }, true)).toBe(false);
    expect(shouldEnablePackagedMcpSmoke({
      HCB_ALLOW_PACKAGED_USER_DATA_DIR: "1"
    }, true)).toBe(false);
  });

  it("enables read-only MCP on a random port for packaged smoke runs", async () => {
    const setEnabled = vi.fn().mockResolvedValue({
      enabled: true,
      running: true,
      readOnly: true,
      confirmationRequired: false,
      permissionMode: "read-only",
      port: 49210,
      tokenState: "configured",
      url: "http://127.0.0.1"
    });

    await expect(applyPackagedMcpSmokeSettings({
      domain: {
        mcp: { setEnabled }
      }
    }, {
      HCB_PACKAGED_MCP_SMOKE: "1",
      HCB_ALLOW_PACKAGED_USER_DATA_DIR: "1"
    }, true)).resolves.toBe(true);
    expect(setEnabled).toHaveBeenCalledWith({
      enabled: true,
      permissionMode: "read-only",
      port: 0
    });
  });

  it("only exposes a smoke token seed when the packaged gate is enabled", () => {
    expect(packagedMcpSmokeTokenSeed({
      HCB_ALLOW_PACKAGED_USER_DATA_DIR: "1",
      HCB_PACKAGED_MCP_SMOKE: "1",
      HCB_PACKAGED_MCP_SMOKE_TOKEN: "seed-token"
    }, true)).toBe("seed-token");
    expect(packagedMcpSmokeTokenSeed({
      HCB_PACKAGED_MCP_SMOKE: "1",
      HCB_PACKAGED_MCP_SMOKE_TOKEN: "seed-token"
    }, true)).toBeUndefined();
  });

  it("only accepts absolute sentinel files for packaged smoke exit", () => {
    expect(packagedMcpSmokeExitFile({
      HCB_ALLOW_PACKAGED_USER_DATA_DIR: "1",
      HCB_PACKAGED_MCP_SMOKE: "1",
      HCB_PACKAGED_MCP_SMOKE_EXIT_FILE: join(tmpdir(), "hcb-smoke.exit")
    }, true)).toBe(join(tmpdir(), "hcb-smoke.exit"));
    expect(packagedMcpSmokeExitFile({
      HCB_ALLOW_PACKAGED_USER_DATA_DIR: "1",
      HCB_PACKAGED_MCP_SMOKE: "1",
      HCB_PACKAGED_MCP_SMOKE_EXIT_FILE: "relative.exit"
    }, true)).toBeUndefined();
  });

  it("quits when the packaged smoke sentinel appears", async () => {
    const exitFile = join(tmpdir(), `hcb-smoke-${process.pid}.exit`);
    const quit = vi.fn();

    vi.useFakeTimers();
    rmSync(exitFile, { force: true });

    try {
      expect(startPackagedMcpSmokeExitWatcher({
        HCB_ALLOW_PACKAGED_USER_DATA_DIR: "1",
        HCB_PACKAGED_MCP_SMOKE: "1",
        HCB_PACKAGED_MCP_SMOKE_EXIT_FILE: exitFile
      }, true, quit, 100)).toBe(true);

      await vi.advanceTimersByTimeAsync(100);
      expect(quit).not.toHaveBeenCalled();
      writeFileSync(exitFile, "done\n", "utf8");
      await vi.advanceTimersByTimeAsync(100);
      expect(quit).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
      rmSync(exitFile, { force: true });
    }
  });

  it("fails when the loopback server does not start", async () => {
    const setEnabled = vi.fn().mockResolvedValue({
      enabled: true,
      running: false,
      readOnly: true,
      confirmationRequired: false,
      permissionMode: "read-only",
      port: 0,
      tokenState: "not_configured"
    });

    await expect(applyPackagedMcpSmokeSettings({
      domain: {
        mcp: { setEnabled }
      }
    }, {
      HCB_PACKAGED_MCP_SMOKE: "1",
      HCB_ALLOW_PACKAGED_USER_DATA_DIR: "1"
    }, true)).rejects.toThrow("Packaged MCP smoke could not start");
  });
});
