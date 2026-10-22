import * as Popover from "@radix-ui/react-popover";
import { CalendarPlus, ChevronDown, ChevronLeft, ChevronRight, MoreHorizontal } from "lucide-react";
import { Button, IconButton } from "../../../../components/primitives";
import type { CalendarViewId } from "../../coreViewModels";
import { calendarViewLabel } from "./calendarGrid";

export function CalendarHeader({
  anchorDate, onSelectDate,
  activeViewId,
  timeZone,
  calendarRangeLabel,
  nextRangeLabel,
  onCreate,
  onResetRange,
  onSetView,
  onShiftRange,
  onToggleShareAvailability,
  onToggleSmartReschedule,
  previousRangeLabel,
  shareAvailabilityOpen,
  shareAvailabilityVisible,
  smartRescheduleOpen,
  visibleCalendarViewIds
}: {
  anchorDate: string;
  onSelectDate: (date: string) => void;
  activeViewId: CalendarViewId;
  timeZone: string;
  calendarRangeLabel: string;
  nextRangeLabel: string;
  onCreate: () => void;
  onResetRange: () => void;
  onSetView: (viewId: CalendarViewId) => void;
  onShiftRange: (direction: -1 | 1) => void;
  onToggleShareAvailability: () => void;
  onToggleSmartReschedule: () => void;
  previousRangeLabel: string;
  shareAvailabilityOpen: boolean;
  shareAvailabilityVisible: boolean;
  smartRescheduleOpen: boolean;
  visibleCalendarViewIds: CalendarViewId[];
}): JSX.Element {
  return (
    <header className="calendar-header flex min-w-0 items-center gap-2 border-b border-border pb-3">
      <Popover.Root>
        <Popover.Trigger asChild>
          <Button aria-label="Choose calendar date" className="calendar-range min-w-0 justify-start px-1 text-lg font-semibold" variant="ghost">
            <span className="truncate">{calendarRangeLabel}</span><ChevronDown size={14} className="shrink-0 text-text-muted" />
          </Button>
        </Popover.Trigger>
        <Popover.Portal><Popover.Content sideOffset={8} align="start" className="z-50 grid w-64 gap-3 rounded-lg border border-border bg-bg-primary p-4 text-text-primary shadow-xl">
          <label className="grid gap-2 text-sm">Go to date<input aria-label="Go to date" type="date" className="min-w-0 rounded-md border border-border bg-bg-secondary px-2" value={anchorDate.slice(0, 10)} onChange={(event) => { if (event.target.value) onSelectDate(event.target.value); }} /></label>
          <Popover.Close asChild><Button variant="secondary">Done</Button></Popover.Close>
        </Popover.Content></Popover.Portal>
      </Popover.Root>
      <div aria-label="Calendar range navigation" className="flex shrink-0 items-center gap-0.5" role="group">
        <IconButton icon={ChevronLeft} label={previousRangeLabel} onClick={() => onShiftRange(-1)} size="sm" variant="ghost" />
        <IconButton icon={ChevronRight} label={nextRangeLabel} onClick={() => onShiftRange(1)} size="sm" variant="ghost" />
        <Button aria-label="Jump to today" onClick={onResetRange} size="sm" variant="secondary">Today</Button>
      </div>
      <span className="calendar-timezone truncate text-xs text-text-muted" title="Calendar timezone">{timeZone}</span>
      <div className="ml-auto flex shrink-0 items-center gap-2">
        <select aria-label="Calendar view" className="calendar-view-select min-w-0 rounded-md border border-border bg-bg-primary px-2 text-sm" value={activeViewId} onChange={(event) => onSetView(event.target.value as CalendarViewId)}>
          {visibleCalendarViewIds.map((view) => <option key={view} value={view}>{calendarViewLabel(view)}</option>)}
        </select>
        <Button aria-label="New event" className="calendar-create" data-action-id="calendar.create" onClick={onCreate} size="sm" variant="primary"><CalendarPlus size={15} /><span>New event</span></Button>
        <Popover.Root>
          <Popover.Trigger asChild><IconButton label="Calendar tools" icon={MoreHorizontal} size="sm" variant="ghost" /></Popover.Trigger>
          <Popover.Portal><Popover.Content sideOffset={8} align="end" className="z-50 grid w-56 gap-1 rounded-lg border border-border bg-bg-primary p-2 text-text-primary shadow-xl">
            <Popover.Close asChild><Button aria-pressed={smartRescheduleOpen} className="justify-start" onClick={onToggleSmartReschedule} variant="ghost">Smart schedule</Button></Popover.Close>
            {shareAvailabilityVisible ? <Popover.Close asChild><Button aria-pressed={shareAvailabilityOpen} className="justify-start" onClick={onToggleShareAvailability} variant="ghost">Share availability</Button></Popover.Close> : null}
          </Popover.Content></Popover.Portal>
        </Popover.Root>
      </div>
      <div aria-label="Calendar status" className="sr-only" role="status" />
    </header>
  );
}
