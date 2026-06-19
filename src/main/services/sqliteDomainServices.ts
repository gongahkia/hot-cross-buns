import type {
  GoogleCalendarReadTransport,
  GoogleCalendarWriteTransport,
  GoogleTasksReadTransport,
  GoogleTasksWriteTransport
} from "../google";
import { GooglePendingMutationWorker } from "../sync/mutationWorker";
import type {
  LocalHistoryRepository,
  LocalAgentRepository,
  LocalPlannerRepository,
  LocalSettingsRepository,
  LocalSettingsSupportRepository,
  LocalUndoRepository,
  LocalWebhookRepository
} from "../data/localRepositories";
import type { GoogleSyncRepository } from "../sync/readSyncRepository";
import type { AppDomainServices } from "./domainInterfaces";
import { createSqliteAgentDomainService } from "./sqliteAgentDomainService";
import { createUnavailableGoogleDomainService } from "./sqliteGoogleDomainService";
import { createMcpDomainServices } from "./sqliteMcpDomainServices";
import {
  createInitialMcpState,
  createSqliteMcpControlService
} from "./sqliteMcpControlService";
import { createSqliteNativeDomainService } from "./sqliteNativeDomainService";
import { createSqlitePlannerDomainService } from "./sqlitePlannerDomainService";
import { createSqliteSearchModelDomainService } from "./sqliteSearchModelDomainService";
import { createSqliteSettingsDomainService } from "./sqliteSettingsDomainService";
import { createSqliteUndoDomainService } from "./sqliteUndoDomainService";
import { createSqliteWebhookDomainService } from "./sqliteWebhookDomainService";
import {
  LocalSyncControlService,
  noopCalendarTransport,
  noopTasksTransport
} from "./sqliteSyncControlService";

export interface SqliteDomainServiceOptions {
  plannerRepository: LocalPlannerRepository;
  settingsRepository: LocalSettingsRepository;
  settingsSupportRepository: LocalSettingsSupportRepository;
  undoRepository: LocalUndoRepository;
  agentRepository: LocalAgentRepository;
  webhookRepository: LocalWebhookRepository;
  syncRepository: GoogleSyncRepository;
  historyRepository?: LocalHistoryRepository;
  syncTasksTransport?: GoogleTasksReadTransport;
  syncCalendarTransport?: GoogleCalendarReadTransport;
  syncTasksWriteTransport?: GoogleTasksWriteTransport;
  syncCalendarWriteTransport?: GoogleCalendarWriteTransport;
}

export function createSqliteDomainServices(
  options: SqliteDomainServiceOptions
): Omit<AppDomainServices, "hosters"> {
  const webhooks = createSqliteWebhookDomainService(options.webhookRepository, options.settingsRepository);
  const mutationWorker =
    options.syncTasksWriteTransport && options.syncCalendarWriteTransport
      ? new GooglePendingMutationWorker({
          repository: options.syncRepository,
          tasks: options.syncTasksWriteTransport,
          calendar: options.syncCalendarWriteTransport,
          onMutationFailed: (event) => {
            void webhooks.emit("mutation.failed", {
              id: event.id,
              operation: event.operation,
              resourceType: event.resourceType,
              resourceId: event.resourceId,
              errorCode: event.errorCode,
              attemptCount: event.attemptCount,
              ...(event.nextRetryAt === undefined ? {} : { nextRetryAt: event.nextRetryAt })
            });
          }
        })
      : undefined;
  const sync = new LocalSyncControlService({
    repository: options.syncRepository,
    settingsRepository: options.settingsRepository,
    historyRepository: options.historyRepository,
    tasksTransport: options.syncTasksTransport ?? noopTasksTransport,
    calendarTransport: options.syncCalendarTransport ?? noopCalendarTransport,
    mutationWorker,
    afterRun: () => webhooks.drainDue()
  });
  const mcpState = createInitialMcpState(options.settingsRepository);
  const undo = createSqliteUndoDomainService(options.undoRepository);

  return {
    planner: createSqlitePlannerDomainService(
      options.plannerRepository,
      options.undoRepository,
      options.settingsRepository
    ),
    sync,
    google: createUnavailableGoogleDomainService(options.syncRepository),
    settings: createSqliteSettingsDomainService({
      mcpState,
      settingsRepository: options.settingsRepository,
      settingsSupportRepository: options.settingsSupportRepository,
      sync,
      syncRepository: options.syncRepository
    }),
    searchModels: createSqliteSearchModelDomainService(
      options.plannerRepository,
      options.settingsRepository
    ),
    undo,
    mcp: createSqliteMcpControlService({
      mcpState,
      settingsRepository: options.settingsRepository
    }),
    agent: createSqliteAgentDomainService(options.agentRepository),
    webhooks,
    native: createSqliteNativeDomainService(),
    mcpTools: createMcpDomainServices({
      plannerRepository: options.plannerRepository,
      settingsRepository: options.settingsRepository,
      syncRepository: options.syncRepository,
      historyRepository: options.historyRepository,
      undo,
      syncStatus: () => sync.status(),
      syncRunNow: (request) => sync.runNow(request)
    })
  };
}
