import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HCB_IPC_VERSION } from "@shared/ipc/contracts";
import { MemorySecretStore } from "../credentials/secretStore";
import { createServiceContainer } from "../services/serviceContainer";
import { createDiagnosticsIpcHandlers } from "./diagnostics";
import { createIpcDispatcher, createIpcMetrics } from "./registry";

vi.mock("electron", () => ({
  app: {
    getName: () => "Hot Cross Buns 2",
    getVersion: () => "5.0.0",
    isPackaged: false
  },
  dialog: {
    showSaveDialog: vi.fn()
  },
  shell: {
    openPath: vi.fn()
  }
}));

describe("diagnostics IPC handlers", () => {
  it("returns a typed diagnostics summary through the dispatcher", async () => {
    const appSupportDirectory = mkdtempSync(join(tmpdir(), "hcb2-diagnostics-ipc-"));
    const services = createServiceContainer({
      appSupportDirectory,
      secretStore: new MemorySecretStore()
    });
    const metrics = createIpcMetrics();
    const dispatch = createIpcDispatcher(
      createDiagnosticsIpcHandlers(metrics, services.performance, services)
    );

    try {
      const result = await dispatch(null, {
        version: HCB_IPC_VERSION,
        domain: "diagnostics",
        method: "summary",
        request: {}
      });

      expect(result).toMatchObject({
        ok: true,
        data: {
          status: "ok",
          sync: {
            state: "idle"
          },
          cache: {
            taskCount: 0
          },
          redaction: {
            credentials: "redacted"
          }
        }
      });
    } finally {
      await services.close();
      rmSync(appSupportDirectory, { recursive: true, force: true });
    }
  });
});
