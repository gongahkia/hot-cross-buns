import { describe, expect, it } from "vitest";
import {
  HCB_IPC_VERSION,
  type HcbDomain
} from "@shared/ipc/contracts";
import { createPlaceholderDomainServices } from "../services/placeholderDomainServices";
import { createCoreIpcHandlers } from "./coreHandlers";
import { createIpcDispatcher } from "./registry";

describe("core IPC handlers", () => {
  it("routes planner reads through the shared domain services", async () => {
    const dispatch = createIpcDispatcher(createCoreIpcHandlers(createPlaceholderDomainServices()));

    const result = await dispatch(
      {},
      envelope("tasks", "list", {
        status: "active",
        limit: 2
      })
    );

    expect(result).toMatchObject({
      ok: true,
      data: {
        page: {
          limit: 2,
          totalKnown: expect.any(Number)
        }
      }
    });
    expect(JSON.stringify(result)).not.toContain("NOT_IMPLEMENTED");
  });

  it("keeps sync and MCP controls sanitized and non-blocking", async () => {
    const dispatch = createIpcDispatcher(createCoreIpcHandlers(createPlaceholderDomainServices()));

    const sync = await dispatch(
      {},
      envelope("sync", "runNow", {
        resources: ["tasks"],
        dryRun: true
      })
    );
    const mcp = await dispatch(
      {},
      envelope("mcp", "setEnabled", {
        enabled: true
      })
    );

    expect(sync).toMatchObject({
      ok: true,
      data: {
        accepted: true,
        dryRun: true,
        resources: ["tasks"]
      }
    });
    expect(mcp).toMatchObject({
      ok: true,
      data: {
        enabled: true,
        running: false,
        url: "http://127.0.0.1"
      }
    });
    expect(JSON.stringify({ sync, mcp })).not.toMatch(/token|secret|Bearer/i);
  });
});

function envelope(domain: HcbDomain, method: string, request: unknown) {
  return {
    version: HCB_IPC_VERSION,
    domain,
    method,
    request
  };
}
