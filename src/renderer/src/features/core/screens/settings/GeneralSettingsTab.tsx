import { Select, SelectItem } from "@renderer/components/Select";
import type {
  SettingsRecoveryActionRequest,
  SettingsSnapshot,
  SettingsUpdateRequest
} from "@shared/ipc/contracts";
import {
  FileSearch,
  Languages,
  Power,
  RotateCcw,
  ShieldCheck,
  Sparkles
} from "lucide-react";
import { Button, Input } from "../../../../components/primitives";
import { languageOptions, useI18n } from "../../../../i18n";
import {
  SettingsControlRow,
  SettingsGroup,
  SettingsSwitch,
  settingsSelectClass
} from "./SettingsPrimitives";
import { retentionOptions } from "./settingsUtils";

interface GeneralSettingsTabProps {
  browserRuntime?: boolean;
  beginRecoveryAction: (action: SettingsRecoveryActionRequest["action"]) => void;
  customRetentionAmount: string;
  customRetentionUnit: "days" | "months" | "years";
  openDiagnosticsDetails: () => Promise<void>;
  setCustomRetentionAmount: (value: string) => void;
  setCustomRetentionUnit: (value: "days" | "months" | "years") => void;
  settings: SettingsSnapshot;
  settingsMutationPending: boolean;
  updateSettings: (request: SettingsUpdateRequest) => void;
}

export function GeneralSettingsTab({
  browserRuntime = false,
  beginRecoveryAction,
  customRetentionAmount,
  customRetentionUnit,
  openDiagnosticsDetails,
  setCustomRetentionAmount,
  setCustomRetentionUnit,
  settings,
  settingsMutationPending,
  updateSettings
}: GeneralSettingsTabProps): JSX.Element {
  const { t } = useI18n();

  function retentionPresetValue(daysBack: number): string {
    return retentionOptions.some((option) => option.value === daysBack) ? String(daysBack) : "custom";
  }

  function customRetentionDays(): number {
    const amount = Math.max(1, Math.round(Number(customRetentionAmount) || 1));

    if (customRetentionUnit === "years") {
      return Math.min(3650, amount * 365);
    }

    if (customRetentionUnit === "months") {
      return Math.min(3650, amount * 30);
    }

    return Math.min(3650, amount);
  }

  function applyCustomRetention(): void {
    const days = customRetentionDays();

    updateSettings({
      eventRetentionDaysBack: days,
      completedTaskRetentionDaysBack: days
    });
  }

  return (
    <div className="grid gap-5">
      <SettingsGroup title={t("settings.language")}>
        <SettingsControlRow
          description={t("language.description")}
          icon={Languages}
          label={t("settings.appLanguage")}
        >
          <Select
            aria-label={t("settings.appLanguage")}
            className={settingsSelectClass}
            onValueChange={(value) =>
              updateSettings({ appLanguage: value as SettingsSnapshot["appLanguage"] })
            }
            value={settings.appLanguage}
          >
            {languageOptions(t).map((option) => (
              <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
            ))}
          </Select>
        </SettingsControlRow>
      </SettingsGroup>

      {!browserRuntime ? <SettingsGroup title="Startup">
        <SettingsSwitch
          checked={settings.startOnLogin}
          description="Starts the app automatically when you sign in to this Mac."
          icon={Power}
          label="Open Hot Cross Buns at login"
          onChange={(checked) => updateSettings({ startOnLogin: checked })}
        />
      </SettingsGroup> : null}

      <SettingsGroup title={t("diagnostics.title")}>
        <SettingsControlRow
          description={t("diagnostics.description")}
          icon={ShieldCheck}
          label={t("diagnostics.title")}
        >
          <Button onClick={() => void openDiagnosticsDetails()} variant="secondary">
            <FileSearch aria-hidden="true" size={14} />
            {t("action.viewDiagnostics")}
          </Button>
        </SettingsControlRow>
        <SettingsSwitch
          checked={settings.diagnosticsIncludePerformance}
          description={t("diagnostics.includePerformance.description")}
          label={t("diagnostics.includePerformance")}
          onChange={(checked) => updateSettings({ diagnosticsIncludePerformance: checked })}
        />
      </SettingsGroup>

      <SettingsGroup title="Sync">
        <SettingsControlRow
          description="Sync runs while HCB is open and your Google session is connected. Manual syncs only when you refresh. Balanced refreshes every 5 minutes; Near real-time every 30 seconds. Both automatic modes send edits shortly after you make them."
          label="Mode"
        >
          <Select
            aria-label="Sync mode"
            className={settingsSelectClass}
            onValueChange={(value) =>
              updateSettings({ syncMode: value as SettingsSnapshot["syncMode"] })
            }
            value={settings.syncMode}
          >
            <SelectItem value="manual">Manual</SelectItem>
            <SelectItem value="balanced">Balanced</SelectItem>
            <SelectItem value="near-real-time">Near real-time</SelectItem>
          </Select>
        </SettingsControlRow>
        <SettingsControlRow label="Keep past events">
          <Select
            aria-label="Keep past events"
            className={settingsSelectClass}
            onValueChange={(value) => {
              if (value !== "custom") {
                updateSettings({ eventRetentionDaysBack: Number(value) });
              }
            }}
            value={retentionPresetValue(settings.eventRetentionDaysBack)}
          >
            {retentionOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
            <SelectItem value="custom">Custom</SelectItem>
          </Select>
        </SettingsControlRow>
        <SettingsControlRow label="Keep completed tasks">
          <Select
            aria-label="Keep completed tasks"
            className={settingsSelectClass}
            onValueChange={(value) => {
              if (value !== "custom") {
                updateSettings({ completedTaskRetentionDaysBack: Number(value) });
              }
            }}
            value={retentionPresetValue(settings.completedTaskRetentionDaysBack)}
          >
            {retentionOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
            <SelectItem value="custom">Custom</SelectItem>
          </Select>
        </SettingsControlRow>
        <SettingsControlRow
          description="Applies the same retention window to past events and completed tasks."
          label="Custom"
        >
          <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
            <Input
              aria-label="Custom retention amount"
              className="w-24"
              min={1}
              onChange={(event) => setCustomRetentionAmount(event.currentTarget.value)}
              type="number"
              value={customRetentionAmount}
            />
            <Select
              aria-label="Custom retention unit"
              className={settingsSelectClass}
              onValueChange={(value) => setCustomRetentionUnit(value as "days" | "months" | "years")}
              value={customRetentionUnit}
            >
              <SelectItem value="days">Days</SelectItem>
              <SelectItem value="months">Months</SelectItem>
              <SelectItem value="years">Years</SelectItem>
            </Select>
            <Button onClick={applyCustomRetention} variant="primary">Apply</Button>
          </div>
        </SettingsControlRow>
        <div className="flex flex-wrap items-center gap-2 px-3 py-3">
          <Button onClick={() => beginRecoveryAction("refresh")} variant="secondary">
            <RotateCcw aria-hidden="true" size={14} />
            Refresh
          </Button>
          <Button onClick={() => beginRecoveryAction("forceFullResync")} variant="danger">
            Force full resync
          </Button>
        </div>
      </SettingsGroup>

      <SettingsGroup title="Setup">
        <SettingsControlRow
          description="Google is required. Reopen setup to reconnect Google or change its sync preferences."
          icon={Sparkles}
          label="Setup assistant"
        >
          <Button onClick={() => beginRecoveryAction("resetOnboarding")} variant="secondary">
            Run setup again
          </Button>
        </SettingsControlRow>
      </SettingsGroup>
    </div>
  );
}
