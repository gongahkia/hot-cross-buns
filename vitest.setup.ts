import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";
import type { HcbApi } from "./src/shared/ipc/preloadApi";
import { ok } from "./src/shared/ipc/result";

const now = new Date("2026-05-22T00:00:00.000Z").toISOString();

const hcbApi: HcbApi = {
  tasks: {
    list: vi.fn(async (request = {}) =>
      ok({
        items: [],
        page: {
          limit: request.limit ?? 50
        }
      })
    ),
    get: vi.fn(async (request) =>
      ok({
        id: request.id,
        listId: "test-list",
        title: "Test task",
        status: "active" as const,
        updatedAt: now
      })
    )
  },
  calendar: {
    listEvents: vi.fn(async (request) =>
      ok({
        items: [],
        page: {
          limit: request.limit ?? 100
        }
      })
    )
  },
  notes: {
    list: vi.fn(async (request = {}) =>
      ok({
        items: [],
        page: {
          limit: request.limit ?? 50
        }
      })
    ),
    get: vi.fn(async (request) =>
      ok({
        id: request.id,
        title: "Test note",
        preview: "",
        body: "",
        updatedAt: now
      })
    )
  },
  search: {
    query: vi.fn(async (request) =>
      ok({
        items: [],
        page: {
          limit: request.limit ?? 20
        }
      })
    )
  },
  sync: {
    status: vi.fn(async () =>
      ok({
        state: "idle" as const,
        pendingMutationCount: 0
      })
    ),
    runNow: vi.fn(async (request = {}) =>
      ok({
        accepted: true,
        dryRun: request.dryRun ?? false,
        resources: request.resources ?? ["tasks", "calendar"]
      })
    )
  },
  settings: {
    get: vi.fn(async () =>
      ok({
        theme: "system" as const,
        startOnLogin: false,
        quickCaptureShortcut: null,
        mcpEnabled: false
      })
    ),
    update: vi.fn(async (request) =>
      ok({
        theme: request.theme ?? "system",
        startOnLogin: request.startOnLogin ?? false,
        quickCaptureShortcut: request.quickCaptureShortcut ?? null,
        mcpEnabled: request.mcpEnabled ?? false
      })
    )
  },
  mcp: {
    status: vi.fn(async () =>
      ok({
        enabled: false,
        running: false,
        readOnly: true,
        confirmationRequired: true
      })
    ),
    setEnabled: vi.fn(async (request) =>
      ok({
        enabled: request.enabled,
        running: false,
        readOnly: true,
        confirmationRequired: request.confirmationRequired ?? true
      })
    )
  },
  native: {
    capabilities: vi.fn(async () =>
      ok({
        platform: "darwin" as const,
        notifications: false,
        globalShortcuts: false,
        tray: false,
        deepLinks: false
      })
    ),
    requestNotificationPermission: vi.fn(async () =>
      ok({
        state: "unsupported" as const
      })
    )
  },
  diagnostics: {
    health: vi.fn(async () =>
      ok({
        status: "ok" as const,
        version: "0.0.0-test",
        environment: "test" as const,
        timestamp: now,
        uptimeMs: 1,
        startup: {
          processStartedMs: 0
        }
      })
    ),
    markShellVisible: vi.fn(async () =>
      ok({
        processStartedMs: 0,
        shellVisibleMs: 1
      })
    ),
    ipcMetrics: vi.fn(async () =>
      ok({
        totalCalls: 0,
        validationFailures: 0,
        serviceFailures: 0,
        responseFailures: 0,
        routes: []
      })
    )
  }
};

Object.defineProperty(window, "hcb", {
  configurable: true,
  value: hcbApi
});
