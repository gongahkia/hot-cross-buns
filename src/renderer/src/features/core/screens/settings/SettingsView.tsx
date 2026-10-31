import { supportedFontFamilies } from "../../../shell/fonts";
import { usePanePreference } from "../../../shell/panePreferences";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  GoogleOptionalWorkspaceService,
  SettingsRecoveryActionRequest,
  SettingsSnapshot,
  SettingsUpdateRequest
} from "@shared/ipc/contracts";
import { previewAutoTagRules, validateAutoTagRule, type AutoTagTargetKind } from "@shared/ipc/autoTags";
import {
  defaultAppColorTheme,
  resolveEffectiveColorTheme,
  resolveEffectiveThemeMode,
  resolveAppThemeMode
} from "@shared/ipc/themeCatalog";
import { Copy, Search } from "@renderer/components/icons";
import { useInspector } from "../../../../components/Inspector";
import { Button, Input, Panel, StatusBanner } from "../../../../components/primitives";
import { useCoreViewModelSource } from "../../coreViewModelSource";
import {
  currentSystemPrefersDark,
  sanitizedJson
} from "../../coreScreenShared";
import { hotkeyDefinitions } from "../../hotkeys";
import { AppearanceSettingsTab } from "./AppearanceSettingsTab";
import { AboutSettingsTab } from "./AboutSettingsTab";
import { AlertsSettingsTab } from "./AlertsSettingsTab";
import { HotkeysSettingsTab } from "./HotkeysSettingsTab";
import { DataSettingsTab } from "./DataSettingsTab";
import { GeneralSettingsTab } from "./GeneralSettingsTab";
import { ProfileSettingsTab } from "./ProfileSettingsTab";
import {
  SettingsSearchProvider,
  SettingsTabButton,
  settingsSearchMatches
} from "./SettingsPrimitives";
import { recoveryPhrase } from "./settingsUtils";

type SettingsTabId = "data" | "profile" | "general" | "appearance" | "hotkeys" | "alerts" | "about";
type AutoTagBackgroundNotice = {
  title: string;
  description: string;
  tone: "info" | "success" | "warning";
  changedKinds?: Array<{ kind: AutoTagTargetKind; changed: number }>;
};

const settingsTabLabels: Record<SettingsTabId, string> = {
  profile: "Accounts", general: "General", appearance: "Appearance", hotkeys: "Hotkeys",
  alerts: "Alerts", data: "Data", about: "About"
};
const settingsTabDescriptions: Record<SettingsTabId, string> = {
  profile: "Manage Google connections and choose the lists and calendars in your planner.",
  general: "Language, sync, history, and setup preferences.",
  appearance: "Make the planner comfortable to read and work in.",
  hotkeys: "Personalise shortcuts and resolve conflicting key combinations.",
  alerts: "Choose when your planner reminds you and which sounds it plays.",
  data: "Manage browser storage, offline availability, and workspace backups.",
  about: "Application version and updates."
};

const autoTagTargetKinds: AutoTagTargetKind[] = ["task", "event", "note"];

const settingsSearchTextByTab: Record<SettingsTabId, string> = {
  data: "Data local notes backup export import restore replace archive storage persistent browser offline availability updates device Google planning metadata",
  about: [
    "About",
    "Updates",
    "Automatically check for updates",
    "Update channel",
    "Last checked",
    "App",
    "Version",
    "Build",
    "Bundle ID",
    "Copy version info"
  ].join(" "),
  alerts: [
    "Alerts",
    "Notifications",
    "Local reminders",
    "Reminder lead time",
    "Completion sounds",
    "Task completion",
    "Task sound",
    "Event completion",
    "Event sound",
    "Glass Pop Chime Click Ding Pluck Tick Sparkle Success Soft bell Arcade Wood Coin Rise Pulse",
    "Imported sounds",
    "Menu bar",
    "Menu bar extra",
    "Menu bar panel",
    "Menu bar icon",
    "Pin Calendar Bun Checklist Target Bell Clock Star Bolt Spark Circle Diamond",
    "Menu bar badge for overdue tasks",
    "Dock",
    "Dock badge for overdue tasks",
    "Global hotkey",
    "Global quick-add hotkey",
    "Shortcut"
  ].join(" "),
  general: [
    "General Language App language English 简体中文 Bahasa Melayu தமிழ் Diagnostics Performance Keep past events Keep completed tasks Custom",
    "Sync",
    "Retention",
    "Refresh",
    "Force full resync",
    "Setup assistant",
    "Run setup again"
  ].join(" "),
  appearance: [
    "Appearance Colour scheme Disable animations Editor buffer font DM Sans DM Serif Display Inter Calendar event colors Per-surface fonts Toolbar actions Calendar view modes Month scroll range Past Future Calendar timeline density Quick-create",
    "Theme",
    "Color theme",
    "Custom background",
    "Infer theme from background",
    "Inferred palette",
    "Color preview",
    "Reduce motion",
    "Layout scale",
    "Text size",
    "UI font",
    "Per-surface fonts",
    "Tasks font",
    "Calendar font",
    "Notes font",
    "Menu bar font",
    "Settings font",
    "Layout",
    "Default section",
    "Sidebar labels",
    "Menu bar compact mode",
    "Calendar default view",
    "Calendar day start",
    "Calendar day end"
  ].join(" "),
  hotkeys: [
    "Hotkeys Leader key",
    "Shortcuts",
    "Keyboard",
    "Command palette",
    ...hotkeyDefinitions.map((definition) => `${definition.group} ${definition.label} ${definition.id}`)
  ].join(" "),
  profile: [
    "Accounts Profile Google connection Drive links uploads Gmail",
    "Google OAuth client",
    "Google Cloud OAuth client",
    "Desktop OAuth client ID",
    "Client secret optional",
    "Google accounts",
    "Add Google Account",
    "Disconnect",
    "Optional Google Workspace access",
    "Reconfigure Google access",
    "Task lists",
    "Calendars"
  ].join(" ")
};

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
  const [recoveryMessage, updateRecoveryMessage] = useState<string | null>(null);
  const [recoveryTone, setRecoveryTone] = useState<"info" | "success" | "warning">("info");
  function setRecoveryMessage(message: string | null, tone: "info" | "success" | "warning" = "info"): void {
    updateRecoveryMessage(message);
    setRecoveryTone(tone);
  }
  const [autoTagBackgroundNotice, setAutoTagBackgroundNotice] = useState<AutoTagBackgroundNotice | null>(null);
  const [selectedSettingsTab, setSelectedSettingsTab] = usePanePreference<SettingsTabId>("settings.category", "general");
  const [settingsQuery, setSettingsQuery] = useState("");
  const [customRetentionAmount, setCustomRetentionAmount] = useState("60");
  const [customRetentionUnit, setCustomRetentionUnit] = useState<"days" | "months" | "years">("days");
  const settings = source.settings;
  const diagnostics = source.diagnosticsSummary;
  const googleStatus = source.googleStatus;
  const browserRuntime = source.native.capabilityReport.platform === "web";
  const effectiveThemeMode = resolveEffectiveThemeMode(settings, currentSystemPrefersDark());
  const activeColorTheme = resolveEffectiveColorTheme(settings, effectiveThemeMode);
  const autoTagBulkCounts = useMemo(() => ({
    task: source.largeTaskWindow.filter((task) => {
      const preview = previewAutoTagRules(settings.autoTagRules, {
        kind: "task",
        title: task.title,
        body: task.detail,
        existingTags: task.tags ?? []
      });
      return previewDiffers(preview.title, task.title) ||
        previewDiffers(preview.body, task.detail) ||
        !sameStringSet(preview.tags, task.tags ?? []);
    }).length,
    event: source.calendarAgendaEvents.filter((event) => {
      if (event.sourceKind === "task" || event.hcbKind === "birthday") {
        return false;
      }

      const preview = previewAutoTagRules(settings.autoTagRules, {
        kind: "event",
        title: event.title,
        body: event.notes,
        existingTags: event.tags ?? [],
        existingEventColorId: event.colorId ?? null
      });
      return previewDiffers(preview.title, event.title) ||
        previewDiffers(preview.body, event.notes) ||
        !sameStringSet(preview.tags, event.tags ?? []) ||
        (preview.eventColorId ?? event.colorId ?? null) !== (event.colorId ?? null);
    }).length,
    note: source.initialNotes.filter((note) => {
      const preview = previewAutoTagRules(settings.autoTagRules, {
        kind: "note",
        title: note.title,
        body: note.body,
        existingTags: note.tags ?? []
      });
      return previewDiffers(preview.title, note.title) ||
        previewDiffers(preview.body, note.body) ||
        !sameStringSet(preview.tags, note.tags ?? []);
    }).length
  }), [settings.autoTagRules, source.calendarAgendaEvents, source.initialNotes, source.largeTaskWindow]);
  const [googleClientId, setGoogleClientId] = useState(googleStatus.clientId ?? "");
  const [googleClientSaving, setGoogleClientSaving] = useState(false);
  const [googleClientSecret, setGoogleClientSecret] = useState("");
  const availableFontFamilies = [...supportedFontFamilies];
  const settingsSearchTexts = useMemo<Record<SettingsTabId, string>>(
    () => ({
      ...settingsSearchTextByTab,
      ...(browserRuntime ? {
        about: "About Updates App Version Build Site Copy version info",
        alerts: "Alerts Notifications Local reminders Calendar reminder lead time Completion sounds Task completion Task sound Event completion Event sound Glass Pop Chime Click Ding Pluck Tick Sparkle Success Soft bell Arcade Wood Coin Rise Pulse",
        appearance: settingsSearchTextByTab.appearance.replace(/Menu bar font|Menu bar compact mode|Sidebar labels|Default section|Calendar default view|Calendar day start|Calendar day end/g, "")
      } : {}),
      profile: [
        browserRuntime ? settingsSearchTextByTab.profile.replace(/Google OAuth client|Google Cloud OAuth client|Desktop OAuth client ID|Client secret optional/g, "") : settingsSearchTextByTab.profile,
        googleStatus.account?.displayName ?? "",
        googleStatus.account?.email ?? "",
        googleStatus.account?.timeZone ?? "",
        source.taskLists.map((taskList) => taskList.title).join(" "),
        source.calendarSources.map((calendar) => `${calendar.title} ${calendar.timeZone ?? ""}`).join(" ")
      ].join(" ")
    }),
    [browserRuntime, googleStatus.account, source.calendarSources, source.taskLists]
  );
  const normalizedSettingsQuery = settingsQuery.trim().length >= 2 ? settingsQuery.trim() : "";
  function selectSettingsTab(tab: SettingsTabId): void {
    if (normalizedSettingsQuery && !matchingSettingsTabs.includes(tab)) setSettingsQuery("");
    setSelectedSettingsTab(tab);
  }
  const matchingSettingsTabs = useMemo<SettingsTabId[]>(() => {
    if (!normalizedSettingsQuery) {
      return [];
    }

    return (Object.entries(settingsSearchTexts) as Array<[SettingsTabId, string]>)
      .filter(([, text]) => settingsSearchMatches(text, normalizedSettingsQuery))
      .map(([id]) => id);
  }, [normalizedSettingsQuery, settingsSearchTexts]);
  const autoTagRuleErrorCount = useMemo(
    () =>
      settings.autoTagRules.filter((rule) =>
        validateAutoTagRule(rule).some((issue) => issue.severity === "error")
      ).length,
    [settings.autoTagRules]
  );
  const autoTagRulesSignature = useMemo(() => JSON.stringify(settings.autoTagRules), [settings.autoTagRules]);
  const autoTagRulesSignatureRef = useRef<string | null>(null);
  const autoTagBackgroundTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setGoogleClientId(googleStatus.clientId ?? "");
  }, [googleStatus.clientId]);

  useEffect(() => {
    if (normalizedSettingsQuery.length < 2 || matchingSettingsTabs.length === 0) {
      return;
    }

    if (!matchingSettingsTabs.includes(selectedSettingsTab)) {
      setSelectedSettingsTab(matchingSettingsTabs[0]);
    }
  }, [matchingSettingsTabs, normalizedSettingsQuery, selectedSettingsTab]);


  useEffect(() => {
    const previousSignature = autoTagRulesSignatureRef.current;
    autoTagRulesSignatureRef.current = autoTagRulesSignature;

    if (previousSignature === null || previousSignature === autoTagRulesSignature) {
      return;
    }

    if (autoTagBackgroundTimerRef.current) {
      clearTimeout(autoTagBackgroundTimerRef.current);
    }

    setAutoTagBackgroundNotice(null);

    if (settings.autoTagBackgroundReapplyMode === "manual") {
      return;
    }

    let cancelled = false;
    autoTagBackgroundTimerRef.current = setTimeout(() => {
      void runAutoTagBackgroundReapply(settings.autoTagBackgroundReapplyMode, () => cancelled);
    }, 900);

    return () => {
      cancelled = true;
      if (autoTagBackgroundTimerRef.current) {
        clearTimeout(autoTagBackgroundTimerRef.current);
      }
    };
  }, [autoTagRuleErrorCount, autoTagRulesSignature, settings.autoTagBackgroundReapplyMode]);

  function updateSettings(request: SettingsUpdateRequest): void {
    setRecoveryMessage(null);
    void source.updateSettings(request);
  }

  async function reapplyAutoTags(kind: AutoTagTargetKind): Promise<void> {
    const preview = await source.previewAutoTagReapply({ kind, scope: "all" });

    if (!preview) {
      setRecoveryMessage(`Auto-tag reapply ${kind}: preview failed.`);
      return;
    }

    if (preview.blocked || preview.changed === 0) {
      setRecoveryMessage(`Auto-tag reapply ${kind}: ${preview.message}`);
      return;
    }

    const applied = await source.applyAutoTagReapply({ kind, scope: "all", confirm: true });

    source.refreshUndoStatus();
    source.refresh();
    setRecoveryMessage(
      applied
        ? `Auto-tag reapply ${kind}: ${applied.changed} updated, ${applied.failed} failed.`
        : `Auto-tag reapply ${kind}: apply failed.`
    );
  }

  async function runAutoTagBackgroundReapply(
    mode: SettingsSnapshot["autoTagBackgroundReapplyMode"],
    cancelled: () => boolean
  ): Promise<void> {
    if (autoTagRuleErrorCount > 0) {
      if (!cancelled()) {
        setAutoTagBackgroundNotice({
          title: "Auto-tag reapply blocked",
          description: "Fix auto-tag rule errors before background reapply can run.",
          tone: "warning"
        });
      }
      return;
    }

    const previews: Array<{ kind: AutoTagTargetKind; changed: number }> = [];

    for (const kind of autoTagTargetKinds) {
      const preview = await source.previewAutoTagReapply({ kind, scope: "all" });

      if (cancelled()) {
        return;
      }

      if (!preview || preview.blocked) {
        setAutoTagBackgroundNotice({
          title: "Auto-tag reapply blocked",
          description: preview?.message ?? `Auto-tag ${kind} preview failed.`,
          tone: "warning"
        });
        return;
      }

      if (preview.changed > 0) {
        previews.push({ kind, changed: preview.changed });
      }
    }

    if (previews.length === 0) {
      setAutoTagBackgroundNotice({
        title: "Auto-tag reapply preview",
        description: "No cached tasks, events, or notes need reapply.",
        tone: "info"
      });
      return;
    }

    if (mode === "preview") {
      setAutoTagBackgroundNotice({
        title: "Auto-tag reapply preview",
        description: autoTagBackgroundSummary(previews),
        tone: "info",
        changedKinds: previews
      });
      return;
    }

    await applyAutoTagBackgroundChanges(previews);
  }

  async function applyAutoTagBackgroundChanges(
    changedKinds: Array<{ kind: AutoTagTargetKind; changed: number }>
  ): Promise<void> {
    const applied: Array<{ kind: AutoTagTargetKind; changed: number; failed: number }> = [];

    for (const item of changedKinds) {
      const result = await source.applyAutoTagReapply({ kind: item.kind, scope: "all", confirm: true });

      if (result) {
        applied.push({ kind: item.kind, changed: result.changed, failed: result.failed });
      }
    }

    source.refreshUndoStatus();
    source.refresh();
    setAutoTagBackgroundNotice({
      title: "Auto-tag reapply applied",
      description: autoTagBackgroundAppliedSummary(applied),
      tone: "success"
    });
  }

  function updateBaseTheme(theme: SettingsSnapshot["theme"]): void {
    const nextMode = resolveAppThemeMode(theme, currentSystemPrefersDark());
    updateSettings({
      theme,
      colorTheme: defaultAppColorTheme(nextMode).id,
      useInferredBackgroundTheme: false
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
    if (["refresh", "resetOnboarding", "checkForUpdates", "backupNow", "exportBackup", "openBackupsFolder"].includes(action)) {
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

  async function copyDiagnosticsPayload(payload: string): Promise<void> {
    const result = await window.hcb?.native.writeClipboardText({ text: payload });
    setRecoveryMessage(result?.ok ? "Diagnostics summary copied." : result?.error.message ?? "Clipboard access is unavailable.", result?.ok ? "success" : "warning");
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

    setGoogleClientSaving(true);
    try {
      const request = googleClientSecret.trim().length > 0
        ? { clientId: googleClientId, clientSecret: googleClientSecret.trim() }
        : { clientId: googleClientId };
      const result = await window.hcb.google.saveOAuthClient(request);
      if (result.ok) {
        setRecoveryMessage("Google OAuth client configuration saved.", "success");
        source.setGoogleStatus(result.data);
        setGoogleClientSecret("");
      } else setRecoveryMessage(result.error.message, "warning");
    } catch {
      setRecoveryMessage("Google client configuration could not be saved. Try again.", "warning");
    } finally {
      setGoogleClientSaving(false);
    }
  }

  async function beginGoogleOAuth(requestedServices: GoogleOptionalWorkspaceService[] = [], accountId?: string): Promise<void> {
    setRecoveryMessage(null);

    const result = await window.hcb?.google.beginOAuth({ requestedServices, accountId });

    if (result?.ok) {
      setRecoveryMessage(result.data.message ?? "Google authorization finished. Only granted services will sync.");
      source.refreshGoogleStatus();
      source.refresh();
      for (const delayMs of [2_000, 5_000, 10_000]) {
        window.setTimeout(() => source.refreshGoogleStatus(), delayMs);
      }
      return;
    }

    if (result && !result.ok) {
      setRecoveryMessage(result.error.message, "warning");
    }
  }

  async function reconfigureOptionalAccess(input: { accountId: string; requestedServices: GoogleOptionalWorkspaceService[] }): Promise<{ ok: boolean; message: string }> {
    setRecoveryMessage(null);
    const result = await window.hcb?.google.reconfigureOptionalAccess({
      ...input,
      confirmation: "RECONFIGURE_OPTIONAL_ACCESS"
    });

    if (result?.ok) {
      source.setGoogleStatus(result.data);
      source.refreshGoogleStatus();
      for (const delayMs of [2_000, 5_000, 10_000]) {
        window.setTimeout(() => source.refreshGoogleStatus(), delayMs);
      }
      source.refresh();
      const browserMessage = "Google authorization finished. This session uses only the access you granted.";
      setRecoveryMessage(result.data.message ?? browserMessage);
      return { ok: true, message: result.data.message ?? browserMessage };
    }

    return { ok: false, message: result && !result.ok ? result.error.message : "Google access could not be reconfigured." };
  }

  async function disconnectGoogle(accountId?: string): Promise<void> {
    setRecoveryMessage(null);

    const result = await window.hcb?.google.disconnect(accountId ? { accountId } : {});

    if (result?.ok) {
      setRecoveryMessage("Google account disconnected.", "success");
      source.setGoogleStatus(result.data);
      return;
    }

    if (result && !result.ok) {
      setRecoveryMessage(result.error.message, "warning");
    }
  }

  return (
    <div className="settings-workspace grid h-full min-h-0 grid-cols-[210px_minmax(0,1fr)]">
      <nav aria-label="Settings categories" className="flex min-h-0 flex-col gap-1 overflow-auto border-r border-border bg-bg-secondary p-4">
        <div className="settings-search relative mb-5">
          <Search aria-hidden="true" className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-text-muted" size={15} />
          <Input aria-label="Search settings" className="w-full min-w-0 pl-8" onChange={(event) => setSettingsQuery(event.currentTarget.value)} placeholder="Search settings" value={settingsQuery} />
        </div>
        <div className="settings-category-list flex min-h-0 flex-col gap-1">
        <p className="px-2 pb-1 text-xs font-semibold text-text-muted">Workspace</p>
        <SettingsTabButton active={selectedSettingsTab === "profile"} label="Accounts" onClick={() => selectSettingsTab("profile")} />
        <p className="mt-5 px-2 pb-1 text-xs font-semibold text-text-muted">Preferences</p>
        <SettingsTabButton active={selectedSettingsTab === "general"} label="General" onClick={() => selectSettingsTab("general")} />
        <SettingsTabButton active={selectedSettingsTab === "appearance"} label="Appearance" onClick={() => selectSettingsTab("appearance")} />
        <SettingsTabButton active={selectedSettingsTab === "hotkeys"} label="Hotkeys" onClick={() => selectSettingsTab("hotkeys")} />
        <SettingsTabButton active={selectedSettingsTab === "alerts"} label="Alerts" onClick={() => selectSettingsTab("alerts")} />
        <p className="mt-5 px-2 pb-1 text-xs font-semibold text-text-muted">Maintenance</p>
        <SettingsTabButton active={selectedSettingsTab === "data"} label="Data" onClick={() => selectSettingsTab("data")} />
        <SettingsTabButton active={selectedSettingsTab === "about"} label="About" onClick={() => selectSettingsTab("about")} />
        </div>
      </nav>
      <div className="settings-content min-h-0 min-w-0 overflow-auto px-6 py-5" key={selectedSettingsTab}>
      <div className="mx-auto grid max-w-4xl gap-4">
      <div className="pb-2">
        <h2 className="text-balance text-xl font-semibold">{selectedSettingsTab === "data" ? "Data and recovery" : settingsTabLabels[selectedSettingsTab]}</h2>
        <p className="mt-1 text-pretty text-sm text-text-muted">{settingsTabDescriptions[selectedSettingsTab]}</p>
      </div>
      {normalizedSettingsQuery ? (
        <div className="grid gap-2">
          <div role="status" className="text-sm text-text-muted">
            {matchingSettingsTabs.length ? `Matches in ${matchingSettingsTabs.length} categories` : "No settings match your search."}
            <Button className="ml-2" size="sm" variant="ghost" onClick={() => setSettingsQuery("")}>Clear search</Button>
          </div>
          {matchingSettingsTabs.length > 0 ? <div aria-label="Matching settings categories" className="flex flex-wrap gap-2">
            {matchingSettingsTabs.map((tab) => <SettingsTabButton key={tab} active={selectedSettingsTab === tab} label={settingsTabLabels[tab]} onClick={() => selectSettingsTab(tab)} />)}
          </div> : null}
        </div>
      ) : null}
      {source.settingsMutationError ? (
        <StatusBanner
          role="alert"
          className="[&_.truncate]:whitespace-normal"
          description={source.settingsMutationError}
          title="Settings action not applied"
          tone="warning"
        />
      ) : null}
      {autoTagBackgroundNotice ? (
        <StatusBanner
          action={autoTagBackgroundNotice.changedKinds ? (
            <div className="flex shrink-0 items-center gap-2">
              <Button
                onClick={() => void applyAutoTagBackgroundChanges(autoTagBackgroundNotice.changedKinds ?? [])}
                size="sm"
                variant="secondary"
              >
                Apply
              </Button>
              <Button onClick={() => setAutoTagBackgroundNotice(null)} size="sm" variant="ghost">
                Dismiss
              </Button>
            </div>
          ) : undefined}
          description={autoTagBackgroundNotice.description}
          title={autoTagBackgroundNotice.title}
          tone={autoTagBackgroundNotice.tone}
        />
      ) : null}
      {recoveryMessage ? (
        <StatusBanner role={recoveryTone === "warning" ? "alert" : "status"} className="[&_.truncate]:whitespace-normal" description={recoveryMessage} title={recoveryTone === "warning" ? "Action could not be completed" : recoveryTone === "success" ? "Action completed" : "Settings update"} tone={recoveryTone} />
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

      {!normalizedSettingsQuery || matchingSettingsTabs.length > 0 ? <SettingsSearchProvider query={settingsSearchMatches(settingsTabLabels[selectedSettingsTab], normalizedSettingsQuery) ? "" : normalizedSettingsQuery}>
        {selectedSettingsTab === "profile" ? (
          <ProfileSettingsTab
            googleAvailable={source.native.capabilityReport.platform === "web" || source.native.capabilityReport.flags.supportsOAuthLoopback === true}
            browserRuntime={source.native.capabilityReport.platform === "web"}
            beginGoogleOAuth={beginGoogleOAuth}
            calendarSources={source.calendarSources}
            disconnectGoogle={disconnectGoogle}
            googleClientId={googleClientId}
            googleClientSecret={googleClientSecret}
            googleStatus={googleStatus}
            refreshPlanner={source.refresh}
            reconfigureOptionalAccess={reconfigureOptionalAccess}
            saveGoogleOAuthClient={saveGoogleOAuthClient}
            setGoogleClientId={setGoogleClientId}
            setGoogleClientSecret={setGoogleClientSecret}
            settings={settings}
            settingsMutationPending={source.settingsMutationPending || googleClientSaving}
            taskLists={source.taskLists}
            updateSelectedCalendar={updateSelectedCalendar}
            updateSelectedTaskList={updateSelectedTaskList}
          />
        ) : null}

        {selectedSettingsTab === "data" ? (
          <DataSettingsTab browserStorage={source.native.capabilityReport.platform === "web"} settings={settings} pending={source.settingsMutationPending} updateSettings={updateSettings} runAction={beginRecoveryAction} />
        ) : null}

        {selectedSettingsTab === "general" ? (
          <GeneralSettingsTab
            browserRuntime={source.native.capabilityReport.platform === "web"}
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

        {selectedSettingsTab === "appearance" ? (
          <AppearanceSettingsTab
            browserRuntime={browserRuntime}
            activeColorTheme={activeColorTheme}
            availableFontFamilies={availableFontFamilies}
            settings={settings}
            updateBaseTheme={updateBaseTheme}
            updateSettings={updateSettings}
          />
        ) : null}

        {selectedSettingsTab === "hotkeys" ? (
          <HotkeysSettingsTab
            query={settingsSearchMatches(settingsTabLabels[selectedSettingsTab], normalizedSettingsQuery) ? "" : normalizedSettingsQuery}
            settings={settings}
            updateSettings={updateSettings}
          />
        ) : null}

        {selectedSettingsTab === "alerts" ? (
          <AlertsSettingsTab browserRuntime={source.native.capabilityReport.platform === "web"} notificationsAvailable={source.native.capabilityReport.flags.supportsNotifications === true} settings={settings} updateSettings={updateSettings} />
        ) : null}

        {selectedSettingsTab === "about" ? (
          <AboutSettingsTab
            browserRuntime={source.native.capabilityReport.platform === "web"}
            beginRecoveryAction={beginRecoveryAction}
            diagnostics={diagnostics}
            nativeUpdaterStatus={source.native.updaterStatus}
            settings={settings}
            updateSettings={updateSettings}
          />
        ) : null}
      </SettingsSearchProvider> : null}
      </div></div>
    </div>
  );
}

function previewDiffers(left: string | null | undefined, right: string | null | undefined): boolean {
  return (left ?? "").trim() !== (right ?? "").trim();
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  const normalizedLeft = [...new Set(left.map((value) => value.trim()).filter(Boolean))].sort();
  const normalizedRight = [...new Set(right.map((value) => value.trim()).filter(Boolean))].sort();

  return normalizedLeft.length === normalizedRight.length &&
    normalizedLeft.every((value, index) => value === normalizedRight[index]);
}

function autoTagBackgroundSummary(items: Array<{ kind: AutoTagTargetKind; changed: number }>): string {
  const total = items.reduce((sum, item) => sum + item.changed, 0);

  return `Rules changed. ${items.map((item) => autoTagKindLabel(item.kind, item.changed)).join(", ")} ${total === 1 ? "needs" : "need"} reapply.`;
}

function autoTagBackgroundAppliedSummary(items: Array<{ kind: AutoTagTargetKind; changed: number; failed: number }>): string {
  const changed = items.reduce((total, item) => total + item.changed, 0);
  const failed = items.reduce((total, item) => total + item.failed, 0);

  return `${changed} updated${failed > 0 ? `, ${failed} failed` : ""}.`;
}

function autoTagKindLabel(kind: AutoTagTargetKind, count: number): string {
  const noun = kind === "task" ? "task" : kind === "event" ? "event" : "note";

  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
