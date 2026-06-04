import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CalendarEventRecurrence, NativeAction, SettingsSnapshot } from "@shared/ipc/contracts";
import type { PlannerAction } from "../../actions/plannerActions";
import type { QuickAddSubmitPayload } from "../../components/QuickAddDialog";
import { cx } from "../../components/primitives";
import { primaryPlannerSections, type SectionId } from "../../data/mockPlanner";
import { getAppNotifications } from "../core/appNotifications";
import { DiagnosticsOverlay } from "../core/DiagnosticsOverlay";
import type { TaskSurfaceCommand } from "../core/CoreScreens";
import { useCoreViewModelSource } from "../core/coreViewModelSource";
import { eventMatchesAccelerator } from "../core/hotkeys";
import {
  RenderTimingBoundary,
  rendererNow,
  reportRendererTimingSince,
  useRenderTiming
} from "../../hooks/useRenderTiming";
import { I18nProvider } from "../../i18n";
import { AppHeader } from "./AppHeader";
import { NotificationsOverlay, SettingsOverlay } from "./AppOverlays";
import { AppSidebar } from "./AppSidebar";
import { PaneWorkspace } from "./PaneWorkspace";
import { splitPaneWebUrl } from "./paneWorkspaceModel";
import {
  isEditableShortcutTarget,
  scheduleFrame,
  shellCanBeReported
} from "./shellUtils";
import { useAppliedTheme } from "./theme";
import type { VisiblePrimarySection } from "./types";
import { usePaneWorkspace } from "./usePaneWorkspace";

const DeferredCommandPalette = lazy(() =>
  import("../../components/CommandPalette").then((module) => ({
    default: module.CommandPalette
  }))
);

const DeferredFirstRunOnboarding = lazy(() =>
  import("../../components/FirstRunOnboarding").then((module) => ({
    default: module.FirstRunOnboarding
  }))
);

const DeferredQuickAddDialog = lazy(() =>
  import("../../components/QuickAddDialog").then((module) => ({
    default: module.QuickAddDialog
  }))
);

function quickAddRecurrenceDraft(recurrence: CalendarEventRecurrence | null): Record<string, unknown> {
  if (!recurrence) {
    return {};
  }

  const custom = recurrence.interval !== 1 || Boolean(recurrence.endsOn) || Boolean(recurrence.count) || Boolean(recurrence.byDay?.length);

  return {
    repeatFrequency: custom ? "custom" : recurrence.frequency,
    repeatCustomFrequency: recurrence.frequency,
    repeatInterval: String(recurrence.interval),
    repeatEndMode: recurrence.endsOn ? "on" : recurrence.count ? "after" : "never",
    repeatEndsOn: recurrence.endsOn ?? "",
    repeatCount: recurrence.count ? String(recurrence.count) : "",
    ...(recurrence.byDay?.length ? { repeatWeekdays: recurrence.byDay } : {})
  };
}

function closestAnchor(target: EventTarget | null): HTMLAnchorElement | null {
  return target instanceof Element ? target.closest<HTMLAnchorElement>("a[href]") : null;
}

export function AppShell(): JSX.Element {
  useRenderTiming("App");

  const source = useCoreViewModelSource();
  useAppliedTheme(source.settings);
  const paneWorkspace = usePaneWorkspace();
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [taskCommand, setTaskCommand] = useState<TaskSurfaceCommand | null>(null);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [commandPaletteInitialQuery, setCommandPaletteInitialQuery] = useState("");
  const [dismissedNotificationIds, setDismissedNotificationIds] = useState<string[]>([]);
  const [visibleCalendarIds, setVisibleCalendarIds] = useState<string[]>([]);
  const shellVisibleReported = useRef(false);
  const commandPaletteOpenStartedAt = useRef<number | null>(null);
  const settingsDialogRef = useRef<HTMLElement | null>(null);
  const calendarVisibilityInitialized = useRef(false);

  const appNotifications = getAppNotifications(source);
  const visibleNotifications = appNotifications.filter(
    (notification) => !dismissedNotificationIds.includes(notification.id)
  );
  const visiblePrimarySections = useMemo<VisiblePrimarySection[]>(() => {
    const hidden = new Set<SectionId>(source.settings.hiddenNavigationTabs);
    const byId = new Map(primaryPlannerSections.map((section) => [section.id, section]));
    return source.settings.navigationTabOrder
      .map((sectionId) => byId.get(sectionId))
      .filter((section): section is (typeof primaryPlannerSections)[number] => Boolean(section))
      .map((section) => ({ section }))
      .filter(({ section }) => !hidden.has(section.id));
  }, [source.settings.hiddenNavigationTabs, source.settings.navigationTabOrder]);
  const visiblePaneSectionIds = useMemo(
    () => visiblePrimarySections.map(({ section }) => section.id),
    [visiblePrimarySections]
  );
  const availableCalendarIds = useMemo(
    () => new Set(source.calendarSources.map((calendar) => calendar.id)),
    [source.calendarSources]
  );
  const visibleCalendarIdSet = useMemo(
    () => new Set(visibleCalendarIds.filter((calendarId) => availableCalendarIds.has(calendarId))),
    [availableCalendarIds, visibleCalendarIds]
  );
  const sidebarOnRight = source.settings.navigationPlacement === "right";
  const googleConnected = source.googleStatus.account?.connectionState === "connected";
  const onboardingVisible =
    (source.settings.setupCompletedAt === null || !googleConnected) &&
    source.dataState !== "loading" &&
    source.dataState !== "offline" &&
    source.dataState !== "error";

  const navigateToSection = useCallback((sectionId: SectionId): void => {
    paneWorkspace.replaceFocusedWithSection(sectionId);
  }, [paneWorkspace]);

  const toggleVisibleCalendar = useCallback((calendarId: string, selected: boolean): void => {
    setVisibleCalendarIds((current) => {
      const next = new Set(current);

      if (selected) {
        next.add(calendarId);
      } else {
        next.delete(calendarId);
      }

      return Array.from(next);
    });
  }, []);

  const showAllCalendars = useCallback((): void => {
    setVisibleCalendarIds(source.calendarSources.map((calendar) => calendar.id));
  }, [source.calendarSources]);

  const dismissNotification = useCallback((id: string): void => {
    setDismissedNotificationIds((current) =>
      current.includes(id) ? current : [...current, id]
    );
  }, []);

  const dismissAllVisibleNotifications = useCallback((): void => {
    setDismissedNotificationIds((current) => {
      const next = new Set(current);

      for (const notification of visibleNotifications) {
        next.add(notification.id);
      }

      return [...next];
    });
  }, [visibleNotifications]);

  const navigateToPrimarySection = useCallback(
    (sectionId: SectionId): void => {
      setCommandPaletteOpen(false);
      setNotificationsOpen(false);
      setSettingsOpen(false);
      navigateToSection(sectionId);
    },
    [navigateToSection]
  );

  const openSettingsPanel = useCallback((): void => {
    setCommandPaletteOpen(false);
    setNotificationsOpen(false);
    setDiagnosticsOpen(false);
    setSettingsOpen(true);
  }, []);

  const openDiagnosticsPanel = useCallback((): void => {
    setCommandPaletteOpen(false);
    setNotificationsOpen(false);
    setSettingsOpen(false);
    setDiagnosticsOpen(true);
  }, []);

  const navigateOrOpenSettings = useCallback(
    (sectionId: SectionId): void => {
      if (sectionId === "settings") {
        openSettingsPanel();
        return;
      }

      navigateToSection(sectionId);
    },
    [navigateToSection, openSettingsPanel]
  );

  const openCommandPalette = useCallback((initialQuery = ""): void => {
    commandPaletteOpenStartedAt.current = rendererNow();
    setCommandPaletteInitialQuery(initialQuery);
    setNotificationsOpen(false);
    setDiagnosticsOpen(false);
    setSettingsOpen(false);
    setCommandPaletteOpen(true);
  }, []);

  const openQuickAdd = useCallback((): void => {
    setCommandPaletteOpen(false);
    setNotificationsOpen(false);
    setDiagnosticsOpen(false);
    setSettingsOpen(false);
    setQuickAddOpen(true);
  }, []);

  const toggleNotificationsPanel = useCallback((): void => {
    setSettingsOpen(false);
    setDiagnosticsOpen(false);
    setNotificationsOpen((open) => !open);
  }, []);

  const toggleDiagnosticsPanel = useCallback((): void => {
    setSettingsOpen(false);
    setNotificationsOpen(false);
    setDiagnosticsOpen((open) => !open);
  }, []);

  const toggleSettingsPanel = useCallback((): void => {
    if (settingsOpen) {
      setSettingsOpen(false);
      return;
    }

    openSettingsPanel();
  }, [openSettingsPanel, settingsOpen]);

  const toggleSidebar = useCallback((): void => {
    setSidebarOpen((open) => !open);
  }, []);

  const triggerTaskCommand = useCallback(
    (id: TaskSurfaceCommand["id"]): void => {
      navigateToSection("tasks");
      setTaskCommand((current) => ({
        id,
        nonce: (current?.nonce ?? 0) + 1,
        paneId: paneWorkspace.focusedPaneId
      }));
    },
    [navigateToSection, paneWorkspace.focusedPaneId]
  );

  const handleNativeAction = useCallback(
    (action: NativeAction): void => {
      if (action.type === "openSettings") {
        openSettingsPanel();
        return;
      }

      if (action.type === "refresh") {
        source.refresh();
        return;
      }

      if (action.route.kind === "search") {
        openCommandPalette(action.route.query ?? "");
        return;
      }

      if (action.route.kind === "settings") {
        openSettingsPanel();
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

      navigateToSection("calendar");
    },
    [navigateToSection, openCommandPalette, openSettingsPanel, source.refresh]
  );

  const handlePaletteCommand = useCallback(
    (command: PlannerAction): boolean => {
      if (command.id === "quickAdd.open") {
        openQuickAdd();
        return true;
      }

      if (command.id === "sync.refresh") {
        source.refresh();
        return true;
      }

      if (command.id === "undo.perform") {
        void source.undo();
        return true;
      }

      if (command.id === "redo.perform") {
        void source.redo();
        return true;
      }

      if (command.id === "diagnostics.copy") {
        openDiagnosticsPanel();
        return true;
      }

      if (command.sectionId === "settings") {
        openSettingsPanel();
        return true;
      }

      if (command.taskCommand === undefined) {
        return false;
      }

      triggerTaskCommand(command.taskCommand as TaskSurfaceCommand["id"]);
      return true;
    },
    [
      openDiagnosticsPanel,
      openQuickAdd,
      openSettingsPanel,
      source.redo,
      source.refresh,
      source.undo,
      triggerTaskCommand
    ]
  );

  const handleQuickAddSubmit = useCallback(
    (payload: QuickAddSubmitPayload): void => {
      setQuickAddOpen(false);

      if (payload.mode === "task") {
        navigateToSection("tasks");
        window.setTimeout(() => {
          window.dispatchEvent(new CustomEvent("hcb:task-command", {
            detail: {
              action: "new-task",
              draft: {
                title: payload.title,
                notes: payload.notes,
                dueDate: payload.dueDate,
                listId: payload.listId
              }
            }
          }));
        }, 0);
        return;
      }

      if (payload.mode === "note") {
        navigateToSection("notes");
        window.setTimeout(() => {
          window.dispatchEvent(new CustomEvent("hcb:note-command", {
            detail: {
              action: "new-note",
              title: payload.title,
              body: payload.body,
              listId: payload.listId
            }
          }));
        }, 0);
        return;
      }

      navigateToSection("calendar");
      window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent("hcb:calendar-command", {
          detail: {
            action: "quick-add",
            createMode: payload.mode,
            draft: {
              title: payload.title,
              calendarId: payload.calendarId,
              startsAt: payload.startsAt,
              endsAt: payload.endsAt,
              allDay: payload.allDay,
              location: payload.location,
              notes: payload.notes,
              ...quickAddRecurrenceDraft(payload.recurrence)
            }
          }
        }));
      }, 0);
    },
    [navigateToSection]
  );

  const runHotkeyAction = useCallback(
    (actionId: keyof SettingsSnapshot["keybindings"]): void => {
      if (actionId === "task.create") {
        triggerTaskCommand("task.create");
        return;
      }

      if (actionId === "note.create") {
        navigateToSection("notes");
        window.dispatchEvent(new CustomEvent("hcb:note-command", { detail: { action: "new-note" } }));
        return;
      }

      if (actionId === "calendar.create") {
        navigateToSection("calendar");
        window.dispatchEvent(new CustomEvent("hcb:calendar-command", { detail: { action: "new-event" } }));
        return;
      }

      if (actionId === "commandPalette.open") {
        openCommandPalette();
        return;
      }

      if (actionId === "print.today") {
        navigateToSection("calendar");
        window.setTimeout(() => window.print(), 0);
        return;
      }

      if (actionId === "sync.refresh") {
        source.refresh();
        return;
      }

      if (actionId === "sync.forceFullResync") {
        void source.runRecoveryAction({
          action: "forceFullResync",
          confirmation: {
            accepted: true,
            phrase: "FULL RESYNC"
          }
        });
        return;
      }

      if (actionId === "undo.perform") {
        void source.undo();
        return;
      }

      if (actionId === "redo.perform") {
        void source.redo();
        return;
      }

      if (actionId === "navigation.today") {
        navigateToPrimarySection("calendar");
        return;
      }

      if (actionId === "navigation.tasks") {
        navigateToPrimarySection("tasks");
        return;
      }

      if (actionId === "navigation.calendar") {
        navigateToPrimarySection("calendar");
        return;
      }

      if (actionId === "navigation.notes") {
        navigateToPrimarySection("notes");
        return;
      }

      if (actionId === "navigation.search") {
        openCommandPalette();
        return;
      }

      if (actionId === "navigation.settings") {
        openSettingsPanel();
        return;
      }

      if (actionId === "navigation.diagnostics.toggle") {
        toggleDiagnosticsPanel();
        return;
      }

      if (actionId === "navigation.sidebar.toggle") {
        toggleSidebar();
        return;
      }

      if (actionId === "navigation.notifications.toggle") {
        toggleNotificationsPanel();
        return;
      }

      if (actionId === "pane.create") {
        paneWorkspace.openChooser();
        return;
      }

      if (actionId === "web.tab.create") {
        paneWorkspace.newWebTab(paneWorkspace.focusedPaneId);
        return;
      }

      if (actionId === "pane.close") {
        paneWorkspace.closePane(paneWorkspace.focusedPaneId);
        return;
      }

      if (actionId === "pane.split.horizontal") {
        paneWorkspace.splitPane(paneWorkspace.focusedPaneId, "row");
        return;
      }

      if (actionId === "pane.split.vertical") {
        paneWorkspace.splitPane(paneWorkspace.focusedPaneId, "column");
        return;
      }

      if (actionId === "pane.focus.left") {
        paneWorkspace.focusPaneByDirection("left");
        return;
      }

      if (actionId === "pane.focus.right") {
        paneWorkspace.focusPaneByDirection("right");
        return;
      }

      if (actionId === "pane.focus.up") {
        paneWorkspace.focusPaneByDirection("up");
        return;
      }

      if (actionId === "pane.focus.down") {
        paneWorkspace.focusPaneByDirection("down");
        return;
      }

      if (actionId.startsWith("calendar.view.")) {
        const viewId = actionId.replace("calendar.view.", "");
        navigateToPrimarySection("calendar");
        window.dispatchEvent(new CustomEvent("hcb:calendar-command", { detail: { action: "set-view", viewId } }));
      }
    },
    [
      navigateToPrimarySection,
      navigateToSection,
      openCommandPalette,
      paneWorkspace.closePane,
      paneWorkspace.focusPaneByDirection,
      paneWorkspace.focusedPaneId,
      paneWorkspace.newWebTab,
      paneWorkspace.openChooser,
      paneWorkspace.splitPane,
      toggleDiagnosticsPanel,
      openSettingsPanel,
      source.refresh,
      source.redo,
      source.runRecoveryAction,
      source.undo,
      toggleNotificationsPanel,
      toggleSidebar,
      triggerTaskCommand
    ]
  );

  useEffect(() => {
    if (source.calendarSources.length === 0) {
      setVisibleCalendarIds([]);
      calendarVisibilityInitialized.current = false;
      return;
    }

    if (!calendarVisibilityInitialized.current) {
      const selectedCalendarIds = source.calendarSources
        .filter((calendar) => calendar.selected)
        .map((calendar) => calendar.id);

      setVisibleCalendarIds(
        selectedCalendarIds.length > 0
          ? selectedCalendarIds
          : source.calendarSources.map((calendar) => calendar.id)
      );
      calendarVisibilityInitialized.current = true;
      return;
    }

    setVisibleCalendarIds((current) => {
      const next = current.filter((calendarId) => availableCalendarIds.has(calendarId));
      return next.length === current.length ? current : next;
    });
  }, [availableCalendarIds, source.calendarSources]);

  useEffect(() => {
    if (shellVisibleReported.current || !shellCanBeReported(source)) {
      return;
    }

    shellVisibleReported.current = true;
    scheduleFrame(() => {
      void window.hcb?.diagnostics.markShellVisible();
      void import("../../components/CommandPalette");
      void import("../../components/QuickAddDialog");
    });
  }, [source]);

  useEffect(() => {
    if (!onboardingVisible) {
      return;
    }

    scheduleFrame(() => {
      void import("../../components/FirstRunOnboarding");
    });
  }, [onboardingVisible]);

  useEffect(() => window.hcb?.native.subscribeAction(handleNativeAction), [handleNativeAction]);

  useEffect(() => {
    const activePrimarySection = primaryPlannerSections.some((section) => section.id === paneWorkspace.activeSectionId);

    if (activePrimarySection && !visiblePrimarySections.some(({ section }) => section.id === paneWorkspace.activeSectionId)) {
      const replacement = visiblePrimarySections[0]?.section.id;

      if (replacement) {
        navigateToSection(replacement);
      }
    }
  }, [navigateToSection, paneWorkspace.activeSectionId, visiblePrimarySections]);

  useEffect(() => {
    function handleGlobalKeyDown(event: globalThis.KeyboardEvent): void {
      if (isEditableShortcutTarget(event.target) && !(event.metaKey || event.ctrlKey)) {
        return;
      }

      for (const [actionId, accelerator] of Object.entries(source.settings.keybindings) as Array<
        [keyof SettingsSnapshot["keybindings"], string | null]
      >) {
        if (!eventMatchesAccelerator(event, accelerator)) {
          continue;
        }

        if (
          isEditableShortcutTarget(event.target) &&
          (actionId === "undo.perform" || actionId === "redo.perform")
        ) {
          return;
        }

        event.preventDefault();
        runHotkeyAction(actionId);
        return;
      }
    }

    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, [
    runHotkeyAction,
    source.settings.keybindings
  ]);

  useEffect(() => {
    function handleDocumentClick(event: MouseEvent): void {
      if (event.defaultPrevented || event.button !== 0) {
        return;
      }

      const anchor = closestAnchor(event.target);
      const url = splitPaneWebUrl(anchor?.getAttribute("href") ?? null, window.location.href);

      if (!url) {
        return;
      }

      event.preventDefault();
      paneWorkspace.openUrl(url, anchor?.textContent ?? null);
    }

    document.addEventListener("click", handleDocumentClick, true);
    return () => document.removeEventListener("click", handleDocumentClick, true);
  }, [paneWorkspace]);

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
    if (!diagnosticsOpen) {
      return;
    }

    function handleKeyDown(event: globalThis.KeyboardEvent): void {
      if (event.key === "Escape") {
        event.preventDefault();
        setDiagnosticsOpen(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [diagnosticsOpen]);

  useEffect(() => {
    if (!settingsOpen) {
      return;
    }

    scheduleFrame(() => settingsDialogRef.current?.focus());

    function handleKeyDown(event: globalThis.KeyboardEvent): void {
      if (event.key === "Escape") {
        event.preventDefault();
        setSettingsOpen(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [settingsOpen]);

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
    <I18nProvider language={source.settings.appLanguage}>
    <div
      className={cx(
        "grid h-dvh min-h-0 overflow-hidden text-text-primary",
        sidebarOpen
          ? sidebarOnRight
            ? "grid-rows-[auto_minmax(0,1fr)] md:grid-cols-[minmax(0,1fr)_72px] md:grid-rows-none lg:grid-cols-[minmax(0,1fr)_232px]"
            : "grid-rows-[auto_minmax(0,1fr)] md:grid-cols-[72px_minmax(0,1fr)] md:grid-rows-none lg:grid-cols-[232px_minmax(0,1fr)]"
          : "grid-rows-[minmax(0,1fr)] md:grid-cols-[minmax(0,1fr)] md:grid-rows-none"
      )}
      data-testid="app-shell"
      style={{ background: "var(--app-shell-background)" }}
    >
      {sidebarOpen ? (
        <AppSidebar
          activeSectionId={paneWorkspace.activeSectionId}
          onShowAllCalendars={showAllCalendars}
          onToggleVisibleCalendar={toggleVisibleCalendar}
          onNavigateToSection={navigateToSection}
          sidebarOnRight={sidebarOnRight}
          source={source}
          visibleCalendarIds={visibleCalendarIdSet}
          visiblePrimarySections={visiblePrimarySections}
        />
      ) : null}

      <main className={cx("flex min-h-0 min-w-0 flex-col overflow-hidden", sidebarOnRight ? "md:order-1" : "md:order-2")}>
        <AppHeader
          activeSectionTitle={paneWorkspace.focusedTitle}
          appNotificationsCount={visibleNotifications.length}
          commandPaletteOpen={commandPaletteOpen}
          diagnosticsOpen={diagnosticsOpen}
          keybindings={source.settings.keybindings}
          notificationsOpen={notificationsOpen}
          onOpenCommandPalette={openCommandPalette}
          onOpenSplitPane={paneWorkspace.openChooser}
          onRefresh={source.refresh}
          onToggleDiagnostics={toggleDiagnosticsPanel}
          onToggleNotifications={toggleNotificationsPanel}
          onToggleSettings={toggleSettingsPanel}
          onToggleSidebar={toggleSidebar}
          settingsOpen={settingsOpen}
          sidebarOpen={sidebarOpen}
          toolbarActionOrder={source.settings.toolbarActionOrder}
        />

        <RenderTimingBoundary id={`pane-workspace:${paneWorkspace.activeSectionId}`}>
          <PaneWorkspace
            activeSectionId={paneWorkspace.activeSectionId}
            canSplit={paneWorkspace.canSplit}
            focusedPaneId={paneWorkspace.focusedPaneId}
            onClosePane={paneWorkspace.closePane}
            onFocusPane={paneWorkspace.focusPane}
            onMovePane={paneWorkspace.movePane}
            onOpenWebPage={paneWorkspace.openWebPageInPane}
            onReplacePane={paneWorkspace.replacePane}
            onSetSplitRatio={paneWorkspace.setSplitRatio}
            onSplitPane={paneWorkspace.splitPane}
            root={paneWorkspace.root}
            taskCommand={taskCommand}
            visibleCalendarIds={visibleCalendarIdSet}
            visibleSectionIds={visiblePaneSectionIds}
          />
        </RenderTimingBoundary>
      </main>

      <RenderTimingBoundary id="command-palette">
        <Suspense fallback={null}>
          <DeferredCommandPalette
            actionContext={{
              hasTaskLists: source.taskLists.length > 0,
              hasCalendars: source.calendarSources.length > 0,
              hasSelectedTask: false,
              canWriteTasks: !source.taskMutationPending,
              canWriteEvents: true,
              canUndo: source.undoStatus.canUndo,
              canRedo: source.undoStatus.canRedo
            }}
            initialQuery={commandPaletteInitialQuery}
            onCommand={handlePaletteCommand}
            onNavigate={navigateOrOpenSettings}
            onOpenChange={setCommandPaletteOpen}
            open={commandPaletteOpen}
          />
        </Suspense>
      </RenderTimingBoundary>

      <Suspense fallback={null}>
        <DeferredQuickAddDialog
          onClose={() => setQuickAddOpen(false)}
          onSubmit={handleQuickAddSubmit}
          open={quickAddOpen}
          source={source}
        />
      </Suspense>

      {onboardingVisible ? (
        <Suspense fallback={null}>
          <DeferredFirstRunOnboarding source={source} />
        </Suspense>
      ) : null}
      {notificationsOpen ? (
        <NotificationsOverlay
          notifications={visibleNotifications}
          onClose={() => setNotificationsOpen(false)}
          onDismiss={dismissNotification}
          onDismissAll={dismissAllVisibleNotifications}
        />
      ) : null}
      {diagnosticsOpen ? (
        <DiagnosticsOverlay onClose={() => setDiagnosticsOpen(false)} />
      ) : null}
      {settingsOpen ? (
        <SettingsOverlay
          dialogRef={settingsDialogRef}
          onOpenDiagnostics={openDiagnosticsPanel}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}
    </div>
    </I18nProvider>
  );
}
