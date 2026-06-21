import { describe, expect, it, vi } from "vitest";
import { HCB_IPC_VERSION, ipcContracts } from "@shared/ipc/contracts";
import { HcbPublicError } from "@shared/ipc/result";
import { createIpcDispatcher, createIpcMetrics } from "./registry";
import { createStubIpcHandlers } from "./stubs";

function envelope(domain: string, method: string, request: unknown) {
  return {
    version: HCB_IPC_VERSION,
    domain,
    method,
    request
  };
}

describe("IPC dispatcher", () => {
  it("validates requests before executing a service and returns typed results", async () => {
    const service = vi.fn((request: unknown) => {
      const parsedRequest = ipcContracts.tasks.list.requestSchema.parse(request);

      return {
        items: [],
        page: {
          limit: parsedRequest.limit
        }
      };
    });
    const dispatcher = createIpcDispatcher([
      {
        contract: ipcContracts.tasks.list,
        handle: service
      }
    ]);

    const result = await dispatcher(null, envelope("tasks", "list", { limit: 5 }));

    expect(service).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "active",
        limit: 5
      }),
      { route: "tasks.list" }
    );
    expect(result).toEqual({
      ok: true,
      data: {
        items: [],
        page: {
          limit: 5
        }
      }
    });
  });

  it("rejects invalid requests before service execution", async () => {
    const service = vi.fn();
    const dispatcher = createIpcDispatcher([
      {
        contract: ipcContracts.search.query,
        handle: service
      }
    ]);

    const result = await dispatcher(null, envelope("search", "query", { query: "", limit: 10 }));

    expect(service).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VALIDATION_ERROR");
      expect(JSON.stringify(result.error)).not.toContain("query text");
    }
  });

  it("sanitizes unexpected service errors", async () => {
    const dispatcher = createIpcDispatcher([
      {
        contract: ipcContracts.notes.list,
        handle: () => {
          throw new Error("token=secret-refresh-token local path /Users/person/private");
        }
      }
    ]);

    const result = await dispatcher(null, envelope("notes", "list", {}));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatchObject({
        code: "INTERNAL_ERROR",
        message: "Internal application error",
        recoverable: false
      });
      expect(JSON.stringify(result.error)).not.toMatch(/secret-refresh-token|\/Users\/person/);
    }
  });

  it("allows explicitly public errors without leaking arbitrary thrown messages", async () => {
    const dispatcher = createIpcDispatcher([
      {
        contract: ipcContracts.settings.get,
        handle: () => {
          throw new HcbPublicError({
            code: "SERVICE_UNAVAILABLE",
            message: "Settings service is not ready",
            recoverable: true
          });
        }
      }
    ]);

    const result = await dispatcher(null, envelope("settings", "get", {}));

    expect(result).toEqual({
      ok: false,
      error: {
        code: "SERVICE_UNAVAILABLE",
        message: "Settings service is not ready",
        recoverable: true
      }
    });
  });

  it("redacts token fixtures from public IPC error messages, details, and logs", async () => {
    const logger = {
      debug: vi.fn()
    };
    const dispatcher = createIpcDispatcher(
      [
        {
          contract: ipcContracts.settings.get,
          handle: () => {
            throw new HcbPublicError({
              code: "SERVICE_UNAVAILABLE",
              message: "Settings failed with access_token=fake-access-token",
              recoverable: true,
              details: {
                refreshToken: "fake-refresh-token",
                reason: "Bearer fake-mcp-token"
              }
            });
          }
        }
      ],
      { logger }
    );

    const result = await dispatcher(null, envelope("settings", "get", {}));

    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toMatch(
      /fake-access-token|fake-refresh-token|fake-mcp-token|refreshToken/
    );
    expect(JSON.stringify(logger.debug.mock.calls)).not.toMatch(
      /fake-access-token|fake-refresh-token|fake-mcp-token/
    );
  });

  it("registers future-domain stubs as sanitized HcbResult failures", async () => {
    const dispatcher = createIpcDispatcher(createStubIpcHandlers());

    const result = await dispatcher(null, envelope("tasks", "list", {}));

    expect(result).toEqual({
      ok: false,
      error: {
        code: "NOT_IMPLEMENTED",
        message: "Task listing is not implemented yet",
        recoverable: false
      }
    });
  });

  it("rejects invalid service responses with a sanitized error", async () => {
    const logger = { debug: vi.fn() };
    const dispatcher = createIpcDispatcher(
      [
        {
          contract: ipcContracts.mcp.status,
          handle: () => ({
            token: "not allowed"
          })
        }
      ],
      { logger }
    );

    const result = await dispatcher(null, envelope("mcp", "status", {}));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INTERNAL_ERROR");
      expect(result.error.details).toMatchObject({
        paths: "enabled,running,readOnly,confirmationRequired,permissionMode,port,tokenState"
      });
      expect(JSON.stringify(result.error)).not.toContain("not allowed");
    }
    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: "response_error",
        errorDetails: expect.objectContaining({
          paths: "enabled,running,readOnly,confirmationRequired,permissionMode,port,tokenState"
        })
      })
    );
  });

  it("records timing metrics and logs only route metadata", async () => {
    let tick = 100;
    const metrics = createIpcMetrics();
    const logger = {
      debug: vi.fn()
    };
    const dispatcher = createIpcDispatcher([], {
      metrics,
      logger,
      now: () => {
        tick += 7;
        return tick;
      }
    });

    const result = await dispatcher(null, envelope("tasks", "secret-token-method", {}));

    expect(result.ok).toBe(false);
    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({
        route: "tasks.unknown",
        outcome: "service_error",
        errorCode: "NOT_IMPLEMENTED"
      })
    );
    expect(JSON.stringify(logger.debug.mock.calls)).not.toContain("secret-token-method");
    expect(metrics.snapshot()).toMatchObject({
      totalCalls: 1,
      serviceFailures: 1,
      routes: [
        expect.objectContaining({
          route: "tasks.unknown",
          totalCalls: 1
        })
      ]
    });
  });
});
