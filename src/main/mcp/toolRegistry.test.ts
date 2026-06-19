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
  it("returns note lists", async () => {
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
          id: "list-inbox",
          title: "Inbox",
          noteCount: 1
        }
      ]
    });
  });

  it("returns undo status", async () => {
    const response = await new McpToolRegistry(createMcpTestDomainServices()).callTool(
      "hcb_undo_status",
      {},
      context
    );

    expect(response).toMatchObject({
      message: "Read undo status.",
      item: {
        kind: "undoStatus",
        canUndo: true,
        canRedo: true,
        undoLabel: "Edit task",
        redoLabel: "Edit note"
      }
    });
  });

  it("returns pending mutations", async () => {
    const response = await new McpToolRegistry(createMcpTestDomainServices()).callTool(
      "hcb_pending_mutations",
      {
        limit: 10
      },
      context
    );

    expect(response).toMatchObject({
      message: "Read 1 pending mutation.",
      items: [
        {
          kind: "mutation",
          id: "mutation-1",
          status: "pending"
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

  it("flags local hoster health problems", async () => {
    const disabled = await callDoctor({
      status: healthyStatus(),
      mutations: [],
      logs: [],
      hosters: {
        enabled: false,
        running: false,
        port: 0,
        profiles: [{ id: "hoster:test" }]
      }
    });
    const failed = await callDoctor({
      status: healthyStatus(),
      mutations: [],
      logs: [],
      hosters: {
        enabled: true,
        running: false,
        health: "error",
        port: 4778,
        lastError: "Local hoster port 4778 is already in use.",
        profiles: []
      }
    });

    expect(disabled).toMatchObject({
      status: "warning",
      findings: [
        {
          level: "warning",
          title: "Local hoster profiles disabled"
        }
      ],
      suggestedCommands: ["pnpm hcb -- hoster status"]
    });
    expect(failed).toMatchObject({
      status: "error",
      findings: [
        {
          level: "error",
          title: "Local hoster not running"
        }
      ],
      suggestedCommands: ["pnpm hcb -- hoster status"]
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

  it("runs sync and queue actions through the write gate", async () => {
    const registry = new McpToolRegistry(createMcpTestDomainServices());
    const sync = await registry.callTool(
      "hcb_sync_now",
      {
        resources: ["tasks"],
        full: true
      },
      allowWritesContext
    );
    const retryPreview = await registry.callTool(
      "hcb_retry_mutation",
      {
        id: "mutation-1",
        dryRun: true
      },
      confirmWritesContext
    );

    expect(sync).toMatchObject({
      applied: true,
      item: {
        kind: "syncRun",
        resources: ["tasks"],
        full: true
      }
    });
    expect(retryPreview).toMatchObject({
      dryRun: true,
      requiresConfirmation: true,
      item: {
        kind: "mutationAction",
        action: "retry",
        id: "mutation-1"
      }
    });
    expect(retryPreview.confirmationId).toEqual(expect.any(String));

    const retryApply = await registry.callTool(
      "hcb_retry_mutation",
      {
        id: "mutation-1",
        confirmationId: retryPreview.confirmationId
      },
      confirmWritesContext
    );

    expect(retryApply).toMatchObject({
      applied: true,
      item: {
        action: "retry",
        id: "mutation-1",
        status: "pending"
      }
    });
  });

  it("converts primitives through the destructive confirmation gate", async () => {
    const services = createMcpTestDomainServices();
    const registry = new McpToolRegistry(services);
    const preview = await registry.callTool(
      "hcb_convert_item",
      {
        sourceKind: "event",
        sourceId: "event-1",
        targetKind: "task",
        sourceAction: "replace",
        dryRun: true
      },
      allowWritesContext
    );

    expect(preview).toMatchObject({
      dryRun: true,
      requiresConfirmation: true,
      item: {
        kind: "conversion",
        source: {
          kind: "event",
          id: "event-1",
          title: "Planning review"
        },
        target: {
          kind: "task",
          payload: {
            title: "Planning review",
            notes: "Calendar event details",
            dueDate: "2026-05-22T09:00:00.000Z"
          }
        },
        sourceAction: "replace",
        willRemoveSource: true
      }
    });
    expect(preview.confirmationId).toEqual(expect.any(String));

    const apply = await registry.callTool(
      "hcb_convert_item",
      {
        sourceKind: "event",
        sourceId: "event-1",
        targetKind: "task",
        sourceAction: "replace",
        confirmationId: preview.confirmationId
      },
      allowWritesContext
    );

    expect(apply).toMatchObject({
      applied: true,
      item: {
        kind: "conversion",
        source: {
          kind: "event",
          id: "event-1",
          action: "replace",
          removed: {
            kind: "event",
            id: "event-1"
          }
        },
        target: {
          kind: "task",
          item: {
            kind: "task",
            id: "task-2",
            title: "Planning review",
            dueDate: "2026-05-22T09:00:00.000Z"
          }
        }
      }
    });
    expect(services.state.events.has("event-1")).toBe(false);
    expect(services.state.tasks.has("task-2")).toBe(true);
  });

  it("keeps event details when converting events to notes", async () => {
    const response = await new McpToolRegistry(createMcpTestDomainServices()).callTool(
      "hcb_convert_item",
      {
        sourceKind: "event",
        sourceId: "event-1",
        targetKind: "note",
        sourceAction: "keep",
        dryRun: true
      },
      allowWritesContext
    );

    expect(response).toMatchObject({
      item: {
        target: {
          kind: "note",
          payload: {
            title: "Planning review"
          }
        }
      }
    });
    const payload = (response.item?.target as JsonObject | undefined)?.payload as JsonObject | undefined;
    expect(payload?.body).toContain("Calendar event details");
    expect(payload?.body).toContain("Location: Office");
  });

  it("refuses to convert birthday events", async () => {
    const services = createMcpTestDomainServices();
    services.state.events.set("birthday-1", {
      kind: "event",
      id: "birthday-1",
      title: "Ada birthday",
      hcbKind: "birthday",
      startDate: "2026-12-10",
      endDate: "2026-12-11",
      isAllDay: true
    });

    await expect(new McpToolRegistry(services).callTool(
      "hcb_convert_item",
      {
        sourceKind: "event",
        sourceId: "birthday-1",
        targetKind: "task",
        sourceAction: "keep",
        dryRun: true
      },
      allowWritesContext
    )).rejects.toMatchObject({
      code: "INVALID_ARGUMENTS",
      message: "Birthday events cannot be converted."
    });
  });

  it("requires confirmation for cancelling pending mutations", async () => {
    const registry = new McpToolRegistry(createMcpTestDomainServices());

    await expect(registry.callTool(
      "hcb_cancel_mutation",
      {
        id: "mutation-1"
      },
      allowWritesContext
    )).rejects.toMatchObject({
      code: "CONFIRMATION_REQUIRED"
    });

    const preview = await registry.callTool(
      "hcb_cancel_mutation",
      {
        id: "mutation-1",
        dryRun: true
      },
      allowWritesContext
    );

    expect(preview).toMatchObject({
      dryRun: true,
      requiresConfirmation: true,
      item: {
        kind: "mutationAction",
        action: "cancel",
        id: "mutation-1"
      }
    });
  });

  it("deletes lists through the destructive confirmation gate", async () => {
    const registry = new McpToolRegistry(createMcpTestDomainServices());
    const taskListPreview = await registry.callTool(
      "hcb_delete_task_list",
      {
        id: "list-inbox",
        dryRun: true
      },
      allowWritesContext
    );

    expect(taskListPreview).toMatchObject({
      applied: false,
      dryRun: true,
      requiresConfirmation: true,
      item: {
        kind: "taskList",
        id: "list-inbox"
      }
    });
    expect(taskListPreview.confirmationId).toEqual(expect.any(String));

    await expect(registry.callTool(
      "hcb_delete_note_list",
      {
        id: "list-inbox"
      },
      allowWritesContext
    )).rejects.toMatchObject({
      code: "CONFIRMATION_REQUIRED"
    });

    const taskListApply = await registry.callTool(
      "hcb_delete_task_list",
      {
        id: "list-inbox",
        confirmationId: taskListPreview.confirmationId
      },
      allowWritesContext
    );

    expect(taskListApply).toMatchObject({
      applied: true,
      dryRun: false,
      requiresConfirmation: false,
      item: {
        kind: "taskList",
        id: "list-inbox"
      }
    });
  });

  it("undoes and redoes through the destructive confirmation gate", async () => {
    const registry = new McpToolRegistry(createMcpTestDomainServices());
    const undoPreview = await registry.callTool(
      "hcb_undo",
      {
        dryRun: true
      },
      allowWritesContext
    );

    expect(undoPreview).toMatchObject({
      applied: false,
      dryRun: true,
      requiresConfirmation: true,
      item: {
        kind: "undoAction",
        action: "undo",
        title: "Edit task",
        canApply: true
      }
    });
    expect(undoPreview.confirmationId).toEqual(expect.any(String));

    await expect(registry.callTool(
      "hcb_undo",
      {},
      allowWritesContext
    )).rejects.toMatchObject({
      code: "CONFIRMATION_REQUIRED"
    });

    const undoApply = await registry.callTool(
      "hcb_undo",
      {
        confirmationId: undoPreview.confirmationId
      },
      allowWritesContext
    );

    expect(undoApply).toMatchObject({
      applied: true,
      item: {
        kind: "undoAction",
        action: "undo",
        label: "Edit task",
        resourceKind: "task",
        resourceId: "task-1"
      }
    });

    const redoPreview = await registry.callTool(
      "hcb_redo",
      {
        dryRun: true
      },
      allowWritesContext
    );

    expect(redoPreview).toMatchObject({
      dryRun: true,
      requiresConfirmation: true,
      item: {
        kind: "undoAction",
        action: "redo",
        title: "Edit task"
      }
    });
  });

  it("refuses undo dry-runs when the stack is empty", async () => {
    const services = createMcpTestDomainServices();
    services.state.undoStatus = {
      kind: "undoStatus",
      canUndo: false,
      canRedo: false
    };

    await expect(new McpToolRegistry(services).callTool(
      "hcb_undo",
      {
        dryRun: true
      },
      allowWritesContext
    )).rejects.toMatchObject({
      code: "INVALID_ARGUMENTS",
      message: "Nothing to undo."
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
      },
      hosters: {
        status: () => ({ enabled: false, running: false, port: 0, profiles: [] }),
        create: () => ({ id: "hoster:test", message: "created" }),
        export: () => ({ id: "hoster:test", path: "/tmp/test.hcbhost", message: "exported" }),
        import: () => ({ id: "hoster:test", path: "/tmp/test.hcbhost", message: "imported" }),
        remove: () => ({ id: "hoster:test", message: "removed" }),
        test: () => ({ id: "hoster:test", message: "tested" })
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
  hosters?: JsonObject;
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

  const registry = new McpToolRegistry(services);
  if (input.hosters) {
    registry.setAdminServices({
      settings: {} as never,
      google: {} as never,
      mcp: {} as never,
      hosters: {
        status: () => input.hosters as never,
        create: () => ({} as never),
        export: () => ({} as never),
        import: () => ({} as never),
        remove: () => ({} as never),
        test: () => ({} as never)
      }
    });
  }

  const response = await registry.callTool("hcb_doctor", input.args ?? {}, context);
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
