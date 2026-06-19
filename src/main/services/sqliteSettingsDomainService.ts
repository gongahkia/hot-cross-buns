import type {
  HcbVaultExportRequest,
  HcbVaultImportRequest,
  HcbVaultRemoteCredentialDeleteRequest,
  HcbVaultRemoteCredentialSaveRequest,
  HcbVaultRemoteCredentialStatusRequest,
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
  hcbVaultRemoteStatusRequestSchema,
  hcbVaultRemoteCredentialDeleteRequestSchema,
  hcbVaultRemoteCredentialSaveRequestSchema,
  hcbVaultRemoteCredentialStatusRequestSchema
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
import type {
  HcbVaultHostCredentials,
  HcbVaultHostCredentialStore
} from "../hoster/vaultCredentials";
import type { GoogleSyncRepository } from "../sync/readSyncRepository";
import type { SettingsDomainService, SyncControlDomainService } from "./domainInterfaces";
import { applyMcpSettings } from "./sqliteMcpControlService";

export function createSqliteSettingsDomainService({
  mcpState,
  settingsRepository,
  settingsSupportRepository,
  sync,
  syncRepository,
  vaultHostCredentials
}: {
  mcpState: McpStatusResponse;
  settingsRepository: LocalSettingsRepository;
  settingsSupportRepository: LocalSettingsSupportRepository;
  sync: SyncControlDomainService;
  syncRepository: GoogleSyncRepository;
  vaultHostCredentials?: HcbVaultHostCredentialStore;
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
      const credentials = await resolveVaultHostCredentials({
        endpoint,
        token: parsed.token,
        vaultHostCredentials,
        requirePassphrase: false
      });
      const remote = await fetchHcbVaultHostInfo(endpoint, credentials.token, {
        allowInsecureHttp: parsed.allowInsecureHttp === true
      });

      return { endpoint, remote };
    },
    pushHcbVaultRemote: async (request: HcbVaultRemotePushRequest) => {
      const parsed = hcbVaultRemotePushRequestSchema.parse(request);
      const endpoint = remoteVaultEndpoint(parsed.endpoint, settingsRepository.get().hcbHosterEndpoint);
      const credentials = await resolveVaultHostCredentials({
        endpoint,
        token: parsed.token,
        passphrase: parsed.passphrase,
        vaultHostCredentials,
        requirePassphrase: true
      });
      const exported = settingsRepository.exportHcbVault({
        ...(parsed.out === undefined ? {} : { out: parsed.out }),
        passphrase: credentials.passphrase
      });
      const remote = await uploadHcbVaultPackage(endpoint, credentials.token, exported.path, {
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
      const credentials = await resolveVaultHostCredentials({
        endpoint,
        token: parsed.token,
        passphrase: parsed.passphrase,
        vaultHostCredentials,
        requirePassphrase: true
      });
      const temporary = temporaryVaultPath("hcb-vault-app-pull-");
      try {
        const pkg = await downloadHcbVaultPackage(endpoint, credentials.token, temporary.path, {
          allowInsecureHttp: parsed.allowInsecureHttp === true
        });
        const imported = settingsRepository.importHcbVault({
          path: temporary.path,
          passphrase: credentials.passphrase
        });
        settingsRepository.update({
          storageBackend: "hcb-hoster",
          hcbHosterEndpoint: endpoint
        });
        const remote = await fetchHcbVaultHostInfo(endpoint, credentials.token, {
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
    hcbVaultRemoteCredentialStatus: async (request: HcbVaultRemoteCredentialStatusRequest) => {
      const parsed = hcbVaultRemoteCredentialStatusRequestSchema.parse(request);
      const endpoint = optionalRemoteVaultEndpoint(parsed.endpoint, settingsRepository.get().hcbHosterEndpoint);
      return credentialStatus(endpoint, vaultHostCredentials);
    },
    saveHcbVaultRemoteCredentials: async (request: HcbVaultRemoteCredentialSaveRequest) => {
      const parsed = hcbVaultRemoteCredentialSaveRequestSchema.parse(request);
      const endpoint = remoteVaultEndpoint(parsed.endpoint, settingsRepository.get().hcbHosterEndpoint);
      const store = requireVaultHostCredentialStore(vaultHostCredentials);
      await store.write({
        endpoint,
        token: parsed.token,
        passphrase: parsed.passphrase
      });
      settingsRepository.update({
        storageBackend: "hcb-hoster",
        hcbHosterEndpoint: endpoint
      });
      return credentialStatus(endpoint, vaultHostCredentials);
    },
    deleteHcbVaultRemoteCredentials: async (request: HcbVaultRemoteCredentialDeleteRequest) => {
      const parsed = hcbVaultRemoteCredentialDeleteRequestSchema.parse(request);
      const endpoint = remoteVaultEndpoint(parsed.endpoint, settingsRepository.get().hcbHosterEndpoint);
      const store = requireVaultHostCredentialStore(vaultHostCredentials);
      await store.delete(endpoint);
      return credentialStatus(endpoint, vaultHostCredentials);
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

function optionalRemoteVaultEndpoint(endpoint: string | undefined, fallback: string | null): string | null {
  const resolved = endpoint ?? fallback ?? "";
  return resolved || null;
}

function requireVaultHostCredentialStore(
  vaultHostCredentials: HcbVaultHostCredentialStore | undefined
): HcbVaultHostCredentialStore {
  if (!vaultHostCredentials) {
    throw new HcbPublicError({
      code: "VALIDATION_ERROR",
      message: "HCB vault host credential storage is unavailable.",
      recoverable: true
    });
  }

  return vaultHostCredentials;
}

async function credentialStatus(
  endpoint: string | null,
  vaultHostCredentials: HcbVaultHostCredentialStore | undefined
) {
  const rawSecretStore = vaultHostCredentials?.status() ?? {
    ok: false,
    state: "unsupported",
    message: "HCB vault host credential storage is unavailable."
  };
  const secretStore = {
    ok: rawSecretStore.ok,
    state: rawSecretStore.state ?? (rawSecretStore.ok ? "ready" : "unsupported"),
    ...(rawSecretStore.message === undefined ? {} : { message: rawSecretStore.message })
  };

  if (!endpoint || !vaultHostCredentials || !secretStore.ok) {
    return {
      endpoint,
      configured: false,
      secretStore
    };
  }

  const credentials = await vaultHostCredentials.read(endpoint);
  return {
    endpoint,
    configured: credentials !== null,
    secretStore
  };
}

async function resolveVaultHostCredentials(input: {
  endpoint: string;
  token?: string;
  passphrase?: string;
  vaultHostCredentials?: HcbVaultHostCredentialStore;
  requirePassphrase: boolean;
}): Promise<Pick<HcbVaultHostCredentials, "token" | "passphrase">> {
  if (input.token && (!input.requirePassphrase || input.passphrase)) {
    return {
      token: input.token,
      passphrase: input.passphrase ?? ""
    };
  }

  const saved = input.vaultHostCredentials
    ? await input.vaultHostCredentials.read(input.endpoint)
    : null;
  const token = input.token ?? saved?.token;
  const passphrase = input.passphrase ?? saved?.passphrase;

  if (!token || (input.requirePassphrase && !passphrase)) {
    throw new HcbPublicError({
      code: "VALIDATION_ERROR",
      message: input.requirePassphrase
        ? "Enter or save the HCB vault host token and vault passphrase."
        : "Enter or save the HCB vault host token.",
      recoverable: true
    });
  }

  return {
    token,
    passphrase: passphrase ?? ""
  };
}

function temporaryVaultPath(prefix: string): { dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return { dir, path: join(dir, "vault.hcbvault") };
}
