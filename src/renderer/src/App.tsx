import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import type { NativeAction, SettingsSnapshot } from "@shared/ipc/contracts";
import {
  Bell,
  CalendarDays,
  CheckCircle2,
  Cloud,
  Command,
  ListChecks,
  RefreshCw,
  Server,
  X
} from "lucide-react";
import appIconUrl from "../../../assets/brand/buns-app-icon-sidebar.png";
import type { PlannerAction } from "./actions/plannerActions";
import { CommandPalette } from "./components/CommandPalette";
import { InspectorProvider, InspectorShell } from "./components/Inspector";
import { Badge, Button, IconButton, StatusBanner, cx } from "./components/primitives";
import { getPlannerSection, plannerSections, type SectionId } from "./data/mockPlanner";
import { getAppNotifications, type AppNotification } from "./features/core/appNotifications";
import { SectionContent, type TaskSurfaceCommand } from "./features/core/CoreScreens";
import {
  CoreDataProvider,
  type CoreViewModelSource,
  useCoreViewModelSource
} from "./features/core/coreViewModelSource";
import {
  RenderTimingBoundary,
  rendererNow,
  reportRendererTimingSince,
  useRenderTiming
} from "./hooks/useRenderTiming";

function scheduleFrame(callback: () => void): void {
  if (typeof window.requestAnimationFrame === "function") {
    window.requestAnimationFrame(callback);
    return;
  }

  window.setTimeout(callback, 0);
}

function sectionMetric(source: CoreViewModelSource, sectionId: SectionId): string {
  if (sectionId === "tasks") {
    return source.taskFilterViewModels.find((filter) => filter.id === "open")?.countLabel ?? "0";
  }

  if (sectionId === "calendar") {
    return String(source.calendarAgendaEvents.length);
  }

  if (sectionId === "notes") {
    return String(source.initialNotes.length);
  }

  if (sectionId === "search") {
    return "local";
  }

  if (sectionId === "notifications") {
    return String(getAppNotifications(source).length);
  }

  if (sectionId === "settings") {
    return source.syncStatus.state;
  }

  return source.todayViewModel.metrics[0]?.value ?? "0";
}

export default function App(): JSX.Element {
  return (
    <CoreDataProvider>
      <InspectorProvider>
        <AppShell />
        <InspectorShell />
      </InspectorProvider>
    </CoreDataProvider>
  );
}

function AppShell(): JSX.Element {
  useRenderTiming("App");

  const source = useCoreViewModelSource();
  const [activeSectionId, setActiveSectionId] = useState<SectionId>("today");
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [taskCommand, setTaskCommand] = useState<TaskSurfaceCommand | null>(null);
  const [healthLabel, setHealthLabel] = useState("Starting");
  const [searchQuery, setSearchQuery] = useState("");
  const [dismissedNotificationIds, setDismissedNotificationIds] = useState<string[]>([]);
  const shellVisibleReported = useRef(false);
  const commandPaletteOpenStartedAt = useRef<number | null>(null);
  const sectionButtonRefs = useRef(new Map<SectionId, HTMLButtonElement>());

  const activeSection = getPlannerSection(activeSectionId);
  const ActiveIcon = activeSection.icon;
  const appNotifications = getAppNotifications(source);
  const visibleNotification = appNotifications.find(
    (notification) => !dismissedNotificationIds.includes(notification.id)
  );
  const onboardingVisible =
    source.settings.setupCompletedAt === null &&
    source.dataState !== "loading" &&
    source.dataState !== "offline" &&
    source.dataState !== "error";

  const setSectionButtonRef = useCallback(
    (sectionId: SectionId) =>
      (node: HTMLButtonElement | null): void => {
        if (node) {
          sectionButtonRefs.current.set(sectionId, node);
        } else {
          sectionButtonRefs.current.delete(sectionId);
        }
      },
    []
  );

  const navigateToSection = useCallback((sectionId: SectionId): void => {
    setActiveSectionId(sectionId);
  }, []);

  const openCommandPalette = useCallback((): void => {
    commandPaletteOpenStartedAt.current = rendererNow();
    setCommandPaletteOpen(true);
  }, []);

  const triggerTaskCommand = useCallback(
    (id: TaskSurfaceCommand["id"]): void => {
      navigateToSection("tasks");
      setTaskCommand((current) => ({
        id,
        nonce: (current?.nonce ?? 0) + 1
      }));
    },
    [navigateToSection]
  );

  const handleNativeAction = useCallback(
    (action: NativeAction): void => {
      if (action.type === "quickCapture") {
        triggerTaskCommand("task.quickCapture");
        return;
      }

      if (action.type === "openSettings") {
        navigateToSection("settings");
        return;
      }

      if (action.type === "refresh") {
        source.refresh();
        return;
      }

      if (action.route.kind === "search") {
        setSearchQuery(action.route.query ?? "");
        navigateToSection("search");
        return;
      }

      if (action.route.kind === "settings") {
        navigateToSection("settings");
        return;
      }

      if (action.route.kind === "calendar" || action.route.kind === "event") {
        navigateToSection("calendar");
        return;
      }

      if (action.route.kind === "notes" || action.route.kind === "note") {
        navigateToSection("notes");
        return;
      }

      if (action.route.kind === "tasks" || action.route.kind === "task") {
        navigateToSection("tasks");
        return;
      }

      navigateToSection("today");
    },
    [navigateToSection, source.refresh, triggerTaskCommand]
  );

  const handlePaletteCommand = useCallback(
    (command: PlannerAction): boolean => {
      if (command.id === "sync.refresh") {
        source.refresh();
        navigateToSection("today");
        return true;
      }

      if (command.searchQuery !== undefined) {
        setSearchQuery(command.searchQuery);
        navigateToSection("search");
        return true;
      }

      if (command.taskCommand === undefined) {
        return false;
      }

      triggerTaskCommand(command.taskCommand as TaskSurfaceCommand["id"]);
      return true;
    },
    [navigateToSection, source.refresh, triggerTaskCommand]
  );

  const focusSection = useCallback(
    (sectionId: SectionId): void => {
      navigateToSection(sectionId);
      sectionButtonRefs.current.get(sectionId)?.focus();
      scheduleFrame(() => sectionButtonRefs.current.get(sectionId)?.focus());
    },
    [navigateToSection]
  );

  function handleNavigationKeyDown(event: KeyboardEvent<HTMLButtonElement>, sectionId: SectionId): void {
    const currentIndex = plannerSections.findIndex((section) => section.id === sectionId);
    let nextIndex = currentIndex;

    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      nextIndex = Math.min(currentIndex + 1, plannerSections.length - 1);
    } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      nextIndex = Math.max(currentIndex - 1, 0);
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = plannerSections.length - 1;
    } else {
      return;
    }

    event.preventDefault();
    focusSection(plannerSections[nextIndex].id);
  }

  useEffect(() => {
    let cancelled = false;

    if (!window.hcb) {
      setHealthLabel("Renderer only");
      return;
    }

    window.hcb.diagnostics.health().then((result) => {
      if (cancelled) {
        return;
      }

      setHealthLabel(result.ok ? "Ready" : "Diagnostics unavailable");
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (shellVisibleReported.current) {
      return;
    }

    shellVisibleReported.current = true;
    scheduleFrame(() => {
      void window.hcb?.diagnostics.markShellVisible();
    });
  }, []);

  useEffect(() => window.hcb?.native.subscribeAction(handleNativeAction), [handleNativeAction]);

  useEffect(() => {
    function handleGlobalKeyDown(event: globalThis.KeyboardEvent): void {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "p") {
        event.preventDefault();
        openCommandPalette();
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "r") {
        event.preventDefault();
        source.refresh();
      }
    }

    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, [openCommandPalette, source.refresh]);

  useEffect(() => {
    if (!visibleNotification) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setDismissedNotificationIds((current) =>
        current.includes(visibleNotification.id) ? current : [...current, visibleNotification.id]
      );
    }, 6_000);

    return () => window.clearTimeout(timeout);
  }, [visibleNotification?.id]);

  useEffect(() => {
    if (!commandPaletteOpen) {
      return;
    }

    scheduleFrame(() => {
      reportRendererTimingSince("command-palette.open", commandPaletteOpenStartedAt.current);
      commandPaletteOpenStartedAt.current = null;
    });
  }, [commandPaletteOpen]);

  return (
    <div
      className="grid h-screen min-h-[640px] grid-cols-[232px_minmax(0,1fr)] bg-bg-primary text-text-primary"
      data-testid="app-shell"
    >
      <aside className="flex min-h-0 flex-col border-r border-border bg-bg-secondary">
        <div className="flex h-14 items-center gap-3 border-b border-border px-4">
          <img
            alt=""
            aria-hidden="true"
            className="size-8 rounded-hcbMd object-cover"
            draggable={false}
            src={appIconUrl}
          />
          <div className="min-w-0">
            <div className="truncate text-[var(--text-md)] font-semibold">Hot Cross Buns 2</div>
            <div className="text-[var(--text-xs)] text-text-muted">Local planner</div>
          </div>
        </div>

        <nav aria-label="Primary" className="flex flex-1 flex-col gap-1 px-2 py-3">
          {plannerSections.map((section) => {
            const Icon = section.icon;
            const selected = section.id === activeSectionId;

            return (
              <button
                aria-current={selected ? "page" : undefined}
                className={cx(
                  "flex h-9 w-full items-center gap-3 rounded-hcbMd px-3 text-left text-[var(--text-base)] transition-colors duration-fast ease-hcb focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                  selected
                    ? "bg-surface-0 text-text-primary"
                    : "text-text-secondary hover:bg-surface-0 hover:text-text-primary"
                )}
                key={section.id}
                onClick={() => navigateToSection(section.id)}
                onKeyDown={(event) => handleNavigationKeyDown(event, section.id)}
                ref={setSectionButtonRef(section.id)}
                type="button"
              >
                <Icon aria-hidden="true" size={16} strokeWidth={2} />
                <span className="min-w-0 flex-1 truncate">{section.label}</span>
                <span className="shrink-0 text-[var(--text-xs)] text-text-muted">
                  {sectionMetric(source, section.id)}
                </span>
              </button>
            );
          })}
        </nav>

        <div className="border-t border-border px-4 py-3 text-[var(--text-xs)] text-text-muted">
          <div className="flex items-center justify-between gap-3">
            <span>Runtime</span>
            <Badge tone={healthLabel === "Ready" ? "success" : "neutral"}>{healthLabel}</Badge>
          </div>
        </div>
      </aside>

      <main className="flex min-w-0 flex-col">
        <header className="flex h-14 items-center justify-between gap-3 border-b border-border bg-bg-primary px-5">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-8 items-center justify-center rounded-hcbMd bg-surface-0 text-accent">
              <ActiveIcon aria-hidden="true" size={18} />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-[var(--text-xl)] font-bold" id="planner-title">
                {activeSection.title}
              </h1>
              <p className="truncate text-[var(--text-sm)] text-text-muted">{activeSection.subtitle}</p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2" role="toolbar" aria-label="Planner actions">
            <Button
              aria-keyshortcuts="Meta+P Control+P"
              onClick={openCommandPalette}
              variant="secondary"
            >
              <Command aria-hidden="true" size={15} />
              Command palette
              <span className="rounded-hcbSm border border-border px-1.5 font-mono text-[var(--text-xs)] text-text-muted">
                Cmd P
              </span>
            </Button>
            <Button
              aria-keyshortcuts="Meta+R Control+R"
              data-action-id="sync.refresh"
              onClick={source.refresh}
              title="Reload local cache"
              variant="ghost"
            >
              <RefreshCw aria-hidden="true" size={15} />
              Reload
              <span className="rounded-hcbSm border border-border px-1.5 font-mono text-[var(--text-xs)] text-text-muted">
                Cmd R
              </span>
            </Button>
          </div>
        </header>

        <section
          aria-labelledby="planner-title"
          className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-4"
        >
          <RenderTimingBoundary id={`section:${activeSectionId}`}>
            <SectionContent
              activeSectionId={activeSectionId}
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              taskCommand={taskCommand}
            />
          </RenderTimingBoundary>
        </section>
      </main>

      <RenderTimingBoundary id="command-palette">
        <CommandPalette
          actionContext={{
            hasTaskLists: source.taskLists.length > 0,
            hasCalendars: source.calendarSources.length > 0,
            hasSelectedTask: false,
            canWriteTasks: !source.taskMutationPending,
            canWriteEvents: true
          }}
          onCommand={handlePaletteCommand}
          onNavigate={navigateToSection}
          onOpenChange={setCommandPaletteOpen}
          open={commandPaletteOpen}
        />
      </RenderTimingBoundary>

      {onboardingVisible ? <FirstRunOnboarding source={source} /> : null}
      {visibleNotification ? (
        <AppNotificationToast
          notification={visibleNotification}
          onDismiss={() =>
            setDismissedNotificationIds((current) =>
              current.includes(visibleNotification.id) ? current : [...current, visibleNotification.id]
            )
          }
        />
      ) : null}
    </div>
  );
}

function AppNotificationToast({
  notification,
  onDismiss
}: {
  notification: AppNotification;
  onDismiss: () => void;
}): JSX.Element {
  return (
    <StatusBanner
      action={<IconButton icon={X} label="Dismiss notification" onClick={onDismiss} variant="ghost" />}
      className="fixed right-4 top-16 z-40 w-[min(420px,calc(100vw-32px))] shadow-2xl"
      description={notification.description}
      title={notification.title}
      tone={notification.tone}
      role="status"
      aria-live="polite"
    />
  );
}

function FirstRunOnboarding({ source }: { source: CoreViewModelSource }): JSX.Element {
  const initialTaskListIds =
    source.settings.selectedTaskListIds.length > 0
      ? source.settings.selectedTaskListIds
      : source.taskLists.map((taskList) => taskList.id);
  const initialCalendarIds =
    source.settings.selectedCalendarIds.length > 0
      ? source.settings.selectedCalendarIds
      : source.calendarSources.filter((calendar) => calendar.selected).map((calendar) => calendar.id);
  const [selectedTaskListIds, setSelectedTaskListIds] = useState<string[]>(initialTaskListIds);
  const [selectedCalendarIds, setSelectedCalendarIds] = useState<string[]>(initialCalendarIds);
  const [syncMode, setSyncMode] = useState<SettingsSnapshot["syncMode"]>(source.settings.syncMode);
  const [notificationsEnabled, setNotificationsEnabled] = useState(source.settings.notificationsEnabled);
  const [mcpEnabled, setMcpEnabled] = useState(source.settings.mcpEnabled);
  const [mcpPermissionMode, setMcpPermissionMode] =
    useState<SettingsSnapshot["mcpPermissionMode"]>(source.settings.mcpPermissionMode);
  const [localError, setLocalError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const selectedTaskLists = useMemo(() => new Set(selectedTaskListIds), [selectedTaskListIds]);
  const selectedCalendars = useMemo(() => new Set(selectedCalendarIds), [selectedCalendarIds]);
  const accountState = source.diagnosticsSummary?.account.state ?? "signed_out";
  const oauthLoopbackReady =
    source.diagnosticsSummary?.native.flags.supportsOAuthLoopback ??
    source.diagnosticsSummary?.native.flags.supportsCredentialStorage ??
    false;

  function toggleTaskList(taskListId: string, selected: boolean): void {
    setSelectedTaskListIds((current) => {
      const next = new Set(current);

      if (selected) {
        next.add(taskListId);
      } else {
        next.delete(taskListId);
      }

      return [...next];
    });
  }

  function toggleCalendar(calendarId: string, selected: boolean): void {
    setSelectedCalendarIds((current) => {
      const next = new Set(current);

      if (selected) {
        next.add(calendarId);
      } else {
        next.delete(calendarId);
      }

      return [...next];
    });
  }

  async function completeSetup(
    overrides: Partial<Pick<
      SettingsSnapshot,
      | "selectedTaskListIds"
      | "selectedCalendarIds"
      | "syncMode"
      | "notificationsEnabled"
      | "mcpEnabled"
      | "mcpPermissionMode"
    >> = {}
  ): Promise<void> {
    setSubmitting(true);
    setLocalError(null);

    const saved = await source.updateSettings({
      selectedTaskListIds: overrides.selectedTaskListIds ?? selectedTaskListIds,
      selectedCalendarIds: overrides.selectedCalendarIds ?? selectedCalendarIds,
      syncMode: overrides.syncMode ?? syncMode,
      notificationsEnabled: overrides.notificationsEnabled ?? notificationsEnabled,
      mcpEnabled: overrides.mcpEnabled ?? mcpEnabled,
      mcpPermissionMode: overrides.mcpPermissionMode ?? mcpPermissionMode,
      setupCompletedAt: new Date().toISOString()
    });

    if (!saved) {
      setSubmitting(false);
      setLocalError("Setup preferences were not saved.");
    }
  }

  return (
    <div
      aria-labelledby="first-run-title"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-bg-primary/80 p-6"
      role="dialog"
    >
      <div className="flex max-h-[calc(100vh-48px)] w-full max-w-5xl flex-col overflow-hidden rounded-hcbMd border border-border bg-bg-primary shadow-hcbLg">
        <header className="flex min-h-14 items-center justify-between gap-4 border-b border-border px-5">
          <div className="min-w-0">
            <h2 className="truncate text-[var(--text-xl)] font-bold text-text-primary" id="first-run-title">
              First-run setup
            </h2>
            <p className="truncate text-[var(--text-sm)] text-text-muted">
              Configure Mac v1 preferences; local notes and settings stay available without Google.
            </p>
          </div>
          <Badge tone={accountState === "connected" ? "success" : "warning"}>
            Google {accountState === "connected" ? "connected" : "not connected"}
          </Badge>
        </header>

        <div className="grid min-h-0 gap-3 overflow-y-auto p-4">
          <div className="grid grid-cols-3 gap-3">
            <SetupCard
              description={
                oauthLoopbackReady
                  ? "OAuth loopback is available; credentials stay outside the renderer."
                  : "Runtime OAuth client setup is still required in Settings."
              }
              icon={Cloud}
              status={oauthLoopbackReady ? "Ready" : "Needs setup"}
              title="1. Google runtime"
            />
            <SetupCard
              description={`${selectedTaskListIds.length} task list${selectedTaskListIds.length === 1 ? "" : "s"} selected`}
              icon={ListChecks}
              status={source.taskLists.length === 0 ? "No cache" : "Selected"}
              title="2. Task lists"
            />
            <SetupCard
              description={`${selectedCalendarIds.length} calendar${selectedCalendarIds.length === 1 ? "" : "s"} selected`}
              icon={CalendarDays}
              status={source.calendarSources.length === 0 ? "No cache" : "Selected"}
              title="3. Calendars"
            />
          </div>

          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
            <section className="min-w-0 rounded-hcbMd border border-border bg-bg-secondary">
              <div className="border-b border-border px-3 py-2">
                <h3 className="text-[var(--text-md)] font-semibold text-text-primary">Task lists</h3>
                <p className="text-[var(--text-xs)] text-text-muted">Cached Google Tasks lists</p>
              </div>
              <div className="grid max-h-44 gap-2 overflow-y-auto p-3">
                {source.taskLists.length === 0 ? (
                  <p className="text-[var(--text-sm)] text-text-muted">No cached task lists.</p>
                ) : source.taskLists.map((taskList) => (
                  <label
                    className="flex min-h-8 items-center gap-2 rounded-hcbMd border border-border bg-bg-tertiary px-3 text-[var(--text-sm)] text-text-secondary"
                    key={taskList.id}
                  >
                    <input
                      aria-label={`Select task list ${taskList.title}`}
                      checked={selectedTaskLists.has(taskList.id)}
                      className="accent-[var(--color-accent)]"
                      onChange={(event) => toggleTaskList(taskList.id, event.target.checked)}
                      type="checkbox"
                    />
                    <span className="min-w-0 flex-1 truncate">{taskList.title}</span>
                    <Badge>{taskList.activeTaskCount ?? taskList.taskCount ?? 0}</Badge>
                  </label>
                ))}
              </div>
            </section>

            <section className="min-w-0 rounded-hcbMd border border-border bg-bg-secondary">
              <div className="border-b border-border px-3 py-2">
                <h3 className="text-[var(--text-md)] font-semibold text-text-primary">Calendars</h3>
                <p className="text-[var(--text-xs)] text-text-muted">Cached Google Calendar lists</p>
              </div>
              <div className="grid max-h-44 gap-2 overflow-y-auto p-3">
                {source.calendarSources.length === 0 ? (
                  <p className="text-[var(--text-sm)] text-text-muted">No cached calendars.</p>
                ) : source.calendarSources.map((calendar) => (
                  <label
                    className="flex min-h-8 items-center gap-2 rounded-hcbMd border border-border bg-bg-tertiary px-3 text-[var(--text-sm)] text-text-secondary"
                    key={calendar.id}
                  >
                    <input
                      aria-label={`Select calendar ${calendar.title}`}
                      checked={selectedCalendars.has(calendar.id)}
                      className="accent-[var(--color-accent)]"
                      onChange={(event) => toggleCalendar(calendar.id, event.target.checked)}
                      type="checkbox"
                    />
                    <span className="min-w-0 flex-1 truncate">{calendar.title}</span>
                    <Badge>{calendar.eventCount ?? 0}</Badge>
                  </label>
                ))}
              </div>
            </section>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <SetupOption title="4. Sync mode" icon={RefreshCw}>
              <select
                aria-label="Onboarding sync mode"
                className={onboardingSelectClass}
                onChange={(event) => setSyncMode(event.target.value as SettingsSnapshot["syncMode"])}
                value={syncMode}
              >
                <option value="manual">Manual</option>
                <option value="balanced">Balanced</option>
                <option value="near-real-time">Near real time</option>
              </select>
            </SetupOption>
            <SetupOption title="5. Notifications" icon={Bell}>
              <label className="flex min-h-8 items-center gap-2 text-[var(--text-sm)] text-text-secondary">
                <input
                  checked={notificationsEnabled}
                  className="accent-[var(--color-accent)]"
                  onChange={(event) => setNotificationsEnabled(event.target.checked)}
                  type="checkbox"
                />
                Local notifications
              </label>
            </SetupOption>
            <SetupOption title="6. MCP access" icon={Server}>
              <div className="grid gap-2">
                <label className="flex min-h-8 items-center gap-2 text-[var(--text-sm)] text-text-secondary">
                  <input
                    checked={mcpEnabled}
                    className="accent-[var(--color-accent)]"
                    onChange={(event) => setMcpEnabled(event.target.checked)}
                    type="checkbox"
                  />
                  Enable MCP
                </label>
                <select
                  aria-label="Onboarding MCP permission mode"
                  className={onboardingSelectClass}
                  disabled={!mcpEnabled}
                  onChange={(event) =>
                    setMcpPermissionMode(event.target.value as SettingsSnapshot["mcpPermissionMode"])
                  }
                  value={mcpPermissionMode}
                >
                  <option value="read-only">Read-only</option>
                  <option value="confirm-writes">Confirm writes</option>
                  <option value="allow-writes">Allow writes</option>
                </select>
              </div>
            </SetupOption>
          </div>

          {source.settingsMutationError || localError ? (
            <StatusBanner
              description={source.settingsMutationError ?? localError ?? "Setup settings failed."}
              title="Setup not saved"
              tone="warning"
            />
          ) : null}
        </div>

        <footer className="flex min-h-14 items-center justify-between gap-3 border-t border-border px-5">
          <Button
            disabled={submitting || source.settingsMutationPending}
            onClick={() =>
              void completeSetup({
                selectedTaskListIds: [],
                selectedCalendarIds: [],
                syncMode: "manual",
                notificationsEnabled: false,
                mcpEnabled: false,
                mcpPermissionMode: "read-only"
              })
            }
            variant="ghost"
          >
            Use local-only
          </Button>
          <Button
            disabled={submitting || source.settingsMutationPending}
            onClick={() => void completeSetup()}
            variant="primary"
          >
            <CheckCircle2 aria-hidden="true" size={15} />
            Finish setup
          </Button>
        </footer>
      </div>
    </div>
  );
}

function SetupCard({
  description,
  icon: Icon,
  status,
  title
}: {
  description: string;
  icon: typeof Cloud;
  status: string;
  title: string;
}): JSX.Element {
  return (
    <section className="min-w-0 rounded-hcbMd border border-border bg-bg-secondary p-3">
      <div className="flex items-center gap-2">
        <div className="flex size-7 shrink-0 items-center justify-center rounded-hcbSm bg-surface-0 text-accent">
          <Icon aria-hidden="true" size={15} />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[var(--text-md)] font-semibold text-text-primary">{title}</h3>
        </div>
        <Badge tone={status === "Ready" || status === "Selected" ? "success" : "warning"}>{status}</Badge>
      </div>
      <p className="mt-2 line-clamp-2 text-[var(--text-sm)] text-text-muted">{description}</p>
    </section>
  );
}

function SetupOption({
  children,
  icon: Icon,
  title
}: {
  children: JSX.Element;
  icon: typeof Cloud;
  title: string;
}): JSX.Element {
  return (
    <section className="min-w-0 rounded-hcbMd border border-border bg-bg-secondary p-3">
      <div className="mb-3 flex items-center gap-2">
        <Icon aria-hidden="true" className="text-accent" size={15} />
        <h3 className="truncate text-[var(--text-md)] font-semibold text-text-primary">{title}</h3>
      </div>
      {children}
    </section>
  );
}

const onboardingSelectClass =
  "h-8 w-full rounded-hcbMd border border-border bg-surface-0 px-2 text-[var(--text-base)] text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
