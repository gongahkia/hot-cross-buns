import { describe, expect, it, vi } from "vitest";
import { IPC_CHANNELS } from "@shared/ipc";
import { ok } from "@shared/result";
import { createHcbApi, type IpcBridge } from "./bridge";

const healthResponse = {
  status: "ok" as const,
  version: "0.0.0-test",
  environment: "test" as const,
  timestamp: new Date("2026-05-22T00:00:00.000Z").toISOString(),
  uptimeMs: 10,
  startup: {
    processStartedMs: 0,
    appReadyMs: 2
  }
};

describe("preload bridge", () => {
  it("validates and invokes the health check IPC channel", async () => {
    const ipc: IpcBridge = {
      invoke: vi.fn(async () => ok(healthResponse))
    };

    const result = await createHcbApi(ipc).diagnostics.health();

    expect(ipc.invoke).toHaveBeenCalledWith(IPC_CHANNELS.diagnostics.health, {});
    expect(result).toEqual(ok(healthResponse));
  });

  it("returns a sanitized validation error for malformed health responses", async () => {
    const ipc: IpcBridge = {
      invoke: vi.fn(async () => ({
        ok: true,
        data: {
          token: "not allowed"
        }
      }))
    };

    const result = await createHcbApi(ipc).diagnostics.health();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatchObject({
        code: "VALIDATION_ERROR",
        recoverable: true
      });
      expect(JSON.stringify(result.error)).not.toContain("not allowed");
    }
  });

  it("validates shell visibility timing responses", async () => {
    const ipc: IpcBridge = {
      invoke: vi.fn(async () =>
        ok({
          processStartedMs: 0,
          appReadyMs: 2,
          windowCreatedMs: 4,
          rendererLoadedMs: 8,
          shellVisibleMs: 9
        })
      )
    };

    const result = await createHcbApi(ipc).diagnostics.markShellVisible();

    expect(ipc.invoke).toHaveBeenCalledWith(
      IPC_CHANNELS.diagnostics.markShellVisible,
      expect.objectContaining({
        rendererNowMs: expect.any(Number)
      })
    );
    expect(result.ok).toBe(true);
  });
});
