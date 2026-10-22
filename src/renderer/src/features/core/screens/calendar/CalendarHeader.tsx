import { DateTimeField } from "@renderer/components/DateTimeField";
import * as Popover from "@radix-ui/react-popover";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { useRef, useState } from "react";
import { Check, ChevronDown, ChevronLeft, ChevronRight, MoreHorizontal, PanelRight } from "lucide-react";
import { Button, IconButton } from "../../../../components/primitives";
import { useInspector } from "../../../../components/Inspector";
import { useCalendarNavigation } from "../../../shell/CalendarNavigation";
import { weekNumber } from "../../../shell/MiniCalendar";
import type { CalendarViewId } from "../../coreViewModels";
import { calendarViewLabel, calendarMonthTitle, calendarDateTitleFromIso, calendarAddUtcDays, calendarDateFromIsoDate } from "./calendarGrid";

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
  const nav = useCalendarNavigation();
  const inspector = useInspector();
  const weekStart = nav.calendarWindowStart ?? calendarAddUtcDays(anchorDate, -calendarDateFromIsoDate(anchorDate).getUTCDay());
  const headingDate = activeViewId === "week" ? calendarAddUtcDays(weekStart, 6) : activeViewId === "multiDay" ? calendarAddUtcDays(anchorDate, nav.multiDayCount - 1) : anchorDate;
  const customDaysPending = useRef(false);
  const [customDays, setCustomDays] = useState(false);
  const [count, setCount] = useState(String(nav.multiDayCount));
  function days(value: number) { nav.setMultiDayCount(value); onSetView("multiDay"); }
  return (
    <header className="calendar-header">
      <Popover.Root>
        <Popover.Trigger asChild><button className="calendar-range" aria-label="Choose calendar date"><span>{calendarMonthTitle(headingDate)}</span></button></Popover.Trigger>
        <Popover.Portal><Popover.Content className="calendar-menu calendar-date-menu" align="start" sideOffset={8}>
          <label>Go to date<DateTimeField aria-label="Go to date" type="date" value={anchorDate.slice(0, 10)} onValueChange={(value) => { if (value) onSelectDate(value); }} /></label>
          <Popover.Close asChild><Button variant="ghost">Done</Button></Popover.Close>
        </Popover.Content></Popover.Portal>
      </Popover.Root>
      <span className="calendar-range-detail">{activeViewId === "week" && nav.calendarWindowStart ? calendarRangeLabel : activeViewId === "week" && nav.showWeekNumbers ? `Week ${weekNumber(weekStart)}` : activeViewId === "day" ? calendarDateTitleFromIso(anchorDate) : ""}</span>
      <div className="calendar-header-controls">
        <Menu.Root>
          <Menu.Trigger asChild><button className="calendar-view-select" aria-label="Calendar view">{activeViewId === "multiDay" ? `${nav.multiDayCount} days` : calendarViewLabel(activeViewId)}<ChevronDown size={16} /></button></Menu.Trigger>
          <Menu.Portal><Menu.Content className="calendar-menu" align="end" sideOffset={8} onCloseAutoFocus={event => { if (customDaysPending.current) { event.preventDefault(); customDaysPending.current = false; setCustomDays(true); } }}>
            {(["day", "week", "month", "agenda"] as CalendarViewId[]).filter(view => visibleCalendarViewIds.includes(view)).map(view => <Menu.Item key={view} onSelect={() => onSetView(view)} className="calendar-menu-item" role="menuitemradio" aria-checked={view === activeViewId}><Check size={16} style={{ visibility: view === activeViewId ? "visible" : "hidden" }} />{calendarViewLabel(view)}</Menu.Item>)}
            {visibleCalendarViewIds.includes("multiDay") ? <><Menu.Separator className="calendar-menu-separator" /><Menu.Sub>
              <Menu.SubTrigger className="calendar-menu-item calendar-sub-trigger">Number of days<ChevronRight size={16} /></Menu.SubTrigger>
              <Menu.Portal><Menu.SubContent className="calendar-menu" sideOffset={4}>{[2,3,4,5,6,7,8,9].map(n => <Menu.Item className="calendar-menu-item" key={n} onSelect={() => days(n)}><Check size={16} style={{ visibility: nav.multiDayCount === n && activeViewId === "multiDay" ? "visible" : "hidden" }} />{n} days</Menu.Item>)}<Menu.Separator className="calendar-menu-separator" /><Menu.Item className="calendar-menu-item" onSelect={() => { setCount(String(nav.multiDayCount)); customDaysPending.current = true; }}>Other…</Menu.Item></Menu.SubContent></Menu.Portal>
            </Menu.Sub></> : null}
            <Menu.Separator className="calendar-menu-separator" />
            <Menu.Sub><Menu.SubTrigger className="calendar-menu-item calendar-sub-trigger">View settings<ChevronRight size={16} /></Menu.SubTrigger>
              <Menu.Portal><Menu.SubContent className="calendar-menu" sideOffset={4}>
                {([ ["Weekends", nav.showWeekends, nav.setShowWeekends], ["Declined events", nav.showDeclinedEvents, nav.setShowDeclinedEvents], ["Week numbers", nav.showWeekNumbers, nav.setShowWeekNumbers] ] as const).map(([label, checked, change]) => <Menu.CheckboxItem className="calendar-menu-item" key={label} checked={checked} onCheckedChange={change} onSelect={e => e.preventDefault()}><span className="calendar-menu-check"><Menu.ItemIndicator><Check size={16} /></Menu.ItemIndicator></span>{label}</Menu.CheckboxItem>)}
                <Menu.Separator className="calendar-menu-separator" /><Menu.Item className="calendar-menu-item" onSelect={() => window.dispatchEvent(new Event("hcb:open-settings"))}>General settings</Menu.Item>
              </Menu.SubContent></Menu.Portal>
            </Menu.Sub>
          </Menu.Content></Menu.Portal>
        </Menu.Root>
        <Button aria-label="Jump to today" onClick={onResetRange} variant="secondary">Today</Button>
        <IconButton icon={ChevronLeft} label={previousRangeLabel} onClick={() => onShiftRange(-1)} variant="ghost" />
        <IconButton icon={ChevronRight} label={nextRangeLabel} onClick={() => onShiftRange(1)} variant="ghost" />
        <Menu.Root><Menu.Trigger asChild><IconButton label="Calendar tools" icon={MoreHorizontal} variant="ghost" /></Menu.Trigger>
          <Menu.Portal><Menu.Content className="calendar-menu" align="end" sideOffset={8}>
            <Menu.Item className="calendar-menu-item" onSelect={onCreate}>New event</Menu.Item>
            <Menu.Item className="calendar-menu-item" onSelect={onToggleSmartReschedule}>Smart schedule</Menu.Item>
            {shareAvailabilityVisible ? <Menu.Item className="calendar-menu-item" onSelect={onToggleShareAvailability}>Share availability</Menu.Item> : null}
            <Menu.Separator className="calendar-menu-separator" />
            <Menu.Label className="max-w-64 px-3 py-2 text-xs leading-relaxed text-text-muted">
              Grid: arrow keys move between cells; Enter creates an event. Tab reaches events. Shift+F10 opens event actions.<br />
              Scroll Month by week. Scroll sideways (or Shift+wheel) in a timeline to advance by day.
            </Menu.Label>
          </Menu.Content></Menu.Portal>
        </Menu.Root>
        <IconButton icon={PanelRight} label="Toggle search sidebar" aria-expanded={inspector.isOpen} onClick={() => { if (inspector.isOpen) void inspector.close(); else window.dispatchEvent(new Event("hcb:open-sidebar-search")); }} variant="ghost" />
      </div>
      <Popover.Root open={customDays} onOpenChange={setCustomDays}><Popover.Anchor className="calendar-custom-anchor" /><Popover.Portal><Popover.Content className="calendar-menu calendar-date-menu" align="end"><form onSubmit={e => { e.preventDefault(); const n = Number(count); if (Number.isInteger(n) && n >= 2 && n <= 31) { days(n); setCustomDays(false); } }}><label>Number of days<input autoFocus aria-label="Number of days" type="number" min={2} max={31} required value={count} onChange={e => setCount(e.target.value)} /></label><Button type="submit" variant="secondary">Apply</Button></form></Popover.Content></Popover.Portal></Popover.Root>
    </header>
  );
}
