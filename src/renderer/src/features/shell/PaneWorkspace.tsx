import { getPlannerSection } from "../../data/mockPlanner";
import { SectionContent, type TaskSurfaceCommand } from "../core/CoreScreens";
import { PaneIdentity } from "./panePreferences";
import type { PaneLeafNode } from "./paneWorkspaceModel";

export function PaneWorkspace({ root, taskCommand, visibleCalendarIds }: {
  root: PaneLeafNode;
  taskCommand?: TaskSurfaceCommand | null;
  visibleCalendarIds: ReadonlySet<string>;
}): JSX.Element {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden" data-testid="pane-workspace">
      <section
        aria-label={`${getPlannerSection(root.content.sectionId).title} view`}
        className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-bg-primary"
        data-pane-id={root.id}
        data-testid="pane-leaf"
      >
        <div className="pane-content h-full min-h-0 overflow-auto p-3">
          <PaneIdentity.Provider value={root.id}>
            <SectionContent
              activeSectionId={root.content.sectionId}
              taskCommand={taskCommand?.paneId === root.id ? taskCommand : null}
              visibleCalendarIds={visibleCalendarIds}
            />
          </PaneIdentity.Provider>
        </div>
      </section>
    </div>
  );
}
