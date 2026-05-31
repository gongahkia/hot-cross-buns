import { CalendarPlus, Check, PanelLeftClose, PanelLeftOpen, Pencil, Plus } from "lucide-react";
import type { NoteListSummary } from "@shared/ipc/contracts";
import { Button, IconButton, cx } from "../../../components/primitives";
import {
  actionDescription,
  actionLabel
} from "../coreScreenShared";
import type { NoteBoardSelection } from "./notesTypes";

export function NotesSidebar({
  allNoteCount,
  collapsed,
  onCreateDailyNote,
  onCreateMeetingNote,
  onCreateNote,
  onCreateNoteList,
  onToggleCollapsed,
  onToggleView,
  noteLists,
  selectedNoteViews,
  starredNoteCount
}: {
  allNoteCount: number;
  collapsed: boolean;
  onCreateDailyNote: () => void;
  onCreateMeetingNote: () => void;
  onCreateNote: () => void;
  onCreateNoteList: () => void;
  onToggleCollapsed: () => void;
  onToggleView: (view: NoteBoardSelection) => void;
  noteLists: NoteListSummary[];
  selectedNoteViews: NoteBoardSelection[];
  starredNoteCount: number;
}): JSX.Element {
  if (collapsed) {
    return (
      <aside className="min-h-0 rounded-hcbLg bg-bg-secondary p-2" aria-label="Notes navigation">
        <IconButton
          className="size-9 rounded-hcbMd"
          icon={PanelLeftOpen}
          label="Expand notes sidebar"
          onClick={onToggleCollapsed}
          variant="ghost"
        />
      </aside>
    );
  }

  return (
    <aside className="min-h-0 rounded-hcbLg bg-bg-secondary p-3" aria-label="Notes navigation">
      <div className="flex items-center gap-2">
        <Button
          aria-label={actionLabel("note.create")}
          className="h-12 min-w-0 flex-1 justify-start rounded-hcbLg shadow-sm"
          data-action-id="note.create"
          onClick={onCreateNote}
          title={actionDescription("note.create")}
          variant="secondary"
        >
          <Plus aria-hidden="true" size={18} />
          Create
        </Button>
        <IconButton
          className="size-10 rounded-hcbMd"
          icon={PanelLeftClose}
          label="Collapse notes sidebar"
          onClick={onToggleCollapsed}
          variant="ghost"
        />
      </div>
      <div className="mt-5 grid gap-1">
        <NoteSidebarCheckbox
          checked={selectedNoteViews.includes("all")}
          count={allNoteCount}
          label="All notes"
          onClick={() => onToggleView("all")}
        />
        <NoteSidebarCheckbox
          checked={selectedNoteViews.includes("starred")}
          count={starredNoteCount}
          label="Starred"
          onClick={() => onToggleView("starred")}
        />
      </div>
      <div className="mt-6">
        <div className="px-2 text-[var(--text-sm)] font-semibold text-text-primary">Lists</div>
        <div className="mt-2 grid gap-1">
          {noteLists.map((list) => (
            <NoteSidebarCheckbox
              checked={selectedNoteViews.includes(`list:${list.id}`)}
              count={list.noteCount}
              key={list.id}
              label={list.title}
              onClick={() => onToggleView(`list:${list.id}`)}
            />
          ))}
        </div>
        <Button className="mt-2 justify-start" onClick={onCreateNoteList} variant="ghost">
          <Plus aria-hidden="true" size={16} />
          Create note list
        </Button>
      </div>
      <div className="mt-5 grid gap-1">
        <Button className="justify-start" onClick={onCreateDailyNote} variant="ghost">
          <CalendarPlus aria-hidden="true" size={16} />
          Daily note
        </Button>
        <Button className="justify-start" onClick={onCreateMeetingNote} variant="ghost">
          <Pencil aria-hidden="true" size={16} />
          Meeting note
        </Button>
      </div>
    </aside>
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
