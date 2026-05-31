import { useState } from "react";
import { CacheStatePanel } from "../coreScreenShared";
import { useCoreViewModelSource } from "../coreViewModelSource";
import { NotesBoard } from "./NotesBoard";
import { NotesSidebar } from "./NotesSidebar";
import { useNotesController } from "./useNotesController";

export function NotesView(): JSX.Element {
  const source = useCoreViewModelSource();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const {
    allNoteCount,
    createDailyNote,
    createMeetingNote,
    createNote,
    createNoteList,
    deleteNote,
    noteViewColumns,
    noteLists,
    moveNoteToList,
    selectedNoteId,
    selectedNoteViews,
    selectNote,
    starredNoteCount,
    starredNoteIds,
    toggleNoteStar,
    toggleNoteView
  } = useNotesController(source);

  if (
    (source.dataState === "loading" ||
      source.dataState === "offline" ||
      source.dataState === "error") &&
    !source.hasCachedData
  ) {
    return <CacheStatePanel title="Notes" />;
  }

  return (
    <div className={`grid h-full min-h-0 grid-cols-1 gap-3 ${sidebarCollapsed ? "lg:grid-cols-[56px_minmax(0,1fr)]" : "lg:grid-cols-[260px_minmax(0,1fr)]"}`}>
      <NotesSidebar
        allNoteCount={allNoteCount}
        collapsed={sidebarCollapsed}
        onCreateDailyNote={createDailyNote}
        onCreateMeetingNote={createMeetingNote}
        onCreateNote={() => void createNote()}
        onCreateNoteList={() => void createNoteList()}
        onToggleCollapsed={() => setSidebarCollapsed((collapsed) => !collapsed)}
        onToggleView={toggleNoteView}
        noteLists={noteLists}
        selectedNoteViews={selectedNoteViews}
        starredNoteCount={starredNoteCount}
      />
      <NotesBoard
        allNoteCount={allNoteCount}
        columns={noteViewColumns}
        onDeleteNote={(noteId) => void deleteNote(noteId)}
        onMoveNote={(noteId, listId) => void moveNoteToList(noteId, listId)}
        onOpenNote={(noteId, mode = "view") => void selectNote(noteId, mode)}
        onToggleStar={toggleNoteStar}
        selectedNoteId={selectedNoteId}
        starredNoteIds={starredNoteIds}
      />
    </div>
  );
}
