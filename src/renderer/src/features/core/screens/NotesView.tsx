import { useEffect, useRef, useState } from "react";
import type { LegacyPseudoNotesMigrationPreview } from "@shared/ipc/contracts";
import { CacheStatePanel } from "../coreScreenShared";
import { useCoreViewModelSource } from "../coreViewModelSource";
import { LegacyNotesMigrationDialog } from "./LegacyNotesMigrationDialog";
import { NotesBoard } from "./NotesBoard";
import { NotesSidebar } from "./NotesSidebar";
import { useAutoCollapsedSidebar } from "./useAutoCollapsedSidebar";
import { StatusBanner } from "../../../components/primitives";
import { useInspector } from "../../../components/Inspector";
import { useNotesController } from "./useNotesController";
import { SectionSidebar, useWorkspaceSidebar } from "../../shell/WorkspaceSidebar";

export function NotesView(): JSX.Element {
  const source = useCoreViewModelSource();
  const inspector = useInspector();
  const restored = useRef(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [legacyMigrationPreview, setLegacyMigrationPreview] = useState<LegacyPseudoNotesMigrationPreview | null>(null);
  const { autoCollapsed, containerRef } = useAutoCollapsedSidebar();
  const sharedSidebar = useWorkspaceSidebar();
  const effectiveSidebarCollapsed = sharedSidebar ? sharedSidebar.collapsed : sidebarCollapsed || autoCollapsed;
  const {
    noteActionError,
    createNote,
    createNoteList,
    deleteNoteList,
    deleteNote,
    duplicateNote,
    noteViewColumns,
    noteLists,
    moveNoteToList,
    selectedNoteId,
    selectedNoteViews,
    selectNote,
    starredNoteIds,
    renameNoteList,
    toggleNoteStar,
    toggleNoteView
  } = useNotesController(source);

  useEffect(() => {
    if (restored.current || inspector.current || !selectedNoteId || source.dataState === "loading") return;
    restored.current = true;
    void selectNote(selectedNoteId, "edit");
  }, [selectedNoteId, source.dataState]);

  useEffect(() => {
    let active = true;
    void window.hcb?.notes.legacyMigrationPreview({ automatic: true, limit: 1_000 }).then((result) => {
      if (active && result?.ok && result.data.autoPromptEligible !== false && result.data.foundCount > 0) {
        setLegacyMigrationPreview(result.data as LegacyPseudoNotesMigrationPreview);
      }
    });
    return () => { active = false; };
  }, []);

  async function importLegacyPseudoNotes(taskIds: string[]): Promise<{ ok: boolean; error?: string }> {
    const result = await window.hcb?.notes.importLegacyPseudoNotes({ taskIds });
    if (!result?.ok) return { ok: false, error: result?.error.message ?? "HCB could not import those legacy notes." };
    setLegacyMigrationPreview(null);
    source.refresh();
    return { ok: true };
  }

  if (
    (source.dataState === "loading" ||
      source.dataState === "offline" ||
      source.dataState === "error") &&
    !source.hasCachedData
  ) {
    return <CacheStatePanel title="Notes" />;
  }

  return (
    <div
      className={`grid h-full min-h-0 gap-2 ${sharedSidebar ? "grid-cols-1" : effectiveSidebarCollapsed ? "grid-cols-[56px_minmax(0,1fr)]" : "grid-cols-[220px_minmax(0,1fr)]"}`}
      ref={containerRef}
    >
      <SectionSidebar><NotesSidebar
        collapsed={effectiveSidebarCollapsed}
        onCreateNote={() => void createNote(selectedNoteViews[0]?.slice("list:".length))}
        onCreateNoteList={() => void createNoteList()}
        onToggleCollapsed={() => sharedSidebar ? sharedSidebar.toggle() : setSidebarCollapsed((collapsed) => !collapsed)}
        onToggleView={toggleNoteView}
        noteLists={noteLists}
        selectedNoteViews={selectedNoteViews}
      /></SectionSidebar>
      <div className="flex min-h-0 flex-col">
      {noteActionError ? <StatusBanner tone="danger" title="Note action failed" description={noteActionError} /> : null}
      <NotesBoard
        source={source}
        columns={noteViewColumns}
        onCreateNote={(listId) => void createNote(listId)}
        onDeleteNoteList={(listId, title) => void deleteNoteList(listId, title)}
        onDeleteNote={(noteId) => void deleteNote(noteId)}
        onDuplicateNote={(noteId) => void duplicateNote(noteId)}
        onMoveNote={(noteId, listId) => void moveNoteToList(noteId, listId)}
        onOpenNote={(noteId, mode = "edit") => void selectNote(noteId, mode)}
        onRenameNoteList={(listId, title) => void renameNoteList(listId, title)}
        onToggleStar={toggleNoteStar}
        selectedNoteId={selectedNoteId}
        starredNoteIds={starredNoteIds}
      />
      </div>
      {legacyMigrationPreview ? (
        <LegacyNotesMigrationDialog
          onDismiss={() => setLegacyMigrationPreview(null)}
          onImport={importLegacyPseudoNotes}
          preview={legacyMigrationPreview}
        />
      ) : null}
    </div>
  );
}
