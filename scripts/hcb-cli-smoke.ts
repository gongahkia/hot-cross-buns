import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runHcbCli } from "../src/cli/hcb";
import { MemorySecretStore } from "../src/main/credentials/secretStore";
import { runLocalDataMigrations } from "../src/main/data/migrations";
import { LocalHosterRepository } from "../src/main/data/localRepositories";
import { createTemporarySqliteConnection } from "../src/main/data/sqliteConnection";
import { HcbVaultHostServer } from "../src/main/hoster/vaultServer";
import { createSqliteHosterDomainService } from "../src/main/services/sqliteHosterDomainService";
import { StaticMcpCredentialAdapter } from "../src/main/mcp/credentials";
import { writeMcpRuntimeFile } from "../src/main/mcp/runtimeFile";
import { LocalMcpServer } from "../src/main/mcp/server";
import { createMcpTestDomainServices } from "../src/main/mcp/testDomainDoubles";
import { McpToolRegistry } from "../src/main/mcp/toolRegistry";

async function main(): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), "hcb-cli-smoke-"));
  const runtimeFile = join(directory, "config", "mcp-runtime.json");
  const token = "hcb-smoke-token";
  const connection = createTemporarySqliteConnection("hcb-cli-smoke-hoster-");
  runLocalDataMigrations(connection.connection);
  const hosterRepository = new LocalHosterRepository(connection.connection, new MemorySecretStore());
  const hosters = createSqliteHosterDomainService({
    repository: hosterRepository,
    statusBase: () => ({
      enabled: true,
      running: true,
      port: 4778,
      url: "http://127.0.0.1"
    }),
    endpoint: () => "http://127.0.0.1:4778/hcb/v1/signal"
  });
  const registry = new McpToolRegistry(createMcpTestDomainServices());
  registry.setAdminServices({
    settings: {
      get: () => ({}) as never,
      update: (request) => ({ kind: "settings", ...request }) as never,
      exportHcbVault: (request) => ({ kind: "hcbVaultExport", ...request }) as never,
      importHcbVault: (request) => ({ kind: "hcbVaultImport", ...request }) as never
    },
    google: {
      status: () => ({}) as never,
      saveOAuthClient: (request) => ({ oauthClientConfigured: true, ...request }) as never,
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
      setEnabled: (request) => ({ enabled: request.enabled }) as never
    },
    hosters
  });
  const server = new LocalMcpServer({
    credentialAdapter: new StaticMcpCredentialAdapter(token, "smoke"),
    permissionProvider: {
      getMode: () => "confirm-writes"
    },
    toolRegistry: registry
  });
  let vaultHost: HcbVaultHostServer | undefined;

  try {
    const port = await server.start(0);
    vaultHost = new HcbVaultHostServer({
      vaultPath: join(directory, "hosted.hcbvault"),
      token: "hcb-vault-host-token"
    });
    const vaultHostStarted = await vaultHost.start({ port: 0 });
    const vaultHostEndpoint = `http://127.0.0.1:${vaultHostStarted.port}/hcb/v1/vault`;
    writeMcpRuntimeFile(runtimeFile, port, new Date("2026-06-04T00:00:00.000Z"));

    await expectCommand(["doctor"], "HCB doctor:", runtimeFile, token);
    await expectCommand(["today"], "HCB today:", runtimeFile, token);
    await expectCommand(["search", "launch"], "HCB search:", runtimeFile, token);
    await expectCommand(["list", "task-lists"], "HCB task lists:", runtimeFile, token);
    await expectCommand(["list", "calendars"], "HCB calendars:", runtimeFile, token);
    await expectCommand(["list", "note-lists"], "HCB note lists:", runtimeFile, token);
    await expectCommand(["get", "task", "task-1"], "HCB task", runtimeFile, token);
    await expectCommand(["undo-status"], "HCB undo status", runtimeFile, token);
    await expectCommand(["pending-mutations"], "mutation-1", runtimeFile, token);
    await expectCommand(["backend", "status"], "HCB backend", runtimeFile, token);
    const backendPreview = await expectCommand(["backend", "set", "hcb-local"], "HCB backend hcb-local: dry-run", runtimeFile, token);
    const backendConfirmationId = confirmationIdFromOutput(backendPreview);
    await expectCommand(["backend", "set", "hcb-local", "--apply", "--confirmation-id", backendConfirmationId], "HCB backend hcb-local: applied", runtimeFile, token);
    const vaultEnv = { HCB_VAULT_PASSPHRASE: "smoke vault passphrase" };
    await expectCommand(["vault", "export", "--out", join(directory, "smoke.hcbvault"), "--passphrase-env", "HCB_VAULT_PASSPHRASE"], "HCB vault export: dry-run", runtimeFile, token, vaultEnv);
    await expectCommand(["vault", "import", join(directory, "smoke.hcbvault"), "--passphrase-env", "HCB_VAULT_PASSPHRASE"], "HCB vault import: dry-run", runtimeFile, token, vaultEnv);
    const vaultHostEnv = {
      HCB_VAULT_PASSPHRASE: "smoke vault passphrase",
      HCB_VAULT_HOST_TOKEN: "hcb-vault-host-token"
    };
    await expectCommand(["vault", "remote-status", "--endpoint", vaultHostEndpoint, "--token-env", "HCB_VAULT_HOST_TOKEN"], "HCB vault host", runtimeFile, token, vaultHostEnv);
    await expectCommand(["vault", "push", "--endpoint", vaultHostEndpoint, "--token-env", "HCB_VAULT_HOST_TOKEN", "--passphrase-env", "HCB_VAULT_PASSPHRASE"], "HCB vault push: dry-run", runtimeFile, token, vaultHostEnv);
    await expectCommand(["sync-now", "--resources", "tasks"], "HCB sync-now: dry-run", runtimeFile, token);
    await expectCommand(["retry-mutation", "mutation-1"], "HCB retry-mutation: dry-run", runtimeFile, token);
    await expectCommand(["cancel-mutation", "mutation-1"], "HCB cancel-mutation: dry-run", runtimeFile, token);
    await expectMcpMethod(port, token, "resources/read", { uri: "hcb://status" }, "diagnosticsStatus");
    await expectMcpMethod(port, token, "prompts/get", { name: "debug-sync" }, "Debug local HCB2 sync health.");
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
    await expectCommand(["delete", "task", "task-1"], "HCB delete task: dry-run", runtimeFile, token);
    await expectCommand(["delete", "task-list", "list-inbox"], "HCB delete task-list: dry-run", runtimeFile, token);
    await expectCommand(["delete", "note-list", "list-inbox"], "HCB delete note-list: dry-run", runtimeFile, token);
    await expectCommand(["undo"], "HCB undo: dry-run", runtimeFile, token);
    await expectCommand(["redo"], "HCB redo: dry-run", runtimeFile, token);
    const updatePreview = await expectCommand(["update", "note", "note-1", "--title", "Smoke updated note"], "HCB update note: dry-run", runtimeFile, token);
    const updateConfirmationId = confirmationIdFromOutput(updatePreview);
    await expectCommand(["update", "note", "note-1", "--title", "Smoke updated note", "--apply", "--confirmation-id", updateConfirmationId], "HCB update note: applied", runtimeFile, token);
    await expectCommand(["hoster", "status"], "HCB local hosters", runtimeFile, token);
    const hosterPreview = await expectCommand(["hoster", "create", "--name", "Smoke hoster"], "HCB hoster create: dry-run", runtimeFile, token);
    const hosterConfirmationId = confirmationIdFromOutput(hosterPreview);
    const hosterCreated = await expectCommand(["hoster", "create", "--name", "Smoke hoster", "--apply", "--confirmation-id", hosterConfirmationId], "HCB hoster create: applied", runtimeFile, token);
    const hosterId = hosterIdFromOutput(hosterCreated);
    await expectCommand(["hoster", "test", hosterId, "--private"], "signal encryption", runtimeFile, token);
    const hosterExportPath = join(directory, "smoke.hcbhost");
    const passphraseEnv = { HCB_HOSTER_PASSPHRASE: "smoke portable passphrase" };
    const exportPreview = await expectCommand(["hoster", "export", hosterId, "--out", hosterExportPath, "--passphrase-env", "HCB_HOSTER_PASSPHRASE"], "HCB hoster export: dry-run", runtimeFile, token, passphraseEnv);
    const exportConfirmationId = confirmationIdFromOutput(exportPreview);
    await expectCommand(["hoster", "export", hosterId, "--out", hosterExportPath, "--passphrase-env", "HCB_HOSTER_PASSPHRASE", "--apply", "--confirmation-id", exportConfirmationId], "HCB hoster export: applied", runtimeFile, token, passphraseEnv);
    await hosterRepository.remove({ id: hosterId });
    const importPreview = await expectCommand(["hoster", "import", hosterExportPath, "--passphrase-env", "HCB_HOSTER_PASSPHRASE"], "HCB hoster import: dry-run", runtimeFile, token, passphraseEnv);
    const importConfirmationId = confirmationIdFromOutput(importPreview);
    await expectCommand(["hoster", "import", hosterExportPath, "--passphrase-env", "HCB_HOSTER_PASSPHRASE", "--apply", "--confirmation-id", importConfirmationId], "HCB hoster import: applied", runtimeFile, token, passphraseEnv);

    process.stdout.write("hcb cli smoke passed\n");
  } finally {
    await vaultHost?.stop();
    await server.stop();
    connection.cleanup();
    rmSync(directory, { recursive: true, force: true });
  }
}

async function expectCommand(
  argv: string[],
  expectedOutput: string,
  runtimeFile: string,
  token: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<string> {
  const stdout = outputBuffer();
  const stderr = outputBuffer();
  const exitCode = await runHcbCli(argv, {
    env,
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

async function expectMcpMethod(
  port: number,
  token: string,
  method: string,
  params: Record<string, unknown>,
  expectedText: string
): Promise<void> {
  const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: `smoke-${method}`,
      method,
      params
    })
  });
  const text = await response.text();

  if (!response.ok || !text.includes(expectedText)) {
    throw new Error(`mcp ${method} smoke output was unexpected: ${response.status} ${text}`);
  }
}

function confirmationIdFromOutput(output: string): string {
  const match = /^Confirmation id: (.+)$/m.exec(output);

  if (!match) {
    throw new Error(`confirmation id was missing: ${output}`);
  }

  return match[1].trim();
}

function hosterIdFromOutput(output: string): string {
  const match = /\bid=(hoster:[^\s]+)/.exec(output);

  if (!match) {
    throw new Error(`hoster id was missing: ${output}`);
  }

  return match[1];
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
