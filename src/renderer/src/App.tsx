import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import type { NativeAction, SettingsSnapshot } from "@shared/ipc/contracts";
import {
  resolveAppColorTheme,
  resolveAppThemeMode,
  semanticThemeVariables
} from "@shared/ipc/themeCatalog";
import {
  Bell,
  Command,
  RefreshCw,
  X
} from "lucide-react";
import appIconUrl from "../../../assets/brand/buns-app-icon-sidebar.png";
import type { PlannerAction } from "./actions/plannerActions";
import { InspectorProvider, InspectorShell } from "./components/Inspector";
import { Badge, Button, IconButton, Input, StatusBanner, cx } from "./components/primitives";
import { getPlannerSection, plannerSections, type SectionId } from "./data/mockPlanner";
import { getAppNotifications, type AppNotification, type AppNotificationTone } from "./features/core/appNotifications";
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

const DeferredCommandPalette = lazy(() =>
  import("./components/CommandPalette").then((module) => ({
    default: module.CommandPalette
  }))
);

const DeferredFirstRunOnboarding = lazy(() =>
  import("./components/FirstRunOnboarding").then((module) => ({
    default: module.FirstRunOnboarding
  }))
);

function scheduleFrame(callback: () => void): void {
  if (typeof window.requestAnimationFrame === "function") {
    window.requestAnimationFrame(callback);
    return;
  }

  window.setTimeout(callback, 0);
}

const systemFontStack = "-apple-system, BlinkMacSystemFont, \"SF Pro Text\", \"Segoe UI\", system-ui, Roboto, \"Helvetica Neue\", Arial, sans-serif";

function systemPrefersDark(): boolean {
  return typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function cssFontFamily(fontName: string | null): string {
  const trimmed = fontName?.trim();

  if (!trimmed) {
    return systemFontStack;
  }

  return `"${trimmed.replace(/[\\"]/g, "\\$&")}", ${systemFontStack}`;
}

function textSizeVariables(baseSize: number): Record<string, string> {
  const clamped = Math.min(24, Math.max(9, baseSize));
  const scale = clamped / 13;
  const px = (value: number): string => `${Math.round(value * scale * 100) / 100}px`;

  return {
    "--text-xs": px(11),
    "--text-sm": px(12),
    "--text-base": px(13),
    "--text-md": px(14),
    "--text-lg": px(16),
    "--text-xl": px(20),
    "--text-2xl": px(24)
  };
}

function useAppliedTheme(settings: SettingsSnapshot): void {
  const [prefersDark, setPrefersDark] = useState(systemPrefersDark);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") {
      return;
    }

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const listener = (event: MediaQueryListEvent): void => setPrefersDark(event.matches);
    setPrefersDark(media.matches);

    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", listener);
      return () => media.removeEventListener("change", listener);
    }

    media.addListener(listener);
    return () => media.removeListener(listener);
  }, []);

  useEffect(() => {
    const mode = resolveAppThemeMode(settings.theme, prefersDark);
    const colorTheme = resolveAppColorTheme(settings.colorTheme, mode);
    const root = document.documentElement;

    root.dataset.theme = mode;
    root.dataset.colorTheme = colorTheme.id;
    root.style.setProperty("--font-family", cssFontFamily(settings.uiFontName));

    for (const [name, value] of Object.entries(semanticThemeVariables(colorTheme))) {
      root.style.setProperty(name, value);
    }

    for (const [name, value] of Object.entries(textSizeVariables(settings.uiTextSizePoints))) {
      root.style.setProperty(name, value);
    }
  }, [
    prefersDark,
    settings.colorTheme,
    settings.theme,
    settings.uiFontName,
    settings.uiTextSizePoints
  ]);
}

function shellCanBeReported(source: CoreViewModelSource): boolean {
  return (
    source.appearanceReady ||
    source.dataState === "offline" ||
    source.dataState === "error"
  );
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
  useAppliedTheme(source.settings);
  const [activeSectionId, setActiveSectionId] = useState<SectionId>("today");
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [taskCommand, setTaskCommand] = useState<TaskSurfaceCommand | null>(null);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
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
    if (shellVisibleReported.current || !shellCanBeReported(source)) {
      return;
    }

    shellVisibleReported.current = true;
    scheduleFrame(() => {
      void window.hcb?.diagnostics.markShellVisible();
      void import("./components/CommandPalette");
    });
  }, [source]);

  useEffect(() => {
    if (!onboardingVisible) {
      return;
    }

    scheduleFrame(() => {
      void import("./components/FirstRunOnboarding");
    });
  }, [onboardingVisible]);

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
    if (!notificationsOpen) {
      return;
    }

    function handleKeyDown(event: globalThis.KeyboardEvent): void {
      if (event.key === "Escape") {
        event.preventDefault();
        setNotificationsOpen(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [notificationsOpen]);

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
      className="grid h-dvh min-h-0 overflow-hidden grid-rows-[auto_minmax(0,1fr)] bg-bg-primary text-text-primary md:grid-cols-[72px_minmax(0,1fr)] md:grid-rows-none lg:grid-cols-[232px_minmax(0,1fr)]"
      data-testid="app-shell"
    >
      <aside className="flex min-h-0 min-w-0 flex-row items-center overflow-x-auto border-b border-border bg-bg-secondary md:flex-col md:items-stretch md:overflow-hidden md:border-b-0 md:border-r">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center border-r border-border px-3 md:w-auto md:border-b md:border-r-0 lg:justify-start lg:gap-3 lg:px-4">
          <img
            alt=""
            aria-hidden="true"
            className="size-8 rounded-hcbMd object-cover"
            draggable={false}
            src={appIconUrl}
          />
          <div className="hidden min-w-0 lg:block">
            <div className="truncate text-[var(--text-md)] font-semibold">Hot Cross Buns 2</div>
            <div className="text-[var(--text-xs)] text-text-muted">Local planner</div>
          </div>
        </div>

        <nav aria-label="Primary" className="flex min-h-0 min-w-0 flex-1 gap-1 overflow-x-auto px-2 py-2 md:flex-col md:overflow-x-hidden md:overflow-y-auto md:py-3">
          {plannerSections.map((section) => {
            const Icon = section.icon;
            const selected = section.id === activeSectionId;

            return (
              <button
                aria-current={selected ? "page" : undefined}
                aria-label={section.label}
                className={cx(
                  "flex h-9 w-auto min-w-9 items-center justify-center gap-3 rounded-hcbMd px-2 text-left text-[var(--text-base)] transition-colors duration-fast ease-hcb focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent md:w-full lg:justify-start lg:px-3",
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
                <Icon aria-hidden="true" className="shrink-0" size={16} strokeWidth={2} />
                <span className="hidden min-w-0 flex-1 truncate lg:inline">{section.label}</span>
                <span className="hidden shrink-0 text-[var(--text-xs)] text-text-muted lg:inline">
                  {sectionMetric(source, section.id)}
                </span>
              </button>
            );
          })}
        </nav>

        <div className="hidden border-t border-border px-4 py-3 text-[var(--text-xs)] text-text-muted lg:block">
          <div className="flex items-center justify-between gap-3">
            <span>Runtime</span>
            <Badge tone={healthLabel === "Ready" ? "success" : "neutral"}>{healthLabel}</Badge>
          </div>
        </div>
      </aside>

      <main className="flex min-h-0 min-w-0 flex-col overflow-hidden">
        <header className="flex min-h-14 shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border bg-bg-primary px-3 py-2 sm:flex-nowrap md:px-5">
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

          <div className="flex min-w-0 shrink-0 items-center gap-2 overflow-x-auto" role="toolbar" aria-label="Planner actions">
            <Button
              aria-label="Command palette"
              aria-keyshortcuts="Meta+P Control+P"
              className="min-w-8"
              onClick={openCommandPalette}
              variant="secondary"
            >
              <Command aria-hidden="true" size={15} />
              <span className="hidden sm:inline">Command palette</span>
              <span className="hidden rounded-hcbSm border border-border px-1.5 font-mono text-[var(--text-xs)] text-text-muted md:inline">
                Cmd P
              </span>
            </Button>
            <Button
              aria-expanded={notificationsOpen}
              aria-label={`Notifications, ${appNotifications.length} active`}
              className="min-w-8"
              onClick={() => setNotificationsOpen((open) => !open)}
              title="Notifications"
              variant={notificationsOpen ? "secondary" : "ghost"}
            >
              <Bell aria-hidden="true" size={15} />
              <span className="hidden sm:inline">Notifications</span>
              <Badge tone={appNotifications.length > 1 ? "warning" : "neutral"}>
                {appNotifications.length}
              </Badge>
            </Button>
            <Button
              aria-label="Reload"
              aria-keyshortcuts="Meta+R Control+R"
              className="min-w-8"
              data-action-id="sync.refresh"
              onClick={source.refresh}
              title="Reload local cache"
              variant="ghost"
            >
              <RefreshCw aria-hidden="true" size={15} />
              <span className="hidden sm:inline">Reload</span>
              <span className="hidden rounded-hcbSm border border-border px-1.5 font-mono text-[var(--text-xs)] text-text-muted md:inline">
                Cmd R
              </span>
            </Button>
          </div>
        </header>

        <section
          aria-labelledby="planner-title"
          className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-auto p-2 sm:p-3 md:p-4"
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
        <Suspense fallback={null}>
          <DeferredCommandPalette
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
        </Suspense>
      </RenderTimingBoundary>

      {onboardingVisible ? (
        <Suspense fallback={null}>
          <DeferredFirstRunOnboarding source={source} />
        </Suspense>
      ) : null}
      {notificationsOpen ? (
        <NotificationsOverlay
          notifications={appNotifications}
          onClose={() => setNotificationsOpen(false)}
          source={source}
        />
      ) : null}
      {visibleNotification && !notificationsOpen ? (
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

function notificationBadgeTone(tone: AppNotificationTone): "neutral" | "success" | "warning" | "danger" | "info" {
  if (tone === "success") {
    return "success";
  }

  if (tone === "danger") {
    return "danger";
  }

  if (tone === "warning" || tone === "offline") {
    return "warning";
  }

  return "info";
}

function NotificationsOverlay({
  notifications,
  onClose,
  source
}: {
  notifications: AppNotification[];
  onClose: () => void;
  source: CoreViewModelSource;
}): JSX.Element {
  const notificationSection = source.settingsSections.find((section) => section.id === "notifications");
  const permission =
    notificationSection?.rows.find((row) => row.id === "permission")?.value ??
    source.native.notificationsStatus.permission;
  const scheduled =
    notificationSection?.rows.find((row) => row.id === "scheduled")?.value ??
    String(source.native.notificationsStatus.scheduledCount);

  function updateLeadMinutes(value: string): void {
    void source.updateSettings({ notificationLeadMinutes: Number(value) || 0 });
  }

  function requestNotificationPermission(): void {
    void window.hcb?.native.requestNotificationPermission().then(() => {
      source.refresh();
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-end overflow-auto bg-bg-tertiary/45 p-3 backdrop-blur-sm sm:p-5"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        aria-labelledby="notifications-overlay-title"
        aria-modal="true"
        className="flex max-h-[calc(100dvh-24px)] w-full max-w-[720px] flex-col overflow-hidden rounded-hcbLg border border-border bg-bg-primary/95 shadow-2xl sm:mt-12 sm:max-h-[calc(100dvh-96px)]"
        role="dialog"
      >
        <header className="flex min-h-14 items-center justify-between gap-3 border-b border-border bg-bg-secondary/80 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-hcbMd bg-surface-0 text-accent">
              <Bell aria-hidden="true" size={18} />
            </div>
            <div className="min-w-0">
              <h2 className="truncate text-[var(--text-lg)] font-semibold" id="notifications-overlay-title">
                Notifications
              </h2>
              <p className="truncate text-[var(--text-sm)] text-text-muted">
                App notices and local reminders
              </p>
            </div>
          </div>
          <IconButton icon={X} label="Close notifications" onClick={onClose} variant="ghost" />
        </header>

        <div className="grid min-h-0 gap-3 overflow-auto p-4">
          <section className="grid gap-2">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-[var(--text-md)] font-semibold">App notices</h3>
              <Badge tone={notifications.length > 1 ? "warning" : "neutral"}>
                {notifications.length}
              </Badge>
            </div>
            <div className="grid gap-2" role="list">
              {notifications.map((notification) => (
                <div
                  className="grid gap-1 rounded-hcbMd border border-border bg-bg-tertiary px-3 py-2"
                  key={notification.id}
                  role="listitem"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="min-w-0 truncate text-[var(--text-base)] font-medium">
                      {notification.title}
                    </span>
                    <Badge tone={notificationBadgeTone(notification.tone)}>{notification.status}</Badge>
                  </div>
                  <p className="text-[var(--text-sm)] text-text-muted">{notification.description}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="grid gap-3 rounded-hcbMd border border-border bg-bg-tertiary p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h3 className="truncate text-[var(--text-md)] font-semibold">Local reminders</h3>
                <p className="truncate text-[var(--text-sm)] text-text-muted">
                  {notificationSection?.status ?? "Not configured"}
                </p>
              </div>
              <Badge tone={source.settings.notificationsEnabled ? "success" : "neutral"}>
                {source.settings.notificationsEnabled ? "On" : "Off"}
              </Badge>
            </div>
            <label className="flex min-h-9 items-center gap-3 text-[var(--text-sm)] text-text-secondary">
              <input
                checked={source.settings.notificationsEnabled}
                className="accent-[var(--color-accent)]"
                onChange={(event) =>
                  void source.updateSettings({ notificationsEnabled: event.target.checked })
                }
                type="checkbox"
              />
              <span className="min-w-0 flex-1">Enable local notifications</span>
            </label>
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
              <Input
                aria-label="Notification lead minutes"
                defaultValue={String(source.settings.notificationLeadMinutes)}
                label="Lead time minutes"
                max={40320}
                min={0}
                onBlur={(event) => updateLeadMinutes(event.currentTarget.value)}
                type="number"
              />
              <Button className="self-end" onClick={requestNotificationPermission} variant="ghost">
                Request permission
              </Button>
            </div>
          </section>

          <section className="grid gap-2 rounded-hcbMd border border-border bg-bg-tertiary p-3">
            <h3 className="text-[var(--text-md)] font-semibold">Delivery status</h3>
            <div className="grid gap-2 text-[var(--text-sm)] sm:grid-cols-3">
              <div>
                <div className="text-text-muted">Permission</div>
                <div className="truncate font-medium">{permission}</div>
              </div>
              <div>
                <div className="text-text-muted">Scheduled</div>
                <div className="truncate font-medium">{scheduled}</div>
              </div>
              <div>
                <div className="text-text-muted">Lead time</div>
                <div className="truncate font-medium">{source.settings.notificationLeadMinutes} min</div>
              </div>
            </div>
          </section>
        </div>
      </section>
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
      className="fixed bottom-3 left-3 right-3 z-40 w-auto shadow-2xl sm:left-auto sm:right-4 sm:w-[min(420px,calc(100vw-32px))]"
      description={notification.description}
      title={notification.title}
      tone={notification.tone}
      role="status"
      aria-live="polite"
    />
  );
}
