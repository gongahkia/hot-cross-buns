import { useState, type DragEvent } from "react";
import { Copy, MoreVertical, Pencil, Plus, Star, Trash2 } from "lucide-react";
import { FloatingMenu } from "../../../components/FloatingMenu";
import { Badge, IconButton, Panel, cx } from "../../../components/primitives";
import { EmptyState } from "../../../components/states";
import { PagedVirtualList } from "../../../components/PagedVirtualList";
import { usePagedCollection } from "../../../hooks/usePagedCollection";
import { noteViewModel } from "../viewModelSource/noteViewModels";
import type { CoreViewModelSource } from "../coreViewModelSource";
import type { NoteViewModel } from "../coreViewModels";
import type { NoteViewColumn } from "./notesTypes";

const noteDragType = "application/x-hcb-note-id";

export function NotesBoard({
  columns,
  onCreateNote,
  onDeleteNoteList,
  onDeleteNote,
  onDuplicateNote,
  onMoveNote,
  onOpenNote,
  onRenameNoteList,
  onToggleStar,
  selectedNoteId,
  starredNoteIds,
  source
}: {
  source: CoreViewModelSource;
  columns: NoteViewColumn[];
  onCreateNote: (listId: string) => void;
  onDeleteNoteList: (listId: string, title: string) => void;
  onDeleteNote: (noteId: string) => void;
  onDuplicateNote: (noteId: string) => void;
  onMoveNote: (noteId: string, listId: string) => void;
  onOpenNote: (noteId: string, mode?: "view" | "edit") => void;
  onRenameNoteList: (listId: string, currentTitle: string) => void;
  onToggleStar: (noteId: string) => void;
  selectedNoteId: string | null;
  starredNoteIds: ReadonlySet<string>;
}): JSX.Element {
  return (
    <div className="h-full min-h-0 min-w-0 flex-1 overflow-hidden rounded-hcbLg bg-bg-primary">
      <div
        className={cx(
          "flex h-full min-h-[480px] min-w-0 gap-2 p-2",
          columns.length <= 1 ? "overflow-y-auto" : "overflow-x-auto"
        )}
        role="list"
        aria-label="Note views"
      >
        {columns.length > 0 ? (
          columns.map((column) => (
            <NoteListColumn key={column.id} column={column} source={source} starredNoteIds={starredNoteIds}
              selectedNoteId={selectedNoteId} single={columns.length === 1}
              onCreateNote={onCreateNote} onDeleteNoteList={onDeleteNoteList} onDeleteNote={onDeleteNote}
              onDuplicateNote={onDuplicateNote} onMoveNote={onMoveNote} onOpenNote={onOpenNote}
              onRenameNoteList={onRenameNoteList} onToggleStar={onToggleStar} />
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
  );
}

function NoteListColumn({ column, source, single, ...actions }: Omit<Parameters<typeof NotesBoard>[0], "columns"> & { column: NoteViewColumn; single: boolean }): JSX.Element {
  const starSignature = JSON.stringify([...actions.starredNoteIds]);
  const collection = usePagedCollection<NoteViewModel>(`${column.listId}:${source.noteDataRevision}:${starSignature}`, async (offset, limit) => {
    const response = await window.hcb!.notes.list({ listId: column.listId, summary: true, limit, cursor: String(offset) });
    if (!response.ok) throw new Error(response.error.message);
    return { ...response.data, items: response.data.items.map(noteViewModel) };
  });
  const drafts = column.notes.filter((note) => note.id.startsWith("note-draft-"));
  return <Panel
    action={<NoteColumnAction count={(collection.total ?? 0) + drafts.length} listId={column.listId} onDeleteNoteList={actions.onDeleteNoteList} onRenameNoteList={actions.onRenameNoteList} title={column.title} />}
    className={cx("flex max-h-full flex-col overflow-hidden border-border/70 bg-bg-primary shadow-none", single ? "w-full" : "w-[min(560px,calc(100vw-2rem))] shrink-0")}
    description="Local notes · Starred first, then recently edited" role="listitem" title={column.title}>
    <button className="flex min-h-10 w-full items-center gap-3 border-b border-border px-4 text-left text-[var(--text-base)] font-semibold text-accent hover:bg-surface-0" onClick={() => actions.onCreateNote(column.listId)} type="button"><Plus aria-hidden size={18} />Add a note</button>
    <NoteColumnDropTarget column={column} onMoveNote={actions.onMoveNote}>
      <div className="flex h-full min-h-0 flex-col">
        {drafts.map((note) => <NoteBoardRow key={note.id} note={note} {...actions} selected={note.id === actions.selectedNoteId} starred={actions.starredNoteIds.has(note.id)} />)}
        <PagedVirtualList ariaLabel={column.title} collection={collection} estimateRowHeight={72} getKey={(note) => note.id}
          emptyState={drafts.length ? undefined : <EmptyState description={column.emptyDescription} title={column.emptyTitle} />}
          renderRow={(note) => <NoteBoardRow key={note.id} note={note} {...actions} selected={note.id === actions.selectedNoteId} starred={actions.starredNoteIds.has(note.id)} />} />
      </div>
    </NoteColumnDropTarget>
  </Panel>;
}

function NoteColumnAction({
  count,
  listId,
  onDeleteNoteList,
  onRenameNoteList,
  title
}: {
  count: number;
  listId: string;
  onDeleteNoteList: (listId: string, title: string) => void;
  onRenameNoteList: (listId: string, currentTitle: string) => void;
  title: string;
}): JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPoint, setMenuPoint] = useState<{ x: number; y: number } | null>(null);
  const canDelete = true;

  return (
    <div className="flex items-center gap-1">
      <Badge tone="neutral">{count}</Badge>
      {listId ? (
        <>
          <IconButton
            className="size-10 rounded-full"
            icon={MoreVertical}
            label={`More actions for ${title}`}
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              setMenuPoint({ x: rect.right, y: rect.bottom });
              setMenuOpen(true);
            }}
            variant="ghost"
          />
          {menuOpen ? (
            <NoteListActionMenu
              anchorPoint={menuPoint ?? undefined}
              canDelete={canDelete}
              onClose={() => setMenuOpen(false)}
              onDelete={() => {
                onDeleteNoteList(listId, title);
                setMenuOpen(false);
              }}
              onRename={() => {
                onRenameNoteList(listId, title);
                setMenuOpen(false);
              }}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function NoteColumnDropTarget({
  children,
  column,
  onMoveNote
}: {
  children: JSX.Element;
  column: NoteViewColumn;
  onMoveNote: (noteId: string, listId: string) => void;
}): JSX.Element {
  const [dropActive, setDropActive] = useState(false);

  function handleDragOver(event: DragEvent<HTMLDivElement>): void {
    if (!column.listId || !event.dataTransfer.types.includes(noteDragType)) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropActive(true);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>): void {
    if (!column.listId) {
      return;
    }

    const noteId = event.dataTransfer.getData(noteDragType);
    if (!noteId) {
      return;
    }

    event.preventDefault();
    setDropActive(false);
    onMoveNote(noteId, column.listId);
  }

  return (
    <div
      className={cx("min-h-0 flex-1", dropActive && "ring-2 ring-info")}
      onDragLeave={() => setDropActive(false)}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {children}
    </div>
  );
}

function NoteBoardRow({
  note,
  onDeleteNote,
  onDuplicateNote,
  onOpenNote,
  onToggleStar,
  selected,
  starred
}: {
  note: NoteViewModel;
  onDeleteNote: (noteId: string) => void;
  onDuplicateNote: (noteId: string) => void;
  onOpenNote: (noteId: string, mode?: "view" | "edit") => void;
  onToggleStar: (noteId: string) => void;
  selected: boolean;
  starred: boolean;
}): JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPoint, setMenuPoint] = useState<{ x: number; y: number } | null>(null);

  return (
    <div
      className={cx(
        "group relative grid min-h-[58px] grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border/70 px-4 py-2 last:border-b-0 transition-colors duration-fast ease-hcb",
        selected ? "bg-accent/10" : "bg-transparent hover:bg-surface-0/70"
      )}
      draggable
      onContextMenu={(event) => {
        event.preventDefault();
        setMenuPoint({ x: event.clientX, y: event.clientY });
        setMenuOpen(true);
      }}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData(noteDragType, note.id);
      }}
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
          <span className="min-w-0 flex-1 whitespace-normal break-words text-[var(--text-md)] font-medium leading-snug text-text-primary">
            {note.title}
          </span>
          <span className="shrink-0 text-[var(--text-xs)] text-text-muted">
            {note.updatedLabel}
          </span>
        </div>
        <p className="line-clamp-2 break-words text-[var(--text-sm)] leading-snug text-text-muted">{note.preview}</p>
      </button>
      <div
        className={cx(
          "relative flex items-center gap-1 transition-opacity duration-fast ease-hcb group-focus-within:opacity-100 group-hover:opacity-100",
          starred || menuOpen ? "opacity-100" : "opacity-0"
        )}
      >
        <IconButton
          className={cx("size-9 rounded-full [&_svg]:size-5", starred ? "text-accent [&_svg]:fill-current" : undefined)}
          icon={Star}
          label={starred ? `Unstar ${note.title} on this device` : `Star ${note.title} on this device`}
          onClick={() => onToggleStar(note.id)}
          variant="ghost"
        />
        {menuOpen ? (
          <NoteActionMenu
            anchorPoint={menuPoint ?? undefined}
            onClose={() => setMenuOpen(false)}
            onDelete={() => {
              onDeleteNote(note.id);
              setMenuOpen(false);
            }}
            onDuplicate={() => {
              onDuplicateNote(note.id);
              setMenuOpen(false);
            }}
            onEdit={() => {
              onOpenNote(note.id, "edit");
              setMenuOpen(false);
            }}
          />
        ) : null}
      </div>
    </div>
  );
}

function NoteListActionMenu({
  anchorPoint,
  canDelete,
  onClose,
  onDelete,
  onRename
}: {
  anchorPoint?: { x: number; y: number };
  canDelete: boolean;
  onClose: () => void;
  onDelete: () => void;
  onRename: () => void;
}): JSX.Element {
  return (
    <FloatingMenu anchorPoint={anchorPoint} onClose={onClose} width={224}>
      <button
        className="flex min-h-10 w-full items-center gap-3 px-4 text-left text-[var(--text-base)] text-text-primary transition-colors duration-fast ease-hcb hover:bg-surface-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        onClick={onRename}
        type="button"
      >
        <Pencil aria-hidden="true" size={18} />
        Rename list
      </button>
      {canDelete ? (
        <button
          className="flex min-h-10 w-full items-center gap-3 px-4 text-left text-[var(--text-base)] text-danger transition-colors duration-fast ease-hcb hover:bg-danger/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          onClick={onDelete}
          type="button"
        >
          <Trash2 aria-hidden="true" size={18} />
          Delete list
        </button>
      ) : null}
    </FloatingMenu>
  );
}

function NoteActionMenu({
  anchorPoint,
  onClose,
  onDelete,
  onDuplicate,
  onEdit
}: {
  anchorPoint?: { x: number; y: number };
  onClose: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onEdit: () => void;
}): JSX.Element {
  return (
    <FloatingMenu anchorPoint={anchorPoint} onClose={onClose} width={224}>
      <button
        className="flex min-h-10 w-full items-center gap-3 px-4 text-left text-[var(--text-base)] text-text-primary transition-colors duration-fast ease-hcb hover:bg-surface-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        onClick={onEdit}
        type="button"
      >
        <Pencil aria-hidden="true" size={18} />
        Edit note
      </button>
      <button
        className="flex min-h-10 w-full items-center gap-3 px-4 text-left text-[var(--text-base)] text-text-primary transition-colors duration-fast ease-hcb hover:bg-surface-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        onClick={onDuplicate}
        type="button"
      >
        <Copy aria-hidden="true" size={18} />
        Duplicate
      </button>
      <button
        className="flex min-h-10 w-full items-center gap-3 px-4 text-left text-[var(--text-base)] text-danger transition-colors duration-fast ease-hcb hover:bg-danger/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        onClick={onDelete}
        type="button"
      >
        <Trash2 aria-hidden="true" size={18} />
        Delete
      </button>
    </FloatingMenu>
  );
}
