import type {
  HcbVaultExportRequest,
  HcbVaultImportRequest,
  HcbVaultRemotePullRequest,
  HcbVaultRemotePushRequest,
  HcbVaultRemoteStatusRequest,
  McpStatusResponse,
  PortableArchivePathRequest,
  PortableImportRequest,
  SettingsRecoveryActionRequest,
  SettingsUpdateRequest
} from "@shared/ipc/contracts";
import {
  hcbVaultRemotePullRequestSchema,
  hcbVaultRemotePushRequestSchema,
  hcbVaultRemoteStatusRequestSchema
} from "@shared/ipc/contracts";
import { HcbPublicError } from "@shared/ipc/result";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LocalSettingsRepository } from "../data/localRepositories";
import type { LocalSettingsSupportRepository } from "../data/localRepositories";
import {
  downloadHcbVaultPackage,
  fetchHcbVaultHostInfo,
  uploadHcbVaultPackage
} from "../hoster/vaultServer";
import type { GoogleSyncRepository } from "../sync/readSyncRepository";
import type { SettingsDomainService, SyncControlDomainService } from "./domainInterfaces";
import { applyMcpSettings } from "./sqliteMcpControlService";

export function createSqliteSettingsDomainService({
  mcpState,
  settingsRepository,
  settingsSupportRepository,
  sync,
  syncRepository
}: {
  mcpState: McpStatusResponse;
  settingsRepository: LocalSettingsRepository;
  settingsSupportRepository: LocalSettingsSupportRepository;
  sync: SyncControlDomainService;
  syncRepository: GoogleSyncRepository;
}): SettingsDomainService {
  return {
    get: () => settingsSupportRepository.applyExternalSettings(settingsRepository.get()),
    update: (request: SettingsUpdateRequest) => {
      let snapshot = settingsSupportRepository.applyExternalSettings(
        settingsRepository.update(request)
      );

      if (snapshot.storageBackend !== "google") {
        settingsRepository.ensureLocalBackendWorkspace();
        snapshot = settingsSupportRepository.applyExternalSettings(settingsRepository.get());
      }

      if (
        request.mcpEnabled !== undefined ||
        request.mcpPermissionMode !== undefined ||
        request.mcpPort !== undefined
      ) {
        applyMcpSettings(mcpState, snapshot);
      }

      return snapshot;
    },
    recoveryAction: async (request: SettingsRecoveryActionRequest) => {
      if (request.action === "refresh") {
        await sync.runNow({ resources: ["tasks", "calendar"], dryRun: false, full: false });
        return {
          action: request.action,
          accepted: true,
          destructive: false,
          requiresReload: false,
          message: "Refresh requested for selected Google resources."
        };
      }

      if (request.action === "forceFullResync") {
        requireRecoveryConfirmation(request, "FULL RESYNC");
        syncRepository.clearAllCheckpoints();
        await sync.runNow({ resources: ["tasks", "calendar"], dryRun: false, full: true });
        return {
          action: request.action,
          accepted: true,
          destructive: true,
          requiresReload: false,
          message: "Sync checkpoints were cleared and a full resync was requested."
        };
      }

      if (request.action === "clearGoogleCache") {
        requireRecoveryConfirmation(request, "CLEAR CACHE");
        syncRepository.clearLocalGoogleCache();
        return {
          action: request.action,
          accepted: true,
          destructive: true,
          requiresReload: true,
          message: "Local Google cache was cleared. Reload to render the empty cache before the next sync."
        };
      }

      if (request.action === "resetOnboarding") {
        settingsRepository.update({ setupCompletedAt: null });
        return {
          action: request.action,
          accepted: true,
          destructive: false,
          requiresReload: false,
          message: "Onboarding will be shown again without changing planner data."
        };
      }

      if (request.action === "backupNow") {
        const backup = settingsRepository.createLocalBackup();
        return {
          action: request.action,
          accepted: true,
          destructive: false,
          requiresReload: false,
          message: `Local backup created at ${backup.path}.`
        };
      }

      if (request.action === "exportPortableArchive") {
        const archive = settingsRepository.exportPortableArchive();
        return {
          action: request.action,
          accepted: true,
          destructive: false,
          requiresReload: false,
          message: `Portable archive exported to ${archive.path}.`
        };
      }

      if (request.action === "resetDuplicateDismissals") {
        settingsRepository.update({ dismissedDuplicateGroupIds: [] });
        return {
          action: request.action,
          accepted: true,
          destructive: false,
          requiresReload: false,
          message: "Duplicate dismissal history was reset."
        };
      }

      if (request.action === "checkForUpdates") {
        settingsRepository.update({ lastUpdateCheckAt: new Date().toISOString() });
        return {
          action: request.action,
          accepted: true,
          destructive: false,
          requiresReload: false,
          message: "Update check timestamp refreshed. GitHub release checks remain handled by the native updater status."
        };
      }

      requireRecoveryConfirmation(request, "RESET MCP TOKEN");
      const reset = settingsRepository.resetMcpTokenRevision();
      mcpState.tokenState = reset.tokenState;
      mcpState.lastTokenResetAt = reset.resetAt;

      return {
        action: request.action,
        accepted: true,
        destructive: true,
        requiresReload: false,
        message: "MCP bearer token was reset without exposing the new token value."
      };
    },
    exportPortableArchive: () => settingsRepository.exportPortableArchive(),
    previewPortableImport: (request: PortableArchivePathRequest) =>
      settingsRepository.previewPortableImport(request.path),
    importPortableArchive: (request: PortableImportRequest) =>
      settingsRepository.importPortableArchive(request.path),
    exportHcbVault: (request: HcbVaultExportRequest) =>
      settingsRepository.exportHcbVault(request),
    importHcbVault: (request: HcbVaultImportRequest) =>
      settingsRepository.importHcbVault(request),
    hcbVaultRemoteStatus: async (request: HcbVaultRemoteStatusRequest) => {
      const parsed = hcbVaultRemoteStatusRequestSchema.parse(request);
      const endpoint = remoteVaultEndpoint(parsed.endpoint, settingsRepository.get().hcbHosterEndpoint);
      const remote = await fetchHcbVaultHostInfo(endpoint, parsed.token, {
        allowInsecureHttp: parsed.allowInsecureHttp === true
      });

      return { endpoint, remote };
    },
    pushHcbVaultRemote: async (request: HcbVaultRemotePushRequest) => {
      const parsed = hcbVaultRemotePushRequestSchema.parse(request);
      const endpoint = remoteVaultEndpoint(parsed.endpoint, settingsRepository.get().hcbHosterEndpoint);
      const exported = settingsRepository.exportHcbVault({
        ...(parsed.out === undefined ? {} : { out: parsed.out }),
        passphrase: parsed.passphrase
      });
      const remote = await uploadHcbVaultPackage(endpoint, parsed.token, exported.path, {
        allowInsecureHttp: parsed.allowInsecureHttp === true
      });
      settingsRepository.update({
        storageBackend: "hcb-hoster",
        hcbHosterEndpoint: endpoint
      });

      return {
        endpoint,
        exportedAt: exported.exportedAt,
        path: exported.path,
        manifest: exported.manifest,
        remote
      };
    },
    pullHcbVaultRemote: async (request: HcbVaultRemotePullRequest) => {
      const parsed = hcbVaultRemotePullRequestSchema.parse(request);
      const endpoint = remoteVaultEndpoint(parsed.endpoint, settingsRepository.get().hcbHosterEndpoint);
      const temporary = temporaryVaultPath("hcb-vault-app-pull-");
      try {
        const pkg = await downloadHcbVaultPackage(endpoint, parsed.token, temporary.path, {
          allowInsecureHttp: parsed.allowInsecureHttp === true
        });
        const imported = settingsRepository.importHcbVault({
          path: temporary.path,
          passphrase: parsed.passphrase
        });
        settingsRepository.update({
          storageBackend: "hcb-hoster",
          hcbHosterEndpoint: endpoint
        });
        const remote = await fetchHcbVaultHostInfo(endpoint, parsed.token, {
          allowInsecureHttp: parsed.allowInsecureHttp === true
        });

        return {
          endpoint,
          importedAt: imported.importedAt,
          backupPath: imported.backupPath,
          manifest: pkg.manifest,
          remote
        };
      } finally {
        rmSync(temporary.dir, { recursive: true, force: true });
      }
    },
    listLocalPointers: (request) => settingsRepository.listLocalPointers(request),
    repairLocalPointer: (request) => settingsRepository.repairLocalPointer(request),
    customizationStatus: () => settingsSupportRepository.customizationStatus(),
    reloadCustomization: () => settingsSupportRepository.reloadCustomization(),
    setSnippetEnabled: (request) => settingsSupportRepository.setSnippetEnabled(request),
    setExtensionEnabled: (request) => settingsSupportRepository.setExtensionEnabled(request),
    logExtensionMessage: (request) => settingsSupportRepository.logExtensionMessage(request),
    listAttachments: (request) => settingsSupportRepository.listAttachments(request),
    addAttachment: (request) => settingsSupportRepository.addAttachment(request),
    removeAttachment: (request) => settingsSupportRepository.removeAttachment(request),
    openAttachment: (request) => settingsSupportRepository.openAttachment(request),
    downloadAttachment: (request) => settingsSupportRepository.downloadAttachment(request),
    importIcs: (request) => settingsSupportRepository.importIcs(request),
    listIcsSubscriptions: () => settingsSupportRepository.listIcsSubscriptions(),
    subscribeIcs: (request) => settingsSupportRepository.subscribeIcs(request),
    refreshIcsSubscription: (request) => settingsSupportRepository.refreshIcsSubscription(request),
    deleteIcsSubscription: (request) => settingsSupportRepository.deleteIcsSubscription(request),
    exportLocalReport: (request) => settingsSupportRepository.exportLocalReport(request)
  };
}

function requireRecoveryConfirmation(
  request: SettingsRecoveryActionRequest,
  phrase: string
): void {
  if (request.confirmation?.accepted === true && request.confirmation.phrase === phrase) {
    return;
  }

  throw new HcbPublicError({
    code: "VALIDATION_ERROR",
    message: `Type ${phrase} to confirm this destructive recovery action.`,
    recoverable: true
  });
}

function remoteVaultEndpoint(endpoint: string | undefined, fallback: string | null): string {
  const resolved = endpoint ?? fallback ?? "";
  if (!resolved) {
    throw new HcbPublicError({
      code: "VALIDATION_ERROR",
      message: "Configure an HCB vault host endpoint first.",
      recoverable: true
    });
  }

  return resolved;
}

function temporaryVaultPath(prefix: string): { dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return { dir, path: join(dir, "vault.hcbvault") };
}
