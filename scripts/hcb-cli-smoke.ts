import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runHcbCli } from "../src/cli/hcb";
import { StaticMcpCredentialAdapter } from "../src/main/mcp/credentials";
import { writeMcpRuntimeFile } from "../src/main/mcp/runtimeFile";
import { LocalMcpServer } from "../src/main/mcp/server";
import { createMcpTestDomainServices } from "../src/main/mcp/testDomainDoubles";
import { McpToolRegistry } from "../src/main/mcp/toolRegistry";

async function main(): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), "hcb-cli-smoke-"));
  const runtimeFile = join(directory, "config", "mcp-runtime.json");
  const token = "hcb-smoke-token";
  const server = new LocalMcpServer({
    credentialAdapter: new StaticMcpCredentialAdapter(token, "smoke"),
    permissionProvider: {
      getMode: () => "confirm-writes"
    },
    toolRegistry: new McpToolRegistry(createMcpTestDomainServices())
  });

  try {
    const port = await server.start(0);
    writeMcpRuntimeFile(runtimeFile, port, new Date("2026-06-04T00:00:00.000Z"));

    await expectCommand(["doctor"], "HCB doctor:", runtimeFile, token);
    await expectCommand(["today"], "HCB today:", runtimeFile, token);
    await expectCommand(["search", "launch"], "HCB search:", runtimeFile, token);
    await expectCommand(["list", "task-lists"], "HCB task lists:", runtimeFile, token);
    await expectCommand(["list", "calendars"], "HCB calendars:", runtimeFile, token);
    await expectCommand(["list", "note-lists"], "HCB note lists:", runtimeFile, token);
    await expectCommand(["get", "task", "task-1"], "HCB task", runtimeFile, token);
    await expectCommand(["create", "task", "--title", "Smoke task"], "HCB create task: dry-run", runtimeFile, token);
    await expectCommand(["create", "event", "--title", "Smoke event", "--start-date", "2026-06-04T09:00:00.000Z"], "HCB create event: dry-run", runtimeFile, token);
    await expectCommand(["create", "task-list", "--title", "Smoke tasks"], "HCB create task-list: dry-run", runtimeFile, token);
    await expectCommand(["create", "note-list", "--title", "Smoke notes"], "HCB create note-list: dry-run", runtimeFile, token);
    const notePreview = await expectCommand(["create", "note", "--title", "Smoke note", "--body", "Smoke body"], "HCB create note: dry-run", runtimeFile, token);
    const confirmationId = confirmationIdFromOutput(notePreview);
    await expectCommand(["create", "note", "--title", "Smoke note", "--body", "Smoke body", "--apply", "--confirmation-id", confirmationId], "HCB create note: applied", runtimeFile, token);
    await expectCommand(["update", "task", "task-1", "--title", "Smoke task update"], "HCB update task: dry-run", runtimeFile, token);
    await expectCommand(["rename", "task-list", "list-inbox", "--title", "Smoke inbox"], "HCB rename task-list: dry-run", runtimeFile, token);
    await expectCommand(["complete", "task", "task-1"], "HCB complete task: dry-run", runtimeFile, token);
    await expectCommand(["move", "task", "task-1", "--task-list-id", "list-inbox"], "HCB move task: dry-run", runtimeFile, token);
    await expectCommand(["schedule", "task", "task-1", "--calendar-id", "cal-primary", "--start-date", "2026-06-04T09:00:00.000Z"], "HCB schedule task: dry-run", runtimeFile, token);
    const updatePreview = await expectCommand(["update", "note", "note-1", "--title", "Smoke updated note"], "HCB update note: dry-run", runtimeFile, token);
    const updateConfirmationId = confirmationIdFromOutput(updatePreview);
    await expectCommand(["update", "note", "note-1", "--title", "Smoke updated note", "--apply", "--confirmation-id", updateConfirmationId], "HCB update note: applied", runtimeFile, token);

    process.stdout.write("hcb cli smoke passed\n");
  } finally {
    await server.stop();
    rmSync(directory, { recursive: true, force: true });
  }
}

async function expectCommand(
  argv: string[],
  expectedOutput: string,
  runtimeFile: string,
  token: string
): Promise<string> {
  const stdout = outputBuffer();
  const stderr = outputBuffer();
  const exitCode = await runHcbCli(argv, {
    runtimeFilePaths: [runtimeFile],
    tokenProvider: async () => token,
    stdout,
    stderr
  });
  const command = argv.join(" ");

  if (exitCode !== 0) {
    throw new Error(`hcb ${command} exited ${exitCode}: ${stderr.text()}${stdout.text()}`);
  }

  if (!stdout.text().includes(expectedOutput)) {
    throw new Error(`hcb ${command} smoke output was unexpected: ${stdout.text()}`);
  }

  return stdout.text();
}

function confirmationIdFromOutput(output: string): string {
  const match = /^Confirmation id: (.+)$/m.exec(output);

  if (!match) {
    throw new Error(`confirmation id was missing: ${output}`);
  }

  return match[1].trim();
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

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
