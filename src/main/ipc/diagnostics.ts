import { app, dialog, shell } from "electron";
import { writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import {
  ipcContracts,
  type DiagnosticsHistoryRequest,
  type DiagnosticsLogsRequest,
  type DiagnosticsPendingMutationsRequest,
  type DiagnosticsSummaryResponse,
  type DiagnosticsHealthResponse,
  type DiagnosticsPerformanceRequest,
  type LocalPerformanceTiming
} from "@shared/ipc/contracts";
import { DIAGNOSTIC_OMITTED_VALUE } from "@shared/redaction";
import { HcbPublicError } from "@shared/ipc/result";
import { redactDiagnosticText, redactDiagnosticsValue } from "./diagnosticsRedaction";
import { appLogger } from "../diagnostics/appLogger";
import { getStartupTimings, markStartupTiming } from "../startupTiming";
import { appBuildMetadata } from "../buildMetadata";
import { createNoopNativeAdapter } from "../native/noopAdapter";
import type { ServiceContainer } from "../services/serviceContainer";
import type { HcbIpcLifecycleHooks } from "./index";
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
      metadata?: Record<string, string | number | boolean | null>;
    }) => void;
  },
  services?: ServiceContainer,
  lifecycleHooks: HcbIpcLifecycleHooks = {}
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
        lifecycleHooks.onShellVisible?.();
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
      contract: ipcContracts.diagnostics.recordTiming,
      handle: (request) => {
        if (!performanceTimings?.record) {
          return { recorded: false };
        }

        const timing = request as {
          kind: LocalPerformanceTiming["kind"];
          name: string;
          durationMs: number;
          metadata?: Record<string, string | number | boolean | null>;
        };

        performanceTimings.record({
          kind: timing.kind,
          name: timing.name,
          durationMs: timing.durationMs,
          ...(timing.metadata === undefined ? {} : { metadata: timing.metadata })
        });

        return { recorded: true };
      }
    },
    {
      contract: ipcContracts.diagnostics.summary,
      handle: () => diagnosticsSummary(services, metrics, performanceTimings)
    },
    {
      contract: ipcContracts.diagnostics.logs,
      handle: (request) => {
        const parsed = request as DiagnosticsLogsRequest;
        return {
          entries: appLogger.recentEntries(parsed.limit ?? 200, parsed.minimumLevel ?? "info"),
          retainedEntryCount: appLogger.retainedEntryCount(),
          persistedText: appLogger.loadPersistedLog(),
          ...(appLogger.logsDirectory() === undefined ? {} : { logsDirectory: appLogger.logsDirectory() })
        };
      }
    },
    {
      contract: ipcContracts.diagnostics.clearLogs,
      handle: () => {
        appLogger.clearLogs();
        appLogger.info("logs cleared", "diagnostics");

        return {
          clearedAt: new Date().toISOString()
        };
      }
    },
    {
      contract: ipcContracts.diagnostics.revealLogsFolder,
      handle: async () => {
        const directory = appLogger.logsDirectory();

        if (directory === undefined) {
          return {
            opened: false,
            message: "Log directory is unavailable for this runtime."
          };
        }

        const error = await shell.openPath(directory);

        return {
          opened: error.length === 0,
          path: directory,
          message: error.length === 0 ? "Logs folder opened." : error
        };
      }
    },
    {
      contract: ipcContracts.diagnostics.history,
      handle: (request) => {
        const parsed = request as DiagnosticsHistoryRequest;

        return {
          entries: services?.localData.historyRepository.listRecent(parsed.limit ?? 100) ?? [],
          retainedEntryCount: services?.localData.historyRepository.count() ?? 0
        };
      }
    },
    {
      contract: ipcContracts.diagnostics.pendingMutations,
      handle: (request) => {
        const parsed = request as DiagnosticsPendingMutationsRequest;

        return {
          mutations: (services?.localData.syncRepository.listActivePendingMutations({
            limit: parsed.limit ?? 100
          }) ?? []).map((mutation) => ({
            id: mutation.id,
            accountId: mutation.accountId,
            resourceType: mutation.resourceType,
            resourceId: mutation.resourceId,
            operation: mutation.operation,
            status:
              mutation.status === "applying" || mutation.status === "failed"
                ? mutation.status
                : "pending",
            attemptCount: mutation.attemptCount,
            nextRetryAt: mutation.nextRetryAt,
            lastErrorCode: mutation.lastErrorCode,
            lastErrorMessage:
              mutation.lastErrorMessage === null
                ? null
                : redactDiagnosticText(mutation.lastErrorMessage),
            createdAt: mutation.createdAt,
            updatedAt: mutation.updatedAt
          }))
        };
      }
    },
    {
      contract: ipcContracts.diagnostics.retryPendingMutation,
      handle: (request) => {
        const id = (request as { id: string }).id;
        const now = new Date().toISOString();
        const mutation = services?.localData.syncRepository.retryPendingMutation(id, now);

        if (!mutation) {
          throw new HcbPublicError({
            code: "VALIDATION_ERROR",
            message: "Pending mutation could not be retried.",
            recoverable: true
          });
        }

        services?.localData.historyRepository.record({
          kind: "mutation.retry",
          resourceId: mutation.id,
          summary: "Retried pending mutation",
          metadata: { operation: mutation.operation }
        });

        return {
          id: mutation.id,
          status: "pending" as const,
          updatedAt: mutation.updatedAt
        };
      }
    },
    {
      contract: ipcContracts.diagnostics.cancelPendingMutation,
      handle: (request) => {
        const id = (request as { id: string }).id;
        const now = new Date().toISOString();
        const mutation = services?.localData.syncRepository.cancelPendingMutation(id, now);

        if (!mutation) {
          throw new HcbPublicError({
            code: "VALIDATION_ERROR",
            message: "Pending mutation could not be cancelled.",
            recoverable: true
          });
        }

        services?.localData.historyRepository.record({
          kind: "mutation.cancel",
          resourceId: mutation.id,
          summary: "Cancelled pending mutation",
          metadata: { operation: mutation.operation }
        });

        return {
          id: mutation.id,
          status: "cancelled" as const,
          updatedAt: mutation.updatedAt
        };
      }
    },
    {
      contract: ipcContracts.diagnostics.copyableSummary,
      handle: async () => {
        const summary = await diagnosticsSummary(services, metrics, performanceTimings);
        const text = buildDiagnosticSummaryText({
          summary,
          services,
          metrics
        });

        return {
          text,
          generatedAt: new Date().toISOString()
        };
      }
    },
    {
      contract: ipcContracts.diagnostics.exportBundle,
      handle: async () => {
        const summary = await diagnosticsSummary(services, metrics, performanceTimings);
        const text = buildDiagnosticBundleText({
          summary,
          services,
          metrics
        });
        const defaultPath = `hot-cross-buns-diagnostics-${filenameTimestamp()}.txt`;
        const result = await dialog.showSaveDialog({
          title: "Export diagnostic bundle",
          defaultPath,
          filters: [{ name: "Text", extensions: ["txt"] }]
        });

        if (result.canceled || result.filePath === undefined) {
          return {
            exported: false,
            message: "Diagnostic bundle export was cancelled."
          };
        }

        await writeFile(result.filePath, text, "utf8");
        appLogger.info("diagnostic bundle exported", "diagnostics", { path: result.filePath });

        return {
          exported: true,
          path: result.filePath,
          message: "Diagnostic bundle exported."
        };
      }
    },
    {
      contract: ipcContracts.diagnostics.rescheduleNotifications,
      handle: () => {
        const status = services?.nativeShell.rescheduleNotificationsForDiagnostics();

        if (!status) {
          throw new HcbPublicError({
            code: "SERVICE_UNAVAILABLE",
            message: "Native notification scheduling is unavailable.",
            recoverable: true
          });
        }

        appLogger.info("notifications rescheduled", "diagnostics", {
          scheduledCount: status.scheduledCount,
          state: status.state
        });

        return {
          status,
          message: status.message ?? "Notification schedule refreshed."
        };
      }
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
        retryableCount: 0,
        authPausedCount: 0,
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

function buildDiagnosticSummaryText(input: {
  summary: DiagnosticsSummaryResponse;
  services: ServiceContainer | undefined;
  metrics: IpcMetricsRecorder;
}): string {
  const summary = input.summary;
  const cachePath = input.services?.localData.connection.databasePath ?? "unavailable";
  const lines = [
    "Hot Cross Buns Diagnostics",
    `Generated: ${summary.generatedAt}`,
    `Version: ${summary.build.version}`,
    `Environment: ${summary.build.environment}`,
    "",
    "Status",
    `Account: ${summary.account.state}`,
    `Sync: ${summary.sync.state}`,
    `Mode: ${summary.sync.mode}`,
    `Last sync: ${summary.sync.lastCompletedAt ?? "Never"}`,
    `Pending writes: ${summary.pendingMutations.totalCount}`,
    "",
    "Local data",
    `Task lists: ${summary.cache.taskListCount}`,
    `Tasks: ${summary.cache.taskCount}`,
    `Calendars: ${summary.cache.calendarCount}`,
    `Events: ${summary.cache.eventCount}`,
    `Notes: ${summary.cache.noteCount}`,
    `Sync checkpoints: ${summary.checkpoints.totalCount}`,
    "",
    "Native",
    `Platform: ${summary.native.platform}`,
    `Adapter: ${summary.native.adapterId}`,
    `Notifications: ${summary.native.flags.supportsNotifications}`,
    `Diagnostics: ${summary.native.flags.supportsDiagnosticsCollection}`,
    "",
    "Paths",
    `Cache: ${cachePath}`,
    `Logs: ${appLogger.logsDirectory() ?? "Unavailable"}`,
    "",
    "Redaction",
    `Credentials: ${summary.redaction.credentials}`,
    `Google payloads: ${summary.redaction.googlePayloads}`,
    `MCP tokens: ${summary.redaction.mcpBearerTokens}`,
    `Sensitive bodies: ${summary.redaction.sensitiveBodies}`,
    "",
    "IPC",
    JSON.stringify(redactDiagnosticsValue(input.metrics.snapshot()), null, 2)
  ];

  return redactDiagnosticText(lines.join("\n"));
}

function buildDiagnosticBundleText(input: {
  summary: DiagnosticsSummaryResponse;
  services: ServiceContainer | undefined;
  metrics: IpcMetricsRecorder;
}): string {
  const pendingMutations =
    input.services?.localData.syncRepository.listActivePendingMutations({ limit: 200 }) ?? [];
  const history = input.services?.localData.historyRepository.listRecent(200) ?? [];
  const performanceTimings = input.services?.performance.listRecent(50) ?? [];
  const sections = [
    "=== Hot Cross Buns Diagnostic Bundle ===",
    buildDiagnosticSummaryText(input),
    "",
    `=== Pending Mutations (${pendingMutations.length}) ===`,
    safeDiagnosticJson(pendingMutations),
    "",
    `=== History (${history.length}) ===`,
    history
      .map((entry) =>
        `${entry.timestamp} [${entry.kind}] ${entry.summary}${entry.metadataLine ? ` ${entry.metadataLine}` : ""}`
      )
      .join("\n") || "none",
    "",
    `=== Performance Timings (${performanceTimings.length}) ===`,
    safeDiagnosticJson(performanceTimings),
    "",
    "=== Recent Logs ===",
    appLogger.loadPersistedLog() || appLogger.recentEntries(500, "debug").map((entry) => entry.formattedLine).join("\n") || "none",
    "",
    "=== Native Capability Report ===",
    safeDiagnosticJson(input.summary.native),
    "",
    "=== Build ===",
    safeDiagnosticJson(input.summary.build)
  ];

  return redactDiagnosticText(sections.join("\n"));
}

function safeDiagnosticJson(value: unknown): string {
  return redactDiagnosticText(JSON.stringify(redactDiagnosticsValue(value), null, 2));
}

function filenameTimestamp(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");

  return [
    now.getUTCFullYear(),
    pad(now.getUTCMonth() + 1),
    pad(now.getUTCDate()),
    "-",
    pad(now.getUTCHours()),
    pad(now.getUTCMinutes()),
    pad(now.getUTCSeconds())
  ].join("");
}
