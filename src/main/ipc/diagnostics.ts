import { app } from "electron";
import { performance } from "node:perf_hooks";
import {
  ipcContracts,
  type DiagnosticsSummaryResponse,
  type DiagnosticsHealthResponse,
  type DiagnosticsPerformanceRequest,
  type LocalPerformanceTiming
} from "@shared/ipc/contracts";
import { DIAGNOSTIC_OMITTED_VALUE } from "@shared/redaction";
import { getStartupTimings, markStartupTiming } from "../startupTiming";
import { appBuildMetadata } from "../buildMetadata";
import { createNoopNativeAdapter } from "../native/noopAdapter";
import type { ServiceContainer } from "../services/serviceContainer";
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
    listSlowSqliteQueries?: (
      limit: number
    ) => Array<{ name: string; durationMs: number; createdAt: string }>;
    record?: (timing: {
      kind: LocalPerformanceTiming["kind"];
      name: string;
      durationMs: number;
    }) => void;
  },
  services?: ServiceContainer
): IpcHandlerDefinition[] {
  const appEnvironment = environment();

  return [
    {
      contract: ipcContracts.diagnostics.health,
      handle: () => ({
        status: "ok" as const,
        version: app.getVersion(),
        environment: appEnvironment,
        timestamp: new Date().toISOString(),
        uptimeMs: Math.round(performance.now()),
        startup: getStartupTimings(),
        build: appBuildMetadata(appEnvironment)
      })
    },
    {
      contract: ipcContracts.diagnostics.markShellVisible,
      handle: () => {
        const snapshot = markStartupTiming("shellVisibleMs");
        services?.nativeShell.startDeferredStartup();
        return snapshot;
      }
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
      handle: async (request) => {
        const includePerformance =
          (await services?.domain.settings.get())?.diagnosticsIncludePerformance ?? true;

        return {
          timings: includePerformance
            ? [...(performanceTimings?.listRecent((request as DiagnosticsPerformanceRequest).limit ?? 50) ?? [])]
            : []
        };
      }
    },
    {
      contract: ipcContracts.diagnostics.summary,
      handle: () => diagnosticsSummary(services, metrics, performanceTimings)
    }
  ];
}

async function diagnosticsSummary(
  services: ServiceContainer | undefined,
  metrics: IpcMetricsRecorder,
  performanceTimings:
    | {
        listRecent: (limit: number) => readonly LocalPerformanceTiming[];
        listSlowSqliteQueries?: (
          limit: number
        ) => Array<{ name: string; durationMs: number; createdAt: string }>;
      }
    | undefined
): Promise<DiagnosticsSummaryResponse> {
  const generatedAt = new Date().toISOString();
  const startup = getStartupTimings();
  const build = appBuildMetadata(environment());

  if (!services) {
    const zeroMcpCounts = zeroMcpRequestCounts();

    return {
      status: "ok",
      generatedAt,
      account: {
        state: "signed_out",
        grantedScopeCount: 0,
        missingScopeCount: 2
      },
      sync: {
        state: "idle",
        pendingMutationCount: 0,
        offline: true,
        stale: true,
        mode: "manual"
      },
      cache: {
        taskListCount: 0,
        taskCount: 0,
        calendarCount: 0,
        eventCount: 0,
        noteCount: 0,
        performanceSampleCount: performanceTimings?.listRecent(100).length ?? 0,
        migrationVersion: 0,
        migrationDurationMs: 0
      },
      selectedResources: {
        taskLists: [],
        calendars: []
      },
      checkpoints: {
        totalCount: 0,
        tasksCount: 0,
        calendarCount: 0
      },
      pendingMutations: {
        totalCount: 0,
        pendingCount: 0,
        applyingCount: 0,
        failedCount: 0,
        byResourceType: []
      },
      mcp: {
        enabled: false,
        running: false,
        permissionMode: "read-only",
        confirmationRequired: true,
        port: 0,
        tokenState: "not_configured",
        requestCounts: zeroMcpCounts
      },
      native: createNoopNativeAdapter().capabilities().capabilityReport,
      build,
      performance: {
        startup,
        migrationDurationMs: 0,
        slowQuerySamples: performanceTimings?.listSlowSqliteQueries?.(10) ?? [],
        pendingMutationCounts: {
          totalCount: 0,
          failedCount: 0
        },
        mcpRequestCounts: zeroMcpCounts
      },
      redaction: redactionGuarantees()
    };
  }

  const [settings, syncStatus, mcpStatus, nativeCapabilities] = await Promise.all([
    services.domain.settings.get(),
    services.domain.sync.status(),
    services.domain.mcp.status(),
    services.domain.native.capabilities()
  ]);
  const account = services.localData.syncRepository.latestAccountStatus();
  const cache = services.localData.syncRepository.cacheDiagnostics();
  const checkpoints = services.localData.syncRepository.checkpointDiagnostics();
  const pendingMutations = services.localData.syncRepository.pendingMutationDiagnostics();
  const selectedResources = services.localData.syncRepository.selectedResourceDiagnostics(settings);
  const mcpRequestCounts = zeroMcpRequestCounts();
  const includePerformance = settings.diagnosticsIncludePerformance;

  return {
    status: "ok",
    generatedAt,
    account: account
      ? {
          state: account.connectionState,
          grantedScopeCount: account.grantedScopes.length,
          missingScopeCount: account.missingScopes.length,
          ...(account.lastAuthenticatedAt === undefined
            ? {}
            : { lastAuthenticatedAt: account.lastAuthenticatedAt }),
          updatedAt: account.updatedAt
        }
      : {
          state: "signed_out",
          grantedScopeCount: 0,
          missingScopeCount: 2
        },
    sync: {
      ...syncStatus,
      mode: settings.syncMode
    },
    cache: {
      ...cache,
      migrationVersion: services.localData.migrations.version,
      migrationDurationMs: services.localData.migrations.durationMs
    },
    selectedResources: sanitizeSelectedResources(selectedResources),
    checkpoints,
    pendingMutations,
    mcp: {
      enabled: mcpStatus.enabled,
      running: mcpStatus.running,
      permissionMode: mcpStatus.permissionMode,
      confirmationRequired: mcpStatus.confirmationRequired,
      ...(mcpStatus.url === undefined ? {} : { url: mcpStatus.url }),
      port: mcpStatus.port,
      tokenState: mcpStatus.tokenState,
      ...(mcpStatus.lastTokenResetAt === undefined
        ? {}
        : { lastTokenResetAt: mcpStatus.lastTokenResetAt }),
      requestCounts: mcpRequestCounts
    },
    native: nativeCapabilities.capabilityReport,
    build,
    performance: {
      startup: includePerformance ? startup : {},
      migrationDurationMs: includePerformance ? services.localData.migrations.durationMs : 0,
      ...(includePerformance && syncStatus.lastDurationMs !== undefined
        ? { lastSyncDurationMs: syncStatus.lastDurationMs }
        : {}),
      slowQuerySamples: includePerformance ? performanceTimings?.listSlowSqliteQueries?.(10) ?? [] : [],
      pendingMutationCounts: {
        totalCount: pendingMutations.totalCount,
        failedCount: pendingMutations.failedCount
      },
      mcpRequestCounts
    },
    redaction: redactionGuarantees()
  };
}

function sanitizeSelectedResources(
  selectedResources: DiagnosticsSummaryResponse["selectedResources"]
): DiagnosticsSummaryResponse["selectedResources"] {
  return {
    taskLists: selectedResources.taskLists.map((resource, index) => ({
      id: `task-list-${index + 1}`,
      title: DIAGNOSTIC_OMITTED_VALUE,
      selected: resource.selected
    })),
    calendars: selectedResources.calendars.map((resource, index) => ({
      id: `calendar-${index + 1}`,
      title: DIAGNOSTIC_OMITTED_VALUE,
      selected: resource.selected
    }))
  };
}

function zeroMcpRequestCounts() {
  return {
    totalRequests: 0,
    successCount: 0,
    rejectedCount: 0,
    errorCount: 0,
    rateLimitedCount: 0
  };
}

function redactionGuarantees(): DiagnosticsSummaryResponse["redaction"] {
  return {
    credentials: "redacted",
    googlePayloads: "omitted",
    mcpBearerTokens: "redacted",
    sensitiveBodies: "omitted"
  };
}
