import type {
  GoogleCalendarReadTransport,
  GoogleCalendarWriteTransport,
  GoogleTasksReadTransport,
  GoogleTasksWriteTransport
} from "../google";
import { GooglePendingMutationWorker } from "../sync/mutationWorker";
import type {
  LocalHistoryRepository,
  LocalPlannerRepository,
  LocalSettingsRepository,
  LocalUndoRepository
} from "../data/localRepositories";
import type { GoogleSyncRepository } from "../sync/readSyncRepository";
import type { AppDomainServices } from "./domainInterfaces";
import { createUnavailableGoogleDomainService } from "./sqliteGoogleDomainService";
import { createMcpDomainServices } from "./sqliteMcpDomainServices";
import {
  createInitialMcpState,
  createSqliteMcpControlService
} from "./sqliteMcpControlService";
import { createSqliteNativeDomainService } from "./sqliteNativeDomainService";
import { createSqlitePlannerDomainService } from "./sqlitePlannerDomainService";
import { createSqliteSettingsDomainService } from "./sqliteSettingsDomainService";
import { createSqliteUndoDomainService } from "./sqliteUndoDomainService";
import {
  LocalSyncControlService,
  noopCalendarTransport,
  noopTasksTransport
} from "./sqliteSyncControlService";

export interface SqliteDomainServiceOptions {
  plannerRepository: LocalPlannerRepository;
  settingsRepository: LocalSettingsRepository;
  undoRepository: LocalUndoRepository;
  syncRepository: GoogleSyncRepository;
  historyRepository?: LocalHistoryRepository;
  syncTasksTransport?: GoogleTasksReadTransport;
  syncCalendarTransport?: GoogleCalendarReadTransport;
  syncTasksWriteTransport?: GoogleTasksWriteTransport;
  syncCalendarWriteTransport?: GoogleCalendarWriteTransport;
}

export function createSqliteDomainServices(
  options: SqliteDomainServiceOptions
): AppDomainServices {
  const mutationWorker =
    options.syncTasksWriteTransport && options.syncCalendarWriteTransport
      ? new GooglePendingMutationWorker({
          repository: options.syncRepository,
          tasks: options.syncTasksWriteTransport,
          calendar: options.syncCalendarWriteTransport
        })
      : undefined;
  const sync = new LocalSyncControlService({
    repository: options.syncRepository,
    settingsRepository: options.settingsRepository,
    historyRepository: options.historyRepository,
    tasksTransport: options.syncTasksTransport ?? noopTasksTransport,
    calendarTransport: options.syncCalendarTransport ?? noopCalendarTransport,
    mutationWorker
  });
  const mcpState = createInitialMcpState(options.settingsRepository);

  return {
    planner: createSqlitePlannerDomainService(options.plannerRepository, options.undoRepository),
    sync,
    google: createUnavailableGoogleDomainService(options.syncRepository),
    settings: createSqliteSettingsDomainService({
      mcpState,
      settingsRepository: options.settingsRepository,
      sync,
      syncRepository: options.syncRepository
    }),
    undo: createSqliteUndoDomainService(options.undoRepository),
    mcp: createSqliteMcpControlService({
      mcpState,
      settingsRepository: options.settingsRepository
    }),
    native: createSqliteNativeDomainService(),
    mcpTools: createMcpDomainServices({
      plannerRepository: options.plannerRepository,
      settingsRepository: options.settingsRepository,
      syncRepository: options.syncRepository,
      syncStatus: () => sync.status()
    })
  };
}
