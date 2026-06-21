import type { McpSetEnabledRequest, McpStatusResponse, SettingsSnapshot } from "@shared/ipc/contracts";
import type { LocalSettingsRepository } from "../data/localRepositories";
import type { McpControlDomainService } from "./domainInterfaces";

export function createInitialMcpState(settingsRepository: LocalSettingsRepository): McpStatusResponse {
  const initialSettings = settingsRepository.get();
  const initialMcpTokenState = settingsRepository.mcpTokenState();

  return {
    enabled: initialSettings.mcpEnabled,
    running: false,
    readOnly: initialSettings.mcpPermissionMode === "read-only",
    confirmationRequired: initialSettings.mcpPermissionMode !== "allow-writes",
    permissionMode: initialSettings.mcpPermissionMode,
    port: initialSettings.mcpPort,
    tokenState: initialMcpTokenState.tokenState,
    ...(initialMcpTokenState.lastTokenResetAt === undefined
      ? {}
      : { lastTokenResetAt: initialMcpTokenState.lastTokenResetAt }),
    url: "http://127.0.0.1"
  };
}

export function createSqliteMcpControlService({
  mcpState,
  settingsRepository
}: {
  mcpState: McpStatusResponse;
  settingsRepository: LocalSettingsRepository;
}): McpControlDomainService {
  return {
    status: () => ({ ...mcpState }),
    setEnabled: (request: McpSetEnabledRequest) => {
      const permissionMode =
        request.permissionMode ??
        (request.confirmationRequired === false
          ? "allow-writes"
          : mcpState.permissionMode);
      const snapshot = settingsRepository.update({
        mcpEnabled: request.enabled,
        mcpPermissionMode: permissionMode,
        ...(request.port === undefined ? {} : { mcpPort: request.port })
      });
      applyMcpSettings(mcpState, snapshot);

      return { ...mcpState };
    }
  };
}

export function applyMcpSettings(mcpState: McpStatusResponse, settings: SettingsSnapshot): void {
  mcpState.enabled = settings.mcpEnabled;
  mcpState.permissionMode = settings.mcpPermissionMode;
  mcpState.readOnly = settings.mcpPermissionMode === "read-only";
  mcpState.confirmationRequired = settings.mcpPermissionMode !== "allow-writes";
  mcpState.port = settings.mcpPort;
}
