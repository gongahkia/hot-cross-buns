import * as Dialog from "@radix-ui/react-dialog";
import { useRef, useState } from "react";
import { CalendarDays, ChevronDown, ChevronRight, ListTodo, X } from "@renderer/components/icons";
import type { CalendarEventCompletionScope } from "@shared/ipc/contracts";
import type { CalendarEventViewModel } from "../../coreViewModels";
import { cx, IconButton } from "../../../../components/primitives";
import { useCalendarEventMenu } from "./calendarEventMenuContext";
import { CalendarSyncBadge } from "./CalendarSyncStatus";
import { eventCompleted, type CalendarEventChip, type EventCompletionDefaultScope } from "./CalendarEventChips";

function compareOverflowEvents(left: CalendarEventViewModel, right: CalendarEventViewModel): number {
  const leftCompleted = eventCompleted(left) ? 1 : 0;
  const rightCompleted = eventCompleted(right) ? 1 : 0;

  return (
    leftCompleted - rightCompleted ||
    left.startsAt.localeCompare(right.startsAt) ||
    left.endsAt.localeCompare(right.endsAt) ||
    left.id.localeCompare(right.id)
  );
}

function calendarOverflowTimeLabel(event: CalendarEventViewModel): string {
  if (event.sourceKind === "task") return event.taskStatus === "completed" ? "Completed" : "Due";
  return event.allDay ? "All day" : event.timeLabel;
}

function calendarOverflowKindLabel(event: CalendarEventViewModel): string {
  if (event.sourceKind === "task") return "Google Task";
  if (event.allDay) return "All-day event";
  return "Calendar event";
}

function CalendarOverflowRow({
  event,
  onOpen,
  onClose
}: Pick<Parameters<typeof CalendarEventChip>[0], "event" | "onOpen"> & { onClose: () => void }): JSX.Element {
  const menu = useCalendarEventMenu(event, onClose);
  const completed = eventCompleted(event);
  const TypeIcon = event.sourceKind === "task" ? ListTodo : CalendarDays;

  return (
    <button
      className={cx(
        "grid w-full grid-cols-[4.75rem_18px_minmax(0,1fr)] items-start gap-2 rounded-hcbSm px-2 py-2 text-left transition-colors duration-fast ease-hcb hover:bg-surface-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent",
        completed && "opacity-65"
      )}
      onClick={() => onOpen?.(event)}
      onContextMenu={menu.onContextMenu}
      onKeyDown={menu.onMenuKeyDown}
      type="button"
    >
      <span className="pt-0.5 tabular-nums text-[var(--text-xs)] font-medium text-text-secondary">{calendarOverflowTimeLabel(event)}</span>
      <span className="flex items-center gap-1 text-text-muted">
        <TypeIcon aria-hidden="true" size={14} />
      </span>
      <span className="min-w-0">
        <span className={cx("block truncate text-[var(--text-sm)] font-medium text-text-primary", completed && "line-through")}>{event.title}</span>
        <span className="mt-0.5 flex min-w-0 items-center gap-1 text-[var(--text-xs)] text-text-muted">
          <span className="truncate">{calendarOverflowKindLabel(event)}</span>
          <span aria-hidden="true">·</span>
          <span className="truncate">{event.calendar}</span>
          <CalendarSyncBadge state={event.mutationState} />
        </span>
      </span>
    </button>
  );
}

export function CalendarOverflowPopover({
  eventCompletionDefaultScope,
  events,
  onClose,
  onOpen,
  onToggleEvent,
  onToggleTask,
  title
}: {
  eventCompletionDefaultScope?: EventCompletionDefaultScope;
  events: CalendarEventViewModel[];
  onClose: () => void;
  onOpen: (event: CalendarEventViewModel) => void;
  onToggleEvent?: (eventId: string, scope?: CalendarEventCompletionScope) => void;
  onToggleTask?: (taskId: string) => void;
  title: string;
}): JSX.Element {
  const orderedEvents = [...events].sort(compareOverflowEvents);
  const activeEvents = orderedEvents.filter((event) => !eventCompleted(event));
  const completedEvents = orderedEvents.filter(eventCompleted);
  const [showCompleted, setShowCompleted] = useState(false);
  const returnFocus = useRef(document.activeElement as HTMLElement | null);

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-50 bg-bg-tertiary/80" />
      <Dialog.Content
        aria-describedby={undefined}
        className="fixed left-1/2 top-1/2 z-50 w-[min(28rem,calc(100vw-1.5rem))] -translate-x-1/2 -translate-y-1/2 rounded-hcbLg border border-border bg-bg-primary shadow-xl"
        onClick={(event) => event.stopPropagation()}
        onEscapeKeyDown={event => { if (document.querySelector('.calendar-event-menu[data-state="open"]')) event.preventDefault(); }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (!document.activeElement?.closest('[data-testid="inspector-shell"]') && returnFocus.current?.isConnected) returnFocus.current.focus({ preventScroll: true });
        }}
      >
        <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2">
          <Dialog.Title className="min-w-0 truncate text-[var(--text-sm)] font-semibold text-text-primary">{title}</Dialog.Title>
          <IconButton icon={X} label="Close overflow items" onClick={onClose} size="sm" variant="ghost" />
        </div>
        <div className="grid max-h-[60vh] gap-1 overflow-auto p-2">
          {activeEvents.map((event) => (
            <CalendarOverflowRow
              event={event}
              key={event.id}
              onClose={onClose}
              onOpen={(selectedEvent) => {
                onClose();
                onOpen(selectedEvent);
              }}
            />
          ))}
          {completedEvents.length > 0 ? (
            <div className="border-t border-border pt-1">
              <button
                aria-expanded={showCompleted}
                className="flex min-h-8 w-full items-center justify-between gap-2 rounded-hcbSm px-2 text-left text-[var(--text-sm)] font-medium text-text-secondary hover:bg-surface-0 hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
                onClick={() => setShowCompleted((shown) => !shown)}
                type="button"
              >
                <span>Completed ({completedEvents.length})</span>
                {showCompleted ? <ChevronDown aria-hidden="true" size={15} /> : <ChevronRight aria-hidden="true" size={15} />}
              </button>
              {showCompleted ? completedEvents.map((event) => (
                <CalendarOverflowRow
                  event={event}
                  key={event.id}
                  onClose={onClose}
                  onOpen={(selectedEvent) => {
                    onClose();
                    onOpen(selectedEvent);
                  }}
                />
              )) : null}
            </div>
          ) : null}
        </div>
      </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

