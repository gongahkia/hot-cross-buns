import type { CalendarEventCompletionScope, SettingsSnapshot } from "@shared/ipc/contracts";
import { cx } from "../../../../components/primitives";
import { EmptyState } from "../../../../components/states";
import { VirtualizedList } from "../../../../components/VirtualizedList";
import { handleActivationKeyDown } from "../../coreScreenShared";
import type { CalendarEventViewModel } from "../../coreViewModels";
import { MarkdownPreview, hasRenderableMixedMarkup } from "../../MarkdownPreview";
import { CalendarItemCompletionButton, calendarSourceColorStyle } from "./CalendarEventChips";

function calendarAgendaDescription(event: CalendarEventViewModel): { location: string; notes: boolean } {
  const location = event.location.trim();
  const visibleLocation = location === "All day" || location === "Scheduled" ? "" : location;

  return { location: visibleLocation, notes: hasRenderableMixedMarkup(event.notes) };
}

function CalendarAgendaEventRow({
  eventCompletionDefaultScope,
  event,
  onOpen,
  onToggleEvent,
  onToggleTask
}: {
  eventCompletionDefaultScope?: SettingsSnapshot["eventCompletionDefaultScope"];
  event: CalendarEventViewModel;
  onOpen: (event: CalendarEventViewModel) => void;
  onToggleEvent?: (eventId: string, scope?: CalendarEventCompletionScope) => void;
  onToggleTask?: (taskId: string) => void;
}): JSX.Element {
  const whenLabel = event.allDay ? "All day" : event.rangeLabel;
  const description = calendarAgendaDescription(event);
  const hasDescription = Boolean(description.location || description.notes);
  const isCompletedTask = event.taskStatus === "completed";
  const isCompletedEvent = event.sourceKind === "event" && event.completedAt !== null && event.completedAt !== undefined;
  const completed = isCompletedTask || isCompletedEvent;

  return (
    <div
      className={cx(
        "grid w-full cursor-default grid-cols-[4.5rem_minmax(0,1fr)] gap-3 border-b border-border bg-bg-tertiary px-3 py-2 text-left last:border-b-0 transition-colors duration-fast ease-hcb hover:bg-surface-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        hasDescription ? "min-h-[76px]" : "min-h-[58px]",
        completed && "text-text-muted opacity-75"
      )}
      onClick={() => onOpen(event)}
      onKeyDown={(keyEvent) => handleActivationKeyDown(keyEvent, () => onOpen(event))}
      role="listitem"
      tabIndex={0}
    >
      <div className="pt-0.5 text-right text-[var(--text-xs)] font-medium text-text-secondary">{whenLabel}</div>
      <div className="flex min-w-0 items-start gap-2">
        <span className="mt-1 text-text-secondary">
          <CalendarItemCompletionButton
            event={event}
            eventCompletionDefaultScope={eventCompletionDefaultScope}
            onToggleEvent={onToggleEvent}
            onToggleTask={onToggleTask}
          />
        </span>
        <span
          aria-hidden="true"
          className="mt-2 size-2 shrink-0 rounded-full"
          style={calendarSourceColorStyle(event.displayBackgroundColor ?? event.calendarBackgroundColor)}
        />
        <div className="min-w-0">
          <span
            className={cx(
              "block max-w-full whitespace-normal break-words text-[var(--text-md)] font-semibold leading-snug text-text-primary",
              completed && "line-through"
            )}
          >
            {event.title}
          </span>
          <span className="block truncate text-[var(--text-xs)] text-text-muted">{event.calendar}</span>
          {description.location ? <span className="block truncate text-[var(--text-xs)] text-text-muted">{description.location}</span> : null}
          {description.notes ? (
            <div
              className="mt-0.5 min-w-0"
              onClick={(clickEvent) => clickEvent.stopPropagation()}
              onKeyDown={(keyEvent) => keyEvent.stopPropagation()}
            >
              <MarkdownPreview ariaLabel={`Description for ${event.title}`} body={event.notes} variant="summary" />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function CalendarAgendaView({
  eventCompletionDefaultScope,
  events,
  label,
  onOpen,
  onToggleEvent,
  onToggleTask
}: {
  eventCompletionDefaultScope?: SettingsSnapshot["eventCompletionDefaultScope"];
  events: CalendarEventViewModel[];
  label: string;
  onOpen: (event: CalendarEventViewModel) => void;
  onToggleEvent?: (eventId: string, scope?: CalendarEventCompletionScope) => void;
  onToggleTask?: (taskId: string) => void;
}): JSX.Element {
  return (
    <div className="flex min-h-[680px] flex-col overflow-hidden rounded-hcbMd border border-border bg-bg-secondary">
      <div className="flex min-h-12 items-center justify-between gap-3 border-b border-border bg-bg-primary/40 px-3 py-2">
        <div className="min-w-0">
          <div className="truncate text-[var(--text-md)] font-semibold text-text-primary">{label}</div>
          <div className="truncate text-[var(--text-xs)] text-text-muted">
            {events.length} event{events.length === 1 ? "" : "s"}
          </div>
        </div>
      </div>
      {events.length > 0 ? (
        <VirtualizedList
          ariaLabel="Calendar agenda"
          estimateRowHeight={76}
          getEstimatedRowHeight={(event) => {
            const description = calendarAgendaDescription(event);
            return description.location || description.notes ? 76 : 58;
          }}
          getKey={(event) => event.id}
          items={events}
          performanceLabel="calendar.agenda"
          renderRow={(event) => (
            <CalendarAgendaEventRow
              event={event}
              eventCompletionDefaultScope={eventCompletionDefaultScope}
              onOpen={onOpen}
              onToggleEvent={onToggleEvent}
              onToggleTask={onToggleTask}
            />
          )}
          viewportHeight={680}
        />
      ) : (
        <EmptyState description="No events match the visible calendar sources." title="No agenda items" />
      )}
    </div>
  );
}
