import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Pencil, Trash2, X } from "lucide-react";
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
  type NoteInspectorBodyHandle
} from "../inspectors/NoteInspectorBody";
import { buildNotePreview } from "../notesParsing";
import { rendererNow, reportRendererTimingSince } from "../../../hooks/useRenderTiming";
import type { NoteBoardSelection, NoteViewColumn } from "./notesTypes";

const starredNotesStorageKey = "hcb.starredNoteIds";
const starredNotesAtStorageKey = "hcb.starredNoteAt";
const defaultNoteListTitle = "Notes";

function displayNoteListTitle(title: string): string {
  return title === "Local notes" ? defaultNoteListTitle : title;
}

function displayNote(note: NoteViewModel): NoteViewModel {
  return { ...note, listTitle: displayNoteListTitle(note.listTitle) };
}

export function useNotesController(source: CoreViewModelSource): {
  allNoteCount: number;
  createDailyNote: () => void;
  createMeetingNote: () => void;
  createNote: () => Promise<void>;
  createNoteList: () => Promise<void>;
  deleteNote: (noteId: string) => Promise<void>;
  noteViewColumns: NoteViewColumn[];
  noteLists: CoreViewModelSource["noteLists"];
  notes: NoteViewModel[];
  selectedNoteId: string | null;
  selectedNoteViews: NoteBoardSelection[];
  selectNote: (noteId: string, mode?: "view" | "edit") => Promise<void>;
  starredNoteCount: number;
  starredNoteIds: ReadonlySet<string>;
  moveNoteToList: (noteId: string, listId: string) => Promise<void>;
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
  const [selectedNoteViews, setSelectedNoteViews] = useState<NoteBoardSelection[]>(["all"]);
  const [noteInspectorMode, setNoteInspectorModeState] = useState<"view" | "edit">("edit");
  const [starredNoteIds, setStarredNoteIds] = useState<Set<string>>(
    () => new Set(readLocalStorageStringArray(starredNotesStorageKey))
  );
  const [starredNoteAt, setStarredNoteAt] = useState<Record<string, number>>(
    () => readLocalStorageNumberRecord(starredNotesAtStorageKey)
  );
  const [draftCounter, setDraftCounter] = useState(1);
  const requestedNoteDetails = useRef(new Set<string>());
  const lastNoteEditReportAt = useRef(0);
  const noteInspectorBodyRef = useRef<NoteInspectorBodyHandle | null>(null);
  const noteInspectorModeRef = useRef<"view" | "edit">("edit");
  const selectedNote = notes.find((note) => note.id === selectedNoteId) ?? null;
  const noteLists = (localNoteLists.length > 0
    ? localNoteLists
    : [{ id: "note-list:default", title: defaultNoteListTitle, noteCount: notes.length, updatedAt: new Date().toISOString() }]
  ).map((list) => ({ ...list, title: displayNoteListTitle(list.title) }));
  const allNoteCount = Math.max(source.resourceCounts.notes, notes.length);
  const starredNotes = useMemo(
    () =>
      notes
        .filter((note) => starredNoteIds.has(note.id))
        .sort((left, right) => (starredNoteAt[right.id] ?? 0) - (starredNoteAt[left.id] ?? 0)),
    [notes, starredNoteAt, starredNoteIds]
  );
  const noteViewColumns = useMemo(
    () =>
      selectedNoteViews.map((view) => {
        if (view === "starred") {
          return {
            id: view,
            title: "Starred notes",
            description: "All starred notes",
            emptyDescription: "Star notes to collect them here.",
            emptyTitle: "No starred notes",
            notes: starredNotes
          };
        }

        if (view.startsWith("list:")) {
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
        }

        return {
          id: view,
          title: "All notes",
          description: "Select a note to open details in the Inspector",
          emptyDescription: "Create a note to populate this view.",
          emptyTitle: "No notes",
          notes
        };
      }),
    [noteLists, notes, selectedNoteViews, starredNotes]
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
    requestedNoteDetails.current.clear();
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
    if (
      !selectedNote ||
      selectedNote.id.startsWith("note-draft-") ||
      requestedNoteDetails.current.has(selectedNote.id)
    ) {
      return;
    }

    requestedNoteDetails.current.add(selectedNote.id);
    let cancelled = false;

    void window.hcb?.notes.get({ id: selectedNote.id }).then((result) => {
      if (cancelled || !result?.ok) {
        return;
      }

      setNotes((current) =>
        current.map((note) =>
          note.id === selectedNote.id
            ? {
                id: result.data.id,
                listId: result.data.listId,
                listTitle: displayNoteListTitle(result.data.listTitle),
                title: result.data.title,
                body: result.data.body,
                preview: result.data.preview,
                updatedLabel: note.updatedLabel
              }
            : note
        )
      );
    });

    return () => {
      cancelled = true;
    };
  }, [selectedNote?.id]);

  useEffect(() => {
    for (const note of notes) {
      if (
        note.id === selectedNote?.id ||
        note.id.startsWith("note-draft-") ||
        requestedNoteDetails.current.has(note.id)
      ) {
        continue;
      }

      requestedNoteDetails.current.add(note.id);
      void window.hcb?.notes.get({ id: note.id }).then((result) => {
        if (!result?.ok) {
          return;
        }

        setNotes((current) =>
          current.map((currentNote) =>
            currentNote.id === result.data.id
              ? {
                  id: result.data.id,
                  listId: result.data.listId,
                  listTitle: displayNoteListTitle(result.data.listTitle),
                  title: result.data.title,
                  body: result.data.body,
                  preview: result.data.preview,
                  updatedLabel: currentNote.updatedLabel
                }
              : currentNote
          )
        );
      });
    }
  }, [notes, selectedNote?.id]);

  useEffect(() => {
    function handleNoteCommand(event: Event): void {
      const detail = (event as CustomEvent<{ action: string; noteId?: string }>).detail;

      if (detail?.action === "new-note") {
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
      subtitle: selectedNote.updatedLabel,
      title: selectedNote.title || "Untitled note"
    });
  }, [
    currentInspector?.id,
    currentInspector?.dirty,
    currentInspector?.kind,
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

  async function createNote(): Promise<void> {
    if (noteInspectorModeRef.current === "edit") {
      await noteInspectorBodyRef.current?.flush();
    }

    const fallbackId = `note-draft-${draftCounter}`;
    const fallbackNote: NoteViewModel = {
      id: fallbackId,
      listId: "note-list:default",
      listTitle: defaultNoteListTitle,
      title: "Untitled note",
      body: "",
      preview: "Empty note",
      updatedLabel: "Just now"
    };

    setDraftCounter((current) => current + 1);
    setNotes((current) => [fallbackNote, ...current]);
    setSelectedNoteId(fallbackId);
    openNoteInspector(fallbackNote, "edit");

    const result = await window.hcb?.notes.create({
      title: "Untitled note",
      body: ""
    });

    if (result?.ok) {
      requestedNoteDetails.current.add(result.data.id);
      const persisted = {
        id: result.data.id,
        listId: result.data.listId,
        listTitle: displayNoteListTitle(result.data.listTitle),
        title: result.data.title,
        body: result.data.body,
        preview: result.data.preview,
        updatedLabel: "Just now"
      };

      setNotes((current) =>
        current.map((note) => (note.id === fallbackId ? persisted : note))
      );
      setSelectedNoteId(result.data.id);
      openNoteInspector(persisted, "edit");
    }
  }

  async function createNoteWithTemplate(title: string, body: string): Promise<void> {
    if (noteInspectorModeRef.current === "edit") {
      await noteInspectorBodyRef.current?.flush();
    }

    const fallbackId = `note-draft-${draftCounter}`;
    const fallbackNote: NoteViewModel = {
      id: fallbackId,
      listId: "note-list:default",
      listTitle: defaultNoteListTitle,
      title,
      body,
      preview: buildNotePreview(body),
      updatedLabel: "Just now"
    };

    setDraftCounter((current) => current + 1);
    setNotes((current) => [fallbackNote, ...current]);
    setSelectedNoteId(fallbackId);
    openNoteInspector(fallbackNote, "edit");

    const result = await window.hcb?.notes.create({ title, body });

    if (result?.ok) {
      requestedNoteDetails.current.add(result.data.id);
      const persisted = {
        id: result.data.id,
        listId: result.data.listId,
        listTitle: displayNoteListTitle(result.data.listTitle),
        title: result.data.title,
        body: result.data.body,
        preview: result.data.preview,
        updatedLabel: "Just now"
      };

      setNotes((current) =>
        current.map((note) => (note.id === fallbackId ? persisted : note))
      );
      setSelectedNoteId(result.data.id);
      openNoteInspector(persisted, "edit");
    }
  }

  function createDailyNote(): void {
    const today = dateInputValue(new Date().toISOString());
    void createNoteWithTemplate(
      `Daily ${today}`,
      `status: open\ntags: daily\ndate: ${today}\n\n# Daily ${today}\n- [ ] Review calendar\n- [ ] Triage inbox\n`
    );
  }

  function createMeetingNote(): void {
    const today = dateInputValue(new Date().toISOString());
    void createNoteWithTemplate(
      `Meeting ${today}`,
      `status: draft\ntags: meeting\ndate: ${today}\n\n# Meeting ${today}\nAttendees:\n\nNotes:\n\nDecisions:\n- \n`
    );
  }

  async function createNoteList(): Promise<void> {
    const title = `Note list ${localNoteLists.length + 1}`;
    const result = await window.hcb?.notes.createList({ title });

    if (result?.ok) {
      setLocalNoteLists((current) => [...current, result.data]);
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
      return true;
    }

    const result = await window.hcb?.notes.update({
      id: noteId,
      title: draft.title,
      body: draft.body
    });

    return result?.ok ?? false;
  }

  async function deleteNote(noteId: string): Promise<void> {
    const note = notes.find((candidate) => candidate.id === noteId);

    if (!note) {
      return;
    }

    if (!note.id.startsWith("note-draft-")) {
      await window.hcb?.notes.delete({ id: note.id });
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
      const result = await window.hcb?.notes.update({ id: note.id, listId });

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

      return view === "all" ? [view, ...current] : [...current, view];
    });
  }

  return {
    allNoteCount,
    createDailyNote,
    createMeetingNote,
    createNote,
    createNoteList,
    deleteNote,
    noteViewColumns,
    noteLists,
    notes,
    selectedNoteId,
    selectedNoteViews,
    selectNote,
    starredNoteCount: notes.filter((note) => starredNoteIds.has(note.id)).length,
    starredNoteIds,
    moveNoteToList,
    toggleNoteStar,
    toggleNoteView
  };
}
