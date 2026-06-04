import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import { MemoryMcpAuditRecorder } from "./audit";
import { StaticMcpCredentialAdapter } from "./credentials";
import {
  MCP_MAX_HTTP_BODY_BYTES,
  MCP_MAX_HTTP_HEADER_BYTES,
  type McpHttpResponse
} from "./http";
import { LocalMcpServer } from "./server";
import { createMcpTestDomainServices } from "./testDomainDoubles";
import { McpToolRegistry } from "./toolRegistry";
import type { McpPermissionMode } from "./types";

const testToken = "test-token";

describe("local MCP server contract", () => {
  it("rejects a missing bearer token", async () => {
    const { server } = fixture("read-only");

    const response = await post(server, rpc("tools/list"), {});

    expect(response.status).toBe(401);
    expect(response.body.toString("utf8")).not.toContain(testToken);
  });

  it("rejects an unauthorized bearer token", async () => {
    const { server } = fixture("read-only");

    const response = await post(server, rpc("tools/list"), {
      Authorization: "Bearer wrong-token"
    });

    expect(response.status).toBe(401);
    expect(response.body.toString("utf8")).not.toContain(testToken);
  });

  it("rejects malformed JSON before tool dispatch", async () => {
    const { server, audit } = fixture("read-only");

    const response = await post(server, "{", authHeaders());
    const body = jsonBody(response);

    expect(response.status).toBe(400);
    expect(body.error).toMatchObject({
      code: -32700,
      message: "Parse error"
    });
    expect(audit.events).toEqual([]);
  });

  it("initializes with agent command guidance", async () => {
    const { server } = fixture("read-only");

    const response = await post(server, rpc("initialize"), authHeaders());
    const body = jsonBody(response);

    expect(response.status).toBe(200);
    expect(body.result.instructions).toContain("hcb_doctor");
    expect(body.result.instructions).toContain("hcb_status");
  });

  it("rejects an oversized request body", async () => {
    const { server } = fixture("read-only");
    const request = rawHttpRequest({
      headers: authHeaders(),
      body: Buffer.alloc(MCP_MAX_HTTP_BODY_BYTES + 1, "a")
    });

    const response = await server.handleRawHttpRequest(request);

    expect(response.status).toBe(413);
  });

  it("rejects an oversized header block", async () => {
    const { server } = fixture("read-only");
    const request = rawHttpRequest({
      headers: {
        ...authHeaders(),
        "User-Agent": "a".repeat(MCP_MAX_HTTP_HEADER_BYTES)
      },
      body: rpc("tools/list")
    });

    const response = await server.handleRawHttpRequest(request);

    expect(response.status).toBe(413);
  });

  it("rejects an unexpected browser origin", async () => {
    const { server } = fixture("read-only");

    const response = await post(server, rpc("tools/list"), {
      ...authHeaders(),
      Origin: "https://example.com"
    });

    expect(response.status).toBe(403);
  });

  it("rejects browser origins even when they are local", async () => {
    const { server } = fixture("read-only");

    const response = await post(server, rpc("tools/list"), {
      ...authHeaders(),
      Origin: "http://127.0.0.1:3000"
    });

    expect(response.status).toBe(403);
  });

  it("executes a read tool in read-only mode", async () => {
    const { server } = fixture("read-only");

    const response = await post(
      server,
      rpc("tools/call", {
        name: "hcb_get_task",
        arguments: {
          id: "task-1"
        }
      }),
      authHeaders()
    );
    const structured = structuredContent(response);

    expect(response.status).toBe(200);
    expect(structured).toMatchObject({
      applied: false,
      dryRun: false,
      requiresConfirmation: false,
      item: {
        id: "task-1",
        kind: "task"
      }
    });
  });

  it("exposes and executes Git-like read tools", async () => {
    const { server } = fixture("read-only");
    const list = await post(server, rpc("tools/list"), authHeaders());
    const tools = jsonBody(list).result.tools as Array<{ name: string }>;

    expect(tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(["hcb_doctor", "hcb_status", "hcb_log", "hcb_diff", "hcb_show", "hcb_list_note_lists"])
    );

    const doctor = await post(
      server,
      rpc("tools/call", {
        name: "hcb_doctor",
        arguments: {}
      }),
      authHeaders()
    );

    expect(structuredContent(doctor)).toMatchObject({
      message: "Ran HCB doctor.",
      item: {
        kind: "doctor",
        status: "warning",
        findings: [
          {
            level: "warning",
            title: "Pending local mutations"
          }
        ],
        suggestedCommands: ["pnpm hcb -- diff"]
      }
    });

    const status = await post(
      server,
      rpc("tools/call", {
        name: "hcb_status",
        arguments: {}
      }),
      authHeaders()
    );

    expect(structuredContent(status)).toMatchObject({
      message: "Read HCB status.",
      item: {
        kind: "diagnosticsStatus",
        sync: {
          pendingMutationCount: 1
        }
      }
    });

    const diff = await post(
      server,
      rpc("tools/call", {
        name: "hcb_diff",
        arguments: {}
      }),
      authHeaders()
    );

    expect(structuredContent(diff)).toMatchObject({
      items: [
        {
          id: "mutation-1",
          kind: "mutation",
          status: "pending"
        }
      ]
    });

    const shown = await post(
      server,
      rpc("tools/call", {
        name: "hcb_show",
        arguments: {
          kind: "task",
          id: "task-1"
        }
      }),
      authHeaders()
    );

    expect(structuredContent(shown)).toMatchObject({
      item: {
        id: "task-1",
        kind: "task"
      }
    });

    const noteLists = await post(
      server,
      rpc("tools/call", {
        name: "hcb_list_note_lists",
        arguments: {}
      }),
      authHeaders()
    );

    expect(structuredContent(noteLists)).toMatchObject({
      message: "Read note lists.",
      items: [
        {
          id: "note-list:default",
          kind: "noteList",
          title: "Local notes",
          noteCount: 1
        }
      ]
    });
  });

  it("returns a confirmation id for a dry-run write in confirm-writes mode", async () => {
    const { server } = fixture("confirm-writes");

    const dryRun = await post(
      server,
      rpc("tools/call", {
        name: "hcb_create_note",
        arguments: {
          title: "Private launch note",
          body: "Do not write this literal to audit metadata.",
          dryRun: true
        }
      }),
      authHeaders()
    );
    const preview = structuredContent(dryRun);

    expect(preview).toMatchObject({
      applied: false,
      dryRun: true,
      requiresConfirmation: true
    });
    expect(preview.confirmationId).toEqual(expect.any(String));

    const apply = await post(
      server,
      rpc("tools/call", {
        name: "hcb_create_note",
        arguments: {
          title: "Private launch note",
          body: "Do not write this literal to audit metadata.",
          confirmationId: preview.confirmationId
        }
      }),
      authHeaders()
    );

    expect(structuredContent(apply)).toMatchObject({
      applied: true,
      dryRun: false,
      requiresConfirmation: false
    });
  });

  it("blocks a direct write in confirm-writes mode", async () => {
    const { server } = fixture("confirm-writes");

    const response = await post(
      server,
      rpc("tools/call", {
        name: "hcb_create_task",
        arguments: {
          title: "Direct write should not apply"
        }
      }),
      authHeaders()
    );
    const body = jsonBody(response);

    expect(response.status).toBe(200);
    expect(body.error).toMatchObject({
      code: -32001,
      message: "Dry-run confirmation is required before this write can apply."
    });
  });

  it("requires confirmation for destructive writes even in allow-writes mode", async () => {
    const { server } = fixture("allow-writes");

    const direct = await post(
      server,
      rpc("tools/call", {
        name: "hcb_delete_task",
        arguments: {
          id: "task-1"
        }
      }),
      authHeaders()
    );

    expect(jsonBody(direct).error).toMatchObject({
      code: -32001
    });

    const dryRun = await post(
      server,
      rpc("tools/call", {
        name: "hcb_delete_task",
        arguments: {
          id: "task-1",
          dryRun: true
        }
      }),
      authHeaders()
    );
    const preview = structuredContent(dryRun);

    expect(preview).toMatchObject({
      dryRun: true,
      requiresConfirmation: true
    });
    expect(preview.confirmationId).toEqual(expect.any(String));
  });

  it("redacts audit metadata by recording keys and outcomes without argument values", async () => {
    const { server, audit } = fixture("confirm-writes");

    await post(
      server,
      rpc("tools/call", {
        name: "hcb_create_note",
        arguments: {
          title: "Private launch note",
          body: "Do not write this literal to audit metadata.",
          refreshToken: "fake-refresh-token",
          dryRun: true
        }
      }),
      {
        ...authHeaders(),
        "User-Agent": "MCPTest/1.0"
      }
    );

    expect(audit.events).toHaveLength(1);
    expect(audit.events[0]).toMatchObject({
      method: "tools/call",
      toolName: "hcb_create_note",
      outcome: "dry_run",
      isWrite: true,
      metadata: {
        argumentKeys: "[redacted],body,dryRun,title",
        dryRunRequested: "true",
        confirmationIssued: "true"
      }
    });
    expect(JSON.stringify(audit.events)).not.toContain("Private launch note");
    expect(JSON.stringify(audit.events)).not.toContain("Do not write this literal");
    expect(JSON.stringify(audit.events)).not.toContain(testToken);
    expect(JSON.stringify(audit.events)).not.toContain("fake-refresh-token");
  });

  it("rate limits per local client key", async () => {
    const { server } = fixture("read-only", {
      maxRequests: 1,
      windowMs: 60_000
    });
    const request = rawHttpRequest({
      headers: authHeaders(),
      body: rpc("tools/list")
    });

    const first = await server.handleRawHttpRequest(request, { clientKey: "client-a" });
    const second = await server.handleRawHttpRequest(request, { clientKey: "client-a" });
    const otherClient = await server.handleRawHttpRequest(request, { clientKey: "client-b" });

    expect(first.status).toBe(200);
    expect(second.status).toBe(429);
    expect(otherClient.status).toBe(200);
  });

});

function fixture(
  mode: McpPermissionMode,
  rateLimit = {
    maxRequests: 100,
    windowMs: 60_000
  }
) {
  const audit = new MemoryMcpAuditRecorder();
  const domain = createMcpTestDomainServices();
  const server = new LocalMcpServer({
    credentialAdapter: new StaticMcpCredentialAdapter(testToken, "test-revision"),
    permissionProvider: {
      getMode: () => mode
    },
    toolRegistry: new McpToolRegistry(domain),
    auditRecorder: audit,
    rateLimit
  });

  return {
    server,
    audit,
    domain
  };
}

function authHeaders() {
  return {
    Authorization: `Bearer ${testToken}`
  };
}

async function post(
  server: LocalMcpServer,
  body: string | Buffer,
  headers: Record<string, string>
) {
  return server.handleRawHttpRequest(
    rawHttpRequest({
      headers,
      body
    })
  );
}

function rpc(method: string, params: Record<string, unknown> = {}, id: string | number = "id") {
  return JSON.stringify({
    jsonrpc: "2.0",
    id,
    method,
    params
  });
}

function rawHttpRequest(input: {
  method?: string;
  path?: string;
  headers?: Record<string, string>;
  body?: string | Buffer;
}) {
  const body = Buffer.isBuffer(input.body)
    ? input.body
    : Buffer.from(input.body ?? "", "utf8");
  const lines = [
    `${input.method ?? "POST"} ${input.path ?? "/mcp"} HTTP/1.1`,
    "Host: 127.0.0.1",
    `Content-Length: ${body.byteLength}`
  ];

  for (const [key, value] of Object.entries(input.headers ?? {})) {
    lines.push(`${key}: ${value}`);
  }

  lines.push("", "");

  return Buffer.concat([Buffer.from(lines.join("\r\n"), "utf8"), body]);
}

function jsonBody(response: McpHttpResponse) {
  return JSON.parse(response.body.toString("utf8"));
}

function structuredContent(response: McpHttpResponse) {
  const body = jsonBody(response);
  return body.result.structuredContent;
}
