import { useEffect, useRef, useState } from "react";
import { registerSW } from "virtual:pwa-register";

import { CalendarPanel } from "@/components/CalendarPanel";
import { CommandPalette, type CalendarHistory, type DriveHistory, type PaletteAction } from "@/components/CommandPalette";
import { Onboarding } from "@/components/Onboarding";
import { ImportDialog } from "@/components/ImportDialog";
import { DiagnosticsDialog } from "@/components/DiagnosticsDialog";
import { ForegroundReminders, pendingForegroundReminderCount, requestForegroundNotificationPermission } from "@/components/ForegroundReminders";
import { HealthPanel } from "@/components/HealthPanel";
import { Icon, type IconName } from "@/components/Icons";
import { LoadingState } from "@/components/LoadingState";
import { QuickCaptureDialog } from "@/components/QuickCaptureDialog";
import { SettingsPanel } from "@/components/SettingsPanel";
import { SyncDialog } from "@/components/SyncDialog";
import { TaskPanel, type TaskPanelCommand } from "@/components/TaskPanel";
import { TutorialDialog } from "@/components/TutorialDialog";
import type { CalendarPanelCommand } from "@/components/CalendarPanel";
import { localStore } from "@/data/localStore";
import { formatBinding, matchesBinding } from "@/features/keybindings";
import { useWorkspace } from "@/features/useWorkspace";

type View = "tasks" | "notes" | "calendar" | "settings" | "health";

interface LaunchQueueLike {
  setConsumer(consumer: (launchParams: { readonly files: readonly { getFile(): Promise<File> }[] }) => void): void;
}

const workspaceLoadingLabels = [
  "Loading Hot Cross Buns…",
  "Reading local workspace…",
  "Searching cached work…",
  "Thinking through your schedule…"
] as const;

export default function App(): React.JSX.Element {
  const workspace = useWorkspace();
  const [view, setView] = useState<View>("tasks");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [taskCommand, setTaskCommand] = useState<TaskPanelCommand>();
  const [calendarCommand, setCalendarCommand] = useState<CalendarPanelCommand>();
  const [calendarHistory, setCalendarHistory] = useState<CalendarHistory>({ status: "idle", documents: [] });
  const [driveHistory, setDriveHistory] = useState<DriveHistory>({ status: "idle", files: [] });
  const [quickCaptureOpen, setQuickCaptureOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importFile, setImportFile] = useState<File>();
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [deepLinkMessage, setDeepLinkMessage] = useState("");
  const [updateReady, setUpdateReady] = useState(false);
  const [syncDialogOpen, setSyncDialogOpen] = useState(false);
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const paletteButtonRef = useRef<HTMLButtonElement>(null);
  const updateServiceWorker = useRef<(() => Promise<void>) | undefined>(undefined);

  useEffect(() => {
    updateServiceWorker.current = registerSW({ onNeedRefresh: () => setUpdateReady(true) });
  }, []);

  useEffect(() => {
    const launchQueue = (window as Window & { readonly launchQueue?: LaunchQueueLike }).launchQueue;
    if (!launchQueue) return;
    launchQueue.setConsumer((launchParams) => {
      const fileHandle = launchParams.files[0];
      if (!fileHandle) return;
      void fileHandle.getFile().then((file) => { setImportFile(file); setImportOpen(true); });
    });
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      const bindings = workspace.preferences.keybindings;
      if (matchesBinding(event, bindings.commandPalette)) { event.preventDefault(); setPaletteOpen(true); return; }
      if (matchesBinding(event, bindings.quickCapture)) { event.preventDefault(); setQuickCaptureOpen(true); return; }
      if (matchesBinding(event, bindings.sync)) { event.preventDefault(); setSyncDialogOpen(true); void workspace.sync().catch(() => undefined); return; }
      if (matchesBinding(event, bindings.tasks)) { event.preventDefault(); setView("tasks"); return; }
      if (matchesBinding(event, bindings.notes)) { event.preventDefault(); setView("notes"); return; }
      if (matchesBinding(event, bindings.calendar)) { event.preventDefault(); setView("calendar"); return; }
      if (matchesBinding(event, bindings.settings)) { event.preventDefault(); setView("settings"); return; }
      if (matchesBinding(event, bindings.health)) { event.preventDefault(); setView("health"); return; }
      if (matchesBinding(event, bindings.tutorial)) { event.preventDefault(); setTutorialOpen(true); }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [workspace.preferences.keybindings, workspace.sync]);

  useEffect(() => {
    const root = document.documentElement;
    const preferences = workspace.preferences;
    root.dataset.theme = preferences.appearance === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : preferences.appearance === "system" ? "light" : preferences.appearance;
    root.dataset.density = preferences.density;
    // The neutral default becomes a high-contrast light gray in dark mode;
    // explicitly chosen accent colors remain unchanged in both themes.
    if (preferences.accentColor === "#2f3437" && root.dataset.theme === "dark") root.style.removeProperty("--hcb-accent");
    else root.style.setProperty("--hcb-accent", preferences.accentColor);
    root.style.setProperty("--hcb-font-scale", String(preferences.fontScale));
    root.style.setProperty("--hcb-task-pane-width", `${preferences.taskListPaneWidth}px`);
    const stacks = {
      system: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      sans: "Arial, Helvetica, sans-serif",
      serif: "ui-serif, Georgia, 'Times New Roman', serif",
      mono: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      arial: "Arial, Helvetica, sans-serif",
      georgia: "Georgia, 'Times New Roman', serif",
      verdana: "Verdana, Geneva, sans-serif",
      trebuchet: "'Trebuchet MS', Arial, sans-serif",
      courier: "'Courier New', Courier, monospace",
      custom: preferences.customFontFamily.trim() ? `"${preferences.customFontFamily.trim().replaceAll('"', "")}", ui-sans-serif, system-ui, sans-serif` : "ui-sans-serif, system-ui, sans-serif"
    } as const;
    root.style.setProperty("--hcb-font-family", stacks[preferences.fontFamily]);
    const previous = document.head.querySelector<HTMLLinkElement>("link[data-hcb-font-stylesheet]");
    const source = preferences.fontStylesheetUrl.trim();
    if (!source) {
      previous?.remove();
      return;
    }
    try {
      const url = new URL(source);
      if (url.protocol !== "https:") throw new Error("Only HTTPS font stylesheets are allowed");
      if (previous?.href === url.href) return;
      previous?.remove();
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = url.href;
      link.dataset.hcbFontStylesheet = "true";
      document.head.append(link);
    } catch {
      previous?.remove();
    }
  }, [workspace.preferences]);

  useEffect(() => {
    if (workspace.syncProgress.phase === "idle") return;
    setSyncDialogOpen(true);
    if (workspace.syncProgress.active) return;
    const timeout = window.setTimeout(() => setSyncDialogOpen(false), workspace.syncProgress.phase === "error" ? 7_000 : 1_800);
    return () => window.clearTimeout(timeout);
  }, [workspace.syncProgress.active, workspace.syncProgress.phase]);

  useEffect(() => {
    const current = workspace.workspace;
    if (!current) return;
    try {
      let parts = window.location.pathname.split("/").filter(Boolean);
      const protocolTarget = new URLSearchParams(window.location.search).get("open");
      if (protocolTarget) {
        const decodedTarget = decodeURIComponent(protocolTarget);
        const target = new URL(decodedTarget);
        if (target.protocol !== "web+hotcrossbuns:") throw new Error("Unsupported protocol target");
        const targetPath = target.pathname.split("/").filter(Boolean);
        parts = target.hostname ? [target.hostname, ...targetPath] : targetPath;
      }
      if (parts[0] === "task" && parts[1]) {
        const id = decodeURIComponent(parts[1]);
        const task = current.tasks.find((candidate) => candidate.id === id);
        if (task) { setView("tasks"); setTaskCommand({ id: crypto.randomUUID(), type: "open-task", taskId: task.id }); setDeepLinkMessage(""); }
        else setDeepLinkMessage("This task is not cached in this browser. Connect Google and sync, then try the link again.");
      }
      else if (parts[0] === "event" && parts[1] && parts[2]) {
        const calendarId = decodeURIComponent(parts[1]);
        const eventId = decodeURIComponent(parts[2]);
        const event = current.events.find((candidate) => candidate.calendarId === calendarId && candidate.id === eventId);
        if (event) { setView("calendar"); setCalendarCommand({ id: crypto.randomUUID(), type: "open-event", event }); setDeepLinkMessage(""); }
        else setDeepLinkMessage("This event is not cached in this browser. Connect Google and sync the relevant date range, then try the link again.");
      } else if (protocolTarget || parts[0] === "task" || parts[0] === "event") setDeepLinkMessage("This link does not identify a cached Hot Cross Buns task or event.");
    } catch {
      setDeepLinkMessage("This link is malformed. Open Hot Cross Buns normally and use cached search to find the item.");
    }
  }, [workspace.workspace]);

  useEffect(() => {
    if (!("registerProtocolHandler" in navigator) || !window.isSecureContext) return;
    try { navigator.registerProtocolHandler("web+hotcrossbuns", `${window.location.origin}/?open=%s`); } catch { /* optional installed-PWA enhancement */ }
  }, []);

  useEffect(() => {
    const subject = workspace.workspace?.identity.subject;
    if (!subject || !("setAppBadge" in navigator)) return;
    const badgeNavigator = navigator as Navigator & { setAppBadge?(contents?: number): Promise<void>; clearAppBadge?(): Promise<void> };
    let active = true;
    const update = (): void => {
      void Promise.all([
        localStore.pendingMutations(subject),
        pendingForegroundReminderCount(subject, workspace.workspace?.events ?? [], workspace.workspace?.calendars ?? [])
      ]).then(([mutations, reminders]) => {
        if (!active) return;
        const count = mutations.length + reminders;
        if (count) void badgeNavigator.setAppBadge?.(count);
        else void badgeNavigator.clearAppBadge?.();
      });
    };
    update();
    const timer = window.setInterval(update, 30_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [workspace.workspace]);

  useEffect(() => {
    const current = workspace.workspace;
    if (!paletteOpen || !current) {
      return;
    }
    let active = true;
    setCalendarHistory((previous) => ({ status: "loading", documents: previous.documents }));
    void localStore.readCanonicalEventSearchDocuments(current.identity.subject).then(
      (documents) => {
        if (active) {
          setCalendarHistory({ status: "ready", documents });
        }
      },
      () => {
        if (active) {
          setCalendarHistory({ status: "error", documents: [] });
        }
      }
    );
    return () => {
      active = false;
    };
  }, [paletteOpen, workspace.workspace]);

  useEffect(() => {
    const current = workspace.workspace;
    if (!paletteOpen || !current || !workspace.driveAuthorized) {
      setDriveHistory({ status: "idle", files: [] });
      return;
    }
    let active = true;
    setDriveHistory((previous) => ({ status: "loading", files: previous.files }));
    void localStore.readDriveFiles(current.identity.subject).then(
      (files) => {
        if (active) {
          setDriveHistory({ status: "ready", files });
        }
      },
      () => {
        if (active) {
          setDriveHistory({ status: "error", files: [] });
        }
      }
    );
    return () => {
      active = false;
    };
  }, [paletteOpen, workspace.driveAuthorized, workspace.workspace]);

  function closePalette(): void {
    setPaletteOpen(false);
    queueMicrotask(() => paletteButtonRef.current?.focus());
  }

  function runPaletteAction(action: PaletteAction): void {
    const id = crypto.randomUUID();
    switch (action.type) {
      case "navigate":
        setView(action.view);
        return;
      case "open-task":
        setView("tasks");
        setTaskCommand({ id, type: "open-task", taskId: action.task.id });
        return;
      case "open-event":
        setView("calendar");
        setCalendarCommand({ id, type: "open-event", event: action.event });
        return;
      case "open-drive-file":
        if (action.file.webViewLink) {
          window.open(action.file.webViewLink, "_blank", "noopener,noreferrer");
        }
        return;
    }
  }

  if (!workspace.ready) {
    return <main className="loading-screen"><LoadingState label={workspaceLoadingLabels[0]} rotatingLabels={workspaceLoadingLabels} variant="Orbit" /></main>;
  }
  if (!workspace.workspace) {
    return <Onboarding savedClientId={workspace.clientId} displayTimeZone={workspace.onboardingDisplayTimeZone} connectionProfile={workspace.connectionProfile} managedConnectionAvailable={workspace.managedConnectionAvailable} busy={workspace.busy} status={workspace.status} saveClientId={workspace.saveClientId} saveDisplayTimeZone={workspace.saveOnboardingDisplayTimeZone} connect={workspace.connect} connectManaged={workspace.connectManaged} useDirectConnection={workspace.useDirectConnection} />;
  }

  const navigation: ReadonlyArray<{ readonly view: View; readonly icon: IconName; readonly label: string; readonly shortcut: string }> = [
    { view: "tasks", icon: "tasks", label: "Tasks", shortcut: workspace.preferences.keybindings.tasks },
    { view: "notes", icon: "notes", label: "Notes", shortcut: workspace.preferences.keybindings.notes },
    { view: "calendar", icon: "calendar", label: "Calendar", shortcut: workspace.preferences.keybindings.calendar },
    { view: "settings", icon: "settings", label: "Settings", shortcut: workspace.preferences.keybindings.settings },
    { view: "health", icon: "health", label: "Health & logs", shortcut: workspace.preferences.keybindings.health }
  ];

  return (
    <main className="app-shell">
      <aside className="app-sidebar-nav">
        <nav aria-label="Workspace">
          {navigation.map((item) => <button key={item.view} className={view === item.view ? "icon-button active" : "icon-button"} type="button" title={`${item.label} (${formatBinding(item.shortcut)})`} aria-label={item.label} onClick={() => setView(item.view)}><Icon name={item.icon} /></button>)}
        </nav>
        <div className="sidebar-utilities">
          <button ref={paletteButtonRef} className="icon-button" type="button" title={`Search and command (${formatBinding(workspace.preferences.keybindings.commandPalette)})`} aria-label="Search and command" onClick={() => setPaletteOpen(true)}><Icon name="search" /></button>
          <button className="icon-button" type="button" title={`Synchronize (${formatBinding(workspace.preferences.keybindings.sync)})`} aria-label="Synchronize" disabled={workspace.busy} onClick={() => { setSyncDialogOpen(true); void workspace.sync().catch(() => undefined); }}><Icon name="sync" /></button>
          <button className="icon-button" type="button" title={`Tutorial (${formatBinding(workspace.preferences.keybindings.tutorial)})`} aria-label="Open tutorial" onClick={() => setTutorialOpen(true)}><Icon name="help" /></button>
        </div>
      </aside>
      <div className="app-content">
      {updateReady && <section className="update-ready" role="status">A new version of Hot Cross Buns is ready. <button type="button" onClick={() => void updateServiceWorker.current?.().then(() => setUpdateReady(false))}>Reload now</button></section>}
      {deepLinkMessage && <p className="error" role="status">{deepLinkMessage}</p>}
      {workspace.syncProgress.phase !== "idle" && (
        <section className="sync-progress" aria-live="polite" aria-label="Synchronization progress">
          <strong>{workspace.syncProgress.detail}</strong>
          <span>{workspace.syncProgress.completed !== undefined && workspace.syncProgress.total !== undefined ? `${workspace.syncProgress.completed} of ${workspace.syncProgress.total} resources` : `${workspace.syncProgress.pagesSaved} pages saved`}</span>
          {workspace.syncProgress.cancellable && <button type="button" onClick={workspace.cancelSync}>Cancel sync</button>}
        </section>
      )}
      {view === "tasks" && (
        <TaskPanel
          taskLists={workspace.workspace.taskLists}
          tasks={workspace.workspace.tasks}
          calendars={workspace.workspace.calendars}
          metadata={workspace.taskMetadata}
          scheduledTaskBlocks={workspace.scheduledTaskBlocks}
          panel="tasks"
          displayTimeZone={workspace.preferences.displayTimeZone}
          driveAuthorized={workspace.driveAuthorized}
          search=""
          command={taskCommand}
          createTaskList={workspace.createTaskList}
          updateTaskList={workspace.updateTaskList}
          deleteTaskList={workspace.deleteTaskList}
          createTask={workspace.createTask}
          updateTask={workspace.updateTask}
          toggleTask={workspace.toggleTask}
          deleteTask={workspace.deleteTask}
          moveTask={workspace.moveTask}
          saveTaskMetadata={workspace.saveTaskMetadata}
          scheduleTask={workspace.scheduleTask}
          unscheduleTask={workspace.unscheduleTask}
          bulkTasks={workspace.bulkTasks}
          authorizeDrive={workspace.authorizeDrive}
          searchDrive={workspace.searchDrive}
        />
      )}
      {view === "notes" && (
        <TaskPanel
          taskLists={workspace.workspace.taskLists}
          tasks={workspace.workspace.tasks}
          calendars={workspace.workspace.calendars}
          metadata={workspace.taskMetadata}
          scheduledTaskBlocks={workspace.scheduledTaskBlocks}
          panel="notes"
          displayTimeZone={workspace.preferences.displayTimeZone}
          driveAuthorized={workspace.driveAuthorized}
          search=""
          createTaskList={workspace.createTaskList}
          updateTaskList={workspace.updateTaskList}
          deleteTaskList={workspace.deleteTaskList}
          createTask={workspace.createTask}
          updateTask={workspace.updateTask}
          toggleTask={workspace.toggleTask}
          deleteTask={workspace.deleteTask}
          moveTask={workspace.moveTask}
          saveTaskMetadata={workspace.saveTaskMetadata}
          scheduleTask={workspace.scheduleTask}
          unscheduleTask={workspace.unscheduleTask}
          bulkTasks={workspace.bulkTasks}
          authorizeDrive={workspace.authorizeDrive}
          searchDrive={workspace.searchDrive}
        />
      )}
      {view === "calendar" && (
        <CalendarPanel
          calendars={workspace.workspace.calendars}
          events={workspace.workspace.events}
          invitations={workspace.invitationEvents}
          search=""
          command={calendarCommand}
          driveAuthorized={workspace.driveAuthorized}
          displayTimeZone={workspace.preferences.displayTimeZone}
          hourCycle={workspace.preferences.hourCycle}
          visibleCalendarIds={workspace.preferences.visibleCalendarIds}
          eventConflict={workspace.eventConflict}
          createCalendar={workspace.createCalendar}
          subscribeCalendar={workspace.subscribeCalendar}
          removeCalendarFromList={workspace.removeCalendarFromList}
          queryAvailability={workspace.queryAvailability}
          createEvent={workspace.createEvent}
          updateEvent={workspace.updateEvent}
          deleteEvent={workspace.deleteEvent}
          getEvent={workspace.getEvent}
          respondToEvent={workspace.respondToEvent}
          loadCalendarRange={workspace.loadCalendarRange}
          resolveEventConflict={workspace.resolveEventConflict}
          dismissEventConflict={workspace.dismissEventConflict}
          splitRecurringEvent={workspace.splitRecurringEvent}
          authorizeDrive={workspace.authorizeDrive}
          searchDrive={workspace.searchDrive}
          bulkEvents={workspace.bulkEvents}
          saveVisibleCalendarIds={(visibleCalendarIds) => workspace.savePreferences({ visibleCalendarIds })}
        />
      )}
      {view === "settings" && (
        <SettingsPanel
          clientId={workspace.clientId}
          connectionProfile={workspace.connectionProfile}
          managedConnectionAvailable={workspace.managedConnectionAvailable}
          status={workspace.status}
          connected={workspace.connected}
          busy={workspace.busy}
          connect={workspace.connect}
          connectManaged={workspace.connectManaged}
          useDirectConnection={workspace.useDirectConnection}
          sync={workspace.sync}
          refreshAllTasks={workspace.refreshAllTasks}
          syncProgress={workspace.syncProgress}
          cancelSync={workspace.cancelSync}
          disconnect={workspace.disconnect}
          clearLocalData={workspace.clearLocalData}
          preferences={workspace.preferences}
          undoEntries={workspace.undoEntries}
          conflicts={workspace.conflicts}
          taskLists={workspace.workspace.taskLists}
          calendars={workspace.workspace.calendars}
          savePreferences={workspace.savePreferences}
          undo={workspace.undo}
          redo={workspace.redo}
          dismissConflict={workspace.dismissConflict}
          openImport={() => setImportOpen(true)}
          openDiagnostics={() => setDiagnosticsOpen(true)}
          requestNotifications={async () => {
            const permission = await requestForegroundNotificationPermission();
            if (permission !== "granted") throw new Error("Notifications were not enabled; reminders remain visible while the PWA is open");
          }}
        />
      )}
      {view === "health" && <HealthPanel subject={workspace.workspace.identity.subject} connected={workspace.connected} connectionProfile={workspace.connectionProfile} status={workspace.status} syncProgress={workspace.syncProgress} openDiagnostics={() => setDiagnosticsOpen(true)} />}
      <CommandPalette open={paletteOpen} workspace={workspace.workspace} taskMetadata={workspace.taskMetadata} calendarHistory={calendarHistory} driveHistory={driveHistory} close={closePalette} run={runPaletteAction} />
      {quickCaptureOpen && <QuickCaptureDialog taskLists={workspace.workspace.taskLists} calendars={workspace.workspace.calendars} preferences={workspace.preferences.quickCapture} createTask={workspace.createTask} createEvent={workspace.createEvent} saveTaskMetadata={workspace.saveTaskMetadata} close={() => setQuickCaptureOpen(false)} />}
      {importOpen && <ImportDialog taskLists={workspace.workspace.taskLists} calendars={workspace.workspace.calendars} createTask={workspace.createTask} createEvent={workspace.createEvent} saveTaskMetadata={workspace.saveTaskMetadata} initialFile={importFile} close={() => { setImportOpen(false); setImportFile(undefined); }} />}
      {diagnosticsOpen && <DiagnosticsDialog subject={workspace.workspace.identity.subject} syncProgress={workspace.syncProgress} close={() => setDiagnosticsOpen(false)} />}
      {syncDialogOpen && <SyncDialog progress={workspace.syncProgress} cancel={workspace.cancelSync} close={() => setSyncDialogOpen(false)} />}
      {tutorialOpen && <TutorialDialog keybindings={workspace.preferences.keybindings} close={() => setTutorialOpen(false)} />}
      <ForegroundReminders subject={workspace.workspace.identity.subject} events={workspace.workspace.events} calendars={workspace.workspace.calendars} />
      </div>
    </main>
  );
}
