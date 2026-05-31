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
  },
  build: {
    appName: "Hot Cross Buns 2",
    version: "0.0.0-test",
    environment: "test" as const,
    nodeVersion: process.versions.node,
    packaged: false
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

  it("exposes note link helper endpoints through the bridge", async () => {
    const ipc: IpcBridge = {
      invoke: vi.fn(async (_channel, envelope) =>
        envelope.method === "linkSuggest"
          ? ok({ items: [{ kind: "note", id: "note-1", label: "Project plan" }] })
          : ok({ items: [{ linkText: "Missing note" }] })
      )
    };
    const api = createHcbApi(ipc);

    await expect(api.notes.linkSuggest({ query: "plan" })).resolves.toMatchObject({
      ok: true,
      data: { items: [{ kind: "note", id: "note-1", label: "Project plan" }] }
    });
    await expect(api.notes.listBrokenLinks({ noteId: "note-1" })).resolves.toMatchObject({
      ok: true,
      data: { items: [{ linkText: "Missing note" }] }
    });
    expect(ipc.invoke).toHaveBeenCalledWith(
      IPC_CHANNELS.dispatch,
      expect.objectContaining({
        domain: "notes",
        method: "linkSuggest",
        request: expect.objectContaining({ query: "plan", limit: 8 })
      })
    );
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
      ["tasks", "listTaskLists", { limit: 10_000 }],
      ["tasks", "get", { id: "" }],
      ["calendar", "listCalendars", { limit: 10_000 }],
      [
        "calendar",
        "listEvents",
        {
          start: "2026-01-02T00:00:00.000Z",
          end: "2026-01-01T00:00:00.000Z"
        }
      ],
      ["calendar", "get", { id: "" }],
      ["calendar", "create", { title: "", calendarId: "cal-1", startsAt: "2026-01-01T00:00:00.000Z", endsAt: "2026-01-01T01:00:00.000Z" }],
      ["calendar", "update", { id: "event-1" }],
      ["calendar", "delete", { id: "" }],
      ["calendar", "scheduleSuggest", { date: "2026-05-23", workingHours: { start: 22, end: 6 } }],
      ["notes", "create", { title: "" }],
      ["notes", "get", { id: "" }],
      ["notes", "update", { id: "note-1" }],
      ["notes", "linkSuggest", { query: "" }],
      ["notes", "listBrokenLinks", { noteId: "" }],
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

  it("exposes the native font family list through the typed bridge", async () => {
    const ipc: IpcBridge = {
      invoke: vi.fn(async () => ok({ platform: "darwin", families: ["Avenir", "SF Pro Text"] }))
    };

    const result = await createHcbApi(ipc).native.listFontFamilies();

    expect(ipc.invoke).toHaveBeenCalledWith(
      IPC_CHANNELS.dispatch,
      expect.objectContaining({
        version: HCB_IPC_VERSION,
        domain: "native",
        method: "listFontFamilies",
        request: {}
      })
    );
    expect(result).toEqual(ok({ platform: "darwin", families: ["Avenir", "SF Pro Text"] }));
  });

  it("subscribes to sanitized sync status events only", () => {
    const listeners = new Map<string, (event: unknown, payload: unknown) => void>();
    const ipc: IpcBridge = {
      invoke: vi.fn(),
      on: vi.fn((channel, listener) => {
        listeners.set(channel, listener);
      }),
      removeListener: vi.fn((channel) => {
        listeners.delete(channel);
      })
    };
    const listener = vi.fn();
    const unsubscribe = createHcbApi(ipc).sync.subscribeStatus(listener);

    listeners.get(IPC_CHANNELS.syncStatus)?.(
      {},
      {
        state: "idle",
        pendingMutationCount: 0,
        offline: true
      }
    );
    listeners.get(IPC_CHANNELS.syncStatus)?.(
      {},
      {
        token: "not allowed"
      }
    );

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({
      state: "idle",
      pendingMutationCount: 0,
      offline: true
    });

    unsubscribe();
    expect(ipc.removeListener).toHaveBeenCalledWith(
      IPC_CHANNELS.syncStatus,
      expect.any(Function)
    );
  });

  it("subscribes to sanitized native action events only", () => {
    const listeners = new Map<string, (event: unknown, payload: unknown) => void>();
    const ipc: IpcBridge = {
      invoke: vi.fn(),
      on: vi.fn((channel, listener) => {
        listeners.set(channel, listener);
      }),
      removeListener: vi.fn((channel) => {
        listeners.delete(channel);
      })
    };
    const listener = vi.fn();
    const unsubscribe = createHcbApi(ipc).native.subscribeAction(listener);

    listeners.get(IPC_CHANNELS.nativeAction)?.(
      {},
      {
        type: "openSettings"
      }
    );
    listeners.get(IPC_CHANNELS.nativeAction)?.(
      {},
      {
        type: "openRoute",
        route: {
          kind: "task",
          id: ""
        }
      }
    );

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({
      type: "openSettings"
    });

    unsubscribe();
    expect(ipc.removeListener).toHaveBeenCalledWith(
      IPC_CHANNELS.nativeAction,
      expect.any(Function)
    );
  });

  it("exposes only the stable HCB domain namespaces", () => {
    const api = createHcbApi({
      invoke: vi.fn()
    });

    expect(Object.keys(api).sort()).toEqual([
      "calendar",
      "diagnostics",
      "google",
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
