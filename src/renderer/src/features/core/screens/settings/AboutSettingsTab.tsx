import { useState } from "react";
import type {
  DiagnosticsSummaryResponse,
  NativeUpdaterStatus,
  SettingsRecoveryActionRequest,
  SettingsSnapshot
} from "@shared/ipc/contracts";
import { Copy, Download, ExternalLink } from "@renderer/components/icons";
import { Badge, Button } from "../../../../components/primitives";
import { SettingsControlRow, SettingsGroup, SettingsSwitch } from "./SettingsPrimitives";

interface AboutSettingsTabProps {
  browserRuntime?: boolean;
  beginRecoveryAction: (action: SettingsRecoveryActionRequest["action"]) => void;
  diagnostics?: DiagnosticsSummaryResponse;
  nativeUpdaterStatus: NativeUpdaterStatus;
  settings: SettingsSnapshot;
  updateSettings: (request: { lastUpdateCheckAt?: string | null }) => void;
}

export function AboutSettingsTab({
  browserRuntime = false,
  beginRecoveryAction,
  diagnostics,
  nativeUpdaterStatus,
  settings,
  updateSettings
}: AboutSettingsTabProps): JSX.Element {
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const build = diagnostics?.build;
  const version = build?.version ?? "0.0.0";
  const commit = build?.commit ?? "Not recorded";
  const environment = build?.environment ?? "development";
  const versionInfo = [
    "Hot Cross Buns",
    `Version: ${version}`,
    `Build: ${commit}`,
    `Environment: ${environment}`
  ].join("\n");

  async function copyVersionInfo(): Promise<void> {
    const result = await window.hcb?.native.writeClipboardText({ text: versionInfo });
    setActionMessage(result?.ok ? "Version information copied." : result?.error.message ?? "Clipboard access is unavailable in this browser.");
  }

  async function openExternalUrl(url: string): Promise<void> {
    const result = await window.hcb?.native.openExternalUrl({ url });
    if (result && !result.ok) setActionMessage(result.error.message);
  }

  return (
    <div className="grid gap-5">
      {actionMessage ? <p role="status" className="text-sm text-text-secondary">{actionMessage}</p> : null}
      {browserRuntime ? <SettingsGroup title="Updates"><p className="px-3 py-3 text-sm text-text-secondary">When an update is ready, close all Hot Cross Buns tabs, then reopen the app to use it. Check offline and update readiness in Data. Your saved workspace stays in this browser.</p></SettingsGroup> : <SettingsGroup title="Updates">
        <SettingsSwitch
          checked={settings.lastUpdateCheckAt !== null}
          label="Check GitHub releases automatically"
          onChange={(checked) =>
            updateSettings({ lastUpdateCheckAt: checked ? new Date().toISOString() : null })
          }
        />
        <SettingsControlRow
          description="Checks release metadata through the native updater status path."
          label="Manual check"
        >
          <Button onClick={() => beginRecoveryAction("checkForUpdates")} variant="secondary">
            <Download aria-hidden="true" size={14} />
            Check for Updates Now
          </Button>
        </SettingsControlRow>
        <SettingsControlRow label="Update status">
          <span className="flex flex-wrap items-center justify-end gap-2 text-[var(--text-sm)] text-text-muted">
            <Badge tone={nativeUpdaterStatus.updateAvailable ? "warning" : nativeUpdaterStatus.state === "error" ? "danger" : "success"}>
              {nativeUpdaterStatus.updateAvailable ? "Update available" : nativeUpdaterStatus.state}
            </Badge>
            {nativeUpdaterStatus.message ?? "No update status reported"}
          </span>
        </SettingsControlRow>
        {nativeUpdaterStatus.latestVersion ? (
          <SettingsControlRow label="Latest release">
            <span className="text-[var(--text-sm)] text-text-muted">
              {nativeUpdaterStatus.releaseName ?? nativeUpdaterStatus.latestVersion}
            </span>
          </SettingsControlRow>
        ) : null}
        {nativeUpdaterStatus.releaseUrl || nativeUpdaterStatus.downloadUrl ? (
          <SettingsControlRow label="Release actions">
            <div className="flex flex-wrap justify-end gap-2">
              {nativeUpdaterStatus.releaseUrl ? (
                <Button onClick={() => openExternalUrl(nativeUpdaterStatus.releaseUrl as string)} size="sm" variant="secondary">
                  <ExternalLink aria-hidden="true" size={14} />
                  Open release
                </Button>
              ) : null}
              {nativeUpdaterStatus.downloadUrl ? (
                <Button onClick={() => openExternalUrl(nativeUpdaterStatus.downloadUrl as string)} size="sm" variant="secondary">
                  <Download aria-hidden="true" size={14} />
                  Open download
                </Button>
              ) : null}
            </div>
          </SettingsControlRow>
        ) : null}
        <SettingsControlRow label="Last checked">
          <span className="text-[var(--text-sm)] text-text-muted">
            {nativeUpdaterStatus.checkedAt ?? settings.lastUpdateCheckAt ?? "Never"}
          </span>
        </SettingsControlRow>
      </SettingsGroup>}

      <SettingsGroup title="About">
        <SettingsControlRow label="App">
          <span className="text-[var(--text-md)] font-semibold text-text-secondary">Hot Cross Buns</span>
        </SettingsControlRow>
        <SettingsControlRow label="Version">
          <span className="font-mono text-[var(--text-sm)] text-text-muted">{version}</span>
        </SettingsControlRow>
        <SettingsControlRow label="Build">
          <span className="font-mono text-[var(--text-sm)] text-text-muted">{commit}</span>
        </SettingsControlRow>
        {!browserRuntime ? <SettingsControlRow label="Bundle ID">
          <span className="font-mono text-[var(--text-sm)] text-text-muted">
            com.gongahkia.hotcrossbuns.mac
          </span>
        </SettingsControlRow> : <SettingsControlRow label="Site"><span className="font-mono text-sm">{window.location.origin}</span></SettingsControlRow>}
        <SettingsControlRow label="Copy version info">
          <Button onClick={copyVersionInfo} variant="secondary">
            <Copy aria-hidden="true" size={14} />
            Copy version info
          </Button>
        </SettingsControlRow>
      </SettingsGroup>
    </div>
  );
}
