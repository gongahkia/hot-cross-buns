import { createAppSqliteConnection, type SqliteConnection } from "../data/sqliteConnection";
import { dirname } from "node:path";
import { runLocalDataMigrations, type MigrationResult } from "../data/migrations";
import {
  LocalPerformanceRepository,
  LocalPlannerRepository,
  LocalSettingsRepository
} from "../data/localRepositories";
import { McpToolRegistry } from "../mcp/toolRegistry";
import { createNoopNativeAdapter } from "../native/noopAdapter";
import { NativeShellService } from "../native/service";
import type { NativeAppPaths, NativePlatformAdapter, NativeShellWindowActions } from "../native/types";
import { GoogleSyncRepository } from "../sync/readSyncRepository";
import { markStartupTiming } from "../startupTiming";
import type { AppDomainServices } from "./domainInterfaces";
import { createSqliteDomainServices } from "./sqliteDomainServices";

export interface LocalDataService {
  status: "ready";
  connection: SqliteConnection;
  migrations: MigrationResult;
  plannerRepository: LocalPlannerRepository;
  settingsRepository: LocalSettingsRepository;
  syncRepository: GoogleSyncRepository;
  performanceRepository: LocalPerformanceRepository;
}

export interface ServiceContainer {
  domain: AppDomainServices;
  localData: LocalDataService;
  performance: LocalPerformanceRepository;
  mcpTools: McpToolRegistry;
  nativeShell: NativeShellService;
  close: () => void;
}

export interface ServiceContainerOptions {
  appSupportDirectory?: string;
  appPaths?: NativeAppPaths;
  databaseFilename?: string;
  nativeAdapter?: NativePlatformAdapter;
  nativeWindows?: NativeShellWindowActions;
}

const noopWindowActions: NativeShellWindowActions = {
  showMainWindow: () => undefined,
  hideMainWindow: () => undefined,
  showOrHideMainWindow: () => undefined,
  quit: () => undefined,
  dispatchAction: () => undefined
};

export function createServiceContainer(options: ServiceContainerOptions): ServiceContainer {
  const appPaths = options.appPaths ?? options.nativeAdapter?.appPaths();
  const appSupportDirectory =
    options.appSupportDirectory ??
    (appPaths ? dirname(appPaths.dataDirectory) : undefined);

  if (!appSupportDirectory) {
    throw new Error("Service container requires app support paths.");
  }

  const connection = createAppSqliteConnection({
    appSupportDirectory,
    filename: options.databaseFilename
  });
  const migrations = runLocalDataMigrations(connection);
  const performanceRepository = new LocalPerformanceRepository(connection);
  const plannerRepository = new LocalPlannerRepository(connection, performanceRepository);
  const settingsRepository = new LocalSettingsRepository(connection);
  const syncRepository = new GoogleSyncRepository(connection);
  const sqliteDomain = createSqliteDomainServices({
    plannerRepository,
    settingsRepository,
    syncRepository
  });
  const nativeShell = new NativeShellService({
    adapter: options.nativeAdapter ?? createNoopNativeAdapter(),
    planner: plannerRepository,
    settings: settingsRepository,
    windows: options.nativeWindows ?? noopWindowActions,
    sync: {
      runNow: (request) => Promise.resolve(sqliteDomain.sync.runNow(request))
    }
  });
  const domain: AppDomainServices = {
    ...sqliteDomain,
    settings: {
      get: () => sqliteDomain.settings.get(),
      update: async (request) => {
        const snapshot = await sqliteDomain.settings.update(request);
        nativeShell.applySettings(snapshot);
        return snapshot;
      },
      recoveryAction: (request) => sqliteDomain.settings.recoveryAction(request)
    },
    mcp: {
      status: () => sqliteDomain.mcp.status(),
      setEnabled: async (request) => {
        const status = await sqliteDomain.mcp.setEnabled(request);
        nativeShell.applySettings(settingsRepository.get());
        return status;
      }
    },
    native: nativeShell
  };

  markStartupTiming("databaseReadyMs");
  performanceRepository.record({
    kind: "startup",
    name: "database.migrations",
    durationMs: migrations.durationMs,
    metadata: {
      version: migrations.version,
      appliedCount: migrations.appliedVersions.length
    }
  });

  return {
    domain,
    localData: {
      status: "ready",
      connection,
      migrations,
      plannerRepository,
      settingsRepository,
      syncRepository,
      performanceRepository
    },
    performance: performanceRepository,
    mcpTools: new McpToolRegistry(domain.mcpTools),
    nativeShell,
    close: () => {
      nativeShell.dispose();
      connection.close();
    }
  };
}
