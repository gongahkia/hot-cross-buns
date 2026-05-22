import { describe, expect, it, vi } from "vitest";
import { HCB_IPC_VERSION, IPC_CHANNELS, ipcContracts } from "@shared/ipc/contracts";
import { ok } from "@shared/ipc/result";
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
  it("validates and invokes through the versioned dispatch channel", async () => {
    const ipc: IpcBridge = {
      invoke: vi.fn(async () => ok(healthResponse))
    };

    const result = await createHcbApi(ipc).diagnostics.health();

    expect(ipc.invoke).toHaveBeenCalledWith(IPC_CHANNELS.dispatch, {
      version: HCB_IPC_VERSION,
      domain: ipcContracts.diagnostics.health.domain,
      method: ipcContracts.diagnostics.health.method,
      request: {}
    });
    expect(result).toEqual(ok(healthResponse));
  });

  it("rejects invalid requests before invoking IPC", async () => {
    const ipc: IpcBridge = {
      invoke: vi.fn()
    };

    const result = await createHcbApi(ipc).tasks.get({ id: "" });

    expect(ipc.invoke).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatchObject({
        code: "VALIDATION_ERROR",
        recoverable: true
      });
    }
  });

  it("enforces bounded list request payloads before invoking IPC", async () => {
    const ipc: IpcBridge = {
      invoke: vi.fn()
    };

    const result = await createHcbApi(ipc).tasks.list({ limit: 10_000 });

    expect(ipc.invoke).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("rejects malformed renderer payloads across request-bearing namespaces", async () => {
    const ipc: IpcBridge = {
      invoke: vi.fn()
    };
    const api = createHcbApi(ipc) as unknown as Record<
      string,
      Record<string, (value: unknown) => unknown>
    >;
    const calls: Array<[string, string, unknown]> = [
      ["tasks", "get", { id: "" }],
      [
        "calendar",
        "listEvents",
        {
          start: "2026-01-02T00:00:00.000Z",
          end: "2026-01-01T00:00:00.000Z"
        }
      ],
      ["notes", "get", { id: "" }],
      ["search", "query", { query: "" }],
      ["sync", "runNow", { resources: [] }],
      ["settings", "update", {}],
      ["mcp", "setEnabled", {}],
      ["diagnostics", "markShellVisible", { rendererNowMs: -1 }]
    ];

    for (const [domain, method, payload] of calls) {
      const result = await api[domain][method](payload);

      expect(result).toMatchObject({
        ok: false,
        error: {
          code: "VALIDATION_ERROR"
        }
      });
    }

    expect(ipc.invoke).not.toHaveBeenCalled();
  });

  it("returns a sanitized validation error for malformed IPC responses", async () => {
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
      IPC_CHANNELS.dispatch,
      expect.objectContaining({
        version: HCB_IPC_VERSION,
        domain: "diagnostics",
        method: "markShellVisible",
        request: expect.objectContaining({
          rendererNowMs: expect.any(Number)
        })
      })
    );
    expect(result.ok).toBe(true);
  });

  it("exposes only the stable HCB domain namespaces", () => {
    const api = createHcbApi({
      invoke: vi.fn()
    });

    expect(Object.keys(api).sort()).toEqual([
      "calendar",
      "diagnostics",
      "mcp",
      "native",
      "notes",
      "search",
      "settings",
      "sync",
      "tasks"
    ]);
    expect(JSON.stringify(Object.keys(api))).not.toMatch(
      /ipcRenderer|invoke|send|process|require/
    );
    expect(Object.isFrozen(api)).toBe(true);
    expect(Object.isFrozen(api.diagnostics)).toBe(true);
  });
});
