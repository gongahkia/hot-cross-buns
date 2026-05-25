import type {
  DiagnosticsSummaryResponse,
  SettingsRecoveryActionRequest,
  SettingsSnapshot
} from "@shared/ipc/contracts";
import { Copy, Download, Info } from "lucide-react";
import { Button } from "../../../../components/primitives";
import { SettingsControlRow, SettingsGroup, SettingsSwitch } from "./SettingsPrimitives";

interface AboutSettingsTabProps {
  beginRecoveryAction: (action: SettingsRecoveryActionRequest["action"]) => void;
  diagnostics?: DiagnosticsSummaryResponse;
  settings: SettingsSnapshot;
  updateSettings: (request: { lastUpdateCheckAt?: string | null }) => void;
}

export function AboutSettingsTab({
  beginRecoveryAction,
  diagnostics,
  settings,
  updateSettings
}: AboutSettingsTabProps): JSX.Element {
  const build = diagnostics?.build;
  const version = build?.version ?? "0.0.0";
  const commit = build?.commit ?? "Not recorded";
  const environment = build?.environment ?? "development";
  const versionInfo = [
    "Hot Cross Buns 2",
    `Version: ${version}`,
    `Build: ${commit}`,
    `Environment: ${environment}`
  ].join("\n");

  function copyVersionInfo(): void {
    void navigator.clipboard?.writeText(versionInfo);
  }

  return (
    <div className="grid gap-5">
      <SettingsGroup title="Updates">
        <SettingsSwitch
          checked={settings.lastUpdateCheckAt !== null}
          label="Check GitHub releases automatically"
          onChange={(checked) =>
            updateSettings({ lastUpdateCheckAt: checked ? new Date().toISOString() : null })
          }
        />
        <SettingsControlRow
          description="Checks release metadata through the native updater status path."
          icon={Download}
          label="Manual check"
        >
          <Button onClick={() => beginRecoveryAction("checkForUpdates")} variant="secondary">
            <Download aria-hidden="true" size={14} />
            Check for Updates Now
          </Button>
        </SettingsControlRow>
        <SettingsControlRow label="Last checked">
          <span className="text-[var(--text-sm)] text-text-muted">
            {settings.lastUpdateCheckAt ?? "Never"}
          </span>
        </SettingsControlRow>
      </SettingsGroup>

      <SettingsGroup title="About">
        <SettingsControlRow icon={Info} label="App">
          <span className="text-[var(--text-md)] font-semibold text-text-secondary">Hot Cross Buns</span>
        </SettingsControlRow>
        <SettingsControlRow label="Version">
          <span className="font-mono text-[var(--text-sm)] text-text-muted">{version}</span>
        </SettingsControlRow>
        <SettingsControlRow label="Build">
          <span className="font-mono text-[var(--text-sm)] text-text-muted">{commit}</span>
        </SettingsControlRow>
        <SettingsControlRow label="Bundle ID">
          <span className="font-mono text-[var(--text-sm)] text-text-muted">
            com.gongahkia.hotcrossbuns.mac
          </span>
        </SettingsControlRow>
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
