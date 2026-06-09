import type {
  McpStatusResponse,
  PortableArchivePathRequest,
  PortableImportRequest,
  SettingsRecoveryActionRequest,
  SettingsUpdateRequest
} from "@shared/ipc/contracts";
import { HcbPublicError } from "@shared/ipc/result";
import type { LocalSettingsRepository } from "../data/localRepositories";
import type { GoogleSyncRepository } from "../sync/readSyncRepository";
import type { SettingsDomainService, SyncControlDomainService } from "./domainInterfaces";
import { applyMcpSettings } from "./sqliteMcpControlService";

export function createSqliteSettingsDomainService({
  mcpState,
  settingsRepository,
  sync,
  syncRepository
}: {
  mcpState: McpStatusResponse;
  settingsRepository: LocalSettingsRepository;
  sync: SyncControlDomainService;
  syncRepository: GoogleSyncRepository;
}): SettingsDomainService {
  return {
    get: () => settingsRepository.get(),
    update: (request: SettingsUpdateRequest) => {
      const snapshot = settingsRepository.update(request);

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
      settingsRepository.importPortableArchive(request.path)
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
