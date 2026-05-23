import { createAppSqliteConnection, type SqliteConnection } from "../data/sqliteConnection";
import { dirname } from "node:path";
import { MacOsKeychainSecretStore, UnsupportedSecretStore, type SecretStore } from "../credentials/secretStore";
import { runLocalDataMigrations, type MigrationResult } from "../data/migrations";
import {
  LocalPerformanceRepository,
  LocalPlannerRepository,
  LocalSettingsRepository
} from "../data/localRepositories";
import {
  GoogleCalendarHttpAdapter,
  GoogleOAuthClientConfigStore,
  GoogleOAuthHttpTransport,
  GoogleOAuthLoopbackController,
  GoogleTasksHttpAdapter,
  KeychainGoogleCredentialAdapter,
  KeychainGoogleOAuthClientSecretStore,
  RuntimeGoogleAccessTokenProvider
} from "../google";
import { LatestGoogleAccountApiTransport } from "../google/accountTransport";
import { RepositoryGoogleOAuthAccountStatusStore } from "../google/accountStatusStore";
import { GoogleRuntimeService } from "../google/runtimeService";
import { LocalMcpServerController } from "../mcp/controller";
import { KeychainMcpCredentialAdapter } from "../mcp/keychainCredentials";
import { McpToolRegistry } from "../mcp/toolRegistry";
import { createNoopNativeAdapter } from "../native/noopAdapter";
import { NativeShellService } from "../native/service";
import type { NativeAppPaths, NativePlatformAdapter, NativeShellWindowActions } from "../native/types";
import { GoogleSyncRepository } from "../sync/readSyncRepository";
import { SyncScheduler } from "../sync/scheduler";
import type {
  GoogleCalendarReadTransport,
  GoogleCalendarWriteTransport,
  GoogleTasksReadTransport,
  GoogleTasksWriteTransport
} from "../google";
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
  startDeferredRuntime: () => void;
  close: () => void;
}

export interface ServiceContainerOptions {
  appSupportDirectory?: string;
  appPaths?: NativeAppPaths;
  databaseFilename?: string;
  nativeAdapter?: NativePlatformAdapter;
  nativeWindows?: NativeShellWindowActions;
  syncTasksTransport?: GoogleTasksReadTransport;
  syncCalendarTransport?: GoogleCalendarReadTransport;
  syncTasksWriteTransport?: GoogleTasksWriteTransport;
  syncCalendarWriteTransport?: GoogleCalendarWriteTransport;
  secretStore?: SecretStore;
  enableRuntimeGoogle?: boolean;
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
  const runtimeGoogleEnabled = options.enableRuntimeGoogle ?? options.nativeAdapter !== undefined;
  const secretStore = options.secretStore ?? defaultSecretStore();
  const googleCredentialAdapter = new KeychainGoogleCredentialAdapter(secretStore);
  const googleClientSecretStore = new KeychainGoogleOAuthClientSecretStore(secretStore);
  const googleConfigStore = new GoogleOAuthClientConfigStore(connection, googleClientSecretStore);
  const googleOAuthTransport = new GoogleOAuthHttpTransport();
  const googleTokenProvider = new RuntimeGoogleAccessTokenProvider({
    credentialAdapter: googleCredentialAdapter,
    configStore: googleConfigStore,
    refreshTransport: googleOAuthTransport
  });
  const googleApiTransport = new LatestGoogleAccountApiTransport({
    repository: syncRepository,
    tokenProvider: googleTokenProvider
  });
  const runtimeTasksTransport = runtimeGoogleEnabled
    ? new GoogleTasksHttpAdapter(googleApiTransport)
    : undefined;
  const runtimeCalendarTransport = runtimeGoogleEnabled
    ? new GoogleCalendarHttpAdapter(googleApiTransport)
    : undefined;
  const sqliteDomain = createSqliteDomainServices({
    plannerRepository,
    settingsRepository,
    syncRepository,
    syncTasksTransport: options.syncTasksTransport ?? runtimeTasksTransport,
    syncCalendarTransport: options.syncCalendarTransport ?? runtimeCalendarTransport,
    syncTasksWriteTransport: options.syncTasksWriteTransport ?? runtimeTasksTransport,
    syncCalendarWriteTransport: options.syncCalendarWriteTransport ?? runtimeCalendarTransport
  });
  let syncScheduler: SyncScheduler | undefined;
  const googleLoopback = new GoogleOAuthLoopbackController({
    configStore: googleConfigStore,
    credentialAdapter: googleCredentialAdapter,
    authorizationTransport: googleOAuthTransport,
    accountStatusStore: new RepositoryGoogleOAuthAccountStatusStore(syncRepository),
    openExternalUrl: async (url) =>
      (await (options.nativeAdapter ?? createNoopNativeAdapter()).openExternalUrl(url)),
    onConnected: () => {
      syncScheduler?.triggerSoon(0);
    }
  });
  const googleRuntime = runtimeGoogleEnabled
    ? new GoogleRuntimeService({
        configStore: googleConfigStore,
        credentialAdapter: googleCredentialAdapter,
        syncRepository,
        loopback: googleLoopback
      })
    : undefined;
  const mcpToolRegistry = new McpToolRegistry(sqliteDomain.mcpTools);
  const mcpController = new LocalMcpServerController({
    credentialAdapter: new KeychainMcpCredentialAdapter(secretStore),
    toolRegistry: mcpToolRegistry,
    getSettings: () => settingsRepository.get()
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
        syncScheduler?.applySettings(snapshot);
        await mcpController.applySettings(snapshot);
        return snapshot;
      },
      recoveryAction: async (request) => {
        const response = await sqliteDomain.settings.recoveryAction(request);

        if (request.action === "resetMcpToken") {
          await mcpController.resetToken();
          await mcpController.applySettings(settingsRepository.get());
        }

        if (request.action === "refresh" || request.action === "forceFullResync") {
          syncScheduler?.triggerSoon(0);
        }

        return response;
      }
    },
    google: googleRuntime ?? sqliteDomain.google,
    mcp: {
      status: async () => mcpController.status(await sqliteDomain.mcp.status()),
      setEnabled: async (request) => {
        const status = await sqliteDomain.mcp.setEnabled(request);
        const settings = settingsRepository.get();
        nativeShell.applySettings(settings);
        await mcpController.applySettings(settings);
        return mcpController.status(status);
      }
    },
    native: nativeShell
  };
  syncScheduler = new SyncScheduler({
    getSettings: () => settingsRepository.get(),
    runNow: (request) => Promise.resolve(sqliteDomain.sync.runNow(request))
  });

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
    mcpTools: mcpToolRegistry,
    nativeShell,
    startDeferredRuntime: () => {
      void mcpController.applySettings(settingsRepository.get());
      syncScheduler?.start();
    },
    close: () => {
      syncScheduler?.stop();
      mcpController.dispose();
      void googleLoopback.stop();
      nativeShell.dispose();
      connection.close();
    }
  };
}

function defaultSecretStore(): SecretStore {
  return process.platform === "darwin"
    ? new MacOsKeychainSecretStore()
    : new UnsupportedSecretStore("OS credential storage is only wired for macOS in this preview.");
}
