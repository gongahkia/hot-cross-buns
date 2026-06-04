import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseCommand,
  parseRuntimeFile,
  runHcbCli,
  type HcbCliDependencies
} from "./hcb";

describe("hcb CLI", () => {
  it("parses Git-like commands and options", () => {
    expect(parseCommand(["--", "status"])).toMatchObject({
      command: "status",
      json: false
    });
    expect(parseCommand(["status", "--json"])).toMatchObject({
      command: "status",
      json: true
    });
    expect(parseCommand(["log", "-n", "20", "--level", "warn"])).toMatchObject({
      command: "log",
      limit: 20,
      level: "warn"
    });
    expect(parseCommand(["show", "task", "task-1"])).toMatchObject({
      command: "show",
      kind: "task",
      id: "task-1"
    });
    expect(parseCommand(["doctor", "--json", "--log-limit", "10", "--mutation-limit", "5"])).toMatchObject({
      command: "doctor",
      json: true,
      logLimit: 10,
      mutationLimit: 5
    });
    expect(parseCommand(["search", "launch", "prep", "--scope", "tasks", "-n", "5"])).toMatchObject({
      command: "search",
      query: "launch prep",
      scope: "tasks",
      limit: 5
    });
    expect(parseCommand(["today", "--json"])).toMatchObject({
      command: "today",
      json: true
    });
    expect(parseCommand(["week", "--start-date", "2026-06-04"])).toMatchObject({
      command: "week",
      startDate: "2026-06-04"
    });
    expect(parseCommand(["export-diagnostics", "--log-limit", "10", "--mutation-limit", "5"])).toMatchObject({
      command: "export-diagnostics",
      logLimit: 10,
      mutationLimit: 5
    });
    expect(parseCommand(["list", "task-lists"])).toMatchObject({
      command: "list",
      target: "task-lists"
    });
    expect(parseCommand(["list", "calendars"])).toMatchObject({
      command: "list",
      target: "calendars"
    });
    expect(parseCommand(["list", "note-lists"])).toMatchObject({
      command: "list",
      target: "note-lists"
    });
    expect(parseCommand(["get", "task", "task-1"])).toMatchObject({
      command: "get",
      target: "task",
      id: "task-1"
    });
    expect(parseCommand(["get", "event", "event-1"])).toMatchObject({
      command: "get",
      target: "event",
      id: "event-1"
    });
    expect(parseCommand(["get", "note", "note-1"])).toMatchObject({
      command: "get",
      target: "note",
      id: "note-1"
    });
    expect(() => parseCommand(["search", "launch", "--scope", "invalid"])).toThrow("Scope");
    expect(() => parseCommand(["week", "--start-date", "not-a-date"])).toThrow("Start date");
    expect(() => parseCommand(["status", "--scope", "tasks"])).toThrow("--scope");
    expect(() => parseCommand(["list", "invalid"])).toThrow("List target");
    expect(() => parseCommand(["get", "invalid", "id"])).toThrow("Get target");
    expect(() => parseCommand(["get", "task"])).toThrow("Usage");
  });

  it("calls MCP status through the runtime file without exposing the bearer token", async () => {
    const directory = mkdtempSync(join(tmpdir(), "hcb-cli-"));
    const runtimeFile = join(directory, "mcp-runtime.json");
    const stdout = outputBuffer();
    const stderr = outputBuffer();
    const calls: Array<{ url: string; body: Record<string, unknown>; authorization?: string }> = [];
    const fetch: HcbCliDependencies["fetch"] = async (url, init) => {
      calls.push({
        url,
        body: JSON.parse(init.body) as Record<string, unknown>,
        authorization: init.headers.Authorization
      });

      return {
        status: 200,
        json: async () => ({
          jsonrpc: "2.0",
          id: "id",
          result: {
            structuredContent: {
              applied: false,
              dryRun: false,
              requiresConfirmation: false,
              message: "Read HCB status.",
              item: {
                account: { state: "connected" },
                sync: { state: "idle", mode: "manual", pendingMutationCount: 2 },
                pendingMutations: { totalCount: 2, failedCount: 1, retryableCount: 1 },
                cache: { taskCount: 4, eventCount: 5, noteCount: 6 },
                mcp: { enabled: true, permissionMode: "read-only", configuredPort: 4777 },
                build: { appName: "hot-cross-buns-2", version: "0.0.0", nodeVersion: "22.0.0" }
              }
            }
          }
        }),
        text: async () => ""
      };
    };

    try {
      writeFileSync(
        runtimeFile,
        JSON.stringify({
          running: true,
          url: "http://127.0.0.1",
          port: 4777,
          pid: process.pid,
          updatedAt: "2026-06-04T00:00:00.000Z"
        }),
        "utf8"
      );

      const exitCode = await runHcbCli(["status"], {
        fetch,
        runtimeFilePaths: [runtimeFile],
        stdout,
        stderr,
        tokenProvider: async () => "secret-token"
      });

      expect(exitCode).toBe(0);
      expect(stdout.text()).toContain("HCB status");
      expect(stdout.text()).toContain("Pending writes: total=2 failed=1 retryable=1");
      expect(stdout.text()).not.toContain("secret-token");
      expect(stderr.text()).toBe("");
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe("http://127.0.0.1:4777/mcp");
      expect(calls[0].authorization).toBe("Bearer secret-token");
      expect(calls[0].body).toMatchObject({
        method: "tools/call",
        params: {
          name: "hcb_status",
          arguments: {}
        }
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("calls MCP doctor and prints agent-friendly findings", async () => {
    const directory = mkdtempSync(join(tmpdir(), "hcb-cli-doctor-"));
    const runtimeFile = join(directory, "mcp-runtime.json");
    const stdout = outputBuffer();
    const stderr = outputBuffer();
    const calls: Array<{ body: Record<string, unknown> }> = [];
    const fetch: HcbCliDependencies["fetch"] = async (_url, init) => {
      calls.push({
        body: JSON.parse(init.body) as Record<string, unknown>
      });

      return {
        status: 200,
        json: async () => ({
          jsonrpc: "2.0",
          id: "id",
          result: {
            structuredContent: {
              applied: false,
              dryRun: false,
              requiresConfirmation: false,
              message: "Ran HCB doctor.",
              item: {
                kind: "doctor",
                status: "warning",
                findings: [
                  {
                    level: "warning",
                    title: "Pending local mutations",
                    detail: "2 local mutation(s) are waiting for Google sync."
                  }
                ],
                suggestedCommands: ["pnpm hcb -- diff"]
              }
            }
          }
        }),
        text: async () => ""
      };
    };

    try {
      writeFileSync(
        runtimeFile,
        JSON.stringify({
          running: true,
          url: "http://127.0.0.1",
          port: 4777,
          pid: process.pid,
          updatedAt: "2026-06-04T00:00:00.000Z"
        }),
        "utf8"
      );

      const exitCode = await runHcbCli(["doctor", "--log-limit", "10", "--mutation-limit", "5"], {
        fetch,
        runtimeFilePaths: [runtimeFile],
        stdout,
        stderr,
        tokenProvider: async () => "secret-token"
      });

      expect(exitCode).toBe(0);
      expect(stdout.text()).toContain("HCB doctor: warning");
      expect(stdout.text()).toContain("warning Pending local mutations");
      expect(stdout.text()).toContain("pnpm hcb -- diff");
      expect(stderr.text()).toBe("");
      expect(calls[0].body).toMatchObject({
        method: "tools/call",
        params: {
          name: "hcb_doctor",
          arguments: {
            logLimit: 10,
            mutationLimit: 5
          }
        }
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("calls MCP planning read commands and formats compact results", async () => {
    const directory = mkdtempSync(join(tmpdir(), "hcb-cli-read-"));
    const runtimeFile = join(directory, "mcp-runtime.json");
    const calls: Array<{ body: Record<string, unknown> }> = [];
    const fetch: HcbCliDependencies["fetch"] = async (_url, init) => {
      const body = JSON.parse(init.body) as Record<string, unknown>;
      const params = body.params as { name: string };
      calls.push({ body });

      return {
        status: 200,
        json: async () => rpcResponse(responseForPlanningTool(params.name)),
        text: async () => ""
      };
    };

    try {
      writeFileSync(
        runtimeFile,
        JSON.stringify({
          running: true,
          url: "http://127.0.0.1",
          port: 4777,
          pid: process.pid,
          updatedAt: "2026-06-04T00:00:00.000Z"
        }),
        "utf8"
      );

      const searchOut = outputBuffer();
      const todayOut = outputBuffer();
      const weekOut = outputBuffer();

      expect(await runHcbCli(["search", "launch", "--scope", "tasks", "--limit", "3"], {
        fetch,
        runtimeFilePaths: [runtimeFile],
        stdout: searchOut,
        stderr: outputBuffer(),
        tokenProvider: async () => "secret-token"
      })).toBe(0);
      expect(await runHcbCli(["today"], {
        fetch,
        runtimeFilePaths: [runtimeFile],
        stdout: todayOut,
        stderr: outputBuffer(),
        tokenProvider: async () => "secret-token"
      })).toBe(0);
      expect(await runHcbCli(["week", "--start-date", "2026-06-04"], {
        fetch,
        runtimeFilePaths: [runtimeFile],
        stdout: weekOut,
        stderr: outputBuffer(),
        tokenProvider: async () => "secret-token"
      })).toBe(0);

      expect(searchOut.text()).toContain("HCB search: 1 result");
      expect(searchOut.text()).toContain("task id=task-1 Plan launch checklist");
      expect(todayOut.text()).toContain("HCB today: 2026-06-04");
      expect(todayOut.text()).toContain("Tasks:");
      expect(todayOut.text()).toContain("Notes:");
      expect(weekOut.text()).toContain("HCB week: 2026-06-04 2026-06-11");
      expect(weekOut.text()).toContain("Events:");
      expect(calls.map((call) => (call.body.params as { name: string }).name)).toEqual([
        "hcb_search",
        "hcb_today",
        "hcb_week"
      ]);
      expect(calls[0].body).toMatchObject({
        params: {
          arguments: {
            query: "launch",
            scope: "tasks",
            limit: 3
          }
        }
      });
      expect(calls[2].body).toMatchObject({
        params: {
          arguments: {
            startDate: "2026-06-04"
          }
        }
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("exports a redacted read-only diagnostics bundle", async () => {
    const directory = mkdtempSync(join(tmpdir(), "hcb-cli-export-"));
    const runtimeFile = join(directory, "mcp-runtime.json");
    const stdout = outputBuffer();
    const stderr = outputBuffer();
    const calls: Array<{ name: string; args: Record<string, unknown>; authorization?: string }> = [];
    const fetch: HcbCliDependencies["fetch"] = async (_url, init) => {
      const body = JSON.parse(init.body) as {
        params: {
          name: string;
          arguments: Record<string, unknown>;
        };
      };
      calls.push({
        name: body.params.name,
        args: body.params.arguments,
        authorization: init.headers.Authorization
      });

      return {
        status: 200,
        json: async () => rpcResponse(responseForDiagnosticsTool(body.params.name, body.params.arguments)),
        text: async () => ""
      };
    };

    try {
      writeFileSync(
        runtimeFile,
        JSON.stringify({
          running: true,
          url: "http://127.0.0.1",
          port: 4777,
          pid: process.pid,
          updatedAt: "2026-06-04T00:00:00.000Z"
        }),
        "utf8"
      );

      const exitCode = await runHcbCli(["export-diagnostics", "--log-limit", "7", "--mutation-limit", "3"], {
        fetch,
        runtimeFilePaths: [runtimeFile],
        stdout,
        stderr,
        tokenProvider: async () => "secret-token"
      });
      const output = JSON.parse(stdout.text()) as Record<string, unknown>;

      expect(exitCode).toBe(0);
      expect(stderr.text()).toBe("");
      expect(output).toMatchObject({
        kind: "diagnosticsExport",
        doctor: {
          kind: "doctor"
        },
        status: {
          kind: "diagnosticsStatus"
        },
        pendingMutations: [
          {
            id: "mutation-1"
          }
        ],
        warningLogs: [
          {
            level: "warn"
          }
        ],
        errorLogs: [
          {
            level: "error"
          }
        ]
      });
      expect(stdout.text()).not.toContain("secret-token");
      expect(calls.map((call) => call.name)).toEqual([
        "hcb_doctor",
        "hcb_status",
        "hcb_diff",
        "hcb_log",
        "hcb_log"
      ]);
      expect(calls.every((call) => call.authorization === "Bearer secret-token")).toBe(true);
      expect(calls.map((call) => call.args)).toEqual([
        {
          logLimit: 7,
          mutationLimit: 3
        },
        {},
        {
          limit: 3
        },
        {
          limit: 7,
          level: "warn"
        },
        {
          limit: 7,
          level: "error"
        }
      ]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("calls MCP list and get read commands", async () => {
    const directory = mkdtempSync(join(tmpdir(), "hcb-cli-discovery-"));
    const runtimeFile = join(directory, "mcp-runtime.json");
    const calls: Array<{ body: Record<string, unknown> }> = [];
    const fetch: HcbCliDependencies["fetch"] = async (_url, init) => {
      const body = JSON.parse(init.body) as Record<string, unknown>;
      const params = body.params as { name: string };
      calls.push({ body });

      return {
        status: 200,
        json: async () => rpcResponse(responseForDiscoveryTool(params.name)),
        text: async () => ""
      };
    };

    try {
      writeFileSync(
        runtimeFile,
        JSON.stringify({
          running: true,
          url: "http://127.0.0.1",
          port: 4777,
          pid: process.pid,
          updatedAt: "2026-06-04T00:00:00.000Z"
        }),
        "utf8"
      );

      const taskListsOut = outputBuffer();
      const calendarsOut = outputBuffer();
      const noteListsOut = outputBuffer();
      const getTaskOut = outputBuffer();
      const getEventOut = outputBuffer();
      const getNoteOut = outputBuffer();
      const deps = {
        fetch,
        runtimeFilePaths: [runtimeFile],
        stderr: outputBuffer(),
        tokenProvider: async () => "secret-token"
      };

      expect(await runHcbCli(["list", "task-lists"], { ...deps, stdout: taskListsOut })).toBe(0);
      expect(await runHcbCli(["list", "calendars"], { ...deps, stdout: calendarsOut })).toBe(0);
      expect(await runHcbCli(["list", "note-lists"], { ...deps, stdout: noteListsOut })).toBe(0);
      expect(await runHcbCli(["get", "task", "task-1"], { ...deps, stdout: getTaskOut })).toBe(0);
      expect(await runHcbCli(["get", "event", "event-1"], { ...deps, stdout: getEventOut })).toBe(0);
      expect(await runHcbCli(["get", "note", "note-1"], { ...deps, stdout: getNoteOut })).toBe(0);

      expect(taskListsOut.text()).toContain("HCB task lists: 1 item");
      expect(taskListsOut.text()).toContain("taskList id=list-inbox Inbox");
      expect(calendarsOut.text()).toContain("HCB calendars: 1 item");
      expect(calendarsOut.text()).toContain("calendar id=cal-primary Primary selected=true");
      expect(noteListsOut.text()).toContain("HCB note lists: 1 item");
      expect(noteListsOut.text()).toContain("noteList id=note-list:default Local notes notes=1");
      expect(getTaskOut.text()).toContain("HCB task");
      expect(getTaskOut.text()).toContain("\"id\": \"task-1\"");
      expect(getEventOut.text()).toContain("HCB event");
      expect(getEventOut.text()).toContain("\"id\": \"event-1\"");
      expect(getNoteOut.text()).toContain("HCB note");
      expect(getNoteOut.text()).toContain("\"id\": \"note-1\"");
      expect(calls.map((call) => (call.body.params as { name: string }).name)).toEqual([
        "hcb_list_task_lists",
        "hcb_list_calendars",
        "hcb_list_note_lists",
        "hcb_get_task",
        "hcb_get_event",
        "hcb_get_note"
      ]);
      expect(calls.slice(0, 3).map((call) => (call.body.params as { arguments: Record<string, unknown> }).arguments)).toEqual([
        {},
        {},
        {}
      ]);
      expect(calls.slice(3).map((call) => (call.body.params as { arguments: Record<string, unknown> }).arguments)).toEqual([
        {
          id: "task-1"
        },
        {
          id: "event-1"
        },
        {
          id: "note-1"
        }
      ]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("fails fast when the runtime file is stale", async () => {
    const directory = mkdtempSync(join(tmpdir(), "hcb-cli-stale-"));
    const runtimeFile = join(directory, "mcp-runtime.json");
    const stdout = outputBuffer();
    const stderr = outputBuffer();

    try {
      writeFileSync(
        runtimeFile,
        JSON.stringify({
          running: true,
          url: "http://127.0.0.1",
          port: 4777,
          pid: 99_999,
          updatedAt: "2026-06-04T00:00:00.000Z"
        }),
        "utf8"
      );

      const exitCode = await runHcbCli(["status"], {
        runtimeFilePaths: [runtimeFile],
        stdout,
        stderr,
        pidExists: () => false,
        tokenProvider: async () => "secret-token"
      });

      expect(exitCode).toBe(1);
      expect(stdout.text()).toBe("");
      expect(stderr.text()).toContain("runtime file is stale");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("reports stale runtime files as doctor findings", async () => {
    const directory = mkdtempSync(join(tmpdir(), "hcb-cli-doctor-stale-"));
    const runtimeFile = join(directory, "mcp-runtime.json");
    const stdout = outputBuffer();
    const stderr = outputBuffer();

    try {
      writeFileSync(
        runtimeFile,
        JSON.stringify({
          running: true,
          url: "http://127.0.0.1",
          port: 4777,
          pid: 99_999,
          updatedAt: "2026-06-04T00:00:00.000Z"
        }),
        "utf8"
      );

      const exitCode = await runHcbCli(["doctor"], {
        runtimeFilePaths: [runtimeFile],
        stdout,
        stderr,
        pidExists: () => false,
        tokenProvider: async () => "secret-token"
      });

      expect(exitCode).toBe(1);
      expect(stdout.text()).toContain("HCB doctor: error");
      expect(stdout.text()).toContain("MCP unavailable");
      expect(stdout.text()).toContain("runtime file is stale");
      expect(stderr.text()).toBe("");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("validates runtime file contents", () => {
    expect(() => parseRuntimeFile("{}")).toThrow("invalid");
  });
});

function rpcResponse(structuredContent: Record<string, unknown>): Record<string, unknown> {
  return {
    jsonrpc: "2.0",
    id: "id",
    result: {
      structuredContent
    }
  };
}

function responseForDiscoveryTool(name: string): Record<string, unknown> {
  if (name === "hcb_list_task_lists") {
    return {
      applied: false,
      dryRun: false,
      requiresConfirmation: false,
      message: "Read task lists.",
      items: [
        {
          kind: "taskList",
          id: "list-inbox",
          title: "Inbox"
        }
      ]
    };
  }

  if (name === "hcb_list_calendars") {
    return {
      applied: false,
      dryRun: false,
      requiresConfirmation: false,
      message: "Read calendars.",
      items: [
        {
          kind: "calendar",
          id: "cal-primary",
          summary: "Primary",
          isSelected: true
        }
      ]
    };
  }

  if (name === "hcb_list_note_lists") {
    return {
      applied: false,
      dryRun: false,
      requiresConfirmation: false,
      message: "Read note lists.",
      items: [
        {
          kind: "noteList",
          id: "note-list:default",
          title: "Local notes",
          noteCount: 1
        }
      ]
    };
  }

  if (name === "hcb_get_task") {
    return {
      applied: false,
      dryRun: false,
      requiresConfirmation: false,
      message: "Read task.",
      item: {
        kind: "task",
        id: "task-1",
        title: "Plan launch checklist"
      }
    };
  }

  if (name === "hcb_get_event") {
    return {
      applied: false,
      dryRun: false,
      requiresConfirmation: false,
      message: "Read event.",
      item: {
        kind: "event",
        id: "event-1",
        title: "Planning review"
      }
    };
  }

  return {
    applied: false,
    dryRun: false,
    requiresConfirmation: false,
    message: "Read note.",
    item: {
      kind: "note",
      id: "note-1",
      title: "Local note"
    }
  };
}

function responseForPlanningTool(name: string): Record<string, unknown> {
  if (name === "hcb_search") {
    return {
      applied: false,
      dryRun: false,
      requiresConfirmation: false,
      message: "Found 1 result.",
      items: [
        {
          kind: "task",
          id: "task-1",
          title: "Plan launch checklist",
          status: "needsAction",
          dueDate: "2026-06-04T00:00:00.000Z",
          taskListTitle: "Inbox"
        }
      ]
    };
  }

  if (name === "hcb_today") {
    return {
      applied: false,
      dryRun: false,
      requiresConfirmation: false,
      message: "Read today's agenda.",
      item: {
        date: "2026-06-04",
        tasks: [
          {
            kind: "task",
            id: "task-1",
            title: "Plan launch checklist"
          }
        ],
        notes: [
          {
            kind: "note",
            id: "note-1",
            title: "Local note"
          }
        ],
        events: []
      }
    };
  }

  return {
    applied: false,
    dryRun: false,
    requiresConfirmation: false,
    message: "Read week agenda.",
    item: {
      startDate: "2026-06-04",
      endDate: "2026-06-11",
      tasks: [],
      notes: [],
      events: [
        {
          kind: "event",
          id: "event-1",
          title: "Planning review",
          startDate: "2026-06-04T09:00:00.000Z",
          endDate: "2026-06-04T10:00:00.000Z",
          calendarTitle: "Primary"
        }
      ]
    }
  };
}

function responseForDiagnosticsTool(name: string, args: Record<string, unknown>): Record<string, unknown> {
  if (name === "hcb_doctor") {
    return {
      applied: false,
      dryRun: false,
      requiresConfirmation: false,
      message: "Ran HCB doctor.",
      item: {
        kind: "doctor",
        status: "warning",
        findings: [
          {
            level: "warning",
            title: "Pending local mutations",
            detail: "1 local mutation(s) are waiting for Google sync."
          }
        ],
        suggestedCommands: ["pnpm hcb -- diff"]
      }
    };
  }

  if (name === "hcb_status") {
    return {
      applied: false,
      dryRun: false,
      requiresConfirmation: false,
      message: "Read HCB status.",
      item: {
        kind: "diagnosticsStatus",
        account: {
          state: "connected"
        }
      }
    };
  }

  if (name === "hcb_diff") {
    return {
      applied: false,
      dryRun: false,
      requiresConfirmation: false,
      message: "Read 1 pending mutation.",
      items: [
        {
          kind: "mutation",
          id: "mutation-1",
          status: "pending"
        }
      ]
    };
  }

  return {
    applied: false,
    dryRun: false,
    requiresConfirmation: false,
    message: "Read 1 log entry.",
    items: [
      {
        kind: "log",
        id: String(args.level),
        level: String(args.level),
        message: `${String(args.level)} log`
      }
    ]
  };
}

function outputBuffer(): NodeJS.WritableStream & { text: () => string } {
  let value = "";

  return {
    write: (chunk: string | Uint8Array) => {
      value += String(chunk);
      return true;
    },
    text: () => value
  } as NodeJS.WritableStream & { text: () => string };
}
