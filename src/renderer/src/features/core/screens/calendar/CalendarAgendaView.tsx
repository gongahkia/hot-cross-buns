import { CheckCircle2, Circle } from "lucide-react";
import { Badge, cx } from "../../../../components/primitives";
import { EmptyState } from "../../../../components/states";
import { VirtualizedList } from "../../../../components/VirtualizedList";
import { handleActivationKeyDown } from "../../coreScreenShared";
import type { CalendarEventViewModel } from "../../coreViewModels";
import {
  calendarEventFillStyle
} from "./CalendarEventChips";
import { calendarDateTitleFromIso } from "./calendarGrid";

function calendarAgendaDescription(event: CalendarEventViewModel): string {
  const location = event.location.trim();
  const notes = event.notes.trim();
  const visibleLocation = location === "All day" || location === "Scheduled" ? "" : location;
  const visibleNotes = notes === "No notes" ? "" : notes;

  return [visibleLocation, visibleNotes].filter(Boolean).join(" - ");
}

function CalendarAgendaEventRow({
  event,
  onOpen,
  onToggleTask
}: {
  event: CalendarEventViewModel;
  onOpen: (event: CalendarEventViewModel) => void;
  onToggleTask?: (taskId: string) => void;
}): JSX.Element {
  const fillStyle = calendarEventFillStyle(event);
  const whenLabel = event.allDay
    ? `${calendarDateTitleFromIso(event.startsAt.slice(0, 10))} - All day`
    : event.rangeLabel;
  const description = calendarAgendaDescription(event);
  const isTask = event.sourceKind === "task";
  const isCompletedTask = event.taskStatus === "completed";
  const TaskIcon = isCompletedTask ? CheckCircle2 : Circle;
  const taskToggleLabel = isCompletedTask ? `Reopen ${event.title}` : `Mark ${event.title} complete`;
  const taskId = event.taskId;

  return (
    <div
      className={cx(
        "grid w-full cursor-default grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-border bg-bg-tertiary px-3 py-2 text-left last:border-b-0 transition-colors duration-fast ease-hcb hover:bg-surface-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        description ? "min-h-[76px]" : "min-h-[58px]"
      )}
      onClick={() => onOpen(event)}
      onKeyDown={(keyEvent) => handleActivationKeyDown(keyEvent, () => onOpen(event))}
      role="listitem"
      tabIndex={0}
    >
      <span className="flex min-w-0 items-start gap-2">
        {isTask && taskId && onToggleTask ? (
          <button
            aria-label={taskToggleLabel}
            className="mt-1 shrink-0 rounded-full text-text-secondary transition-colors duration-fast ease-hcb hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
            onClick={(clickEvent) => {
              clickEvent.stopPropagation();
              onToggleTask(taskId);
            }}
            onKeyDown={(keyEvent) => keyEvent.stopPropagation()}
            onPointerDown={(pointerEvent) => pointerEvent.stopPropagation()}
            title={taskToggleLabel}
            type="button"
          >
            <TaskIcon aria-hidden="true" size={17} />
          </button>
        ) : isTask ? (
          <TaskIcon aria-hidden="true" className="mt-1 shrink-0 text-text-secondary" size={17} />
        ) : null}
        <span className="min-w-0">
          <span
            className={cx(
              "inline-block max-w-full whitespace-normal break-words rounded-hcbSm px-2 py-0.5 text-[var(--text-md)] font-semibold leading-snug text-text-primary",
              isCompletedTask && "line-through"
            )}
            style={fillStyle}
          >
            {event.title}
          </span>
          <span className="block truncate text-[var(--text-sm)] text-text-secondary">{whenLabel}</span>
          {description ? <span className="block truncate text-[var(--text-xs)] text-text-muted">{description}</span> : null}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-2">
        {event.mutationState && event.mutationState !== "synced" ? (
          <Badge tone={event.mutationState === "failed" ? "danger" : "warning"}>
            {event.mutationState === "failed" ? "Failed" : "Queued"}
          </Badge>
        ) : null}
      </span>
    </div>
  );
}

export function CalendarAgendaView({
  events,
  label,
  onOpen,
  onToggleTask
}: {
  events: CalendarEventViewModel[];
  label: string;
  onOpen: (event: CalendarEventViewModel) => void;
  onToggleTask?: (taskId: string) => void;
}): JSX.Element {
  return (
    <div className="flex min-h-[680px] flex-col overflow-hidden rounded-hcbMd border border-border bg-bg-secondary">
      <div className="flex min-h-12 items-center justify-between gap-3 border-b border-border bg-bg-primary/40 px-3 py-2">
        <div className="min-w-0">
          <div className="truncate text-[var(--text-md)] font-semibold text-text-primary">Agenda view</div>
          <div className="truncate text-[var(--text-xs)] text-text-muted">
            {label} - {events.length} visible events
          </div>
        </div>
      </div>
      {events.length > 0 ? (
        <VirtualizedList
          ariaLabel="Calendar agenda"
          estimateRowHeight={76}
          getEstimatedRowHeight={(event) => (calendarAgendaDescription(event) ? 76 : 58)}
          getKey={(event) => event.id}
          items={events}
          performanceLabel="calendar.agenda"
          renderRow={(event) => <CalendarAgendaEventRow event={event} onOpen={onOpen} onToggleTask={onToggleTask} />}
          viewportHeight={680}
        />
      ) : (
        <EmptyState description="No events match the visible calendar sources." title="No agenda items" />
      )}
    </div>
  );
}
