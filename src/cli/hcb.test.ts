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
    expect(parseCommand(["create", "task", "--title", "Plan launch", "--notes", "Checklist", "--due-date", "2026-06-04", "--task-list-id", "list-inbox"])).toMatchObject({
      command: "create",
      target: "task",
      title: "Plan launch",
      notes: "Checklist",
      dueDate: "2026-06-04",
      taskListId: "list-inbox"
    });
    expect(parseCommand(["create", "note", "--title", "Scratch", "--body", "Local body", "--apply", "--confirmation-id", "confirm-1"])).toMatchObject({
      command: "create",
      target: "note",
      title: "Scratch",
      body: "Local body",
      apply: true,
      confirmationId: "confirm-1"
    });
    expect(parseCommand(["create", "event", "--title", "Review", "--start-date", "2026-06-04T09:00:00.000Z", "--end-date", "2026-06-04T10:00:00.000Z", "--details", "Agenda", "--location", "Office", "--calendar-id", "cal-primary"])).toMatchObject({
      command: "create",
      target: "event",
      title: "Review",
      startDate: "2026-06-04T09:00:00.000Z",
      endDate: "2026-06-04T10:00:00.000Z",
      details: "Agenda",
      location: "Office",
      calendarId: "cal-primary"
    });
    expect(parseCommand(["create", "event", "--title", "Holiday", "--start-date", "2026-06-04", "--end-date", "2026-06-05", "--all-day"])).toMatchObject({
      command: "create",
      target: "event",
      title: "Holiday",
      startDate: "2026-06-04",
      endDate: "2026-06-05",
      allDay: true
    });
    expect(parseCommand(["create", "task-list", "--title", "Errands"])).toMatchObject({
      command: "create",
      target: "task-list",
      title: "Errands"
    });
    expect(parseCommand(["create", "note-list", "--title", "Project notes"])).toMatchObject({
      command: "create",
      target: "note-list",
      title: "Project notes"
    });
    expect(parseCommand(["update", "task", "task-1", "--title", "Plan v2", "--notes", "New notes", "--due-date", "2026-06-05", "--task-list-id", "list-inbox"])).toMatchObject({
      command: "update",
      target: "task",
      id: "task-1",
      title: "Plan v2",
      notes: "New notes",
      dueDate: "2026-06-05",
      taskListId: "list-inbox"
    });
    expect(parseCommand(["update", "note", "note-1", "--title", "Scratch v2", "--body", "Body v2"])).toMatchObject({
      command: "update",
      target: "note",
      id: "note-1",
      title: "Scratch v2",
      body: "Body v2"
    });
    expect(parseCommand(["update", "event", "event-1", "--title", "Review v2", "--start-date", "2026-06-04T09:00:00.000Z", "--end-date", "2026-06-04T10:00:00.000Z", "--details", "Agenda", "--location", "Office", "--calendar-id", "cal-primary"])).toMatchObject({
      command: "update",
      target: "event",
      id: "event-1",
      title: "Review v2",
      startDate: "2026-06-04T09:00:00.000Z",
      endDate: "2026-06-04T10:00:00.000Z",
      details: "Agenda",
      location: "Office",
      calendarId: "cal-primary"
    });
    expect(parseCommand(["rename", "task-list", "list-inbox", "--title", "Inbox v2"])).toMatchObject({
      command: "rename",
      target: "task-list",
      id: "list-inbox",
      title: "Inbox v2"
    });
    expect(parseCommand(["complete", "task", "task-1"])).toMatchObject({
      command: "complete",
      target: "task",
      id: "task-1"
    });
    expect(parseCommand(["reopen", "task", "task-1"])).toMatchObject({
      command: "reopen",
      target: "task",
      id: "task-1"
    });
    expect(parseCommand(["move", "task", "task-1", "--task-list-id", "list-next"])).toMatchObject({
      command: "move",
      target: "task",
      id: "task-1",
      taskListId: "list-next"
    });
    expect(parseCommand(["move", "task", "task-1", "--parent-id", "parent-1", "--previous-sibling-id", "null"])).toMatchObject({
      command: "move",
      target: "task",
      id: "task-1",
      parentId: "parent-1",
      previousSiblingId: null
    });
    expect(parseCommand(["schedule", "task", "task-1", "--calendar-id", "cal-primary", "--start-date", "2026-06-04T09:00:00.000Z", "--duration-minutes", "45"])).toMatchObject({
      command: "schedule",
      target: "task",
      id: "task-1",
      calendarId: "cal-primary",
      startDate: "2026-06-04T09:00:00.000Z",
      durationMinutes: 45
    });
    expect(parseCommand(["settings", "update", "--patch-json", "{\"mcpEnabled\":true}"])).toMatchObject({
      command: "settings",
      action: "update",
      patchJson: {
        mcpEnabled: true
      }
    });
    expect(parseCommand(["google", "save-oauth-client", "--client-id", "client-id-12345", "--client-secret", "secret"])).toMatchObject({
      command: "google",
      action: "save-oauth-client",
      clientId: "client-id-12345",
      clientSecret: "secret"
    });
    expect(parseCommand(["google", "begin-oauth", "--apply"])).toMatchObject({
      command: "google",
      action: "begin-oauth",
      apply: true
    });
    expect(parseCommand(["mcp", "set-enabled", "true"])).toMatchObject({
      command: "mcp",
      action: "set-enabled",
      enabled: true
    });
    expect(() => parseCommand(["search", "launch", "--scope", "invalid"])).toThrow("Scope");
    expect(() => parseCommand(["week", "--start-date", "not-a-date"])).toThrow("Start date");
    expect(() => parseCommand(["status", "--scope", "tasks"])).toThrow("--scope");
    expect(() => parseCommand(["list", "invalid"])).toThrow("List target");
    expect(() => parseCommand(["get", "invalid", "id"])).toThrow("Get target");
    expect(() => parseCommand(["get", "task"])).toThrow("Usage");
    expect(() => parseCommand(["create", "task"])).toThrow("Missing required --title");
    expect(() => parseCommand(["create", "task", "--title", " "])).toThrow("Missing required --title");
    expect(() => parseCommand(["create", "event", "--title", "Review"])).toThrow("Missing required --start-date");
    expect(() => parseCommand(["create", "event", "--title", "Review", "--start-date", "2026-06-04T10:00:00.000Z", "--end-date", "2026-06-04T09:00:00.000Z"])).toThrow("--end-date");
    expect(() => parseCommand(["create", "event", "--title", "Holiday", "--start-date", "2026-06-04T09:00:00.000Z", "--all-day"])).toThrow("--all-day");
    expect(() => parseCommand(["create", "note", "--title", "Scratch", "--task-list-id", "list-inbox"])).toThrow("--task-list-id");
    expect(() => parseCommand(["create", "task-list", "--title", "Errands", "--body", "Nope"])).toThrow("--body");
    expect(() => parseCommand(["create", "invalid", "--title", "Scratch"])).toThrow("Create target");
    expect(() => parseCommand(["update", "task", "task-1"])).toThrow("At least one update field");
    expect(() => parseCommand(["update", "note", "note-1", "--task-list-id", "list-inbox"])).toThrow("--task-list-id");
    expect(() => parseCommand(["update", "event", "event-1", "--start-date", "2026-06-04T10:00:00.000Z", "--end-date", "2026-06-04T09:00:00.000Z"])).toThrow("--end-date");
    expect(() => parseCommand(["update", "event", "event-1", "--start-date", "2026-06-04T09:00:00.000Z", "--all-day"])).toThrow("--all-day");
    expect(() => parseCommand(["rename", "note-list", "note-list:default"])).toThrow("Missing required --title");
    expect(() => parseCommand(["complete", "task", "task-1", "--title", "Nope"])).toThrow("--title");
    expect(() => parseCommand(["move", "task", "task-1"])).toThrow("At least one update field");
    expect(() => parseCommand(["move", "note", "note-1", "--task-list-id", "list-inbox"])).toThrow("move target");
    expect(() => parseCommand(["schedule", "task", "task-1", "--calendar-id", "cal-primary"])).toThrow("Missing required --start-date");
    expect(() => parseCommand(["settings", "update", "--patch-json", "[]"])).toThrow("--patch-json");
    expect(() => parseCommand(["google", "save-oauth-client"])).toThrow("--client-id");
    expect(() => parseCommand(["mcp", "set-enabled"])).toThrow("enabled");
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

  it("calls MCP create commands with dry-run defaults, apply, and confirmation ids", async () => {
    const directory = mkdtempSync(join(tmpdir(), "hcb-cli-create-"));
    const runtimeFile = join(directory, "mcp-runtime.json");
    const calls: Array<{ body: Record<string, unknown>; authorization?: string }> = [];
    const fetch: HcbCliDependencies["fetch"] = async (_url, init) => {
      const body = JSON.parse(init.body) as {
        params: {
          name: string;
          arguments: Record<string, unknown>;
        };
      };
      calls.push({
        body,
        authorization: init.headers.Authorization
      });

      return {
        status: 200,
        json: async () => rpcResponse(responseForCreateTool(body.params.name, body.params.arguments)),
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

      const taskOut = outputBuffer();
      const noteDryRunOut = outputBuffer();
      const noteOut = outputBuffer();
      const eventOut = outputBuffer();
      const taskListOut = outputBuffer();
      const noteListJsonOut = outputBuffer();
      const deps = {
        fetch,
        runtimeFilePaths: [runtimeFile],
        stderr: outputBuffer(),
        tokenProvider: async () => "secret-token"
      };

      expect(await runHcbCli(["create", "task", "--title", "Plan launch", "--notes", "Checklist", "--due-date", "2026-06-04", "--task-list-id", "list-inbox"], { ...deps, stdout: taskOut })).toBe(0);
      expect(await runHcbCli(["create", "note", "--title", "Scratch", "--body", "Local body"], { ...deps, stdout: noteDryRunOut })).toBe(0);
      expect(await runHcbCli(["create", "note", "--title", "Scratch", "--body", "Local body", "--apply", "--confirmation-id", "confirm-1"], { ...deps, stdout: noteOut })).toBe(0);
      expect(await runHcbCli(["create", "event", "--title", "Review", "--start-date", "2026-06-04T09:00:00.000Z", "--end-date", "2026-06-04T10:00:00.000Z", "--details", "Agenda", "--location", "Office", "--calendar-id", "cal-primary"], { ...deps, stdout: eventOut })).toBe(0);
      expect(await runHcbCli(["create", "task-list", "--title", "Errands"], { ...deps, stdout: taskListOut })).toBe(0);
      expect(await runHcbCli(["create", "note-list", "--title", "Project notes", "--json"], { ...deps, stdout: noteListJsonOut })).toBe(0);
      const noteListJson = JSON.parse(noteListJsonOut.text()) as Record<string, unknown>;

      expect(taskOut.text()).toContain("HCB create task: dry-run");
      expect(taskOut.text()).toContain("Confirmation id: confirm-task");
      expect(taskOut.text()).toContain("Apply: pnpm hcb -- create task --title 'Plan launch' --notes Checklist --due-date 2026-06-04 --task-list-id list-inbox --apply --confirmation-id confirm-task");
      expect(noteDryRunOut.text()).toContain("Apply: pnpm hcb -- create note --title Scratch --body 'Local body' --apply --confirmation-id confirm-note");
      expect(noteOut.text()).toContain("HCB create note: applied");
      expect(eventOut.text()).toContain("HCB create event: dry-run");
      expect(taskListOut.text()).toContain("HCB create task-list: dry-run");
      expect(taskListOut.text()).toContain("Apply: pnpm hcb -- create task-list --title Errands --apply --confirmation-id confirm-task-list");
      expect(noteListJson).toMatchObject({
        tool: "hcb_create_note_list",
        target: "note-list",
        dryRun: true,
        requiresConfirmation: true,
        confirmationId: "confirm-note-list",
        applyCommand: "pnpm hcb -- create note-list --title 'Project notes' --apply --confirmation-id confirm-note-list",
        item: {
          kind: "noteList",
          id: "note-list-1",
          title: "Project notes"
        }
      });
      expect(`${taskOut.text()}${noteDryRunOut.text()}${noteOut.text()}${eventOut.text()}${taskListOut.text()}${noteListJsonOut.text()}`).not.toContain("secret-token");
      expect(calls.every((call) => call.authorization === "Bearer secret-token")).toBe(true);
      expect(calls.map((call) => (call.body.params as { name: string }).name)).toEqual([
        "hcb_create_task",
        "hcb_create_note",
        "hcb_create_note",
        "hcb_create_event",
        "hcb_create_task_list",
        "hcb_create_note_list"
      ]);
      expect(calls.map((call) => (call.body.params as { arguments: Record<string, unknown> }).arguments)).toEqual([
        {
          title: "Plan launch",
          notes: "Checklist",
          dueDate: "2026-06-04",
          taskListId: "list-inbox",
          dryRun: true
        },
        {
          title: "Scratch",
          body: "Local body",
          dryRun: true
        },
        {
          title: "Scratch",
          body: "Local body",
          dryRun: false,
          confirmationId: "confirm-1"
        },
        {
          title: "Review",
          startDate: "2026-06-04T09:00:00.000Z",
          details: "Agenda",
          endDate: "2026-06-04T10:00:00.000Z",
          location: "Office",
          calendarId: "cal-primary",
          dryRun: true
        },
        {
          title: "Errands",
          dryRun: true
        },
        {
          title: "Project notes",
          dryRun: true
        }
      ]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("calls MCP update, rename, and task state commands with dry-run defaults", async () => {
    const directory = mkdtempSync(join(tmpdir(), "hcb-cli-update-"));
    const runtimeFile = join(directory, "mcp-runtime.json");
    const calls: Array<{ body: Record<string, unknown>; authorization?: string }> = [];
    const fetch: HcbCliDependencies["fetch"] = async (_url, init) => {
      const body = JSON.parse(init.body) as {
        params: {
          name: string;
          arguments: Record<string, unknown>;
        };
      };
      calls.push({
        body,
        authorization: init.headers.Authorization
      });

      return {
        status: 200,
        json: async () => rpcResponse(responseForWriteTool(body.params.name, body.params.arguments)),
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

      const taskOut = outputBuffer();
      const noteJsonOut = outputBuffer();
      const eventOut = outputBuffer();
      const renameTaskListOut = outputBuffer();
      const renameNoteListOut = outputBuffer();
      const completeOut = outputBuffer();
      const reopenOut = outputBuffer();
      const moveOut = outputBuffer();
      const deps = {
        fetch,
        runtimeFilePaths: [runtimeFile],
        stderr: outputBuffer(),
        tokenProvider: async () => "secret-token"
      };

      expect(await runHcbCli(["update", "task", "task-1", "--title", "Plan v2", "--notes", "New notes", "--due-date", "2026-06-05", "--task-list-id", "list-inbox"], { ...deps, stdout: taskOut })).toBe(0);
      expect(await runHcbCli(["update", "note", "note-1", "--title", "Scratch v2", "--body", "Body v2", "--json"], { ...deps, stdout: noteJsonOut })).toBe(0);
      expect(await runHcbCli(["update", "event", "event-1", "--title", "Review v2", "--start-date", "2026-06-04T09:00:00.000Z", "--end-date", "2026-06-04T10:00:00.000Z", "--details", "Agenda", "--location", "Office", "--calendar-id", "cal-primary"], { ...deps, stdout: eventOut })).toBe(0);
      expect(await runHcbCli(["rename", "task-list", "list-inbox", "--title", "Inbox v2"], { ...deps, stdout: renameTaskListOut })).toBe(0);
      expect(await runHcbCli(["rename", "note-list", "note-list:default", "--title", "Notes v2", "--apply", "--confirmation-id", "confirm-rename-note-list"], { ...deps, stdout: renameNoteListOut })).toBe(0);
      expect(await runHcbCli(["complete", "task", "task-1"], { ...deps, stdout: completeOut })).toBe(0);
      expect(await runHcbCli(["reopen", "task", "task-1"], { ...deps, stdout: reopenOut })).toBe(0);
      expect(await runHcbCli(["move", "task", "task-1", "--task-list-id", "list-next"], { ...deps, stdout: moveOut })).toBe(0);
      const noteJson = JSON.parse(noteJsonOut.text()) as Record<string, unknown>;

      expect(taskOut.text()).toContain("HCB update task: dry-run");
      expect(taskOut.text()).toContain("Apply: pnpm hcb -- update task task-1 --title 'Plan v2' --notes 'New notes' --due-date 2026-06-05 --task-list-id list-inbox --apply --confirmation-id confirm-update-task");
      expect(noteJson).toMatchObject({
        tool: "hcb_update_note",
        target: "note",
        dryRun: true,
        confirmationId: "confirm-update-note",
        applyCommand: "pnpm hcb -- update note note-1 --title 'Scratch v2' --body 'Body v2' --apply --confirmation-id confirm-update-note"
      });
      expect(eventOut.text()).toContain("HCB update event: dry-run");
      expect(renameTaskListOut.text()).toContain("HCB rename task-list: dry-run");
      expect(renameNoteListOut.text()).toContain("HCB rename note-list: applied");
      expect(completeOut.text()).toContain("HCB complete task: dry-run");
      expect(reopenOut.text()).toContain("HCB reopen task: dry-run");
      expect(moveOut.text()).toContain("HCB move task: dry-run");
      expect(`${taskOut.text()}${noteJsonOut.text()}${eventOut.text()}${renameTaskListOut.text()}${renameNoteListOut.text()}${completeOut.text()}${reopenOut.text()}${moveOut.text()}`).not.toContain("secret-token");
      expect(calls.every((call) => call.authorization === "Bearer secret-token")).toBe(true);
      expect(calls.map((call) => (call.body.params as { name: string }).name)).toEqual([
        "hcb_update_task",
        "hcb_update_note",
        "hcb_update_event",
        "hcb_rename_task_list",
        "hcb_rename_note_list",
        "hcb_complete_task",
        "hcb_reopen_task",
        "hcb_move_task"
      ]);
      expect(calls.map((call) => (call.body.params as { arguments: Record<string, unknown> }).arguments)).toEqual([
        {
          id: "task-1",
          dryRun: true,
          patch: {
            title: "Plan v2",
            notes: "New notes",
            dueDate: "2026-06-05",
            taskListId: "list-inbox"
          }
        },
        {
          id: "note-1",
          dryRun: true,
          patch: {
            title: "Scratch v2",
            body: "Body v2"
          }
        },
        {
          id: "event-1",
          dryRun: true,
          patch: {
            title: "Review v2",
            details: "Agenda",
            startDate: "2026-06-04T09:00:00.000Z",
            endDate: "2026-06-04T10:00:00.000Z",
            location: "Office",
            calendarId: "cal-primary"
          }
        },
        {
          id: "list-inbox",
          dryRun: true,
          title: "Inbox v2"
        },
        {
          id: "note-list:default",
          dryRun: false,
          confirmationId: "confirm-rename-note-list",
          title: "Notes v2"
        },
        {
          id: "task-1",
          dryRun: true
        },
        {
          id: "task-1",
          dryRun: true
        },
        {
          id: "task-1",
          dryRun: true,
          taskListId: "list-next"
        }
      ]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("calls MCP advanced write commands without echoing OAuth secrets", async () => {
    const directory = mkdtempSync(join(tmpdir(), "hcb-cli-advanced-write-"));
    const runtimeFile = join(directory, "mcp-runtime.json");
    const calls: Array<{ body: Record<string, unknown>; authorization?: string }> = [];
    const fetch: HcbCliDependencies["fetch"] = async (_url, init) => {
      const body = JSON.parse(init.body) as {
        params: {
          name: string;
          arguments: Record<string, unknown>;
        };
      };
      calls.push({
        body,
        authorization: init.headers.Authorization
      });

      return {
        status: 200,
        json: async () => rpcResponse(responseForWriteTool(body.params.name, body.params.arguments)),
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

      const taskOut = outputBuffer();
      const eventOut = outputBuffer();
      const noteOut = outputBuffer();
      const moveOut = outputBuffer();
      const scheduleOut = outputBuffer();
      const settingsOut = outputBuffer();
      const googleOut = outputBuffer();
      const beginOut = outputBuffer();
      const mcpOut = outputBuffer();
      const deps = {
        fetch,
        runtimeFilePaths: [runtimeFile],
        stderr: outputBuffer(),
        tokenProvider: async () => "secret-token"
      };

      expect(await runHcbCli(["create", "task", "--title", "Plan launch", "--priority", "high", "--planned-start", "2026-06-04T09:00:00.000Z", "--planned-end", "2026-06-04T10:00:00.000Z", "--duration-minutes", "60", "--locked-schedule", "--snooze-until", "2026-06-05T00:00:00.000Z", "--tags", "launch,ops", "--parent-id", "parent-1", "--previous-sibling-id", "null"], { ...deps, stdout: taskOut })).toBe(0);
      expect(await runHcbCli(["update", "event", "event-1", "--guest-emails", "ada@example.com,grace@example.com", "--reminder-minutes", "10,30", "--color-id", "9", "--time-zone", "Asia/Singapore", "--recurrence-frequency", "weekly", "--recurrence-interval", "2", "--recurrence-by-day", "MO,WE"], { ...deps, stdout: eventOut })).toBe(0);
      expect(await runHcbCli(["update", "note", "note-1", "--note-list-id", "note-list:project"], { ...deps, stdout: noteOut })).toBe(0);
      expect(await runHcbCli(["move", "task", "task-1", "--parent-id", "parent-1", "--previous-sibling-id", "null"], { ...deps, stdout: moveOut })).toBe(0);
      expect(await runHcbCli(["schedule", "task", "task-1", "--calendar-id", "cal-primary", "--start-date", "2026-06-04T09:00:00.000Z", "--duration-minutes", "45"], { ...deps, stdout: scheduleOut })).toBe(0);
      expect(await runHcbCli(["settings", "update", "--patch-json", "{\"mcpEnabled\":true}"], { ...deps, stdout: settingsOut })).toBe(0);
      expect(await runHcbCli(["google", "save-oauth-client", "--client-id", "client-id-12345", "--client-secret", "super-secret"], { ...deps, stdout: googleOut })).toBe(0);
      expect(await runHcbCli(["google", "begin-oauth", "--apply"], { ...deps, stdout: beginOut })).toBe(0);
      expect(await runHcbCli(["mcp", "set-enabled", "true"], { ...deps, stdout: mcpOut })).toBe(0);

      expect(taskOut.text()).toContain("--priority high");
      expect(scheduleOut.text()).toContain("HCB schedule task: dry-run");
      expect(googleOut.text()).not.toContain("super-secret");
      expect(googleOut.text()).not.toContain("Apply:");
      expect(calls.map((call) => (call.body.params as { name: string }).name)).toEqual([
        "hcb_create_task",
        "hcb_update_event",
        "hcb_update_note",
        "hcb_move_task",
        "hcb_schedule_task_block",
        "hcb_settings_update",
        "hcb_google_save_oauth_client",
        "hcb_google_begin_oauth",
        "hcb_mcp_set_enabled"
      ]);
      expect(calls.map((call) => (call.body.params as { arguments: Record<string, unknown> }).arguments)).toEqual([
        {
          title: "Plan launch",
          parentId: "parent-1",
          previousSiblingId: null,
          priority: "high",
          plannedStart: "2026-06-04T09:00:00.000Z",
          plannedEnd: "2026-06-04T10:00:00.000Z",
          durationMinutes: 60,
          lockedSchedule: true,
          snoozeUntil: "2026-06-05T00:00:00.000Z",
          tags: ["launch", "ops"],
          dryRun: true
        },
        {
          id: "event-1",
          dryRun: true,
          patch: {
            guestEmails: ["ada@example.com", "grace@example.com"],
            reminderMinutes: [10, 30],
            colorId: "9",
            timeZone: "Asia/Singapore",
            recurrence: {
              frequency: "weekly",
              interval: 2,
              byDay: ["MO", "WE"]
            }
          }
        },
        {
          id: "note-1",
          dryRun: true,
          patch: {
            noteListId: "note-list:project"
          }
        },
        {
          id: "task-1",
          dryRun: true,
          parentId: "parent-1",
          previousSiblingId: null
        },
        {
          dryRun: true,
          taskId: "task-1",
          calendarId: "cal-primary",
          startDate: "2026-06-04T09:00:00.000Z",
          durationMinutes: 45
        },
        {
          dryRun: true,
          patch: {
            mcpEnabled: true
          }
        },
        {
          dryRun: true,
          clientId: "client-id-12345",
          clientSecret: "super-secret"
        },
        {
          dryRun: false
        },
        {
          dryRun: true,
          enabled: true
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

function responseForCreateTool(name: string, args: Record<string, unknown>): Record<string, unknown> {
  const dryRun = args.dryRun !== false;
  const target = name.replace("hcb_create_", "").replaceAll("_", "-");
  const kind = target === "task-list" ? "taskList" : target === "note-list" ? "noteList" : target;
  const id = `${target}-1`;

  return {
    applied: !dryRun,
    dryRun,
    requiresConfirmation: dryRun,
    ...(dryRun ? { confirmationId: `confirm-${target}` } : {}),
    message: dryRun ? "Dry-run ready. Pass confirmationId to apply." : `Applied create ${target}.`,
    item: {
      kind,
      id,
      title: String(args.title)
    }
  };
}

function responseForWriteTool(name: string, args: Record<string, unknown>): Record<string, unknown> {
  const dryRun = args.dryRun !== false;
  const action = name.replace(/^hcb_/, "").replaceAll("_", "-");
  const target = action
    .replace(/^update-/, "")
    .replace(/^rename-/, "")
    .replace(/^complete-/, "")
    .replace(/^reopen-/, "")
    .replace(/^move-/, "");
  const kind = target === "task-list" ? "taskList" : target === "note-list" ? "noteList" : target;
  const patch = typeof args.patch === "object" && args.patch !== null ? args.patch as Record<string, unknown> : {};

  return {
    applied: !dryRun,
    dryRun,
    requiresConfirmation: dryRun,
    ...(dryRun ? { confirmationId: `confirm-${action}` } : {}),
    message: dryRun ? "Dry-run ready. Pass confirmationId to apply." : `Applied ${action}.`,
    item: {
      kind,
      id: String(args.id),
      title: String(args.title ?? patch.title ?? `${target} title`)
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
