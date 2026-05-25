import { useEffect, useMemo, useRef, useState } from "react";
import type {
  SettingsRecoveryActionRequest,
  SettingsSnapshot,
  SettingsUpdateRequest
} from "@shared/ipc/contracts";
import {
  appColorThemes,
  defaultAppColorTheme,
  resolveAppColorTheme,
  resolveAppThemeMode
} from "@shared/ipc/themeCatalog";
import { Bell, Brush, Copy, Info, Keyboard, Search, Settings2, SlidersHorizontal, Users } from "lucide-react";
import { useInspector } from "../../../../components/Inspector";
import { Button, Input, Panel, StatusBanner } from "../../../../components/primitives";
import { useCoreViewModelSource } from "../../coreViewModelSource";
import {
  currentSystemPrefersDark,
  fontFamilyOptions,
  sanitizedJson
} from "../../coreScreenShared";
import { AppearanceSettingsTab } from "./AppearanceSettingsTab";
import { AboutSettingsTab } from "./AboutSettingsTab";
import { AdvancedSettingsTab } from "./AdvancedSettingsTab";
import { AlertsSettingsTab } from "./AlertsSettingsTab";
import { GeneralSettingsTab } from "./GeneralSettingsTab";
import { HotkeysSettingsTab } from "./HotkeysSettingsTab";
import { ProfileSettingsTab } from "./ProfileSettingsTab";
import { SettingsTabButton } from "./SettingsPrimitives";
import { recoveryPhrase } from "./settingsUtils";

type SettingsTabId = "general" | "profile" | "appearance" | "hotkeys" | "alerts" | "advanced" | "about";

export function SettingsView({
  onOpenDiagnostics
}: {
  onOpenDiagnostics?: () => void;
} = {}): JSX.Element {
  const source = useCoreViewModelSource();
  const { open: openInspector } = useInspector();
  const [confirmation, setConfirmation] = useState<{
    action: SettingsRecoveryActionRequest["action"];
    phrase: string;
  } | null>(null);
  const [confirmationInput, setConfirmationInput] = useState("");
  const [recoveryMessage, setRecoveryMessage] = useState<string | null>(null);
  const [selectedSettingsTab, setSelectedSettingsTab] = useState<SettingsTabId>("general");
  const [settingsQuery, setSettingsQuery] = useState("");
  const [customRetentionAmount, setCustomRetentionAmount] = useState("60");
  const [customRetentionUnit, setCustomRetentionUnit] = useState<"days" | "months" | "years">("days");
  const settings = source.settings;
  const diagnostics = source.diagnosticsSummary;
  const googleStatus = source.googleStatus;
  const effectiveThemeMode = resolveAppThemeMode(settings.theme, currentSystemPrefersDark());
  const matchingColorThemes = appColorThemes.filter(
    (theme) => theme.isDark === (effectiveThemeMode === "dark")
  );
  const activeColorTheme = resolveAppColorTheme(settings.colorTheme, effectiveThemeMode);
  const [googleClientId, setGoogleClientId] = useState(googleStatus.clientId ?? "");
  const [googleClientSecret, setGoogleClientSecret] = useState("");
  const [systemFontFamilies, setSystemFontFamilies] = useState<string[]>([]);
  const systemFontFamiliesRequested = useRef(false);
  const availableFontFamilies = useMemo(
    () => fontFamilyOptions(systemFontFamilies, settings.uiFontName),
    [settings.uiFontName, systemFontFamilies]
  );

  useEffect(() => {
    setGoogleClientId(googleStatus.clientId ?? "");
  }, [googleStatus.clientId]);

  useEffect(() => {
    if (selectedSettingsTab !== "appearance" || systemFontFamiliesRequested.current || !window.hcb) {
      return;
    }

    systemFontFamiliesRequested.current = true;
    void window.hcb.native.listFontFamilies().then((result) => {
      if (result.ok) {
        setSystemFontFamilies(result.data.families);
      }
    });
  }, [selectedSettingsTab]);

  function updateSettings(request: SettingsUpdateRequest): void {
    setRecoveryMessage(null);
    void source.updateSettings(request);
  }

  function updateBaseTheme(theme: SettingsSnapshot["theme"]): void {
    const nextMode = resolveAppThemeMode(theme, currentSystemPrefersDark());
    const currentColorTheme = resolveAppColorTheme(settings.colorTheme, effectiveThemeMode);
    const nextColorTheme = currentColorTheme.isDark === (nextMode === "dark")
      ? currentColorTheme
      : defaultAppColorTheme(nextMode);

    updateSettings({
      theme,
      colorTheme: nextColorTheme.id
    });
  }

  function updateSelectedTaskList(taskListId: string, selected: boolean): void {
    const current = new Set(settings.selectedTaskListIds.length > 0
      ? settings.selectedTaskListIds
      : source.taskLists.map((taskList) => taskList.id));

    if (selected) {
      current.add(taskListId);
    } else {
      current.delete(taskListId);
    }

    updateSettings({ selectedTaskListIds: [...current] });
  }

  function updateSelectedCalendar(calendarId: string, selected: boolean): void {
    const current = new Set(settings.selectedCalendarIds.length > 0
      ? settings.selectedCalendarIds
      : source.calendarSources.filter((calendar) => calendar.selected).map((calendar) => calendar.id));

    if (selected) {
      current.add(calendarId);
    } else {
      current.delete(calendarId);
    }

    updateSettings({ selectedCalendarIds: [...current] });
  }

  function beginRecoveryAction(action: SettingsRecoveryActionRequest["action"]): void {
    if (action === "refresh" || action === "resetOnboarding") {
      void runRecovery({ action });
      return;
    }

    setConfirmation({ action, phrase: recoveryPhrase(action) });
    setConfirmationInput("");
  }

  async function runRecovery(request: SettingsRecoveryActionRequest): Promise<void> {
    const result = await source.runRecoveryAction(request);

    if (result) {
      setRecoveryMessage(result.message);
      setConfirmation(null);
      setConfirmationInput("");
    }
  }

  function confirmRecoveryAction(): void {
    if (!confirmation || confirmationInput !== confirmation.phrase) {
      return;
    }

    void runRecovery({
      action: confirmation.action,
      confirmation: {
        accepted: true,
        phrase: confirmationInput
      }
    });
  }

  function copyDiagnosticsPayload(payload: string): void {
    void navigator.clipboard?.writeText(payload);
    setRecoveryMessage("Diagnostics summary copied without credentials, raw Google payloads, MCP bearer tokens, or sensitive bodies.");
  }

  async function openDiagnosticsDetails(): Promise<void> {
    if (onOpenDiagnostics) {
      onOpenDiagnostics();
      return;
    }

    const summaryResult = diagnostics ? null : await window.hcb?.diagnostics.summary();
    const freshDiagnostics = diagnostics ?? (summaryResult?.ok ? summaryResult.data : null);
    const payload = sanitizedJson(freshDiagnostics ?? { rows: source.settingsSections[0]?.rows ?? [] });

    openInspector({
      actions: (
        <Button onClick={() => copyDiagnosticsPayload(payload)} size="sm" variant="primary">
          <Copy aria-hidden="true" size={14} />
          Copy
        </Button>
      ),
      body: (
        <pre
          aria-label="Sanitized diagnostics JSON"
          className="max-h-[70vh] overflow-auto whitespace-pre-wrap rounded-hcbMd border border-border bg-surface-0 p-3 font-mono text-[var(--text-xs)] text-text-primary"
        >
          {payload}
        </pre>
      ),
      id: "diagnostics-summary",
      kind: "diagnostics",
      subtitle: "Sanitized JSON",
      title: "Diagnostics details"
    });
  }

  async function saveGoogleOAuthClient(): Promise<void> {
    setRecoveryMessage(null);

    if (!window.hcb) {
      return;
    }

    const request =
      googleClientSecret.trim().length > 0
        ? { clientId: googleClientId, clientSecret: googleClientSecret.trim() }
        : { clientId: googleClientId };
    const result = await window.hcb.google.saveOAuthClient(request);

    if (result.ok) {
      setGoogleClientSecret("");
      setRecoveryMessage("Google OAuth client configuration saved.");
      source.setGoogleStatus(result.data);
      return;
    }

    setRecoveryMessage(result.error.message);
  }

  async function beginGoogleOAuth(): Promise<void> {
    setRecoveryMessage(null);

    const result = await window.hcb?.google.beginOAuth();

    if (result?.ok) {
      setRecoveryMessage(result.data.message);
      source.refreshGoogleStatus();
      for (const delayMs of [2_000, 5_000, 10_000]) {
        window.setTimeout(() => source.refreshGoogleStatus(), delayMs);
      }
      return;
    }

    if (result && !result.ok) {
      setRecoveryMessage(result.error.message);
    }
  }

  async function disconnectGoogle(): Promise<void> {
    setRecoveryMessage(null);

    const result = await window.hcb?.google.disconnect();

    if (result?.ok) {
      setRecoveryMessage("Google account disconnected.");
      source.setGoogleStatus(result.data);
      return;
    }

    if (result && !result.ok) {
      setRecoveryMessage(result.error.message);
    }
  }

  return (
    <div className="grid min-h-0 gap-3">
      <div className="flex min-w-0 items-center gap-1 overflow-x-auto border-b border-border pb-2">
        <SettingsTabButton
          active={selectedSettingsTab === "general"}
          icon={Settings2}
          label="General"
          onClick={() => setSelectedSettingsTab("general")}
        />
        <SettingsTabButton
          active={selectedSettingsTab === "profile"}
          icon={Users}
          label="Profile"
          onClick={() => setSelectedSettingsTab("profile")}
        />
        <SettingsTabButton
          active={selectedSettingsTab === "appearance"}
          icon={Brush}
          label="Appearance"
          onClick={() => setSelectedSettingsTab("appearance")}
        />
        <SettingsTabButton
          active={selectedSettingsTab === "hotkeys"}
          icon={Keyboard}
          label="Hotkeys"
          onClick={() => setSelectedSettingsTab("hotkeys")}
        />
        <SettingsTabButton
          active={selectedSettingsTab === "alerts"}
          icon={Bell}
          label="Alerts"
          onClick={() => setSelectedSettingsTab("alerts")}
        />
        <SettingsTabButton
          active={selectedSettingsTab === "advanced"}
          icon={SlidersHorizontal}
          label="Advanced"
          onClick={() => setSelectedSettingsTab("advanced")}
        />
        <SettingsTabButton
          active={selectedSettingsTab === "about"}
          icon={Info}
          label="About"
          onClick={() => setSelectedSettingsTab("about")}
        />
      </div>

      <div className="relative">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
          size={15}
        />
        <Input
          aria-label="Search settings"
          className="pl-9"
          onChange={(event) => setSettingsQuery(event.currentTarget.value)}
          placeholder="Search settings"
          value={settingsQuery}
        />
      </div>

      {source.settingsMutationError ? (
        <StatusBanner
          description={source.settingsMutationError}
          title="Settings action not applied"
          tone="warning"
        />
      ) : null}
      {recoveryMessage ? (
        <StatusBanner description={recoveryMessage} title="Settings action applied" tone="success" />
      ) : null}
      {confirmation ? (
        <Panel title="Confirm destructive action" description={confirmation.action}>
          <div className="grid gap-3 p-3">
            <Input
              aria-label="Confirmation phrase"
              onChange={(event) => setConfirmationInput(event.target.value)}
              placeholder={confirmation.phrase}
              value={confirmationInput}
            />
            <div className="flex items-center gap-2">
              <Button
                disabled={confirmationInput !== confirmation.phrase || source.settingsMutationPending}
                onClick={confirmRecoveryAction}
                variant="danger"
              >
                Confirm
              </Button>
              <Button onClick={() => setConfirmation(null)} variant="ghost">
                Cancel
              </Button>
            </div>
          </div>
        </Panel>
      ) : null}

      {selectedSettingsTab === "general" ? (
        <GeneralSettingsTab
          beginRecoveryAction={beginRecoveryAction}
          customRetentionAmount={customRetentionAmount}
          customRetentionUnit={customRetentionUnit}
          openDiagnosticsDetails={openDiagnosticsDetails}
          setCustomRetentionAmount={setCustomRetentionAmount}
          setCustomRetentionUnit={setCustomRetentionUnit}
          settings={settings}
          settingsMutationPending={source.settingsMutationPending}
          updateSettings={updateSettings}
        />
      ) : null}

      {selectedSettingsTab === "profile" ? (
        <ProfileSettingsTab
          beginGoogleOAuth={beginGoogleOAuth}
          calendarSources={source.calendarSources}
          disconnectGoogle={disconnectGoogle}
          googleClientId={googleClientId}
          googleClientSecret={googleClientSecret}
          googleStatus={googleStatus}
          saveGoogleOAuthClient={saveGoogleOAuthClient}
          setGoogleClientId={setGoogleClientId}
          setGoogleClientSecret={setGoogleClientSecret}
          settings={settings}
          settingsMutationPending={source.settingsMutationPending}
          taskLists={source.taskLists}
          updateSelectedCalendar={updateSelectedCalendar}
          updateSelectedTaskList={updateSelectedTaskList}
        />
      ) : null}

      {selectedSettingsTab === "appearance" ? (
        <AppearanceSettingsTab
          activeColorTheme={activeColorTheme}
          availableFontFamilies={availableFontFamilies}
          matchingColorThemes={matchingColorThemes}
          settings={settings}
          updateBaseTheme={updateBaseTheme}
          updateSettings={updateSettings}
        />
      ) : null}

      {selectedSettingsTab === "hotkeys" ? (
        <HotkeysSettingsTab
          query={settingsQuery}
          settings={settings}
          updateSettings={updateSettings}
        />
      ) : null}

      {selectedSettingsTab === "alerts" ? (
        <AlertsSettingsTab settings={settings} updateSettings={updateSettings} />
      ) : null}

      {selectedSettingsTab === "advanced" ? (
        <AdvancedSettingsTab
          beginRecoveryAction={beginRecoveryAction}
          calendarSources={source.calendarSources}
          settings={settings}
          taskLists={source.taskLists}
          updateSelectedCalendar={updateSelectedCalendar}
          updateSelectedTaskList={updateSelectedTaskList}
          updateSettings={updateSettings}
        />
      ) : null}

      {selectedSettingsTab === "about" ? (
        <AboutSettingsTab
          beginRecoveryAction={beginRecoveryAction}
          diagnostics={diagnostics}
          settings={settings}
          updateSettings={updateSettings}
        />
      ) : null}
    </div>
  );
}
