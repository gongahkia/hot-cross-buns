import { MemorySecretStore } from "../src/main/credentials/secretStore";
import { runLocalDataMigrations } from "../src/main/data/migrations";
import { LocalHosterRepository } from "../src/main/data/localRepositories";
import { createTemporarySqliteConnection } from "../src/main/data/sqliteConnection";
import { encryptSignalEnvelope, type LocalHosterSecret } from "../src/main/hoster/crypto";
import { LocalHosterServer } from "../src/main/hoster/server";
import { StaticMcpCredentialAdapter } from "../src/main/mcp/credentials";
import { createMcpTestDomainServices } from "../src/main/mcp/testDomainDoubles";
import { McpToolRegistry } from "../src/main/mcp/toolRegistry";
import type { JsonObject } from "../src/main/mcp/types";

const token = "hcb-hoster-e2e-token";
const secretService = "Hot Cross Buns Local Hosters";

async function main(): Promise<void> {
  const temp = createTemporarySqliteConnection("hcb-hoster-e2e-");
  const secretStore = new MemorySecretStore();
  const repository = new LocalHosterRepository(temp.connection, secretStore);
  const registry = new McpToolRegistry(createMcpTestDomainServices());
  const server = new LocalHosterServer({
    credentialAdapter: new StaticMcpCredentialAdapter(token, "hoster-e2e"),
    repository,
    dispatchSignal: async ({ profileId, permissionMode, payload }) =>
      registry.callTool(payload.toolName, payload.arguments, {
        permissionMode,
        credentialRevision: "hoster-e2e",
        clientKey: `hoster:${profileId}`,
        now: new Date()
      }) as unknown as JsonObject
  });

  try {
    runLocalDataMigrations(temp.connection);
    const port = await server.start(0);
    const endpoint = `http://127.0.0.1:${port}/hcb/v1/signal`;
    const full = await repository.create({
      name: "E2E full",
      capabilities: ["host.info", "signal.send", "planner.read", "planner.write"],
      permissionMode: "confirm-writes"
    }, endpoint);
    const readOnly = await repository.create({
      name: "E2E read only",
      capabilities: ["host.info", "signal.send", "planner.read"],
      permissionMode: "confirm-writes"
    }, endpoint);

    await expectInfo(port, full.id);
    await expectEncryptedSignal(port, repository, secretStore, full.id, "request-read", "hcb_status", {}, 200, "diagnosticsStatus");
    await expectEncryptedSignal(port, repository, secretStore, full.id, "request-write", "hcb_create_task", {
      title: "E2E smoke task",
      dryRun: true
    }, 200, "confirmationId");
    await expectEncryptedSignal(port, repository, secretStore, readOnly.id, "request-denied-write", "hcb_create_task", {
      title: "Denied task",
      dryRun: true
    }, 403, "planner.write");
    await expectReplay(port, repository, secretStore, full.id);

    process.stdout.write("hcb hoster e2e smoke passed\n");
  } finally {
    await server.stop();
    temp.cleanup();
  }
}

async function expectInfo(port: number, profileId: string): Promise<void> {
  const response = await fetch(`http://127.0.0.1:${port}/hcb/v1/info`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ profileId })
  });
  const text = await response.text();
  if (!response.ok || !text.includes(profileId)) {
    throw new Error(`hoster info failed: ${response.status} ${text}`);
  }
}

async function expectEncryptedSignal(
  port: number,
  repository: LocalHosterRepository,
  secretStore: MemorySecretStore,
  profileId: string,
  requestId: string,
  toolName: string,
  args: Record<string, unknown>,
  expectedStatus: number,
  expectedText: string
): Promise<string> {
  const secret = await readSecret(secretStore, profileId);
  const envelope = encryptSignalEnvelope(signalPayload(requestId, toolName, args), secret.publicKeyDerBase64);
  const response = await fetch(`http://127.0.0.1:${port}/hcb/v1/signal`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      profileId,
      private: true,
      envelope
    })
  });
  const text = await response.text();
  if (response.status !== expectedStatus || !text.includes(expectedText)) {
    throw new Error(`hoster signal ${toolName} failed: ${response.status} ${text}`);
  }

  return text;
}

async function expectReplay(
  port: number,
  repository: LocalHosterRepository,
  secretStore: MemorySecretStore,
  profileId: string
): Promise<void> {
  const requestId = "request-replay";
  await expectEncryptedSignal(port, repository, secretStore, profileId, requestId, "hcb_status", {}, 200, "diagnosticsStatus");
  await expectEncryptedSignal(port, repository, secretStore, profileId, requestId, "hcb_status", {}, 409, "already processed");
}

async function readSecret(secretStore: MemorySecretStore, profileId: string): Promise<LocalHosterSecret> {
  const value = await secretStore.read({
    service: secretService,
    account: profileId
  });
  if (!value) {
    throw new Error(`secret missing for ${profileId}`);
  }

  return JSON.parse(value) as LocalHosterSecret;
}

function signalPayload(requestId: string, toolName: string, args: Record<string, unknown>) {
  return {
    formatVersion: 1,
    requestId,
    createdAt: new Date().toISOString(),
    toolName,
    arguments: args
  };
}

function authHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json"
  };
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
