import { Buffer } from "node:buffer";
import { createServer } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { MemorySecretStore } from "../credentials/secretStore";
import { runLocalDataMigrations } from "../data/migrations";
import { LocalHosterRepository } from "../data/localRepositories";
import { createTemporarySqliteConnection, type TemporarySqliteConnection } from "../data/sqliteConnection";
import { StaticMcpCredentialAdapter } from "../mcp/credentials";
import type { JsonObject } from "../mcp/types";
import { encryptSignalEnvelope, type LocalHosterSecret } from "./crypto";
import { LocalHosterServer, LocalHosterServerController, type LocalHosterSignalDispatchRequest } from "./server";

const token = "hoster-token";
let temp: TemporarySqliteConnection | undefined;

afterEach(() => {
  temp?.cleanup();
  temp = undefined;
});

describe("local hoster server", () => {
  it("rejects missing tokens, bad origins, non-local remotes, and malformed JSON", async () => {
    const server = testServer();

    expect((await post(server, "/hcb/v1/info", "{}", {})).status).toBe(401);
    expect((await post(server, "/hcb/v1/info", "{}", {
      Authorization: `Bearer ${token}`,
      Origin: "https://example.com"
    })).status).toBe(403);
    expect((await server.handleRawHttpRequest(request("/hcb/v1/info", "{}", {
      Authorization: `Bearer ${token}`
    }), "10.0.0.5")).status).toBe(403);
    expect((await post(server, "/hcb/v1/signal", "{", {
      Authorization: `Bearer ${token}`
    })).status).toBe(400);
  });

  it("requires encrypted envelopes for private signal payloads", async () => {
    const { repository, server } = testFixture();
    const created = await repository.create({ name: "Private" }, "http://127.0.0.1:0/hcb/v1/signal");
    const response = await post(server, "/hcb/v1/signal", JSON.stringify({
      profileId: created.id,
      private: true,
      payload: signalPayload("request-private", "hcb_status")
    }), {
      Authorization: `Bearer ${token}`
    });

    expect(response.status).toBe(400);
    expect(response.body.toString("utf8")).toContain("require encryption");
  });

  it("dispatches encrypted signal payloads through the MCP path", async () => {
    const calls: LocalHosterSignalDispatchRequest[] = [];
    const { repository, secretStore, server } = testFixture((request) => {
      calls.push(request);
      return { kind: "mcpResult", message: "ok" };
    });
    const created = await repository.create({
      name: "Terminal",
      permissionMode: "read-only"
    }, "http://127.0.0.1:0/hcb/v1/signal");
    const secret = JSON.parse(await secretStore.read({
      service: "Hot Cross Buns 2 Local Hosters",
      account: created.id
    }) ?? "{}") as LocalHosterSecret;
    const payload = signalPayload("request-encrypted", "hcb_status", { limit: 1 });
    const envelope = encryptSignalEnvelope(payload, secret.publicKeyDerBase64);
    const response = await post(server, "/hcb/v1/signal", JSON.stringify({
      profileId: created.id,
      envelope
    }), {
      Authorization: `Bearer ${token}`
    });
    const body = JSON.parse(response.body.toString("utf8")) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body.result).toMatchObject({ kind: "mcpResult", message: "ok" });
    expect(calls).toEqual([
      {
        profileId: created.id,
        permissionMode: "read-only",
        payload
      }
    ]);
  });

  it("rejects malformed, stale, and replayed signal payloads", async () => {
    const { repository, server } = testFixture(() => ({ kind: "ok" }));
    const created = await repository.create({ name: "Replay" }, "http://127.0.0.1:0/hcb/v1/signal");

    expect((await post(server, "/hcb/v1/signal", JSON.stringify({
      profileId: created.id,
      payload: { toolName: "hcb_status", arguments: {} }
    }), authHeaders())).status).toBe(400);
    expect((await post(server, "/hcb/v1/signal", JSON.stringify({
      profileId: created.id,
      payload: signalPayload("request-stale", "hcb_status", {}, "2000-01-01T00:00:00.000Z")
    }), authHeaders())).status).toBe(409);

    const body = JSON.stringify({
      profileId: created.id,
      payload: signalPayload("request-replay", "hcb_status")
    });
    expect((await post(server, "/hcb/v1/signal", body, authHeaders())).status).toBe(200);
    expect((await post(server, "/hcb/v1/signal", body, authHeaders())).status).toBe(409);
  });

  it("enforces hoster capabilities and denies admin tools", async () => {
    const { repository, server } = testFixture(() => ({ kind: "ok" }));
    const noInfo = await repository.create({
      name: "No info",
      capabilities: ["signal.send", "planner.read"]
    }, "http://127.0.0.1:0/hcb/v1/signal");
    const noSignal = await repository.create({
      name: "No signal",
      capabilities: ["host.info", "planner.read"]
    }, "http://127.0.0.1:0/hcb/v1/signal");
    const readOnly = await repository.create({
      name: "Read only",
      capabilities: ["host.info", "signal.send", "planner.read"]
    }, "http://127.0.0.1:0/hcb/v1/signal");
    const full = await repository.create({
      name: "Full",
      capabilities: ["host.info", "signal.send", "planner.read", "planner.write"]
    }, "http://127.0.0.1:0/hcb/v1/signal");
    const info = await post(server, "/hcb/v1/info", JSON.stringify({ profileId: full.id }), authHeaders());
    const infoBody = JSON.parse(info.body.toString("utf8")) as Record<string, unknown>;

    expect((await post(server, "/hcb/v1/info", JSON.stringify({ profileId: noInfo.id }), authHeaders())).status).toBe(403);
    expect(infoBody.protocol).toMatchObject({
      kind: "localHosterProtocolCompatibility",
      hcbhostFormatVersions: [1],
      routes: ["/hcb/v1/info", "/hcb/v1/signal"]
    });
    expect((await post(server, "/hcb/v1/signal", JSON.stringify({
      profileId: noSignal.id,
      payload: signalPayload("request-no-signal", "hcb_status")
    }), authHeaders())).status).toBe(403);
    expect((await post(server, "/hcb/v1/signal", JSON.stringify({
      profileId: readOnly.id,
      payload: signalPayload("request-no-write", "hcb_create_task")
    }), authHeaders())).status).toBe(403);
    expect((await post(server, "/hcb/v1/signal", JSON.stringify({
      profileId: full.id,
      payload: signalPayload("request-admin", "hcb_hoster_status")
    }), authHeaders())).status).toBe(403);
  });

  it("reports lifecycle health and rebinding errors", async () => {
    const { repository } = testFixture();
    const controller = new LocalHosterServerController({
      credentialAdapter: new StaticMcpCredentialAdapter(token),
      repository
    });
    const blocker = createServer();

    try {
      await controller.applySettings({ localHostersEnabled: true, localHosterPort: 0 });
      const started = controller.status({ localHostersEnabled: true, localHosterPort: 0 });
      expect(started).toMatchObject({
        enabled: true,
        running: true,
        health: "running",
        configuredPort: 0,
        url: "http://127.0.0.1"
      });
      expect(started.endpoint).toBe(`http://127.0.0.1:${started.port}/hcb/v1/signal`);

      const nextPort = await availablePort();
      await controller.applySettings({ localHostersEnabled: true, localHosterPort: nextPort });
      expect(controller.status({ localHostersEnabled: true, localHosterPort: nextPort })).toMatchObject({
        running: true,
        port: nextPort,
        configuredPort: nextPort
      });

      await controller.stop();
      const blockedPort = await listen(blocker, 0);
      await controller.applySettings({ localHostersEnabled: true, localHosterPort: blockedPort });
      expect(controller.status({ localHostersEnabled: true, localHosterPort: blockedPort })).toMatchObject({
        running: false,
        health: "error",
        configuredPort: blockedPort,
        lastErrorCode: "EADDRINUSE",
        lastError: `Local hoster port ${blockedPort} is already in use. Choose another port or set localHosterPort to 0.`
      });
    } finally {
      blocker.close();
      await controller.dispose();
    }
  });
});

function testServer(): LocalHosterServer {
  return testFixture().server;
}

function testFixture(dispatchSignal?: (request: LocalHosterSignalDispatchRequest) => JsonObject) {
  temp = createTemporarySqliteConnection("hcbhost-server-");
  runLocalDataMigrations(temp.connection);
  const secretStore = new MemorySecretStore();
  const repository = new LocalHosterRepository(temp.connection, secretStore);
  const server = new LocalHosterServer({
    credentialAdapter: new StaticMcpCredentialAdapter(token),
    repository,
    ...(dispatchSignal === undefined ? {} : { dispatchSignal })
  });

  return { repository, secretStore, server };
}

function post(
  server: LocalHosterServer,
  path: string,
  body: string,
  headers: Record<string, string>
) {
  return server.handleRawHttpRequest(request(path, body, headers));
}

function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

function signalPayload(
  requestId: string,
  toolName: string,
  args: Record<string, unknown> = {},
  createdAt = new Date().toISOString()
) {
  return {
    formatVersion: 1,
    requestId,
    createdAt,
    toolName,
    arguments: args
  };
}

function request(path: string, body: string, headers: Record<string, string>): Buffer {
  const bodyBuffer = Buffer.from(body, "utf8");
  const lines = [
    `POST ${path} HTTP/1.1`,
    "Host: 127.0.0.1",
    `Content-Length: ${bodyBuffer.byteLength}`,
    ...Object.entries(headers).map(([key, value]) => `${key}: ${value}`),
    "",
    ""
  ];

  return Buffer.concat([Buffer.from(lines.join("\r\n"), "utf8"), bodyBuffer]);
}

async function availablePort(): Promise<number> {
  const server = createServer();
  const port = await listen(server, 0);
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  return port;
}

async function listen(server: ReturnType<typeof createServer>, port: number): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.once("listening", resolve);
    server.listen({ host: "127.0.0.1", port });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("server did not bind tcp");
  }
  return address.port;
}
