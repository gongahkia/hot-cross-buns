import { Badge } from "../../../../components/primitives";
import { EmptyState } from "../../../../components/states";
import { VirtualizedList } from "../../../../components/VirtualizedList";
import type { CalendarEventViewModel } from "../../coreViewModels";
import {
  calendarEventFillStyle
} from "./CalendarEventChips";
import { calendarDateTitleFromIso } from "./calendarGrid";

function CalendarAgendaEventRow({
  event,
  onOpen
}: {
  event: CalendarEventViewModel;
  onOpen: (event: CalendarEventViewModel) => void;
}): JSX.Element {
  const fillStyle = calendarEventFillStyle(event);
  const whenLabel = event.allDay
    ? `${calendarDateTitleFromIso(event.startsAt.slice(0, 10))} - All day`
    : event.rangeLabel;

  return (
    <button
      className="grid min-h-[76px] w-full grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-border bg-bg-tertiary px-3 py-2 text-left last:border-b-0 transition-colors duration-fast ease-hcb hover:bg-surface-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      onClick={() => onOpen(event)}
      role="listitem"
      type="button"
    >
      <span className="min-w-0">
        <span
          className="inline-block max-w-full whitespace-normal break-words rounded-hcbSm px-2 py-0.5 text-[var(--text-md)] font-semibold leading-snug text-text-primary"
          style={fillStyle}
        >
          {event.title}
        </span>
        <span className="block truncate text-[var(--text-sm)] text-text-secondary">{whenLabel}</span>
        {event.notes || event.location ? (
          <span className="block truncate text-[var(--text-xs)] text-text-muted">
            {event.location ? `${event.location} - ` : ""}
            {event.notes}
          </span>
        ) : null}
      </span>
      <span className="flex shrink-0 items-center gap-2">
        {event.mutationState && event.mutationState !== "synced" ? (
          <Badge tone={event.mutationState === "failed" ? "danger" : "warning"}>
            {event.mutationState === "failed" ? "Failed" : "Queued"}
          </Badge>
        ) : null}
      </span>
    </button>
  );
}

export function CalendarAgendaView({
  events,
  label,
  onOpen
}: {
  events: CalendarEventViewModel[];
  label: string;
  onOpen: (event: CalendarEventViewModel) => void;
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
          getKey={(event) => event.id}
          items={events}
          performanceLabel="calendar.agenda"
          renderRow={(event) => <CalendarAgendaEventRow event={event} onOpen={onOpen} />}
          viewportHeight={680}
        />
      ) : (
        <EmptyState description="No events match the visible calendar sources." title="No agenda items" />
      )}
    </div>
  );
}
