import { lazy, Suspense, useEffect } from "react";
import type { SectionId } from "../../data/mockPlanner";
import type { TaskSurfaceCommand } from "./screens/TasksView";

const DeferredCalendar = lazy(() => import("./screens/CalendarView").then((module) => ({ default: module.CalendarView })));
const DeferredTasks = lazy(() => import("./screens/TasksView").then((module) => ({ default: module.TasksView })));
const DeferredNotes = lazy(() => import("./screens/NotesView").then((module) => ({ default: module.NotesView })));
const DeferredSettings = lazy(() => import("./screens/SettingsView").then((module) => ({ default: module.SettingsView })));

export type { TaskSurfaceCommand };

function LoadingSurface(): JSX.Element {
  return <div className="grid flex-1 place-items-center text-sm text-text-muted" role="status">Loading…</div>;
}

export function SettingsView(props: { onOpenDiagnostics?: () => void }): JSX.Element {
  return <Suspense fallback={<LoadingSurface />}><DeferredSettings {...props} /></Suspense>;
}

export function SectionContent({ activeSectionId, taskCommand, visibleCalendarIds, onReady }: {
  activeSectionId: SectionId;
  onReady?: (sectionId: SectionId) => void;
  taskCommand?: TaskSurfaceCommand | null;
  visibleCalendarIds: ReadonlySet<string>;
}): JSX.Element {
  return (
    <Suspense fallback={<LoadingSurface />}>
      {activeSectionId === "tasks" ? <DeferredTasks command={taskCommand} />
        : activeSectionId === "notes" ? <DeferredNotes />
        : activeSectionId === "settings" ? <DeferredSettings />
        : <DeferredCalendar visibleCalendarIds={visibleCalendarIds} />}
      <SectionReady sectionId={activeSectionId} onReady={onReady} />
    </Suspense>
  );
}

// Commit this effect only after the lazy view and its event listeners mount.
function SectionReady({ sectionId, onReady }: { sectionId: SectionId; onReady?: (sectionId: SectionId) => void }): null {
  useEffect(() => { onReady?.(sectionId); }, [sectionId, onReady]);
  return null;
}
