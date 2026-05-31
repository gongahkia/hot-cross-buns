import { useState, type DragEvent } from "react";
import { Pencil, Star, Trash2 } from "lucide-react";
import { FloatingMenu } from "../../../components/FloatingMenu";
import { Badge, IconButton, Panel, cx } from "../../../components/primitives";
import { EmptyState } from "../../../components/states";
import { VirtualizedList } from "../../../components/VirtualizedList";
import type { NoteViewModel } from "../coreViewModels";
import type { NoteViewColumn } from "./notesTypes";

const noteDragType = "application/x-hcb-note-id";

export function NotesBoard({
  allNoteCount,
  columns,
  onDeleteNote,
  onMoveNote,
  onOpenNote,
  onToggleStar,
  selectedNoteId,
  starredNoteIds
}: {
  allNoteCount: number;
  columns: NoteViewColumn[];
  onDeleteNote: (noteId: string) => void;
  onMoveNote: (noteId: string, listId: string) => void;
  onOpenNote: (noteId: string, mode?: "view" | "edit") => void;
  onToggleStar: (noteId: string) => void;
  selectedNoteId: string | null;
  starredNoteIds: ReadonlySet<string>;
}): JSX.Element {
  return (
    <div className="min-h-0 min-w-0 overflow-hidden rounded-hcbLg bg-bg-secondary">
      <div
        className="flex h-full min-h-[480px] min-w-0 gap-3 overflow-x-auto p-3"
        role="list"
        aria-label="Note views"
      >
        {columns.length > 0 ? (
          columns.map((column) => (
            <Panel
              action={<Badge tone="neutral">{column.id === "all" ? allNoteCount : column.notes.length}</Badge>}
              className="flex max-h-full w-[min(520px,calc(100vw-2rem))] shrink-0 flex-col overflow-hidden bg-bg-primary"
              description={column.description}
              key={column.id}
              onDragLeave={() => undefined}
              role="listitem"
              title={column.title}
            >
              <NoteColumnDropTarget column={column} onMoveNote={onMoveNote}>
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
                      onDeleteNote={onDeleteNote}
                      onOpenNote={onOpenNote}
                      onToggleStar={onToggleStar}
                      selected={note.id === selectedNoteId}
                      starred={starredNoteIds.has(note.id)}
                    />
                  )}
                  viewportHeight={520}
                />
              </NoteColumnDropTarget>
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
  onOpenNote,
  onToggleStar,
  selected,
  starred
}: {
  note: NoteViewModel;
  onDeleteNote: (noteId: string) => void;
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
        "group relative grid min-h-[66px] grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border px-3 py-2 last:border-b-0 transition-colors duration-fast ease-hcb",
        selected ? "bg-surface-0" : "bg-transparent hover:bg-surface-0"
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
          className={cx("size-9 rounded-full [&_svg]:size-5", starred ? "text-accent [&_svg]:fill-current" : undefined)}
          icon={Star}
          label={starred ? `Unstar ${note.title}` : `Star ${note.title}`}
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

function NoteActionMenu({
  anchorPoint,
  onClose,
  onDelete,
  onEdit
}: {
  anchorPoint?: { x: number; y: number };
  onClose: () => void;
  onDelete: () => void;
  onEdit: () => void;
}): JSX.Element {
  return (
    <FloatingMenu anchorPoint={anchorPoint} onClose={onClose} width={224}>
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
    </FloatingMenu>
  );
}
