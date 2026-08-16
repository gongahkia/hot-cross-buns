import { useEffect, useRef, useState } from "react";

import { CalendarPanel } from "@/components/CalendarPanel";
import { CommandPalette, type PaletteAction } from "@/components/CommandPalette";
import { Onboarding } from "@/components/Onboarding";
import { SettingsPanel } from "@/components/SettingsPanel";
import { TaskPanel, type TaskPanelCommand } from "@/components/TaskPanel";
import type { CalendarPanelCommand } from "@/components/CalendarPanel";
import { useWorkspace } from "@/features/useWorkspace";

type View = "tasks" | "calendar" | "settings";

export default function App(): React.JSX.Element {
  const workspace = useWorkspace();
  const [view, setView] = useState<View>("tasks");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [taskCommand, setTaskCommand] = useState<TaskPanelCommand>();
  const [calendarCommand, setCalendarCommand] = useState<CalendarPanelCommand>();
  const paletteButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen(true);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

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
      case "sync":
        void workspace.sync().catch(() => undefined);
        return;
      case "new-task":
        setView("tasks");
        setTaskCommand({ id, type: "new-task" });
        return;
      case "open-task":
        setView("tasks");
        setTaskCommand({ id, type: "open-task", taskId: action.task.id });
        return;
      case "new-event":
        setView("calendar");
        setCalendarCommand({ id, type: "new-event" });
        return;
      case "open-event":
        setView("calendar");
        setCalendarCommand({ id, type: "open-event", eventId: action.event.id, calendarId: action.event.calendarId });
        return;
      case "find-time":
        setView("calendar");
        setCalendarCommand({ id, type: "find-time" });
        return;
      case "manage-calendars":
        setView("calendar");
        setCalendarCommand({ id, type: "manage-calendars" });
        return;
    }
  }

  if (!workspace.ready) {
    return <main className="loading-screen">Loading browser-local workspace…</main>;
  }
  if (!workspace.workspace) {
    return <Onboarding savedClientId={workspace.clientId} busy={workspace.busy} status={workspace.status} saveClientId={workspace.saveClientId} connect={workspace.connect} />;
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">Hot Cross Buns</p>
          <h1>{workspace.workspace.identity.name ?? workspace.workspace.identity.email ?? "Google workspace"}</h1>
        </div>
        <button ref={paletteButtonRef} className="command-palette-trigger" type="button" aria-keyshortcuts="Control+K Meta+K" onClick={() => setPaletteOpen(true)}>Search or command <kbd>⌘/Ctrl K</kbd></button>
        <button type="button" disabled={workspace.busy} onClick={() => void workspace.sync().catch(() => undefined)}>
          {workspace.busy ? "Working…" : "Sync"}
        </button>
      </header>
      <nav className="primary-nav" aria-label="Workspace">
        <button className={view === "tasks" ? "active" : ""} type="button" onClick={() => setView("tasks")}>Tasks</button>
        <button className={view === "calendar" ? "active" : ""} type="button" onClick={() => setView("calendar")}>Calendar</button>
        <button className={view === "settings" ? "active" : ""} type="button" onClick={() => setView("settings")}>Settings</button>
      </nav>
      <p className="global-status" aria-live="polite">{workspace.status}</p>
      {view === "tasks" && (
        <TaskPanel
          taskLists={workspace.workspace.taskLists}
          tasks={workspace.workspace.tasks}
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
        />
      )}
      {view === "calendar" && (
        <CalendarPanel
          calendars={workspace.workspace.calendars}
          events={workspace.workspace.events}
          search=""
          command={calendarCommand}
          driveAuthorized={workspace.driveAuthorized}
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
          authorizeDrive={workspace.authorizeDrive}
          searchDrive={workspace.searchDrive}
        />
      )}
      {view === "settings" && (
        <SettingsPanel
          clientId={workspace.clientId}
          status={workspace.status}
          connected={workspace.connected}
          busy={workspace.busy}
          connect={workspace.connect}
          sync={workspace.sync}
          disconnect={workspace.disconnect}
          clearLocalData={workspace.clearLocalData}
        />
      )}
      <CommandPalette open={paletteOpen} workspace={workspace.workspace} busy={workspace.busy} close={closePalette} run={runPaletteAction} />
    </main>
  );
}
