import { CalendarOverflowPopover } from "./CalendarOverflowPopover";
import { useCalendarGridFocus } from "./useCalendarGridFocus";
import { useCalendarWheelNavigation } from "./useCalendarWheelNavigation";
import { useCalendarPointerGesture } from "./useCalendarPointerGesture";
import { calendarGestureRange, type CalendarEventRange, type CalendarGestureKind } from "./calendarGesture";
import { calendarLocalPoint } from "./calendarDateUtils";
import { useCalendarNavigation } from "../../../shell/CalendarNavigation";
import { weekNumber } from "../../../shell/MiniCalendar";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import type { CalendarEventCompletionScope } from "@shared/ipc/contracts";
import { cx } from "../../../../components/primitives";
import { handleActivationKeyDown } from "../../coreScreenShared";
import type { CalendarEventViewModel, CalendarMonthWeekViewModel } from "../../coreViewModels";
import {
  CalendarEventChip,
  CalendarOverflowChip,
  type EventCompletionDefaultScope
} from "./CalendarEventChips";
import { calendarAddUtcDays, calendarContextualDateTitleFromIso, calendarDayKey, calendarMonthVisibleChipCount, visibleCalendarMonthWeeks } from "./calendarGrid";
import type { CalendarCreateSeed, CalendarTimelineAllDaySegment } from "./types";

const monthEventLaneHeight = 24;

type MonthPointerEvent = Pick<globalThis.PointerEvent, "buttons" | "clientX" | "clientY" | "pointerId" | "type" | "preventDefault">;

function monthAllDaySegmentStyle(segment: CalendarTimelineAllDaySegment): CSSProperties {
  return {
    gridColumn: `${segment.startDayIndex + 1} / span ${segment.daySpan}`,
    gridRow: `${segment.laneIndex + 2}`
  };
}

function monthEventChipStyle(dayIndex: number, laneIndex: number): CSSProperties {
  return {
    gridColumn: `${dayIndex + 1}`,
    gridRow: `${laneIndex + 2}`
  };
}

function monthOverflowStyle(dayIndex: number, visibleChipCount: number): CSSProperties {
  return {
    gridColumn: `${dayIndex + 1}`,
    gridRow: `${visibleChipCount + 2}`
  };
}

export function MonthView({
  onScrollPeriod,
  onChangeEvent,
  eventCompletionDefaultScope,
  weeks,
  onCreate,
  onOpen,
  onToggleEvent,
  onToggleTask,
  todayKey,
  visibleCalendarIds
}: {
  eventCompletionDefaultScope?: EventCompletionDefaultScope;
  weeks: CalendarMonthWeekViewModel[];
  onScrollPeriod?: (direction: -1 | 1) => void;
  onChangeEvent: (event: CalendarEventViewModel, range: CalendarEventRange) => void;
  onCreate: (seed?: CalendarCreateSeed) => void;
  onOpen: (event: CalendarEventViewModel) => void;
  onToggleEvent?: (eventId: string, scope?: CalendarEventCompletionScope) => void;
  onToggleTask?: (taskId: string) => void;
  todayKey: string;
  visibleCalendarIds: ReadonlySet<string>;
}): JSX.Element {
  const { showWeekends, showWeekNumbers } = useCalendarNavigation();
  const dayCount = showWeekends ? 7 : 5;
  const [activeOverflow, setActiveOverflow] = useState<{
    events: CalendarEventViewModel[];
    title: string;
  } | null>(null);
  const [rangeSelection, setRangeSelection] = useState<{ end: string; start: string } | null>(null);
  const [suppressClick, setSuppressClick] = useState(false);
  const [visibleChipCount, setVisibleChipCount] = useState(calendarMonthVisibleChipCount);
  const visibleWeeks = useMemo(
    () => visibleCalendarMonthWeeks(showWeekends ? weeks : weeks.map(week => ({ ...week, days: week.days.slice(1, 6) })), visibleCalendarIds, visibleChipCount),
    [weeks, visibleCalendarIds, showWeekends, visibleChipCount]
  );
  const visibleWeekIds = visibleWeeks.map((week) => week.id).join("|");
  const cellKeys = useMemo(() => visibleWeeks.flatMap(week => week.days.map(({ day }) => calendarDayKey(day))), [visibleWeeks]);
  const gridFocus = useCalendarGridFocus(cellKeys, dayCount, todayKey);
  const dragRangeRef = useRef<{ last: string; moved: boolean; start: string } | null>(null);
  const monthGridRef = useRef<HTMLDivElement | null>(null);
  const removeMonthPointerListenersRef = useRef<(() => void) | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const edgeNavigation = useRef<{ direction: -1 | 1; at: number } | null>(null);
  useCalendarWheelNavigation(scrollRef, "vertical", onScrollPeriod);
  const todayCellRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      // The observer supplies the initial size without forcing layout after mount.
      const rowHeight = (Math.round(entry.contentRect.height) - 40) / 6;
      // Date header, overflow row and gaps stay visible; event lanes remain bounded.
      setVisibleChipCount(Math.max(1, Math.min(6, Math.floor((rowHeight - 50) / 25))));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => () => removeMonthPointerListenersRef.current?.(), []);

  function orderedRange(start: string, end: string): { end: string; start: string } {
    return start <= end ? { start, end } : { start: end, end: start };
  }

  function rangeContains(dayKey: string): boolean {
    if (!rangeSelection) {
      return false;
    }

    const range = orderedRange(rangeSelection.start, rangeSelection.end);
    return dayKey >= range.start && dayKey <= range.end;
  }

  function dayKeyFromPointer(pointerEvent: Pick<MonthPointerEvent, "clientX" | "clientY">): string | null {
    const rows = monthGridRef.current?.querySelectorAll<HTMLElement>("[data-calendar-month-week-row]");

    if (!rows) {
      return null;
    }

    for (let weekIndex = 0; weekIndex < rows.length; weekIndex += 1) {
      const rect = rows[weekIndex].getBoundingClientRect();

      if (
        pointerEvent.clientY < rect.top ||
        pointerEvent.clientY > rect.bottom ||
        pointerEvent.clientX < rect.left ||
        pointerEvent.clientX > rect.right
      ) {
        continue;
      }

      const dayIndex = Math.max(
        0,
        Math.min(dayCount - 1, Math.floor(((pointerEvent.clientX - rect.left) / Math.max(1, rect.width)) * dayCount))
      );
      const day = visibleWeeks[weekIndex]?.days[dayIndex]?.day;

      return day ? day.id.slice("month-".length) : null;
    }

    return null;
  }

  const gesture = useCalendarPointerGesture({
    locate: (x, y) => { const day = dayKeyFromPointer({ clientX: x, clientY: y }); return day ? { day } : null; },
    onCommit: onChangeEvent,
    onFinish: () => { edgeNavigation.current = null; },
    onEdge: (_, y) => {
      const node = scrollRef.current;
      if (!node) return false;
      const rect = node.getBoundingClientRect();
      const direction = y > rect.bottom - 28 ? 1 : y < rect.top + 65 ? -1 : 0;
      if (!direction) { edgeNavigation.current = null; return false; }
      const before = node.scrollTop; node.scrollTop += direction * 12;
      if (node.scrollTop !== before) { edgeNavigation.current = null; return true; }
      if (!onScrollPeriod) return false;
      const now = performance.now(), edge = edgeNavigation.current;
      if (!edge || edge.direction !== direction) edgeNavigation.current = { direction, at: now + 600 };
      else if (now >= edge.at) { edge.at = now + 800; onScrollPeriod(direction); }
      return true;
    }
  });
  function openAfterGesture(event: CalendarEventViewModel): void {
    if (!gesture.consumeClick()) onOpen(event);
  }
  function eventKeys(key: KeyboardEvent<HTMLElement>, event: CalendarEventViewModel, kind: CalendarGestureKind = "move"): void {
    if ((key.key !== "ArrowLeft" && key.key !== "ArrowRight") || event.sourceKind === "task" || event.canWrite === false) return;
    key.preventDefault(); key.stopPropagation();
    const value = kind === "end" ? event.endsAt : event.startsAt;
    const point = event.allDay ? value.slice(0, 10) : calendarLocalPoint(value, event.displayTimeZone || event.timeZone).dayKey;
    const day = kind === "end" && event.allDay ? calendarAddUtcDays(point, -1) : point;
    const step = (key.key === "ArrowRight" ? 1 : -1) * (key.shiftKey ? 7 : 1);
    onChangeEvent(event, calendarGestureRange(event, kind, { day }, { day: calendarAddUtcDays(day, step) }));
  }
  const previewStart = gesture.preview && (gesture.preview.allDay ? gesture.preview.startsAt.slice(0, 10) : calendarLocalPoint(gesture.preview.startsAt, gesture.preview.event.displayTimeZone || gesture.preview.event.timeZone).dayKey);
  const previewEnd = gesture.preview && (gesture.preview.allDay ? calendarAddUtcDays(gesture.preview.endsAt.slice(0, 10), -1) : calendarLocalPoint(gesture.preview.endsAt, gesture.preview.event.displayTimeZone || gesture.preview.event.timeZone).dayKey);

  function updateDayPointerDrag(pointerEvent: MonthPointerEvent): string | null {
    const drag = dragRangeRef.current;

    if (!drag) {
      return null;
    }

    pointerEvent.preventDefault();
    const dayKey = dayKeyFromPointer(pointerEvent) ?? drag.last;
    drag.moved = drag.moved || drag.start !== dayKey;
    drag.last = dayKey;
    setRangeSelection({ start: drag.start, end: dayKey });
    return dayKey;
  }

  function clearDayPointerDrag(): void {
    dragRangeRef.current = null;
    setRangeSelection(null);
    removeMonthPointerListenersRef.current?.();
    removeMonthPointerListenersRef.current = null;
  }

  function installMonthPointerListeners(pointerId: number): void {
    removeMonthPointerListenersRef.current?.();

    const handlePointerMove = (pointerEvent: globalThis.PointerEvent): void => {
      if (pointerEvent.pointerId === pointerId) {
        updateDayPointerDrag(pointerEvent);
      }
    };
    const handlePointerUp = (pointerEvent: globalThis.PointerEvent): void => {
      if (pointerEvent.pointerId === pointerId) {
        handleDayPointerUp(pointerEvent);
      }
    };
    const handlePointerCancel = (pointerEvent: globalThis.PointerEvent): void => {
      if (pointerEvent.pointerId === pointerId) {
        clearDayPointerDrag();
      }
    };

    window.addEventListener("pointermove", handlePointerMove, { passive: false });
    window.addEventListener("pointerup", handlePointerUp, { passive: false });
    window.addEventListener("pointercancel", handlePointerCancel, { passive: false });
    removeMonthPointerListenersRef.current = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerCancel);
    };
  }

  function handleDayPointerDown(pointerEvent: ReactPointerEvent<HTMLDivElement>, dayKey: string): void {
    if (pointerEvent.button > 0) {
      return;
    }

    pointerEvent.preventDefault();
    pointerEvent.currentTarget.setPointerCapture?.(pointerEvent.pointerId);
    dragRangeRef.current = { last: dayKey, moved: false, start: dayKey };
    installMonthPointerListeners(pointerEvent.pointerId);
    setRangeSelection({ start: dayKey, end: dayKey });
  }

  function handleDayPointerUp(pointerEvent: MonthPointerEvent): void {
    if (!dragRangeRef.current) {
      return;
    }

    const start = dragRangeRef.current.start;
    const end = updateDayPointerDrag(pointerEvent) ?? dragRangeRef.current.last;
    const moved = dragRangeRef.current.moved || start !== end;
    const range = orderedRange(start, end);
    clearDayPointerDrag();

    if (!moved) {
      return;
    }

    setSuppressClick(true);
    onCreate({
      allDay: true,
      startsAt: `${range.start}T00:00:00.000Z`,
      endsAt: `${calendarAddUtcDays(range.end, 1)}T00:00:00.000Z`
    });
  }

  return (
    <div ref={scrollRef} className="calendar-month flex h-full min-h-0 select-none flex-col overflow-auto" data-month-lanes={visibleChipCount} data-week-numbers={showWeekNumbers} role="grid" aria-label="Calendar month view" aria-description="Use arrow keys to move between dates, Home or End for a row, and Enter to create an event. Tab moves to event controls.">
      <div className="calendar-month-head grid" style={{ gridTemplateColumns: `repeat(${dayCount}, minmax(0, 1fr))` }} role="row">
        {(showWeekends ? ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] : ["Mon", "Tue", "Wed", "Thu", "Fri"]).map((weekday) => (
          <div className="border-r border-border px-2 py-2 last:border-r-0" key={weekday} role="columnheader">
            {weekday}
          </div>
        ))}
      </div>
      <div
        className="calendar-month-body grid flex-1 grid-rows-6"
        onPointerCancel={() => {
          dragRangeRef.current = null;
          setRangeSelection(null);
        }}
        onPointerMove={updateDayPointerDrag}
        onPointerUp={handleDayPointerUp}
        ref={monthGridRef}
        role="rowgroup"
      >
        {visibleWeeks.map((week, weekIndex) => (
          <div
            className="calendar-month-week relative grid gap-y-px border-b border-border last:border-b-0"
            data-calendar-month-week-row
            key={week.id}
            role="row"
            style={{
              gridTemplateColumns: `repeat(${dayCount}, minmax(0, 1fr))`,
              minHeight: 50 + 25 * visibleChipCount,
              gridTemplateRows: `28px repeat(${visibleChipCount}, ${monthEventLaneHeight}px) 20px minmax(0, 1fr)`
            }}
          >
            {showWeekNumbers ? <span className="calendar-week-number" aria-label={`Week ${weekNumber(calendarDayKey(weeks[weekIndex].days[0]))}`}>{weekNumber(calendarDayKey(weeks[weekIndex].days[0]))}</span> : null}
            {week.days.map(({ day, overflowCount, visibleEventChips }, dayIndex) => {
              const dayKey = day.id.slice("month-".length);
              const isCurrentDay = dayKey === todayKey;

              return (
                <div
                  className={cx(
                    "calendar-month-cell relative z-0 min-h-0 border-r border-border bg-bg-tertiary px-2 py-1.5 text-left transition-colors duration-fast ease-hcb last:border-r-0 hover:bg-surface-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",


                    (rangeContains(dayKey) || (previewStart && previewEnd && dayKey >= previewStart && dayKey <= previewEnd)) && "bg-info/15 ring-1 ring-inset ring-info"
                  )}
                  data-calendar-date={dayKey}
                  data-calendar-drop-preview={Boolean(previewStart && previewEnd && dayKey >= previewStart && dayKey <= previewEnd)}
                  data-calendar-month-today={isCurrentDay || undefined}
                  data-outside-month={day.isOutsideMonth}
                  key={day.id}
                  onClick={() => {
                    if (suppressClick) {
                      setSuppressClick(false);
                      return;
                    }

                    onCreate({ startsAt: `${dayKey}T00:00:00.000Z`, allDay: true });
                  }}
                  onKeyDown={(event) => {
                    if (gridFocus.onKeyDown(event)) return;
                    handleActivationKeyDown(event, () =>
                      onCreate({ startsAt: `${dayKey}T00:00:00.000Z`, allDay: true })
                    );
                  }}
                  onPointerEnter={updateDayPointerDrag}
                  onPointerDown={(event) => handleDayPointerDown(event, dayKey)}
                  onPointerMove={updateDayPointerDrag}
                  onPointerUp={handleDayPointerUp}
                  ref={(node) => {
                    if (isCurrentDay) {
                      todayCellRef.current = node;
                    }
                  }}
                  role="gridcell"
                  style={{ gridColumn: `${dayIndex + 1}`, gridRow: "1 / -1" }}
                  {...gridFocus.cellProps(dayKey)}
                >
                  <span className="sr-only">{day.weekday}</span>
                  <span className="calendar-month-date">{day.dateLabel}</span>
                </div>
              );
            })}
            {week.allDaySegments.map((segment) => (
              <div
                className="calendar-month-event relative z-10 min-w-0 px-1.5"
                data-calendar-month-all-day-segment={segment.event.id}
                data-day-span={segment.daySpan}
                data-ends-after-range={segment.endsAfterRange}
                data-lane-index={segment.laneIndex}
                data-start-day-index={segment.startDayIndex}
                data-starts-before-range={segment.startsBeforeRange}
                key={segment.event.id}
                role="presentation"
                style={monthAllDaySegmentStyle(segment)}
              >
                <CalendarEventChip
                  className="h-5"
                  event={segment.event}
                  eventCompletionDefaultScope={eventCompletionDefaultScope}
                  labelVariant="title"
                  onKeyDown={(keyEvent) => {
                    eventKeys(keyEvent, segment.event);
                    if (!keyEvent.defaultPrevented) handleActivationKeyDown(keyEvent, () => onOpen(segment.event));
                  }}
                  onOpen={openAfterGesture}
                  onPointerDown={(pointer) => gesture.begin(pointer, segment.event)}
                  onToggleEvent={onToggleEvent}
                  onToggleTask={onToggleTask}
                  size="compact"
                />
                {segment.event.sourceKind !== "task" && segment.event.canWrite !== false ? <>
                  {!segment.startsBeforeRange ? <button className="calendar-month-resize calendar-month-resize-start" aria-label={`Resize ${segment.event.title} start`} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => eventKeys(e, segment.event, "start")} title="Resize start: drag or use Left and Right arrow keys" onPointerDown={(e) => gesture.begin(e, segment.event, "start")} /> : null}
                  {!segment.endsAfterRange ? <button className="calendar-month-resize calendar-month-resize-end" aria-label={`Resize ${segment.event.title} end`} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => eventKeys(e, segment.event, "end")} title="Resize end: drag or use Left and Right arrow keys" onPointerDown={(e) => gesture.begin(e, segment.event, "end")} /> : null}
                </> : null}
              </div>
            ))}
            {week.days.flatMap(({ day, visibleEventChips }, dayIndex) =>
              visibleEventChips.map(({ event, laneIndex }) => (
                <div
                  className="calendar-month-event relative z-10 min-w-0 px-1.5"
                  key={`${day.id}-${event.id}`}
                  role="presentation"
                  style={monthEventChipStyle(dayIndex, laneIndex)}
                >
                  <CalendarEventChip
                    className="h-5"
                    event={event}
                    eventCompletionDefaultScope={eventCompletionDefaultScope}
                    labelVariant="time"
                    onKeyDown={(keyEvent) => {
                      eventKeys(keyEvent, event);
                      if (!keyEvent.defaultPrevented) handleActivationKeyDown(keyEvent, () => onOpen(event));
                    }}
                    onOpen={openAfterGesture}
                    onPointerDown={(pointer) => gesture.begin(pointer, event)}
                    onToggleEvent={onToggleEvent}
                    onToggleTask={onToggleTask}
                    size="compact"
                  />
                </div>
              ))
            )}
            {week.days.map(({ day, overflowCount, popupEvents }, dayIndex) =>
              overflowCount > 0 ? (
                <div
                  className="calendar-month-event relative z-10 min-w-0 px-1.5"
                  key={`${day.id}-overflow`}
                  role="presentation"
                  style={monthOverflowStyle(dayIndex, visibleChipCount)}
                >
                  <CalendarOverflowChip
                    count={overflowCount}
                    onOpen={() =>
                      setActiveOverflow({
                        events: popupEvents,
                        title: calendarContextualDateTitleFromIso(calendarDayKey(day))
                      })
                    }
                  />
                </div>
              ) : null
            )}
          </div>
        ))}
      </div>
      {gesture.preview ? <div className="calendar-gesture-status" role="status" data-calendar-gesture-preview>
        {gesture.preview.event.title}: {previewStart} – {previewEnd}. Release to save; Escape to cancel.
      </div> : null}
      {activeOverflow ? (
        <CalendarOverflowPopover
          eventCompletionDefaultScope={eventCompletionDefaultScope}
          events={activeOverflow.events}
          onClose={() => setActiveOverflow(null)}
          onOpen={onOpen}
          onToggleEvent={onToggleEvent}
          onToggleTask={onToggleTask}
          title={activeOverflow.title}
        />
      ) : null}
    </div>
  );
}
