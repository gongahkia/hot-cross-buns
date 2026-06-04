import { describe, expect, it } from "vitest";
import type { McpAdminDomainServices } from "./domainServices";
import { createMcpTestDomainServices } from "./testDomainDoubles";
import { McpToolRegistry } from "./toolRegistry";
import type { JsonObject, McpToolCallContext } from "./types";

const context: McpToolCallContext = {
  permissionMode: "read-only",
  credentialRevision: "test-revision",
  clientKey: "test-client",
  now: new Date("2026-06-04T00:00:00.000Z")
};
const allowWritesContext: McpToolCallContext = {
  ...context,
  permissionMode: "allow-writes"
};
const confirmWritesContext: McpToolCallContext = {
  ...context,
  permissionMode: "confirm-writes"
};

describe("McpToolRegistry read lists", () => {
  it("returns local note lists", async () => {
    const response = await new McpToolRegistry(createMcpTestDomainServices()).callTool(
      "hcb_list_note_lists",
      {},
      context
    );

    expect(response).toMatchObject({
      message: "Read note lists.",
      items: [
        {
          kind: "noteList",
          id: "note-list:default",
          title: "Local notes",
          noteCount: 1
        }
      ]
    });
  });
});

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

describe("McpToolRegistry advanced writes", () => {
  it("schedules task blocks through the write gate", async () => {
    const response = await new McpToolRegistry(createMcpTestDomainServices()).callTool(
      "hcb_schedule_task_block",
      {
        taskId: "task-1",
        calendarId: "cal-primary",
        startDate: "2026-06-04T09:00:00.000Z",
        durationMinutes: 45
      },
      allowWritesContext
    );

    expect(response).toMatchObject({
      applied: true,
      item: {
        kind: "scheduledTaskBlock",
        taskId: "task-1",
        calendarId: "cal-primary",
        durationMinutes: 45
      }
    });
  });

  it("runs admin writes and redacts OAuth secrets from preview output", async () => {
    const settingsPatches: unknown[] = [];
    const savedClients: unknown[] = [];
    const enabledValues: boolean[] = [];
    const registry = new McpToolRegistry(createMcpTestDomainServices());
    const admin: McpAdminDomainServices = {
      settings: {
        get: () => ({}) as never,
        update: (patch) => {
          settingsPatches.push(patch);
          return { mcpEnabled: true } as never;
        }
      },
      google: {
        status: () => ({}) as never,
        saveOAuthClient: (request) => {
          savedClients.push(request);
          return {
            oauthClientConfigured: true,
            clientId: request.clientId,
            hasClientSecret: request.clientSecret !== undefined
          } as never;
        },
        beginOAuth: () => ({
          accepted: true,
          openedExternalBrowser: true,
          expiresAt: "2026-06-04T01:00:00.000Z",
          scopes: [],
          redirectUri: "http://127.0.0.1:4777/oauth",
          message: "OAuth started."
        })
      },
      mcp: {
        status: () => ({}) as never,
        setEnabled: (request) => {
          enabledValues.push(request.enabled);
          return { enabled: request.enabled } as never;
        }
      }
    };
    registry.setAdminServices(admin);

    const preview = await registry.callTool(
      "hcb_google_save_oauth_client",
      {
        clientId: "client-id-12345",
        clientSecret: "super-secret",
        dryRun: true
      },
      confirmWritesContext
    );
    const settings = await registry.callTool("hcb_settings_update", { patch: { mcpEnabled: true } }, allowWritesContext);
    const google = await registry.callTool("hcb_google_save_oauth_client", { clientId: "client-id-12345" }, allowWritesContext);
    const oauth = await registry.callTool("hcb_google_begin_oauth", {}, allowWritesContext);
    const mcp = await registry.callTool("hcb_mcp_set_enabled", { enabled: true }, allowWritesContext);

    expect(JSON.stringify(preview)).not.toContain("super-secret");
    expect(preview).toMatchObject({
      dryRun: true,
      item: {
        kind: "googleOAuthClient",
        hasClientSecret: true
      }
    });
    expect(settingsPatches).toEqual([{ mcpEnabled: true }]);
    expect(savedClients).toEqual([{ clientId: "client-id-12345" }]);
    expect(enabledValues).toEqual([true]);
    expect(settings.applied).toBe(true);
    expect(google.item).toMatchObject({ kind: "googleStatus", hasClientSecret: false });
    expect(oauth.item).toMatchObject({ openedExternalBrowser: true });
    expect(mcp.item).toMatchObject({ kind: "mcpStatus", enabled: true });
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
