import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";
import type { HcbApi } from "./src/shared/preloadApi";
import { ok } from "./src/shared/result";

const hcbApi: HcbApi = {
  diagnostics: {
    health: vi.fn(async () =>
      ok({
        status: "ok" as const,
        version: "0.0.0-test",
        environment: "test" as const,
        timestamp: new Date("2026-05-22T00:00:00.000Z").toISOString(),
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
    )
  },
  planner: {
    workspace: vi.fn(async () =>
      ok({
        revision: 0,
        taskCount: 0,
        openTaskCount: 0,
        completedTaskCount: 0,
        pendingMutationCount: 0,
        conflictCount: 0,
        searchIndexState: "ready" as const
      })
    ),
    listTasks: vi.fn(async () => ok({ revision: 0, tasks: [], nextCursor: null })),
    saveTask: vi.fn(async () =>
      ok({
        task: {
          id: "test-task",
          title: "Test task",
          notes: "",
          dueDate: null,
          status: "open" as const,
          createdAt: "2026-05-22T00:00:00.000Z",
          updatedAt: "2026-05-22T00:00:00.000Z",
          revision: 1
        },
        revision: 1,
        queued: true
      })
    ),
    completeTask: vi.fn(async () =>
      ok({
        task: {
          id: "test-task",
          title: "Test task",
          notes: "",
          dueDate: null,
          status: "completed" as const,
          createdAt: "2026-05-22T00:00:00.000Z",
          updatedAt: "2026-05-22T00:00:00.000Z",
          revision: 1
        },
        revision: 1,
        queued: true
      })
    ),
    syncStatus: vi.fn(async () =>
      ok({
        pendingMutationCount: 0,
        conflictCount: 0,
        nextAttemptAt: null,
        lastSuccessfulDeliveryAt: null,
        lastError: null
      })
    )
  },
  settings: {
    get: vi.fn(async () => ok({ colorScheme: "system" as const, startPage: "today" as const })),
    save: vi.fn(async (settings) => ok(settings)),
    dataInfo: vi.fn(async () =>
      ok({
        settingsFile: "/tmp/hcb/settings-v1.json",
        plannerFile: "/tmp/hcb/planner-v1.json"
      })
    )
  }
};

Object.defineProperty(window, "hcb", {
  configurable: true,
  value: hcbApi
});
