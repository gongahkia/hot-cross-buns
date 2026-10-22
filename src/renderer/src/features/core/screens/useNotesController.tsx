import { InspectorItemToolbar, copyInspectorText } from "../../../components/Inspector/InspectorItemToolbar";
import { usePanePreference } from "../../shell/panePreferences";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ArrowRightLeft, Copy, Pencil, Save, Trash2 } from "lucide-react";
import { useInspector } from "../../../components/Inspector";
import { Button } from "../../../components/primitives";
import { useTextPrompt } from "../../../components/TextPrompt";
import {
  conversionCleanup,
  dispatchConvertCommand,
  type ConvertSourceCleanup
} from "../conversionEvents";
import { copiedTitle } from "../copyLabels";
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
import { shortDateTime } from "../viewModelSource/dateFormat";
import { rendererNow, reportRendererTimingSince } from "../../../hooks/useRenderTiming";
import type { NoteBoardSelection, NoteViewColumn } from "./notesTypes";

const starredNotesStorageKey = "hcb.starredNoteIds";
const starredNotesAtStorageKey = "hcb.starredNoteAt";
const defaultNoteListTitle = "Notes";

function noteListSelection(listId: string): NoteBoardSelection {
  return `list:${listId}`;
}

function initialNoteViews(noteLists: CoreViewModelSource["noteLists"]): NoteBoardSelection[] {
  const first = noteLists[0];
  return first ? [noteListSelection(first.id)] : [];
}

function noteFromNative(note: {
  id: string;
  listId: string;
  listTitle?: string;
  title: string;
  body: string;
  tags?: string[];
  updatedAt?: string;
}): NoteViewModel {
  return {
    id: note.id,
    listId: note.listId,
    listTitle: note.listTitle ?? defaultNoteListTitle,
    title: note.title,
    body: note.body,
    preview: buildNotePreview(note.body),
    tags: note.tags ?? [],
    updatedLabel: note.updatedAt ? shortDateTime(note.updatedAt) : "Just now"
  };
}

export function useNotesController(source: CoreViewModelSource): {
  noteActionError?: string;
  createNote: (listId?: string) => Promise<void>;
  createNoteList: () => Promise<void>;
  deleteNoteList: (listId: string, title: string) => Promise<void>;
  deleteNote: (noteId: string) => Promise<void>;
  duplicateNote: (noteId: string) => Promise<void>;
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
  const requestText = useTextPrompt();
  const {
    close: closeInspector,
    current: currentInspector,
    open: openInspector,
    update: updateInspector
  } = useInspector();
  const [notes, setNotes] = useState<NoteViewModel[]>(() => source.initialNotes.map((note) => note));
  const [localNoteLists, setLocalNoteLists] = useState(source.noteLists);
  const [selectedNoteId, setSelectedNoteId] = usePanePreference<string | null>("notes.selected",
    source.initialNotes[0]?.id ?? null
  );
  const [selectedNoteViews, setSelectedNoteViews] = useState<NoteBoardSelection[]>(() =>
    initialNoteViews(source.noteLists)
  );
  const [noteInspectorMode, setNoteInspectorModeState] = useState<"view" | "edit">("edit");
  const [noteActionError, setNoteActionError] = useState<string | undefined>();
  const [starredNoteIds, setStarredNoteIds] = useState<Set<string>>(
    () => new Set<string>(source.settings.starredNoteIds ?? readLocalStorageStringArray(starredNotesStorageKey))
  );
  const [starredNoteAt, setStarredNoteAt] = useState<Record<string, number>>(
    () => source.settings.starredNoteAt ?? readLocalStorageNumberRecord(starredNotesAtStorageKey)
  );
  const noteAliases = useRef(new Map<string, string>());
  const noteInspectorInstance = useRef(0);
  const autoCreateNoteIds = useRef(new Set<string>());
  const [creatingNote, setCreatingNote] = useState<string | null>(null);
  const [draftCounter, setDraftCounter] = useState(1);
  const createNoteIds = useRef(new Set<string>());
  const conversionCleanupByNoteId = useRef(new Map<string, ConvertSourceCleanup>());
  const selectionGeneration = useRef(0);
  const fullNoteId = useRef<string | null>(null);
  const lastNoteEditReportAt = useRef(0);
  const noteInspectorBodyRef = useRef<NoteInspectorBodyHandle | null>(null);
  const noteInspectorModeRef = useRef<"view" | "edit">("edit");
  const selectedNote = notes.find((note) => note.id === selectedNoteId) ?? null;
  const noteLists = localNoteLists.length ? localNoteLists : source.noteLists;
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
    if (!Array.isArray(source.settings.starredNoteIds) && starredNoteIds.size > 0) {
      void source.updateSettings({ starredNoteIds: [...starredNoteIds], starredNoteAt });
    }
  }, [source.settings.starredNoteIds, source.updateSettings]);

  useEffect(() => {
    if (Array.isArray(source.settings.starredNoteIds)) setStarredNoteIds(new Set(source.settings.starredNoteIds));
    if (source.settings.starredNoteAt) setStarredNoteAt(source.settings.starredNoteAt);
  }, [source.settings.starredNoteIds, source.settings.starredNoteAt]);

  useEffect(() => {
    setNotes((current) => {
      const retained = current.filter((note) => note.id.startsWith("note-draft-") || note.id === fullNoteId.current);
      const ids = new Set(retained.map((note) => note.id));
      return [...retained, ...source.initialNotes.filter((note) => !ids.has(note.id))];
    });
  }, [source.initialNotes]);

  useEffect(() => {
    setLocalNoteLists(source.noteLists);
  }, [source.noteLists]);

  useEffect(() => {
    const availableViews = noteLists.map((list) => noteListSelection(list.id));
    const available = new Set<NoteBoardSelection>(availableViews);

    setSelectedNoteViews((current) => {
      const next = current.filter((view) => available.has(view));
      return next.length > 0 ? [next[0]!] : availableViews.slice(0, 1);
    });
  }, [noteListSignature]);

  useEffect(() => {
    function handleNoteCommand(event: Event): void {
      const detail = (event as CustomEvent<{
        action: string;
        body?: string;
        cleanup?: ConvertSourceCleanup;
        draft?: {
          body: string;
          id?: string;
          listId?: string;
          listTitle?: string;
          replaceSource?: boolean;
          title: string;
        };
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
        void selectNote(detail.noteId, "edit");
      }

      if (detail?.action === "convert-to-note" && detail.draft) {
        void openConvertedNoteDraft(detail.draft, detail.cleanup);
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
      actions: null,
      toolbar: noteInspectorToolbar(selectedNote),
      onSave: flushCurrentNote,
      onDiscard: discardNoteEdits,
      saving: creatingNote !== null,
      saveError: noteActionError,
      body: noteInspectorBody(selectedNote),
      dirty: noteInspectorMode === "view" ? false : currentInspector.dirty,
      hideHeader: false,
      subtitle: selectedNote.updatedLabel,
      title: selectedNote.title || "Untitled note"
    });
  }, [
    currentInspector?.id,
    currentInspector?.dirty,
    currentInspector?.kind,
    noteTemplateOptions,
    notes,
    noteActionError,
    creatingNote,
    noteInspectorMode,
    selectedNote,
    updateInspector
  ]);

  function noteInspectorBody(
    note: NoteViewModel,
    mode = noteInspectorModeRef.current,
    error = noteActionError
  ): ReactNode {
    if (mode === "view") {
      return (
        <NoteInspectorSummary
          key={`view-${note.id}`}
          note={note}
          notes={notes}
          onOpenNote={(noteId) => selectNote(noteId, "edit")}
          source={source}
        />
      );
    }

    return (
      <NoteInspectorBody
        key={noteInspectorInstance.current}
        note={note}
        notes={notes}
        onDraftChange={updateNoteDraft}
        onOpenNote={(noteId) => selectNote(noteId, "edit")}
        onPersist={persistNoteDraft}
        rules={source.settings.autoTagRules}
        source={source}
        templates={noteTemplateOptions}
        saving={creatingNote === note.id}
        createMode={note.id.startsWith("note-draft-")}
        error={error}
        ref={noteInspectorBodyRef}
      />
    );
  }

  function noteInspectorToolbar(note: NoteViewModel): ReactNode {
    return <InspectorItemToolbar kind="note" persisted={!note.id.startsWith("note-draft-")} busy={creatingNote !== null}
      onKindChange={async (kind) => { if (kind !== "note" && await flushCurrentNote()) convertNote({ ...note, id: noteAliases.current.get(note.id) ?? note.id }, kind); }}
      onCopy={() => { const live = noteInspectorBodyRef.current?.getDraft(); return copyInspectorText(live?.title ?? note.title, live?.body ?? note.body); }}
      onDuplicate={() => duplicateNote(noteAliases.current.get(note.id) ?? note.id)}
      onDelete={() => deleteNote(noteAliases.current.get(note.id) ?? note.id)} />;
  }

  async function discardNoteEdits(): Promise<void> {
    await noteInspectorBodyRef.current?.settle();
    setNoteInspectorMode("view");
    setNoteActionError(undefined);
    fullNoteId.current = null;
    if (selectedNoteId?.startsWith("note-draft-")) setNotes((current) => current.filter((note) => note.id !== selectedNoteId));
    await closeInspector();
    source.refresh();
  }

  useEffect(() => {
    if (currentInspector?.kind === "note" && autoCreateNoteIds.current.delete(currentInspector.id)) void flushCurrentNote();
  }, [currentInspector?.id, currentInspector?.kind]);

  function openNoteInspector(
    note: NoteViewModel,
    mode: "view" | "edit" = "edit"
  ): void {
    const instance = ++noteInspectorInstance.current;
    setNoteActionError(undefined);
    setNoteInspectorMode(mode);
    openInspector({
      actions: null,
      toolbar: noteInspectorToolbar(note),
      onSave: flushCurrentNote,
      onDiscard: discardNoteEdits,
      saving: false,
      saveError: undefined,
      body: noteInspectorBody(note, mode),
      dirty: false,
      hideHeader: false,
      id: note.id,
      kind: "note",
      onConfirmClose: async () => {
        if (instance !== noteInspectorInstance.current) return true;
        if (noteInspectorModeRef.current === "edit") {
          return await flushCurrentNote();
        }
        return true;
      },
      subtitle: note.updatedLabel,
      title: note.title || "Untitled note"
    });
  }

  async function readFullNote(noteId: string): Promise<NoteViewModel | null> {
    if (noteId.startsWith("note-draft-")) return notes.find((note) => note.id === noteId) ?? null;
    try {
      const result = await window.hcb?.notes.get({ id: noteId });
      if (!result?.ok) throw new Error(result?.error.message ?? "Note could not be opened.");
      return noteFromNative(result.data);
    } catch (error) {
      setNoteActionError(error instanceof Error ? error.message : "Note could not be opened.");
      return null;
    }
  }

  async function flushCurrentNote(): Promise<boolean> {
    if (noteInspectorModeRef.current !== "edit") return true;
    const saved = await noteInspectorBodyRef.current?.flush() ?? true;
    if (!saved) setNoteActionError((message) => message ?? "Your changes are still open. Retry saving before leaving this note.");
    return saved;
  }

  function retainFullNote(note: NoteViewModel): void {
    fullNoteId.current = note.id;
    setNotes((current) => [note, ...current.filter((candidate) => candidate.id.startsWith("note-draft-") && candidate.id !== note.id),
      ...source.initialNotes.filter((candidate) => candidate.id !== note.id)]);
  }

  async function selectNote(noteId: string, mode: "view" | "edit" = "edit"): Promise<void> {
    const generation = ++selectionGeneration.current;
    if (!await flushCurrentNote() || generation !== selectionGeneration.current) return;
    const note = await readFullNote(noteId);
    if (!note || generation !== selectionGeneration.current) return;
    retainFullNote(note);
    setSelectedNoteId(note.id);
    openNoteInspector(note, mode);
  }

  async function createNote(listId?: string): Promise<void> {
    ++selectionGeneration.current;
    if (!await flushCurrentNote()) return;

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
      preview: "",
      tags: [],
      updatedLabel: "Just now"
    };

    setDraftCounter((current) => current + 1);
    setNotes((current) => [fallbackNote, ...current.filter((note) => !note.id.startsWith("note-draft-"))]);
    setSelectedNoteId(fallbackId);
    createNoteIds.current.add(fallbackId);
    openNoteInspector(fallbackNote, "edit");
  }

  function openLocalNoteDraft(seed: {
    body: string;
    listId: string;
    listTitle: string;
    tags?: string[];
    title: string;
  }): string {
    const fallbackId = `note-draft-${draftCounter}`;
    const fallbackNote: NoteViewModel = {
      id: fallbackId,
      listId: seed.listId,
      listTitle: seed.listTitle,
      title: seed.title,
      body: seed.body,
      preview: buildNotePreview(seed.body),
      tags: seed.tags ?? [],
      updatedLabel: "Just now"
    };

    setDraftCounter((current) => current + 1);
    setNotes((current) => [fallbackNote, ...current.filter((note) => !note.id.startsWith("note-draft-"))]);
    setSelectedNoteId(fallbackId);
    createNoteIds.current.add(fallbackId);
    openNoteInspector(fallbackNote, "edit");

    return fallbackId;
  }

  async function openConvertedNoteDraft(
    seed: {
      body: string;
      id?: string;
      listId?: string;
      listTitle?: string;
      replaceSource?: boolean;
      tags?: string[];
      title: string;
    },
    cleanup?: ConvertSourceCleanup
  ): Promise<void> {
    ++selectionGeneration.current;
    if (!await flushCurrentNote()) return;

    const list = noteLists.find((candidate) => candidate.id === seed.listId) ?? noteLists[0];

    if (!list) {
      return;
    }

    const draftId = openLocalNoteDraft({
      title: seed.title,
      body: seed.body,
      tags: seed.tags ?? [],
      listId: list.id,
      listTitle: list.title
    });

    if (cleanup) {
      conversionCleanupByNoteId.current.set(draftId, cleanup);
      autoCreateNoteIds.current.add(draftId);
    }
  }

  function convertNote(note: NoteViewModel, target: "event" | "birthday" | "task"): void {
    const live = noteInspectorBodyRef.current?.getDraft();
    const title = live?.title ?? note.title;
    const body = live?.body ?? note.body;
    const tags = live?.tags ?? note.tags ?? [];
    const cleanup = note.id.startsWith("note-draft-") ? undefined : conversionCleanup("note", note.id, target);
    if (cleanup === null) return;
    if (target === "event" || target === "birthday") {
      dispatchConvertCommand({ cleanup, target: "event", eventDraft: { title, notes: body, tags, ...(target === "birthday" ? { hcbKind: "birthday" } : {}) } });
      return;
    }
    dispatchConvertCommand({ cleanup, target, taskDraft: { title, notes: body, tags, dueDate: dateInputValue(new Date().toISOString()), listId: source.taskLists[0]?.id, priority: "none", plannedStart: null, plannedEnd: null, durationMinutes: null, lockedSchedule: false } });
  }

  async function cleanupConvertedSource(noteId: string): Promise<string | null> {
    const cleanup = conversionCleanupByNoteId.current.get(noteId);

    if (!cleanup) {
      return null;
    }

    conversionCleanupByNoteId.current.delete(noteId);

    if (cleanup.kind === "event") {
      const result = await window.hcb?.calendar.delete({ id: cleanup.id });
      return result?.ok ? null : result?.error.message ?? "Original event was not removed.";
    }

    const result = await window.hcb?.tasks.delete({ id: cleanup.id });
    return result?.ok ? null : result?.error.message ?? "Original task was not removed.";
  }

  async function createNoteWithTemplate(title: string, body: string, listId?: string): Promise<void> {
    ++selectionGeneration.current;
    if (!await flushCurrentNote()) return;

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
      tags: [],
      updatedLabel: "Just now"
    };

    setDraftCounter((current) => current + 1);
    setNotes((current) => [fallbackNote, ...current.filter((note) => !note.id.startsWith("note-draft-"))]);
    setSelectedNoteId(fallbackId);
    createNoteIds.current.add(fallbackId);
    openNoteInspector(fallbackNote, "edit");
  }

  async function duplicateNote(noteId: string): Promise<void> {
    ++selectionGeneration.current;
    if (!await flushCurrentNote()) return;

    const note = await readFullNote(noteId);
    if (!note) return;

    const liveDraft =
      currentInspector?.kind === "note" && currentInspector.id === note.id
        ? noteInspectorBodyRef.current?.getDraft()
        : null;

    const draftId = openLocalNoteDraft({
      title: copiedTitle(liveDraft?.title ?? note.title, "Untitled note"),
      body: liveDraft?.body ?? note.body,
      tags: liveDraft?.tags ?? note.tags ?? [],
      listId: note.listId,
      listTitle: note.listTitle
    });
    autoCreateNoteIds.current.add(draftId);
  }

  async function createNoteList(): Promise<void> {
    const title = await requestText({ title: "Create note list", submitLabel: "Create list" });
    if (!title) return;
    const result = await window.hcb?.notes.createNoteList({ title });

    if (result?.ok) {
      setLocalNoteLists((current) => [...current, result.data]);
      setSelectedNoteViews([noteListSelection(result.data.id)]);
      source.refresh();
    } else setNoteActionError(result?.error.message ?? "Note list was not created.");
  }

  async function deleteNoteList(listId: string, title: string): Promise<void> {
    const count = noteLists.find((list) => list.id === listId)?.noteCount ?? 0;
    if (!window.confirm(`Delete ${title} and ${count} note${count === 1 ? "" : "s"}? This cannot be undone.`)) {
      return;
    }

    const result = await window.hcb?.notes.deleteNoteList({ id: listId });

    if (!result?.ok) {
      setNoteActionError(result?.error.message ?? "Note list was not deleted.");
      return;
    }
    if (selectedNote?.listId === listId) { fullNoteId.current = null; setSelectedNoteId(null); await closeInspector(); }

    setLocalNoteLists((current) =>
      current.filter((list) => list.id !== listId)
    );
    setNotes((current) => current.filter((note) => note.listId !== listId));
    setSelectedNoteViews((current) => {
      const next = current.filter((view) => view !== noteListSelection(listId));
      return next.length > 0 ? next : noteLists.filter((list) => list.id !== listId).map((list) => noteListSelection(list.id));
    });
    source.refresh();
  }

  async function renameNoteList(listId: string, currentTitle: string): Promise<void> {
    const title = await requestText({ title: "Rename list", initialValue: currentTitle });

    if (!title || title === currentTitle) {
      return;
    }

    const result = await window.hcb?.notes.renameNoteList({ id: listId, title });

    if (result?.ok) {
      const displayTitle = result.data.title;
      setLocalNoteLists((current) =>
        current.map((list) => (list.id === listId ? result.data : list))
      );
      setNotes((current) =>
        current.map((note) => (note.listId === listId ? { ...note, listTitle: displayTitle } : note))
      );
      source.refresh();
    } else setNoteActionError(result?.error.message ?? "Note list was not renamed.");
  }

  function updateNoteDraft(noteId: string, draft: NoteDraftValue): void {
    noteId = noteAliases.current.get(noteId) ?? noteId;
    const startedAt = rendererNow();
    if (currentInspector?.kind === "note" && currentInspector.id === noteId) {
      setNoteActionError(undefined);
    }
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
          tags: draft.tags,
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
    noteId = noteAliases.current.get(noteId) ?? noteId;
    setCreatingNote(noteId);
    setNoteActionError(undefined);
    try {
      if (noteId.startsWith("note-draft-")) {
        const note = notes.find((candidate) => candidate.id === noteId);
        if (!note) return false;
        const result = await window.hcb?.notes.create({ title: draft.title || "Untitled note", body: draft.body, listId: note.listId, tags: draft.tags });
        if (!result?.ok) { setNoteActionError(result?.error.message ?? "Note was not saved."); return false; }
        const persisted = noteFromNative(result.data);
        noteAliases.current.set(noteId, persisted.id);
        fullNoteId.current = persisted.id;
        // Keep the editor mounted and retain any text entered during creation.
        const live = noteInspectorBodyRef.current?.getDraft() ?? draft;
        setNotes((current) => current.map((candidate) => candidate.id === noteId ? { ...persisted, ...live, preview: buildNotePreview(live.body) } : candidate));
        setSelectedNoteId(persisted.id);
        updateInspector({ id: persisted.id });
        createNoteIds.current.delete(noteId);
        const cleanupError = await cleanupConvertedSource(noteId);
        if (cleanupError) setNoteActionError(`The new note was saved, but ${cleanupError}`);
      } else {
        const result = await window.hcb?.notes.update({ id: noteId, title: draft.title || "Untitled note", body: draft.body, tags: draft.tags });
        if (!result?.ok) { setNoteActionError(result?.error.message ?? "Note was not saved."); return false; }
      }
      source.refresh();
      return true;
    } catch (error) {
      setNoteActionError(error instanceof Error ? error.message : "Note was not saved.");
      return false;
    } finally { setCreatingNote(null); }
  }

  async function deleteNote(noteId: string): Promise<void> {
    await noteInspectorBodyRef.current?.settle();
    noteId = noteAliases.current.get(noteId) ?? noteId;
    const result = noteId.startsWith("note-draft-") ? { ok: true } : await window.hcb?.notes.delete({ id: noteId });
    if (!result?.ok) { setNoteActionError("Note was not deleted."); return; }
    setNotes((current) => current.filter((candidate) => candidate.id !== noteId));
    createNoteIds.current.delete(noteId);
    conversionCleanupByNoteId.current.delete(noteId);
    if (starredNoteIds.has(noteId)) toggleNoteStar(noteId);
    if (selectedNoteId === noteId) {
      ++selectionGeneration.current;
      fullNoteId.current = null;
      setSelectedNoteId(null);
      // The record was deliberately deleted: do not autosave it on close.
      setNoteInspectorMode("view");
      await closeInspector();
    }
    source.refresh();
  }

  function toggleNoteStar(noteId: string): void {
    const ids = new Set(starredNoteIds);
    const timestamps = { ...starredNoteAt };
    if (ids.has(noteId)) { ids.delete(noteId); delete timestamps[noteId]; }
    else { ids.add(noteId); timestamps[noteId] = Date.now(); }
    setStarredNoteIds(ids);
    setStarredNoteAt(timestamps);
    void source.updateSettings({ starredNoteIds: [...ids], starredNoteAt: timestamps });
  }

  async function moveNoteToList(noteId: string, listId: string): Promise<void> {
    const list = noteLists.find((candidate) => candidate.id === listId);
    if (!list) return;
    if (!await flushCurrentNote()) return;
    if (!noteId.startsWith("note-draft-")) {
      const result = await window.hcb?.notes.update({ id: noteId, listId });
      if (!result?.ok) { setNoteActionError(result?.error.message ?? "Note was not moved."); return; }
    }
    setNotes((current) => current.map((candidate) => candidate.id === noteId ? { ...candidate, listId, listTitle: list.title } : candidate));
    source.refresh();
  }

  function toggleNoteView(view: NoteBoardSelection): void {
    setSelectedNoteViews([view]);
  }

  return {
    noteActionError,
    createNote,
    createNoteList,
    deleteNoteList,
    deleteNote,
    duplicateNote,
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
