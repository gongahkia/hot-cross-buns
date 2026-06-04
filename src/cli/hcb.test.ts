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
