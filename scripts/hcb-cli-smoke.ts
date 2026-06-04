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
      getMode: () => "read-only"
    },
    toolRegistry: new McpToolRegistry(createMcpTestDomainServices())
  });

  try {
    const port = await server.start(0);
    writeMcpRuntimeFile(runtimeFile, port, new Date("2026-06-04T00:00:00.000Z"));

    const stdout = outputBuffer();
    const stderr = outputBuffer();
    const exitCode = await runHcbCli(["doctor"], {
      runtimeFilePaths: [runtimeFile],
      tokenProvider: async () => token,
      stdout,
      stderr
    });

    if (exitCode !== 0) {
      throw new Error(`hcb doctor exited ${exitCode}: ${stderr.text()}${stdout.text()}`);
    }

    if (!stdout.text().includes("HCB doctor:")) {
      throw new Error(`hcb doctor smoke output was unexpected: ${stdout.text()}`);
    }

    process.stdout.write("hcb cli smoke passed\n");
  } finally {
    await server.stop();
    rmSync(directory, { recursive: true, force: true });
  }
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
