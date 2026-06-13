import { createAppSqliteConnection, type SqliteConnection } from "../data/sqliteConnection";
import { dirname, join } from "node:path";
import { HCB_MCP_RUNTIME_FILE_NAME } from "@shared/mcpRuntime";
import { appLogger } from "../diagnostics/appLogger";
import {
  LinuxSecretServiceStore,
  MacOsKeychainSecretStore,
  UnsupportedSecretStore,
  type LinuxSafeStorageBackend,
  type SecretStore
} from "../credentials/secretStore";
import { runLocalDataMigrations, type MigrationResult } from "../data/migrations";
import {
  LocalHistoryRepository,
  LocalAgentRepository,
  LocalPerformanceRepository,
  LocalPlannerRepository,
  LocalSettingsRepository,
  LocalSettingsSupportRepository,
  LocalUndoRepository,
  LocalWebhookRepository
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
import { McpConfirmationStore } from "../mcp/confirmationStore";
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
import { createSqliteAgentDomainService } from "./sqliteAgentDomainService";

export interface LocalDataService {
  status: "ready";
  connection: SqliteConnection;
  migrations: MigrationResult;
  plannerRepository: LocalPlannerRepository;
  settingsRepository: LocalSettingsRepository;
  settingsSupportRepository: LocalSettingsSupportRepository;
  syncRepository: GoogleSyncRepository;
  historyRepository: LocalHistoryRepository;
  undoRepository: LocalUndoRepository;
  agentRepository: LocalAgentRepository;
  webhookRepository: LocalWebhookRepository;
  performanceRepository: LocalPerformanceRepository;
}

export interface ServiceContainer {
  domain: AppDomainServices;
  localData: LocalDataService;
  performance: LocalPerformanceRepository;
  mcpTools: McpToolRegistry;
  nativeShell: NativeShellService;
  startDeferredRuntime: () => void;
  close: () => Promise<void>;
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
  linuxSafeStorageBackend?: LinuxSafeStorageBackend;
  enableRuntimeGoogle?: boolean;
  enableRuntimeGoogleWrites?: boolean;
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
  const defaultTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const migrations = runLocalDataMigrations(connection, { defaultTimeZone });
  const performanceRepository = new LocalPerformanceRepository(connection);
  const historyRepository = new LocalHistoryRepository(connection);
  const undoRepository = new LocalUndoRepository(connection);
  const agentRepository = new LocalAgentRepository(connection);
  const webhookRepository = new LocalWebhookRepository(connection);
  const plannerRepository = new LocalPlannerRepository(connection, performanceRepository);
  const settingsRepository = new LocalSettingsRepository(connection);
  const settingsSupportRepository = new LocalSettingsSupportRepository(
    connection,
    appPaths ?? {
      configDirectory: appSupportDirectory,
      dataDirectory: appSupportDirectory,
      cacheDirectory: appSupportDirectory,
      logsDirectory: appSupportDirectory,
      diagnosticsDirectory: appSupportDirectory,
      tempDirectory: appSupportDirectory
    }
  );
  const syncRepository = new GoogleSyncRepository(connection, { defaultTimeZone });
  const runtimeGoogleEnabled = options.enableRuntimeGoogle ?? options.nativeAdapter !== undefined;
  const runtimeGoogleWritesEnabled =
    options.enableRuntimeGoogleWrites ?? runtimeGoogleEnabled;
  const secretStore = options.secretStore ?? defaultSecretStoreForPlatform({
    appPaths,
    linuxSafeStorageBackend: options.linuxSafeStorageBackend
  });
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
  const runtimeTasksWriteTransport =
    runtimeGoogleEnabled && runtimeGoogleWritesEnabled ? runtimeTasksTransport : undefined;
  const runtimeCalendarWriteTransport =
    runtimeGoogleEnabled && runtimeGoogleWritesEnabled ? runtimeCalendarTransport : undefined;
  const sqliteDomain = createSqliteDomainServices({
    plannerRepository,
    settingsRepository,
    settingsSupportRepository,
    undoRepository,
    agentRepository,
    webhookRepository,
    syncRepository,
    historyRepository,
    syncTasksTransport: options.syncTasksTransport ?? runtimeTasksTransport,
    syncCalendarTransport: options.syncCalendarTransport ?? runtimeCalendarTransport,
    syncTasksWriteTransport: options.syncTasksWriteTransport ?? runtimeTasksWriteTransport,
    syncCalendarWriteTransport: options.syncCalendarWriteTransport ?? runtimeCalendarWriteTransport
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
  const mcpToolRegistry = new McpToolRegistry(
    sqliteDomain.mcpTools,
    new McpConfirmationStore({ repository: agentRepository })
  );
  const mcpController = new LocalMcpServerController({
    credentialAdapter: new KeychainMcpCredentialAdapter(secretStore),
    toolRegistry: mcpToolRegistry,
    getSettings: () => settingsSupportRepository.applyExternalSettings(settingsRepository.get()),
    runtimeFilePath: appPaths ? join(appPaths.configDirectory, HCB_MCP_RUNTIME_FILE_NAME) : undefined
  });
  const nativeShell = new NativeShellService({
    adapter: options.nativeAdapter ?? createNoopNativeAdapter(),
    planner: plannerRepository,
    account: {
      latest: () => syncRepository.latestAccountStatus()
    },
    settings: {
      get: () => settingsSupportRepository.applyExternalSettings(settingsRepository.get())
    },
    recordUpdateCheck: (checkedAt) => {
      settingsRepository.update({ lastUpdateCheckAt: checkedAt });
    },
    windows: options.nativeWindows ?? noopWindowActions,
    sync: {
      runNow: (request) => Promise.resolve(sqliteDomain.sync.runNow(request))
    },
    webhooks: sqliteDomain.webhooks
  });
  const domain: AppDomainServices = {
    ...sqliteDomain,
    settings: {
      get: () => sqliteDomain.settings.get(),
      update: async (request) => {
        const snapshot = await sqliteDomain.settings.update(request);
        historyRepository.enforceRetention(snapshot.historyStorageCap);
        nativeShell.applySettings(snapshot);
        syncScheduler?.applySettings(snapshot);
        await mcpController.applySettings(snapshot);
        return snapshot;
      },
      recoveryAction: async (request) => {
        appLogger.info("recovery action requested", "settings", { action: request.action });
        const response = await sqliteDomain.settings.recoveryAction(request);
        historyRepository.record({
          kind: `recovery.${request.action}`,
          summary: "Ran recovery action",
          metadata: { action: request.action, destructive: response.destructive }
        });

        if (request.action === "resetMcpToken") {
          await mcpController.resetToken();
          await mcpController.applySettings(settingsRepository.get());
        }

        if (request.action === "refresh" || request.action === "forceFullResync") {
          syncScheduler?.triggerSoon(0);
        }

        if (request.action === "checkForUpdates") {
          const updaterStatus = await nativeShell.checkForUpdates();
          return {
            ...response,
            message: updaterStatus.message ?? response.message
          };
        }

        return response;
      },
      exportPortableArchive: () => sqliteDomain.settings.exportPortableArchive(),
      previewPortableImport: (request) => sqliteDomain.settings.previewPortableImport(request),
      importPortableArchive: (request) => sqliteDomain.settings.importPortableArchive(request),
      listLocalPointers: (request) => sqliteDomain.settings.listLocalPointers(request),
      repairLocalPointer: (request) => sqliteDomain.settings.repairLocalPointer(request),
      customizationStatus: () => sqliteDomain.settings.customizationStatus(),
      reloadCustomization: () => sqliteDomain.settings.reloadCustomization(),
      setSnippetEnabled: (request) => sqliteDomain.settings.setSnippetEnabled(request),
      setExtensionEnabled: (request) => sqliteDomain.settings.setExtensionEnabled(request),
      logExtensionMessage: (request) => sqliteDomain.settings.logExtensionMessage(request),
      listAttachments: (request) => sqliteDomain.settings.listAttachments(request),
      addAttachment: (request) => sqliteDomain.settings.addAttachment(request),
      removeAttachment: (request) => sqliteDomain.settings.removeAttachment(request),
      openAttachment: (request) => sqliteDomain.settings.openAttachment(request),
      downloadAttachment: (request) => sqliteDomain.settings.downloadAttachment(request),
      importIcs: (request) => sqliteDomain.settings.importIcs(request),
      listIcsSubscriptions: () => sqliteDomain.settings.listIcsSubscriptions(),
      subscribeIcs: (request) => sqliteDomain.settings.subscribeIcs(request),
      refreshIcsSubscription: (request) => sqliteDomain.settings.refreshIcsSubscription(request),
      deleteIcsSubscription: (request) => sqliteDomain.settings.deleteIcsSubscription(request),
      exportLocalReport: (request) => sqliteDomain.settings.exportLocalReport(request)
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
    agent: createSqliteAgentDomainService(agentRepository, mcpToolRegistry),
    webhooks: sqliteDomain.webhooks,
    native: nativeShell
  };
  mcpToolRegistry.setAdminServices({
    settings: domain.settings,
    google: domain.google,
    mcp: domain.mcp
  });
  syncScheduler = new SyncScheduler({
    getSettings: () => settingsSupportRepository.applyExternalSettings(settingsRepository.get()),
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
      settingsSupportRepository,
      syncRepository,
      historyRepository,
      undoRepository,
      agentRepository,
      webhookRepository,
      performanceRepository
    },
    performance: performanceRepository,
    mcpTools: mcpToolRegistry,
    nativeShell,
    startDeferredRuntime: () => {
      try {
        void mcpController.applySettings(settingsRepository.get()).catch((error) => {
          appLogger.warn("deferred MCP settings apply failed", "mcp", {
            message: error instanceof Error ? error.message : String(error)
          });
        });
      } catch (error) {
        appLogger.warn("deferred MCP settings load failed", "mcp", {
          message: error instanceof Error ? error.message : String(error)
        });
      }

      syncScheduler?.start();
    },
    close: async () => {
      syncScheduler?.stop();
      await mcpController.dispose();
      await googleLoopback.stop();
      nativeShell.dispose();
      connection.close();
    }
  };
}

export function defaultSecretStoreForPlatform(input: {
  appPaths?: NativeAppPaths;
  linuxSafeStorageBackend?: LinuxSafeStorageBackend;
  platform?: NodeJS.Platform | string;
} = {}): SecretStore {
  const platform = input.platform ?? process.platform;

  if (platform === "darwin") {
    return new MacOsKeychainSecretStore();
  }

  if (platform === "linux") {
    const backend = input.linuxSafeStorageBackend ?? loadElectronSafeStorageBackend();

    if (backend && input.appPaths) {
      return new LinuxSecretServiceStore({
        backend,
        platform,
        storageFile: join(input.appPaths.configDirectory, "secrets.safe-storage.json")
      });
    }

    return new UnsupportedSecretStore(
      backend
        ? "Linux Secret Service storage requires app paths before secrets can be persisted."
        : "Electron safeStorage is unavailable; Linux Secret Service storage cannot be used."
    );
  }

  return new UnsupportedSecretStore("OS credential storage is unavailable on this platform.");
}

function loadElectronSafeStorageBackend(): LinuxSafeStorageBackend | undefined {
  try {
    const electron = require("electron") as { safeStorage?: LinuxSafeStorageBackend } | string;

    return typeof electron === "object" ? electron.safeStorage : undefined;
  } catch {
    return undefined;
  }
}
