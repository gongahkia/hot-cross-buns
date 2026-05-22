import { app, ipcMain } from "electron";
import { performance } from "node:perf_hooks";
import {
  healthCheckRequestSchema,
  shellVisibleRequestSchema,
  type AppEnvironment
} from "@shared/diagnostics";
import { IPC_CHANNELS } from "@shared/ipc";
import { internalError, ok, validationError } from "@shared/result";
import { getStartupTimings, markStartupTiming } from "../startupTiming";

function environment(): AppEnvironment {
  if (process.env.NODE_ENV === "test") {
    return "test";
  }

  return app.isPackaged ? "production" : "development";
}

export function registerDiagnosticsIpc(): void {
  ipcMain.handle(IPC_CHANNELS.diagnostics.health, async (_event, payload: unknown) => {
    const request = healthCheckRequestSchema.safeParse(payload);

    if (!request.success) {
      return validationError("Invalid health check request");
    }

    try {
      return ok({
        status: "ok" as const,
        version: app.getVersion(),
        environment: environment(),
        timestamp: new Date().toISOString(),
        uptimeMs: Math.round(performance.now()),
        startup: getStartupTimings()
      });
    } catch {
      return internalError("Unable to read diagnostics health");
    }
  });

  ipcMain.handle(IPC_CHANNELS.diagnostics.markShellVisible, async (_event, payload: unknown) => {
    const request = shellVisibleRequestSchema.safeParse(payload);

    if (!request.success) {
      return validationError("Invalid shell visibility request");
    }

    return ok(markStartupTiming("shellVisibleMs"));
  });
}
