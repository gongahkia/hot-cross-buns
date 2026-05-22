import { app } from "electron";
import { performance } from "node:perf_hooks";
import {
  ipcContracts,
  type DiagnosticsHealthResponse,
  type DiagnosticsPerformanceRequest,
  type LocalPerformanceTiming
} from "@shared/ipc/contracts";
import { getStartupTimings, markStartupTiming } from "../startupTiming";
import type { IpcHandlerDefinition, IpcMetricsRecorder } from "./registry";

type AppEnvironment = DiagnosticsHealthResponse["environment"];

function environment(): AppEnvironment {
  if (process.env.NODE_ENV === "test") {
    return "test";
  }

  return app.isPackaged ? "production" : "development";
}

export function createDiagnosticsIpcHandlers(
  metrics: IpcMetricsRecorder,
  performanceTimings?: {
    listRecent: (limit: number) => readonly LocalPerformanceTiming[];
    record?: (timing: {
      kind: LocalPerformanceTiming["kind"];
      name: string;
      durationMs: number;
    }) => void;
  }
): IpcHandlerDefinition[] {
  return [
    {
      contract: ipcContracts.diagnostics.health,
      handle: () => ({
        status: "ok" as const,
        version: app.getVersion(),
        environment: environment(),
        timestamp: new Date().toISOString(),
        uptimeMs: Math.round(performance.now()),
        startup: getStartupTimings()
      })
    },
    {
      contract: ipcContracts.diagnostics.markShellVisible,
      handle: () => markStartupTiming("shellVisibleMs")
    },
    {
      contract: ipcContracts.diagnostics.markCachedDataRendered,
      handle: () => {
        const snapshot = markStartupTiming("cachedDataRenderedMs");

        if (snapshot.cachedDataRenderedMs !== undefined) {
          performanceTimings?.record?.({
            kind: "cached_render",
            name: "renderer.cached-data-rendered",
            durationMs: snapshot.cachedDataRenderedMs
          });
        }

        return snapshot;
      }
    },
    {
      contract: ipcContracts.diagnostics.ipcMetrics,
      handle: () => metrics.snapshot()
    },
    {
      contract: ipcContracts.diagnostics.performance,
      handle: (request) => ({
        timings: [...(performanceTimings?.listRecent((request as DiagnosticsPerformanceRequest).limit ?? 50) ?? [])]
      })
    }
  ];
}
