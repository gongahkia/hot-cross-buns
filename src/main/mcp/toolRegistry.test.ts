import { describe, expect, it } from "vitest";
import { createMcpTestDomainServices } from "./testDomainDoubles";
import { McpToolRegistry } from "./toolRegistry";
import type { JsonObject, McpToolCallContext } from "./types";

const context: McpToolCallContext = {
  permissionMode: "read-only",
  credentialRevision: "test-revision",
  clientKey: "test-client",
  now: new Date("2026-06-04T00:00:00.000Z")
};

describe("McpToolRegistry doctor", () => {
  it("reports ok when account, sync, queue, MCP, and logs are healthy", async () => {
    const item = await callDoctor({
      status: healthyStatus(),
      mutations: [],
      logs: []
    });

    expect(item).toMatchObject({
      kind: "doctor",
      status: "ok",
      findings: [
        {
          level: "ok",
          title: "No issues found"
        }
      ],
      suggestedCommands: []
    });
  });

  it("flags a disconnected Google account", async () => {
    const item = await callDoctor({
      status: healthyStatus({
        account: {
          state: "disconnected"
        }
      }),
      mutations: [],
      logs: []
    });

    expect(item).toMatchObject({
      status: "error",
      findings: [
        {
          level: "error",
          title: "Google account not connected"
        }
      ],
      suggestedCommands: ["pnpm hcb -- status"]
    });
  });

  it("flags failed pending mutations and suggests showing the failed mutation", async () => {
    const item = await callDoctor({
      status: healthyStatus({
        pendingMutations: {
          totalCount: 1,
          pendingCount: 0,
          applyingCount: 0,
          failedCount: 1,
          retryableCount: 0,
          authPausedCount: 0,
          byResourceType: []
        }
      }),
      mutations: [
        {
          kind: "mutation",
          id: "mutation-failed",
          status: "failed"
        }
      ],
      logs: []
    });

    expect(item).toMatchObject({
      status: "error",
      findings: [
        {
          level: "error",
          title: "Failed pending mutations"
        }
      ],
      suggestedCommands: ["pnpm hcb -- diff", "pnpm hcb -- show mutation mutation-failed"]
    });
  });

  it("flags pending local mutations without treating them as failures", async () => {
    const item = await callDoctor({
      status: healthyStatus({
        sync: {
          state: "idle",
          pendingMutationCount: 2,
          mode: "manual"
        },
        pendingMutations: {
          totalCount: 2,
          pendingCount: 2,
          applyingCount: 0,
          failedCount: 0,
          retryableCount: 0,
          authPausedCount: 0,
          byResourceType: []
        }
      }),
      mutations: [
        {
          kind: "mutation",
          id: "mutation-1",
          status: "pending"
        }
      ],
      logs: []
    });

    expect(item).toMatchObject({
      status: "warning",
      findings: [
        {
          level: "warning",
          title: "Pending local mutations"
        }
      ],
      suggestedCommands: ["pnpm hcb -- diff"]
    });
  });

  it("flags recent warning and error logs", async () => {
    const warning = await callDoctor({
      status: healthyStatus(),
      mutations: [],
      logs: [
        {
          kind: "log",
          id: "log-warn",
          level: "warn"
        }
      ]
    });
    const error = await callDoctor({
      status: healthyStatus(),
      mutations: [],
      logs: [
        {
          kind: "log",
          id: "log-error",
          level: "error"
        }
      ]
    });

    expect(warning).toMatchObject({
      status: "warning",
      findings: [
        {
          level: "warning",
          title: "Recent warning logs"
        }
      ],
      suggestedCommands: ["pnpm hcb -- log --level warn"]
    });
    expect(error).toMatchObject({
      status: "error",
      findings: [
        {
          level: "error",
          title: "Recent error logs"
        }
      ],
      suggestedCommands: ["pnpm hcb -- log --level error"]
    });
  });

  it("passes doctor inspection limits to diagnostics services", async () => {
    const calls: JsonObject[] = [];
    await callDoctor({
      status: healthyStatus(),
      mutations: [],
      logs: [],
      args: {
        logLimit: 7,
        mutationLimit: 3
      },
      calls
    });

    expect(calls).toEqual([
      {
        service: "diff",
        limit: 3
      },
      {
        service: "logs",
        limit: 7,
        level: "warn"
      }
    ]);
  });
});

async function callDoctor(input: {
  status: JsonObject;
  mutations: JsonObject[];
  logs: JsonObject[];
  args?: JsonObject;
  calls?: JsonObject[];
}): Promise<JsonObject> {
  const services = createMcpTestDomainServices();

  services.diagnostics = {
    status: () => input.status,
    diff: ({ limit }) => {
      input.calls?.push({
        service: "diff",
        limit: limit ?? null
      });
      return input.mutations;
    },
    logs: ({ limit, level }) => {
      input.calls?.push({
        service: "logs",
        limit: limit ?? null,
        level: level ?? null
      });
      return input.logs;
    },
    show: () => ({})
  };

  const response = await new McpToolRegistry(services).callTool("hcb_doctor", input.args ?? {}, context);
  return response.item ?? {};
}

function healthyStatus(overrides: JsonObject = {}): JsonObject {
  const base: JsonObject = {
    kind: "diagnosticsStatus",
    generatedAt: "2026-06-04T00:00:00.000Z",
    account: {
      state: "connected",
      grantedScopeCount: 2,
      missingScopeCount: 0
    },
    sync: {
      state: "idle",
      pendingMutationCount: 0,
      mode: "manual"
    },
    cache: {
      taskListCount: 1,
      taskCount: 1,
      calendarCount: 1,
      eventCount: 1,
      noteCount: 1
    },
    pendingMutations: {
      totalCount: 0,
      pendingCount: 0,
      applyingCount: 0,
      failedCount: 0,
      retryableCount: 0,
      authPausedCount: 0,
      byResourceType: []
    },
    mcp: {
      enabled: true,
      permissionMode: "read-only",
      configuredPort: 4777
    }
  };

  return {
    ...base,
    ...overrides,
    account: {
      ...(base.account as JsonObject),
      ...objectOverride(overrides.account)
    },
    sync: {
      ...(base.sync as JsonObject),
      ...objectOverride(overrides.sync)
    },
    pendingMutations: {
      ...(base.pendingMutations as JsonObject),
      ...objectOverride(overrides.pendingMutations)
    },
    mcp: {
      ...(base.mcp as JsonObject),
      ...objectOverride(overrides.mcp)
    }
  };
}

function objectOverride(value: unknown): JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonObject
    : {};
}
