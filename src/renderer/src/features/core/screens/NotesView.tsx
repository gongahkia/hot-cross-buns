import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  AlertTriangle,
  Bell,
  Brush,
  CalendarClock,
  CalendarPlus,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  Clock3,
  Copy,
  Eye,
  EyeOff,
  FileText,
  Flag,
  Gift,
  Info,
  Keyboard,
  Languages,
  ListPlus,
  MapPin,
  Pencil,
  Filter,
  Minus,
  MoreVertical,
  PanelLeft,
  PanelRight,
  Plus,
  Power,
  RotateCcw,
  Save,
  Server,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  StepBack,
  StepForward,
  Search,
  Settings2,
  Trash2,
  Star,
  Users,
  X
} from "lucide-react";
import { useInspector } from "../../../components/Inspector";
import { Badge, Button, IconButton, ListRow, Panel, cx } from "../../../components/primitives";
import { EmptyState } from "../../../components/states";
import { VirtualizedList } from "../../../components/VirtualizedList";
import { rendererNow, reportRendererTimingSince } from "../../../hooks/useRenderTiming";
import { useCoreViewModelSource } from "../coreViewModelSource";
import type { NoteViewModel } from "../coreViewModels";
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
import {
  CacheStatePanel,
  TaskCompletionButton,
  actionDescription,
  actionLabel,
  dateInputValue,
  priorityLabel,
  priorityTone,
  scheduleRendererFrame
} from "../coreScreenShared";

type NoteBoardSelection = "all" | "starred";

const starredNotesStorageKey = "hcb.starredNoteIds";
const starredNotesAtStorageKey = "hcb.starredNoteAt";

function TaskNotesView(): JSX.Element {
  const source = useCoreViewModelSource();
  const undatedTasks = useMemo(
    () =>
      source.largeTaskWindow.filter(
        (task) =>
          task.status === "open" &&
          task.parentId === null &&
          !task.dueDate &&
          !task.plannedStart
      ),
    [source.largeTaskWindow]
  );

  if (
    (source.dataState === "loading" ||
      source.dataState === "offline" ||
      source.dataState === "error") &&
    !source.hasCachedData
  ) {
    return <CacheStatePanel title="Notes" />;
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <Panel
        title="Notes"
        description="Undated Google Tasks"
        action={<Badge tone="neutral">{undatedTasks.length}</Badge>}
      >
        {undatedTasks.length > 0 ? (
          <VirtualizedList
            ariaLabel="Undated task notes"
            estimateRowHeight={68}
            getKey={(task) => task.id}
            items={undatedTasks}
            performanceLabel="notes.undated-tasks"
            renderRow={(task) => (
              <ListRow
                description={task.detail}
                leading={
                  <TaskCompletionButton
                    completed={false}
                    onToggle={(taskId) => void source.completeTask(taskId)}
                    task={task}
                  />
                }
                meta={task.list}
                title={task.title}
                trailing={<Badge tone={priorityTone(task.priority)}>{priorityLabel(task.priority)}</Badge>}
              />
            )}
            viewportHeight={Math.min(560, Math.max(180, undatedTasks.length * 68))}
          />
        ) : (
          <EmptyState
            description="Google Tasks with no due date or planned block will appear here."
            title="No undated tasks"
          />
        )}
      </Panel>
    </div>
  );
}

export function NotesView(): JSX.Element {
  const source = useCoreViewModelSource();
  const {
    close: closeInspector,
    current: currentInspector,
    open: openInspector,
    update: updateInspector
  } = useInspector();
  const [notes, setNotes] = useState<NoteViewModel[]>(source.initialNotes);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(
    source.initialNotes[0]?.id ?? null
  );
  const [selectedNoteViews, setSelectedNoteViews] = useState<NoteBoardSelection[]>(["all"]);
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
  const selectedNote = notes.find((note) => note.id === selectedNoteId) ?? null;
  const starredNotes = useMemo(
    () =>
      notes
        .filter((note) => starredNoteIds.has(note.id))
        .sort((left, right) => (starredNoteAt[right.id] ?? 0) - (starredNoteAt[left.id] ?? 0)),
    [notes, starredNoteAt, starredNoteIds]
  );
  const noteViewColumns = useMemo(
    () =>
      selectedNoteViews.map((view) => ({
        id: view,
        title: view === "starred" ? "Starred notes" : "Local notes",
        description:
          view === "starred"
            ? "All starred local notes"
            : "Select a note to open details in the Inspector",
        emptyDescription:
          view === "starred"
            ? "Star notes to collect them here."
            : "Create a local note to populate SQLite.",
        emptyTitle: view === "starred" ? "No starred notes" : "No local notes",
        notes: view === "starred" ? starredNotes : notes
      })),
    [notes, selectedNoteViews, starredNotes]
  );

  useEffect(() => {
    writeLocalStorageJSON(starredNotesStorageKey, [...starredNoteIds]);
  }, [starredNoteIds]);

  useEffect(() => {
    writeLocalStorageJSON(starredNotesAtStorageKey, starredNoteAt);
  }, [starredNoteAt]);

  useEffect(() => {
    requestedNoteDetails.current.clear();
    setNotes(source.initialNotes);
    setSelectedNoteId((current) =>
      current && source.initialNotes.some((note) => note.id === current)
        ? current
        : source.initialNotes[0]?.id ?? null
    );
  }, [source.initialNotes]);

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
      const detail = (event as CustomEvent<{ action: string }>).detail;

      if (detail?.action === "new-note") {
        void createNote();
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
      subtitle: selectedNote.updatedLabel,
      title: selectedNote.title || "Untitled note"
    });
  }, [
    currentInspector?.id,
    currentInspector?.kind,
    notes,
    selectedNote,
    updateInspector
  ]);

  if (
    (source.dataState === "loading" ||
      source.dataState === "offline" ||
      source.dataState === "error") &&
    !source.hasCachedData
  ) {
    return <CacheStatePanel title="Notes" />;
  }

  function noteInspectorBody(note: NoteViewModel): ReactNode {
    return (
      <NoteInspectorBody
        key={note.id}
        note={note}
        notes={notes}
        onDraftChange={updateNoteDraft}
        onOpenNote={selectNote}
        onPersist={persistNoteDraft}
        ref={noteInspectorBodyRef}
      />
    );
  }

  function noteInspectorActions(note: NoteViewModel): ReactNode {
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

  function openNoteInspector(note: NoteViewModel): void {
    openInspector({
      actions: noteInspectorActions(note),
      body: noteInspectorBody(note),
      dirty: false,
      id: note.id,
      kind: "note",
      onConfirmClose: async () => {
        await noteInspectorBodyRef.current?.flush();
        return true;
      },
      subtitle: note.updatedLabel,
      title: note.title || "Untitled note"
    });
  }

  async function selectNote(noteId: string): Promise<void> {
    const note = notes.find((candidate) => candidate.id === noteId);

    if (!note) {
      return;
    }

    await noteInspectorBodyRef.current?.flush();
    setSelectedNoteId(note.id);
    openNoteInspector(note);
  }

  async function createNote(): Promise<void> {
    await noteInspectorBodyRef.current?.flush();

    const fallbackId = `note-draft-${draftCounter}`;
    const fallbackNote: NoteViewModel = {
      id: fallbackId,
      title: "Untitled note",
      body: "",
      preview: "Empty local note",
      updatedLabel: "Just now"
    };

    setDraftCounter((current) => current + 1);
    setNotes((current) => [fallbackNote, ...current]);
    setSelectedNoteId(fallbackId);
    openNoteInspector(fallbackNote);

    const result = await window.hcb?.notes.create({
      title: "Untitled note",
      body: ""
    });

    if (result?.ok) {
      requestedNoteDetails.current.add(result.data.id);
      const persisted = {
        id: result.data.id,
        title: result.data.title,
        body: result.data.body,
        preview: result.data.preview,
        updatedLabel: "Just now"
      };

      setNotes((current) =>
        current.map((note) => (note.id === fallbackId ? persisted : note))
      );
      setSelectedNoteId(result.data.id);
      openNoteInspector(persisted);
    }
  }

  async function createNoteWithTemplate(title: string, body: string): Promise<void> {
    await noteInspectorBodyRef.current?.flush();

    const fallbackId = `note-draft-${draftCounter}`;
    const fallbackNote: NoteViewModel = {
      id: fallbackId,
      title,
      body,
      preview: buildNotePreview(body),
      updatedLabel: "Just now"
    };

    setDraftCounter((current) => current + 1);
    setNotes((current) => [fallbackNote, ...current]);
    setSelectedNoteId(fallbackId);
    openNoteInspector(fallbackNote);

    const result = await window.hcb?.notes.create({ title, body });

    if (result?.ok) {
      requestedNoteDetails.current.add(result.data.id);
      const persisted = {
        id: result.data.id,
        title: result.data.title,
        body: result.data.body,
        preview: result.data.preview,
        updatedLabel: "Just now"
      };

      setNotes((current) =>
        current.map((note) => (note.id === fallbackId ? persisted : note))
      );
      setSelectedNoteId(result.data.id);
      openNoteInspector(persisted);
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
          updatedLabel: "Edited locally"
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
      openNoteInspector(nextNote);
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

  function toggleNoteView(view: NoteBoardSelection): void {
    setSelectedNoteViews((current) => {
      if (current.includes(view)) {
        return current.filter((selectedView) => selectedView !== view);
      }

      return view === "all" ? [view, ...current] : [...current, view];
    });
  }

  return (
    <div className="grid h-full min-h-0 grid-cols-1 gap-3 lg:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="min-h-0 rounded-hcbLg bg-bg-secondary p-3" aria-label="Notes navigation">
        <Button
          aria-label={actionLabel("note.create")}
          className="h-12 min-w-32 justify-start rounded-hcbLg shadow-sm"
          data-action-id="note.create"
          onClick={() => void createNote()}
          title={actionDescription("note.create")}
          variant="secondary"
        >
          <Plus aria-hidden="true" size={18} />
          Create
        </Button>
        <div className="mt-5 grid gap-1">
          <NoteSidebarCheckbox
            checked={selectedNoteViews.includes("all")}
            count={notes.length}
            label="All notes"
            onClick={() => toggleNoteView("all")}
          />
          <NoteSidebarCheckbox
            checked={selectedNoteViews.includes("starred")}
            count={notes.filter((note) => starredNoteIds.has(note.id)).length}
            label="Starred"
            onClick={() => toggleNoteView("starred")}
          />
        </div>
        <div className="mt-5 grid gap-1">
          <Button className="justify-start" onClick={createDailyNote} variant="ghost">
            <CalendarPlus aria-hidden="true" size={16} />
            Daily note
          </Button>
          <Button className="justify-start" onClick={createMeetingNote} variant="ghost">
            <Pencil aria-hidden="true" size={16} />
            Meeting note
          </Button>
        </div>
      </aside>
      <div className="min-h-0 min-w-0 overflow-hidden rounded-hcbLg bg-bg-secondary">
        <div
          className="flex h-full min-h-[480px] min-w-0 gap-3 overflow-x-auto p-3"
          role="list"
          aria-label="Note views"
        >
          {noteViewColumns.length > 0 ? (
            noteViewColumns.map((column) => (
              <Panel
                action={<Badge tone="neutral">{column.notes.length}</Badge>}
                className="flex max-h-full w-[min(520px,calc(100vw-2rem))] shrink-0 flex-col overflow-hidden bg-bg-primary"
                description={column.description}
                key={column.id}
                role="listitem"
                title={column.title}
              >
                <VirtualizedList
                  ariaLabel={column.title}
                  emptyState={
                    <EmptyState
                      description={column.emptyDescription}
                      title={column.emptyTitle}
                    />
                  }
                  estimateRowHeight={66}
                  getKey={(note) => note.id}
                  items={column.notes}
                  performanceLabel={`notes.${column.id}.list`}
                  renderRow={(note) => (
                    <NoteBoardRow
                      key={note.id}
                      note={note}
                      onDeleteNote={(noteId) => void deleteNote(noteId)}
                      onOpenNote={(noteId) => void selectNote(noteId)}
                      onToggleStar={toggleNoteStar}
                      selected={note.id === selectedNoteId}
                      starred={starredNoteIds.has(note.id)}
                    />
                  )}
                  viewportHeight={520}
                />
              </Panel>
            ))
          ) : (
            <div className="grid min-h-[360px] min-w-80 flex-1 place-items-center rounded-hcbLg border border-border bg-bg-primary">
              <EmptyState
                description="Select at least one note view from the sidebar to show it here."
                title="No visible note views"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function NoteSidebarCheckbox({
  checked,
  count,
  label,
  onClick
}: {
  checked: boolean;
  count: number;
  label: string;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      aria-checked={checked}
      aria-label={label}
      className={cx(
        "grid h-9 grid-cols-[22px_minmax(0,1fr)_auto] items-center gap-2 rounded-hcbLg px-2 text-left transition-colors duration-fast ease-hcb focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        checked ? "text-text-primary" : "text-text-secondary hover:bg-surface-0 hover:text-text-primary"
      )}
      onClick={onClick}
      role="checkbox"
      type="button"
    >
      <span
        aria-hidden="true"
        className={cx(
          "flex size-4 items-center justify-center rounded-[4px] border",
          checked ? "border-accent bg-accent text-bg-primary" : "border-text-muted bg-transparent"
        )}
      >
        {checked ? <Check size={12} strokeWidth={3} /> : null}
      </span>
      <span className="truncate text-[var(--text-base)] font-medium">{label}</span>
      <span className="text-[var(--text-xs)] text-text-muted">{count}</span>
    </button>
  );
}

function NoteBoardRow({
  note,
  onDeleteNote,
  onOpenNote,
  onToggleStar,
  selected,
  starred
}: {
  note: NoteViewModel;
  onDeleteNote: (noteId: string) => void;
  onOpenNote: (noteId: string) => void;
  onToggleStar: (noteId: string) => void;
  selected: boolean;
  starred: boolean;
}): JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div
      className={cx(
        "group relative grid min-h-[66px] grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border px-3 py-2 last:border-b-0 transition-colors duration-fast ease-hcb",
        selected ? "bg-surface-0" : "bg-transparent hover:bg-surface-0"
      )}
      role="listitem"
    >
      <button
        aria-current={selected ? "true" : undefined}
        aria-label={`Open note ${note.title}`}
        className="min-w-0 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        onClick={() => onOpenNote(note.id)}
        type="button"
      >
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[var(--text-md)] font-medium text-text-primary">
            {note.title}
          </span>
          <span className="shrink-0 text-[var(--text-xs)] text-text-muted">
            {note.updatedLabel}
          </span>
        </div>
        <p className="truncate text-[var(--text-sm)] text-text-muted">{note.preview}</p>
      </button>
      <div
        className={cx(
          "relative flex items-center gap-1 transition-opacity duration-fast ease-hcb group-focus-within:opacity-100 group-hover:opacity-100",
          starred || menuOpen ? "opacity-100" : "opacity-0"
        )}
      >
        <IconButton
          className="size-7 rounded-full"
          icon={MoreVertical}
          label={`Open actions for ${note.title}`}
          onClick={() => setMenuOpen((open) => !open)}
          variant="ghost"
        />
        <IconButton
          className={cx("size-7 rounded-full", starred ? "text-accent [&_svg]:fill-current" : undefined)}
          icon={Star}
          label={starred ? `Unstar ${note.title}` : `Star ${note.title}`}
          onClick={() => onToggleStar(note.id)}
          variant="ghost"
        />
        {menuOpen ? (
          <NoteActionMenu
            onDelete={() => {
              onDeleteNote(note.id);
              setMenuOpen(false);
            }}
            onEdit={() => {
              onOpenNote(note.id);
              setMenuOpen(false);
            }}
          />
        ) : null}
      </div>
    </div>
  );
}

function NoteActionMenu({
  onDelete,
  onEdit
}: {
  onDelete: () => void;
  onEdit: () => void;
}): JSX.Element {
  return (
    <div className="absolute right-0 top-8 z-30 w-56 overflow-hidden rounded-hcbLg border border-border bg-bg-primary py-2 shadow-xl">
      <button
        className="flex min-h-9 w-full items-center gap-3 px-4 text-left text-[var(--text-base)] text-text-primary transition-colors duration-fast ease-hcb hover:bg-surface-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        onClick={onEdit}
        type="button"
      >
        <Pencil aria-hidden="true" size={18} />
        Edit note
      </button>
      <button
        className="flex min-h-9 w-full items-center gap-3 px-4 text-left text-[var(--text-base)] text-danger transition-colors duration-fast ease-hcb hover:bg-danger/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        onClick={onDelete}
        type="button"
      >
        <Trash2 aria-hidden="true" size={18} />
        Delete
      </button>
    </div>
  );
}
