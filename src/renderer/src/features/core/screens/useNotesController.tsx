import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Pencil, Trash2, X } from "lucide-react";
import type { TaskListSummary, TaskSummary } from "@shared/ipc/contracts";
import { useInspector } from "../../../components/Inspector";
import { Button } from "../../../components/primitives";
import type { CoreViewModelSource } from "../coreViewModelSource";
import type { NoteViewModel } from "../coreViewModels";
import { dateInputValue, scheduleRendererFrame } from "../coreScreenShared";
import {
  readLocalStorageNumberRecord,
  readLocalStorageStringArray,
  writeLocalStorageJSON
} from "../localStorageHelpers";
import {
  NoteInspectorBody,
  NoteInspectorSummary,
  type NoteDraftValue,
  type NoteInspectorBodyHandle,
  type NoteTemplateOption
} from "../inspectors/NoteInspectorBody";
import { buildNotePreview } from "../notesParsing";
import { rendererNow, reportRendererTimingSince } from "../../../hooks/useRenderTiming";
import type { NoteBoardSelection, NoteViewColumn } from "./notesTypes";

const starredNotesStorageKey = "hcb.starredNoteIds";
const starredNotesAtStorageKey = "hcb.starredNoteAt";
const defaultNoteListTitle = "Notes";

function noteListSelection(listId: string): NoteBoardSelection {
  return `list:${listId}`;
}

function initialNoteViews(noteLists: CoreViewModelSource["noteLists"]): NoteBoardSelection[] {
  return noteLists.map((list) => noteListSelection(list.id));
}

function displayNote(note: NoteViewModel): NoteViewModel {
  return note;
}

function noteFromTask(
  task: TaskSummary,
  noteLists: CoreViewModelSource["noteLists"],
  updatedLabel = "Just now"
): NoteViewModel {
  const body = task.notes ?? "";
  const listTitle = noteLists.find((list) => list.id === task.listId)?.title ?? defaultNoteListTitle;

  return {
    id: task.id,
    listId: task.listId,
    listTitle,
    title: task.title,
    body,
    preview: buildNotePreview(body),
    updatedLabel
  };
}

function noteListFromTaskList(list: TaskListSummary): CoreViewModelSource["noteLists"][number] {
  return {
    id: list.id,
    title: list.title,
    updatedAt: list.updatedAt,
    noteCount: 0
  };
}

export function useNotesController(source: CoreViewModelSource): {
  createNote: (listId?: string) => Promise<void>;
  createNoteList: () => Promise<void>;
  deleteNoteList: (listId: string, title: string) => Promise<void>;
  deleteNote: (noteId: string) => Promise<void>;
  noteViewColumns: NoteViewColumn[];
  noteLists: CoreViewModelSource["noteLists"];
  notes: NoteViewModel[];
  selectedNoteId: string | null;
  selectedNoteViews: NoteBoardSelection[];
  selectNote: (noteId: string, mode?: "view" | "edit") => Promise<void>;
  starredNoteIds: ReadonlySet<string>;
  moveNoteToList: (noteId: string, listId: string) => Promise<void>;
  renameNoteList: (listId: string, currentTitle: string) => Promise<void>;
  toggleNoteStar: (noteId: string) => void;
  toggleNoteView: (view: NoteBoardSelection) => void;
} {
  const {
    close: closeInspector,
    current: currentInspector,
    open: openInspector,
    update: updateInspector
  } = useInspector();
  const [notes, setNotes] = useState<NoteViewModel[]>(() => source.initialNotes.map(displayNote));
  const [localNoteLists, setLocalNoteLists] = useState(source.noteLists);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(
    source.initialNotes[0]?.id ?? null
  );
  const [selectedNoteViews, setSelectedNoteViews] = useState<NoteBoardSelection[]>(() =>
    initialNoteViews(source.noteLists)
  );
  const [noteInspectorMode, setNoteInspectorModeState] = useState<"view" | "edit">("edit");
  const [starredNoteIds, setStarredNoteIds] = useState<Set<string>>(
    () => new Set(readLocalStorageStringArray(starredNotesStorageKey))
  );
  const [starredNoteAt, setStarredNoteAt] = useState<Record<string, number>>(
    () => readLocalStorageNumberRecord(starredNotesAtStorageKey)
  );
  const [draftCounter, setDraftCounter] = useState(1);
  const createNoteIds = useRef(new Set<string>());
  const lastNoteEditReportAt = useRef(0);
  const noteInspectorBodyRef = useRef<NoteInspectorBodyHandle | null>(null);
  const noteInspectorModeRef = useRef<"view" | "edit">("edit");
  const selectedNote = notes.find((note) => note.id === selectedNoteId) ?? null;
  const noteLists = localNoteLists;
  const noteListSignature = noteLists.map((list) => list.id).join("\n");
  const noteTemplateOptions = useMemo<NoteTemplateOption[]>(() => {
    const today = dateInputValue(new Date().toISOString());

    return [
      { id: "blank", name: "Blank", title: "Untitled note", body: "" },
      {
        id: "daily",
        name: "Daily note",
        title: `Daily ${today}`,
        body: `status: open\ntags: daily\ndate: ${today}\n\n# Daily ${today}\n- [ ] Review calendar\n- [ ] Triage inbox\n`
      },
      {
        id: "meeting",
        name: "Meeting note",
        title: `Meeting ${today}`,
        body: `status: draft\ntags: meeting\ndate: ${today}\n\n# Meeting ${today}\nAttendees:\n\nNotes:\n\nDecisions:\n- \n`
      },
      ...(source.settings.noteTemplates ?? []).map((template) => ({
        id: template.id,
        name: template.name,
        title: template.title,
        body: template.body
      }))
    ];
  }, [source.settings.noteTemplates]);
  const noteViewColumns = useMemo(
    () =>
      selectedNoteViews.map((view) => {
        const listId = view.slice("list:".length);
        const list = noteLists.find((candidate) => candidate.id === listId);
        return {
          id: view,
          listId,
          title: list?.title ?? defaultNoteListTitle,
          description: "Notes in this list",
          emptyDescription: "Drag notes here or create a note in this list.",
          emptyTitle: "No notes in this list",
          notes: notes.filter((note) => note.listId === listId)
        };
      }),
    [noteLists, notes, selectedNoteViews]
  );

  function setNoteInspectorMode(mode: "view" | "edit"): void {
    noteInspectorModeRef.current = mode;
    setNoteInspectorModeState(mode);
  }

  useEffect(() => {
    writeLocalStorageJSON(starredNotesStorageKey, [...starredNoteIds]);
  }, [starredNoteIds]);

  useEffect(() => {
    writeLocalStorageJSON(starredNotesAtStorageKey, starredNoteAt);
  }, [starredNoteAt]);

  useEffect(() => {
    setNotes(source.initialNotes.map(displayNote));
    setSelectedNoteId((current) =>
      current && source.initialNotes.some((note) => note.id === current)
        ? current
        : source.initialNotes[0]?.id ?? null
    );
  }, [source.initialNotes]);

  useEffect(() => {
    setLocalNoteLists(source.noteLists);
  }, [source.noteLists]);

  useEffect(() => {
    const availableViews = noteLists.map((list) => noteListSelection(list.id));
    const available = new Set<NoteBoardSelection>(availableViews);

    setSelectedNoteViews((current) => {
      const next = current.filter((view) => available.has(view));
      return next.length > 0 ? next : availableViews;
    });
  }, [noteListSignature]);

  useEffect(() => {
    function handleNoteCommand(event: Event): void {
      const detail = (event as CustomEvent<{
        action: string;
        body?: string;
        listId?: string;
        noteId?: string;
        title?: string;
      }>).detail;

      if (detail?.action === "new-note") {
        if (detail.title !== undefined || detail.body !== undefined || detail.listId !== undefined) {
          void createNoteWithTemplate(
            detail.title?.trim() || "Untitled note",
            detail.body ?? "",
            detail.listId
          );
          return;
        }

        void createNote();
      }

      if (detail?.action === "open-note" && detail.noteId) {
        void selectNote(detail.noteId, "view");
      }
    }

    window.addEventListener("hcb:note-command", handleNoteCommand);
    return () => window.removeEventListener("hcb:note-command", handleNoteCommand);
  });

  useEffect(() => {
    if (currentInspector?.kind !== "note" || !selectedNote || currentInspector.id !== selectedNote.id) {
      return;
    }

    updateInspector({
      actions: noteInspectorActions(selectedNote),
      body: noteInspectorBody(selectedNote),
      dirty: noteInspectorMode === "view" ? false : currentInspector.dirty,
      hideHeader: noteInspectorMode === "view",
      subtitle: selectedNote.updatedLabel,
      title: selectedNote.title || "Untitled note"
    });
  }, [
    currentInspector?.id,
    currentInspector?.dirty,
    currentInspector?.kind,
    noteTemplateOptions,
    notes,
    noteInspectorMode,
    selectedNote,
    updateInspector
  ]);

  function noteInspectorBody(note: NoteViewModel, mode = noteInspectorModeRef.current): ReactNode {
    if (mode === "view") {
      return (
        <NoteInspectorSummary
          key={`view-${note.id}`}
          note={note}
          notes={notes}
          onOpenNote={(noteId) => selectNote(noteId, "view")}
        />
      );
    }

    return (
      <NoteInspectorBody
        key={note.id}
        note={note}
        notes={notes}
        onDraftChange={updateNoteDraft}
        onOpenNote={(noteId) => selectNote(noteId, "view")}
        onPersist={persistNoteDraft}
        templates={noteTemplateOptions}
        createMode={createNoteIds.current.has(note.id)}
        ref={noteInspectorBodyRef}
      />
    );
  }

  function noteInspectorActions(note: NoteViewModel, mode = noteInspectorModeRef.current): ReactNode {
    if (mode === "view") {
      return (
        <div className="flex w-full items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Button onClick={() => void deleteNote(note.id)} size="sm" variant="danger">
              <Trash2 aria-hidden="true" size={14} />
              Delete selected note
            </Button>
            <Button onClick={() => setNoteInspectorMode("edit")} size="sm" variant="secondary">
              <Pencil aria-hidden="true" size={14} />
              Edit
            </Button>
          </div>
          <Button onClick={() => void closeInspector()} size="sm" variant="ghost">
            <X aria-hidden="true" size={14} />
            Close
          </Button>
        </div>
      );
    }

    return (
      <>
        <Button onClick={() => void deleteNote(note.id)} size="sm" variant="danger">
          <Trash2 aria-hidden="true" size={14} />
          Delete selected note
        </Button>
        <Button onClick={() => void closeInspector()} size="sm" variant="ghost">
          <X aria-hidden="true" size={14} />
          Close
        </Button>
      </>
    );
  }

  function openNoteInspector(
    note: NoteViewModel,
    mode: "view" | "edit" = note.id.startsWith("note-draft-") ? "edit" : "view"
  ): void {
    setNoteInspectorMode(mode);
    openInspector({
      actions: noteInspectorActions(note, mode),
      body: noteInspectorBody(note, mode),
      dirty: false,
      hideHeader: mode === "view",
      id: note.id,
      kind: "note",
      onConfirmClose: async () => {
        if (noteInspectorModeRef.current === "edit") {
          await noteInspectorBodyRef.current?.flush();
        }
        return true;
      },
      subtitle: note.updatedLabel,
      title: note.title || "Untitled note"
    });
  }

  async function selectNote(noteId: string, mode: "view" | "edit" = "view"): Promise<void> {
    const note = notes.find((candidate) => candidate.id === noteId);

    if (!note) {
      return;
    }

    if (noteInspectorModeRef.current === "edit") {
      await noteInspectorBodyRef.current?.flush();
    }
    setSelectedNoteId(note.id);
    openNoteInspector(note, mode);
  }

  async function createNote(listId?: string): Promise<void> {
    if (noteInspectorModeRef.current === "edit") {
      await noteInspectorBodyRef.current?.flush();
    }

    const list = noteLists.find((candidate) => candidate.id === listId) ?? noteLists[0];
    if (!list) {
      return;
    }

    const fallbackId = `note-draft-${draftCounter}`;
    const fallbackNote: NoteViewModel = {
      id: fallbackId,
      listId: list.id,
      listTitle: list.title,
      title: "Untitled note",
      body: "",
      preview: "Empty note",
      updatedLabel: "Just now"
    };

    setDraftCounter((current) => current + 1);
    setNotes((current) => [fallbackNote, ...current]);
    setSelectedNoteId(fallbackId);
    createNoteIds.current.add(fallbackId);
    openNoteInspector(fallbackNote, "edit");

    const result = await window.hcb?.tasks.create({
      title: "Untitled note",
      notes: "",
      listId: list.id,
      dueDate: null
    });

    if (result?.ok) {
      const persisted = noteFromTask(result.data, noteLists);

      setNotes((current) =>
        current.map((note) => (note.id === fallbackId ? persisted : note))
      );
      setSelectedNoteId(result.data.id);
      createNoteIds.current.delete(fallbackId);
      createNoteIds.current.add(result.data.id);
      openNoteInspector(persisted, "edit");
      source.refreshUndoStatus();
    }
  }

  async function createNoteWithTemplate(title: string, body: string, listId?: string): Promise<void> {
    if (noteInspectorModeRef.current === "edit") {
      await noteInspectorBodyRef.current?.flush();
    }

    const list = noteLists.find((candidate) => candidate.id === listId) ?? noteLists[0];
    if (!list) {
      return;
    }

    const fallbackId = `note-draft-${draftCounter}`;
    const fallbackNote: NoteViewModel = {
      id: fallbackId,
      listId: list.id,
      listTitle: list.title,
      title,
      body,
      preview: buildNotePreview(body),
      updatedLabel: "Just now"
    };

    setDraftCounter((current) => current + 1);
    setNotes((current) => [fallbackNote, ...current]);
    setSelectedNoteId(fallbackId);
    createNoteIds.current.add(fallbackId);
    openNoteInspector(fallbackNote, "edit");

    const result = await window.hcb?.tasks.create({
      title,
      notes: body,
      listId: list.id,
      dueDate: null
    });

    if (result?.ok) {
      const persisted = noteFromTask(result.data, noteLists);

      setNotes((current) =>
        current.map((note) => (note.id === fallbackId ? persisted : note))
      );
      setSelectedNoteId(result.data.id);
      createNoteIds.current.delete(fallbackId);
      createNoteIds.current.add(result.data.id);
      openNoteInspector(persisted, "edit");
      source.refreshUndoStatus();
    }
  }

  async function createNoteList(): Promise<void> {
    const title = `Note list ${localNoteLists.length + 1}`;
    const result = await window.hcb?.tasks.createTaskList({ title });

    if (result?.ok) {
      setLocalNoteLists((current) => [...current, noteListFromTaskList(result.data)]);
      setSelectedNoteViews((current) => [...current, noteListSelection(result.data.id)]);
      source.refreshUndoStatus();
    }
  }

  async function deleteNoteList(listId: string, title: string): Promise<void> {
    if (!window.confirm(`Delete ${title}? Notes in this list will be deleted in Google Tasks.`)) {
      return;
    }

    const result = await window.hcb?.tasks.deleteTaskList({ id: listId });

    if (!result?.ok) {
      return;
    }

    setLocalNoteLists((current) =>
      current.filter((list) => list.id !== listId)
    );
    setNotes((current) => current.filter((note) => note.listId !== listId));
    setSelectedNoteViews((current) => {
      const next = current.filter((view) => view !== noteListSelection(listId));
      return next.length > 0 ? next : noteLists.filter((list) => list.id !== listId).map((list) => noteListSelection(list.id));
    });
    source.refreshUndoStatus();
  }

  async function renameNoteList(listId: string, currentTitle: string): Promise<void> {
    const title = window.prompt("Rename list", currentTitle)?.trim();

    if (!title || title === currentTitle) {
      return;
    }

    const result = await window.hcb?.tasks.renameTaskList({ id: listId, title });

    if (result?.ok) {
      const displayTitle = result.data.title;
      setLocalNoteLists((current) =>
        current.map((list) => (list.id === listId ? noteListFromTaskList(result.data) : list))
      );
      setNotes((current) =>
        current.map((note) => (note.listId === listId ? { ...note, listTitle: displayTitle } : note))
      );
      source.refreshUndoStatus();
    }
  }

  function updateNoteDraft(noteId: string, draft: NoteDraftValue): void {
    const startedAt = rendererNow();
    setNotes((current) =>
      current.map((note) => {
        if (note.id !== noteId) {
          return note;
        }

        return {
          ...note,
          title: draft.title,
          body: draft.body,
          preview: buildNotePreview(draft.body),
          updatedLabel: "Edited"
        };
      })
    );

    if (startedAt !== null && startedAt - lastNoteEditReportAt.current > 250) {
      lastNoteEditReportAt.current = startedAt;
      scheduleRendererFrame(() => {
        reportRendererTimingSince("notes.edit.local", startedAt, {
          field: "body",
          noteCount: notes.length
        });
      });
    }
  }

  async function persistNoteDraft(noteId: string, draft: NoteDraftValue): Promise<boolean> {
    if (noteId.startsWith("note-draft-")) {
      const note = notes.find((candidate) => candidate.id === noteId);
      if (!note) {
        return false;
      }

      const result = await window.hcb?.tasks.create({
        title: draft.title || "Untitled note",
        notes: draft.body,
        listId: note.listId,
        dueDate: null
      });

      if (!result?.ok) {
        return false;
      }

      const persisted = noteFromTask(result.data, noteLists);
      setNotes((current) => current.map((candidate) => candidate.id === noteId ? persisted : candidate));
      setSelectedNoteId(persisted.id);
      createNoteIds.current.delete(noteId);
      createNoteIds.current.add(persisted.id);
      source.refreshUndoStatus();
      return true;
    }

    const result = await window.hcb?.tasks.update({
      id: noteId,
      title: draft.title,
      notes: draft.body,
      dueDate: null
    });

    if (result?.ok) {
      source.refreshUndoStatus();
    }

    return result?.ok ?? false;
  }

  async function deleteNote(noteId: string): Promise<void> {
    const note = notes.find((candidate) => candidate.id === noteId);

    if (!note) {
      return;
    }

    if (!note.id.startsWith("note-draft-")) {
      const result = await window.hcb?.tasks.delete({ id: note.id });

      if (result?.ok) {
        source.refreshUndoStatus();
      }
    }

    setStarredNoteIds((current) => {
      if (!current.has(note.id)) {
        return current;
      }

      const next = new Set(current);
      next.delete(note.id);
      return next;
    });
    setStarredNoteAt((current) => {
      if (!(note.id in current)) {
        return current;
      }

      const next = { ...current };
      delete next[note.id];
      return next;
    });

    const nextNotes = notes.filter((candidate) => candidate.id !== note.id);
    const nextNote = nextNotes[0] ?? null;

    setNotes(nextNotes);
    setSelectedNoteId(nextNote?.id ?? null);
    createNoteIds.current.delete(note.id);

    if (nextNote) {
      openNoteInspector(nextNote, "view");
      return;
    }

    await closeInspector();
  }

  function toggleNoteStar(noteId: string): void {
    setStarredNoteIds((current) => {
      const next = new Set(current);

      if (next.has(noteId)) {
        next.delete(noteId);
        setStarredNoteAt((timestamps) => {
          const result = { ...timestamps };
          delete result[noteId];
          return result;
        });
      } else {
        next.add(noteId);
        setStarredNoteAt((timestamps) => ({
          ...timestamps,
          [noteId]: Date.now()
        }));
      }

      return next;
    });
  }

  async function moveNoteToList(noteId: string, listId: string): Promise<void> {
    const note = notes.find((candidate) => candidate.id === noteId);
    const list = noteLists.find((candidate) => candidate.id === listId);

    if (!note || !list) {
      return;
    }

    setNotes((current) =>
      current.map((candidate) =>
        candidate.id === noteId
          ? { ...candidate, listId, listTitle: list.title }
          : candidate
      )
    );

    if (!note.id.startsWith("note-draft-")) {
      const result = await window.hcb?.tasks.move({ id: note.id, listId });

      if (!result?.ok) {
        setNotes((current) =>
          current.map((candidate) =>
            candidate.id === noteId
              ? { ...candidate, listId: note.listId, listTitle: note.listTitle }
              : candidate
          )
        );
      }
    }
  }

  function toggleNoteView(view: NoteBoardSelection): void {
    setSelectedNoteViews((current) => {
      if (current.includes(view)) {
        return current.filter((selectedView) => selectedView !== view);
      }

      return [...current, view];
    });
  }

  return {
    createNote,
    createNoteList,
    deleteNoteList,
    deleteNote,
    noteViewColumns,
    noteLists,
    notes,
    selectedNoteId,
    selectedNoteViews,
    selectNote,
    starredNoteIds,
    moveNoteToList,
    renameNoteList,
    toggleNoteStar,
    toggleNoteView
  };
}
