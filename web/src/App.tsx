import { useState } from "react";

import { CalendarPanel } from "@/components/CalendarPanel";
import { Onboarding } from "@/components/Onboarding";
import { SettingsPanel } from "@/components/SettingsPanel";
import { TaskPanel } from "@/components/TaskPanel";
import { useWorkspace } from "@/features/useWorkspace";

type View = "tasks" | "calendar" | "settings";

export default function App(): React.JSX.Element {
  const workspace = useWorkspace();
  const [view, setView] = useState<View>("tasks");
  const [search, setSearch] = useState("");

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
        <label className="search-field">
          <span>Search cached tasks and events</span>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search" />
        </label>
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
          search={search}
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
          search={search}
          driveAuthorized={workspace.driveAuthorized}
          eventConflict={workspace.eventConflict}
          createEvent={workspace.createEvent}
          updateEvent={workspace.updateEvent}
          deleteEvent={workspace.deleteEvent}
          getEvent={workspace.getEvent}
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
    </main>
  );
}
