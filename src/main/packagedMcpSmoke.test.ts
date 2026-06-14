import { describe, expect, it, vi } from "vitest";
import {
  applyPackagedMcpSmokeSettings,
  packagedMcpSmokeTokenSeed,
  shouldEnablePackagedMcpSmoke
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
