import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HCB_MCP_RUNTIME_FILE_NAME } from "@shared/mcpRuntime";
import {
  LinuxSecretServiceStore,
  MemorySecretStore,
  type LinuxSafeStorageBackend
} from "../credentials/secretStore";
import {
  GOOGLE_CALENDAR_SCOPE,
  GOOGLE_TASKS_SCOPE,
  KeychainGoogleCredentialAdapter,
  sanitizeGoogleAccountConnectionStatus,
  type GoogleCalendarReadTransport,
  type GoogleCalendarWriteTransport,
  type GoogleTasksReadTransport,
  type GoogleTasksWriteTransport
} from "../google";
import { HcbVaultHostServer, readHcbVaultPackage } from "../hoster/vaultServer";
import { createServiceContainer, defaultSecretStoreForPlatform } from "./serviceContainer";

const fakeLinuxSafeStorageBackend: LinuxSafeStorageBackend = {
  decryptString: (encrypted) => encrypted.toString("utf8").replace(/^encrypted:/, ""),
  encryptString: (plainText) => Buffer.from(`encrypted:${plainText}`, "utf8"),
  getSelectedStorageBackend: () => "gnome_libsecret",
  isEncryptionAvailable: () => true,
  setUsePlainTextEncryption: () => undefined
};

describe("service container integration", () => {
  it("selects Linux Secret Service storage when Linux app paths and safeStorage are available", () => {
    const appPaths = {
      configDirectory: "/tmp/hcb-config",
      dataDirectory: "/tmp/hcb-data",
      cacheDirectory: "/tmp/hcb-cache",
      logsDirectory: "/tmp/hcb-logs",
      diagnosticsDirectory: "/tmp/hcb-diagnostics",
      tempDirectory: "/tmp/hcb-temp"
    };
    const store = defaultSecretStoreForPlatform({
      appPaths,
      linuxSafeStorageBackend: fakeLinuxSafeStorageBackend,
      platform: "linux"
    });

    expect(store).toBeInstanceOf(LinuxSecretServiceStore);
    expect(store.status()).toMatchObject({
      ok: true,
      state: "ready"
    });
  });

  it("writes MCP discovery metadata under the Linux config path without bearer tokens", async () => {
    const root = mkdtempSync(join(tmpdir(), "hcb-linux-mcp-runtime-"));
    const appPaths = {
      configDirectory: join(root, "config"),
      dataDirectory: join(root, "data"),
      cacheDirectory: join(root, "cache"),
      logsDirectory: join(root, "logs"),
      diagnosticsDirectory: join(root, "diagnostics"),
      tempDirectory: join(root, "tmp")
    };
    const secretStore = new MemorySecretStore();
    const services = createServiceContainer({
      appPaths,
      secretStore
    });
    const runtimePath = join(appPaths.configDirectory, HCB_MCP_RUNTIME_FILE_NAME);

    try {
      const status = await services.domain.mcp.setEnabled({ enabled: true, port: 0 });
      const parsed = JSON.parse(readFileSync(runtimePath, "utf8")) as Record<string, unknown>;
      const mode = statSync(runtimePath).mode & 0o777;
      const token = await secretStore.read({
        service: "Hot Cross Buns MCP",
        account: "loopback-bearer-token"
      });

      expect(status).toMatchObject({
        running: true,
        tokenState: "configured",
        url: "http://127.0.0.1"
      });
      expect(parsed).toMatchObject({
        running: true,
        url: "http://127.0.0.1",
        port: status.port
      });
      expect(runtimePath.startsWith(appPaths.configDirectory)).toBe(true);
      if (process.platform !== "win32") {
        expect(mode).toBe(0o600);
      }
      expect(JSON.stringify(parsed)).not.toMatch(/token|secret|bearer/i);
      expect(token).toEqual(expect.any(String));
    } finally {
      await services.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("starts the local hoster from persisted settings before deferred runtime", async () => {
    const appSupportDirectory = mkdtempSync(join(tmpdir(), "hcb-service-hoster-startup-"));
    const services = createServiceContainer({
      appSupportDirectory,
      secretStore: new MemorySecretStore()
    });

    try {
      services.localData.settingsRepository.update({
        localHostersEnabled: true,
        localHosterPort: 0
      });
      await services.startHosterRuntime();
      const status = await services.domain.hosters.status();

      expect(status).toMatchObject({
        enabled: true,
        running: true,
        health: "running",
        configuredPort: 0,
        url: "http://127.0.0.1"
      });
      expect(status.endpoint).toBe(`http://127.0.0.1:${status.port}/hcb/v1/signal`);
    } finally {
      await services.close();
      rmSync(appSupportDirectory, { recursive: true, force: true });
    }
  });

  it("pushes a saved HCB vault host credential during sync.runNow in hoster mode", async () => {
    const appSupportDirectory = mkdtempSync(join(tmpdir(), "hcb-service-vault-sync-"));
    const secretStore = new MemorySecretStore();
    const services = createServiceContainer({
      appSupportDirectory,
      secretStore
    });
    const remotePath = join(appSupportDirectory, "remote.hcbvault");
    const token = "service-vault-host-token";
    const passphrase = "service-vault-passphrase";
    const server = new HcbVaultHostServer({ vaultPath: remotePath, token });
    const started = await server.start({ port: 0 });
    const endpoint = `${started.protocol}://${started.host}:${started.port}/hcb/v1/vault`;

    try {
      await services.domain.settings.update({
        storageBackend: "hcb-hoster",
        hcbHosterEndpoint: endpoint
      });
      await services.domain.settings.saveHcbVaultRemoteCredentials({
        token,
        passphrase
      });

      const result = await services.domain.sync.runNow({ resources: ["tasks", "calendar"] });
      const mcpSync = await services.mcpTools.callTool(
        "hcb_sync_now",
        { resources: ["tasks"] },
        {
          permissionMode: "allow-writes",
          credentialRevision: "test-revision",
          clientKey: "test-client",
          now: new Date("2026-06-19T00:00:00.000Z")
        }
      );
      const hosted = readHcbVaultPackage(remotePath);

      expect(result).toMatchObject({
        accepted: true,
        dryRun: false,
        resources: ["hcb-vault"]
      });
      expect(mcpSync).toMatchObject({
        applied: true,
        item: {
          accepted: true,
          dryRun: false,
          resources: ["hcb-vault"]
        }
      });
      expect(hosted.manifest.kind).toBe("hot-cross-buns-vault");
    } finally {
      await server.stop();
      await services.close();
      rmSync(appSupportDirectory, { recursive: true, force: true });
    }
  });

  it("keeps sync status available after wrapping runNow for hoster mode", async () => {
    const appSupportDirectory = mkdtempSync(join(tmpdir(), "hcb-service-sync-wrapper-"));
    const services = createServiceContainer({
      appSupportDirectory,
      secretStore: new MemorySecretStore()
    });

    try {
      const status = await services.domain.sync.status();
      const unsubscribe = services.domain.sync.subscribeStatus?.(() => undefined);

      expect(status).toMatchObject({
        state: "idle",
        pendingMutationCount: 0
      });
      expect(unsubscribe).toEqual(expect.any(Function));
      unsubscribe?.();
    } finally {
      await services.close();
      rmSync(appSupportDirectory, { recursive: true, force: true });
    }
  });

  it("shares domain services between MCP tool handlers and planner IPC services", async () => {
    const appSupportDirectory = mkdtempSync(join(tmpdir(), "hcb-service-container-"));
    const services = createServiceContainer({
      appSupportDirectory
    });

    try {
      services.localData.syncRepository.writeTaskLists(
        "acct-1",
        [{ id: "inbox", title: "Inbox", updatedAt: "2026-05-22T00:00:00.000Z" }],
        "2026-05-22T00:00:00.000Z"
      );

      const created = await services.mcpTools.callTool(
        "hcb_create_note",
        {
          title: "MCP shared note",
          body: "Body stays inside the SQLite-backed domain service."
        },
        {
          permissionMode: "allow-writes",
          credentialRevision: "test-revision",
          clientKey: "test-client",
          now: new Date("2026-05-22T00:00:00.000Z")
        }
      );
      const search = await services.domain.planner.search({
        query: "MCP shared note",
        domains: ["notes"],
        limit: 10
      });

      expect(created).toMatchObject({
        applied: true,
        item: {
          kind: "note",
          title: "MCP shared note"
        }
      });
      expect(search.items).toContainEqual(
        expect.objectContaining({
          domain: "notes",
          title: "MCP shared note"
        })
      );
    } finally {
      await services.close();
      rmSync(appSupportDirectory, { recursive: true, force: true });
    }
  });

  it("wires runtime Google write transports by default", async () => {
    const appSupportDirectory = mkdtempSync(join(tmpdir(), "hcb-service-runtime-writes-"));
    const secretStore = new MemorySecretStore();
    const tasksRead: GoogleTasksReadTransport = {
      listTaskLists: vi.fn(async () => [
        {
          id: "inbox",
          title: "Inbox",
          updatedAt: "2026-05-22T00:00:00.000Z"
        }
      ]),
      listTasks: vi.fn(async () => ({
        tasks: [],
        serverDate: "2026-05-22T00:00:00.000Z"
      }))
    };
    const calendarRead: GoogleCalendarReadTransport = {
      listCalendarLists: vi.fn(async () => []),
      listEvents: vi.fn(async () => ({ events: [], nextSyncToken: null }))
    };
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);

      expect(init?.method).toBe("POST");
      expect(headers.get("Authorization")).toBe("Bearer access-token");

      return new Response(
        JSON.stringify({
          id: "remote-task-1",
          title: "Runtime write",
          status: "needsAction",
          updated: "2026-05-22T00:00:00.000Z"
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" }
        }
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const services = createServiceContainer({
      appSupportDirectory,
      enableRuntimeGoogle: true,
      secretStore,
      syncTasksTransport: tasksRead,
      syncCalendarTransport: calendarRead
    });

    try {
      await services.domain.google.saveOAuthClient({
        clientId: "desktop-client-id.apps.googleusercontent.com"
      });
      await new KeychainGoogleCredentialAdapter(secretStore).saveTokenSet("acct-1", {
        accessToken: "access-token",
        refreshToken: "refresh-token",
        scope: `${GOOGLE_TASKS_SCOPE} ${GOOGLE_CALENDAR_SCOPE}`,
        tokenType: "Bearer"
      });
      services.localData.syncRepository.upsertAccountStatus(
        sanitizeGoogleAccountConnectionStatus({
          accountId: "acct-1",
          googleAccountId: "acct-1",
          email: "planner@example.com",
          connectionState: "connected",
          grantedScopes: [GOOGLE_TASKS_SCOPE, GOOGLE_CALENDAR_SCOPE],
          lastAuthenticatedAt: "2026-05-22T00:00:00.000Z",
          updatedAt: "2026-05-22T00:00:00.000Z"
        })
      );
      services.localData.syncRepository.writeTaskLists(
        "acct-1",
        [{ id: "inbox", title: "Inbox", updatedAt: "2026-05-22T00:00:00.000Z" }],
        "2026-05-22T00:00:00.000Z"
      );

      const created = await services.domain.planner.createTask({
        title: "Runtime write",
        listId: "acct-1:task-list:inbox"
      });

      await services.domain.sync.runNow({ resources: ["tasks"] });

      expect(fetchMock).toHaveBeenCalled();
      expect(
        services.localData.connection.get<{ status: string }>(
          "SELECT status FROM google_pending_mutations WHERE resource_id = ?;",
          [created.id]
        )
      ).toEqual({ status: "applied" });
    } finally {
      vi.unstubAllGlobals();
      await services.close();
      rmSync(appSupportDirectory, { recursive: true, force: true });
    }
  });

  it("keeps runtime Google writes disabled when explicitly configured read-only", async () => {
    const appSupportDirectory = mkdtempSync(join(tmpdir(), "hcb-service-runtime-readonly-"));
    let createdTaskId: string | undefined;
    const tasksRead: GoogleTasksReadTransport = {
      listTaskLists: vi.fn(async () => [
        {
          id: "inbox",
          title: "Inbox",
          updatedAt: "2026-05-22T00:00:00.000Z"
        }
      ]),
      listTasks: vi.fn(async () => ({
        tasks: createdTaskId
          ? [
              {
                id: createdTaskId,
                taskListId: "inbox",
                title: "Queued but not pushed",
                notes: "",
                status: "needsAction" as const,
                dueAt: null,
                completedAt: null,
                deleted: false,
                hidden: false,
                updatedAt: "2026-05-22T00:00:00.000Z"
              }
            ]
          : [],
        serverDate: "2026-05-22T00:00:00.000Z"
      }))
    };
    const calendarRead: GoogleCalendarReadTransport = {
      listCalendarLists: vi.fn(async () => []),
      listEvents: vi.fn(async () => ({ events: [], nextSyncToken: null }))
    };
    const services = createServiceContainer({
      appSupportDirectory,
      enableRuntimeGoogle: true,
      enableRuntimeGoogleWrites: false,
      syncTasksTransport: tasksRead,
      syncCalendarTransport: calendarRead
    });

    try {
      services.localData.syncRepository.upsertAccountStatus(
        sanitizeGoogleAccountConnectionStatus({
          accountId: "acct-1",
          googleAccountId: "acct-1",
          email: "planner@example.com",
          connectionState: "connected",
          grantedScopes: [GOOGLE_TASKS_SCOPE, GOOGLE_CALENDAR_SCOPE],
          lastAuthenticatedAt: "2026-05-22T00:00:00.000Z",
          updatedAt: "2026-05-22T00:00:00.000Z"
        })
      );
      services.localData.syncRepository.writeTaskLists(
        "acct-1",
        [{ id: "inbox", title: "Inbox", updatedAt: "2026-05-22T00:00:00.000Z" }],
        "2026-05-22T00:00:00.000Z"
      );

      const created = await services.domain.planner.createTask({
        title: "Queued but not pushed",
        listId: "acct-1:task-list:inbox"
      });
      createdTaskId = created.id;

      await services.domain.sync.runNow({ resources: ["tasks"] });

      expect(
        services.localData.connection.get<{ status: string }>(
          "SELECT status FROM google_pending_mutations WHERE resource_id = ?;",
          [created.id]
        )
      ).toEqual({ status: "pending" });
    } finally {
      await services.close();
      rmSync(appSupportDirectory, { recursive: true, force: true });
    }
  });

  it("drains queued Google mutations from sync.runNow when write transports are configured", async () => {
    const appSupportDirectory = mkdtempSync(join(tmpdir(), "hcb-service-sync-worker-"));
    const tasks: GoogleTasksWriteTransport = {
      insertTaskList: vi.fn(async (title) => ({
        id: "remote-list",
        title,
        updatedAt: "2026-05-22T00:00:00.000Z"
      })),
      updateTaskList: vi.fn(async ({ taskListId, title }) => ({
        id: taskListId,
        title,
        updatedAt: "2026-05-22T00:00:00.000Z"
      })),
      deleteTaskList: vi.fn(async () => undefined),
      insertTask: vi.fn(async (taskListId, input) => ({
        id: "remote-task-from-container",
        taskListId,
        title: input.title,
        notes: input.notes ?? null,
        status: "needsAction" as const,
        dueAt: input.dueDate ? `${input.dueDate}T00:00:00.000Z` : null,
        deleted: false,
        hidden: false,
        updatedAt: "2026-05-22T00:00:00.000Z",
        etag: "remote-task-etag"
      })),
      updateTask: vi.fn(async (input) => ({
        id: input.taskId,
        taskListId: input.taskListId,
        title: input.title ?? "Updated task",
        status: input.status ?? "needsAction" as const,
        deleted: false,
        hidden: false,
        updatedAt: "2026-05-22T00:00:00.000Z"
      })),
      setTaskCompleted: vi.fn(async (request) => ({
        id: request.taskId,
        taskListId: request.taskListId,
        title: "Task",
        status: request.completed ? "completed" as const : "needsAction" as const,
        completedAt: request.completed ? "2026-05-22T00:00:00.000Z" : null,
        deleted: false,
        hidden: false,
        updatedAt: "2026-05-22T00:00:00.000Z"
      })),
      moveTask: vi.fn(async (input) => ({
        id: input.taskId,
        taskListId: input.taskListId,
        title: "Moved task",
        status: "needsAction" as const,
        deleted: false,
        hidden: false,
        updatedAt: "2026-05-22T00:00:00.000Z"
      })),
      deleteTask: vi.fn(async () => undefined)
    };
    const calendar: GoogleCalendarWriteTransport = {
      insertEvent: vi.fn(async () => {
        throw new Error("Calendar writes are not used in this test.");
      }),
      updateEvent: vi.fn(async () => {
        throw new Error("Calendar writes are not used in this test.");
      }),
      deleteEvent: vi.fn(async () => undefined)
    };
    const services = createServiceContainer({
      appSupportDirectory,
      syncTasksWriteTransport: tasks,
      syncCalendarWriteTransport: calendar
    });

    try {
      services.localData.syncRepository.upsertAccountStatus(
        sanitizeGoogleAccountConnectionStatus({
          accountId: "acct-1",
          googleAccountId: "acct-1",
          email: "planner@example.com",
          connectionState: "connected",
          grantedScopes: [GOOGLE_TASKS_SCOPE, GOOGLE_CALENDAR_SCOPE],
          lastAuthenticatedAt: "2026-05-22T00:00:00.000Z",
          updatedAt: "2026-05-22T00:00:00.000Z"
        })
      );
      services.localData.syncRepository.writeTaskLists(
        "acct-1",
        [{ id: "inbox", title: "Inbox", updatedAt: "2026-05-22T00:00:00.000Z" }],
        "2026-05-22T00:00:00.000Z"
      );

      const created = await services.domain.planner.createTask({
        title: "Container queued task",
        listId: "acct-1:task-list:inbox"
      });

      await services.domain.sync.runNow({ resources: ["tasks"] });

      expect(tasks.insertTask).toHaveBeenCalledWith(
        "inbox",
        expect.objectContaining({
          title: "Container queued task"
        })
      );
      expect(
        services.localData.connection.get<{ status: string }>(
          "SELECT status FROM google_pending_mutations WHERE resource_id = ?;",
          [created.id]
        )
      ).toEqual({ status: "applied" });
    } finally {
      await services.close();
      rmSync(appSupportDirectory, { recursive: true, force: true });
    }
  });
});
