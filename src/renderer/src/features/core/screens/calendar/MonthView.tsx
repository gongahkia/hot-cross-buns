import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent } from "react";
import { cx } from "../../../../components/primitives";
import { handleActivationKeyDown } from "../../coreScreenShared";
import type { CalendarEventViewModel, CalendarMonthWeekViewModel } from "../../coreViewModels";
import { CalendarEventChip, CalendarOverflowChip, CalendarOverflowPopover } from "./CalendarEventChips";
import { calendarAddUtcDays, calendarDateTitle, calendarMonthVisibleChipCount, visibleCalendarMonthWeeks } from "./calendarGrid";
import type { CalendarCreateSeed, CalendarTimelineAllDaySegment } from "./types";

const monthEventLaneHeight = 24;

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

function monthOverflowStyle(dayIndex: number): CSSProperties {
  return {
    gridColumn: `${dayIndex + 1}`,
    gridRow: `${calendarMonthVisibleChipCount + 2}`
  };
}

export function MonthView({
  weeks,
  onCreate,
  onOpen,
  onToggleTask,
  todayKey,
  visibleCalendarIds
}: {
  weeks: CalendarMonthWeekViewModel[];
  onCreate: (seed?: CalendarCreateSeed) => void;
  onOpen: (event: CalendarEventViewModel) => void;
  onToggleTask?: (taskId: string) => void;
  todayKey: string;
  visibleCalendarIds: ReadonlySet<string>;
}): JSX.Element {
  const [activeOverflow, setActiveOverflow] = useState<{
    events: CalendarEventViewModel[];
    title: string;
  } | null>(null);
  const [rangeSelection, setRangeSelection] = useState<{ end: string; start: string } | null>(null);
  const [suppressClick, setSuppressClick] = useState(false);
  const visibleWeeks = useMemo(
    () => visibleCalendarMonthWeeks(weeks, visibleCalendarIds),
    [weeks, visibleCalendarIds]
  );
  const visibleWeekIds = visibleWeeks.map((week) => week.id).join("|");
  const dragRangeRef = useRef<{ moved: boolean; start: string } | null>(null);
  const todayCellRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      todayCellRef.current?.scrollIntoView?.({ block: "center", inline: "nearest" });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [todayKey, visibleWeekIds]);

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

  function handleDayPointerDown(pointerEvent: PointerEvent<HTMLDivElement>, dayKey: string): void {
    if (pointerEvent.button !== 0) {
      return;
    }

    dragRangeRef.current = { moved: false, start: dayKey };
    setRangeSelection({ start: dayKey, end: dayKey });
  }

  function handleDayPointerEnter(dayKey: string): void {
    if (!dragRangeRef.current) {
      return;
    }

    dragRangeRef.current.moved = true;
    setRangeSelection({ start: dragRangeRef.current.start, end: dayKey });
  }

  function handleDayPointerUp(dayKey: string): void {
    if (!dragRangeRef.current) {
      return;
    }

    const start = dragRangeRef.current.start;
    const moved = dragRangeRef.current.moved || start !== dayKey;
    const range = orderedRange(start, dayKey);
    dragRangeRef.current = null;
    setRangeSelection(null);

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
    <div className="flex min-h-[680px] flex-col overflow-hidden rounded-hcbMd border border-border bg-bg-secondary" role="grid" aria-label="Calendar month view">
      <div className="grid grid-cols-7 border-b border-border bg-bg-primary/40 text-center text-[var(--text-xs)] font-semibold text-text-muted" role="row">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((weekday) => (
          <div className="border-r border-border px-2 py-2 last:border-r-0" key={weekday} role="columnheader">
            {weekday}
          </div>
        ))}
      </div>
      <div className="grid flex-1 grid-rows-6" role="rowgroup">
        {visibleWeeks.map((week) => (
          <div
            className="grid gap-y-1 border-b border-border last:border-b-0"
            key={week.id}
            role="row"
            style={{
              gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
              gridTemplateRows: `28px repeat(${calendarMonthVisibleChipCount}, ${monthEventLaneHeight}px) ${monthEventLaneHeight}px minmax(0, 1fr)`
            }}
          >
            {week.days.map(({ day, overflowCount, visibleEventChips }, dayIndex) => {
              const dayKey = day.id.slice("month-".length);
              const isCurrentDay = dayKey === todayKey;

              return (
                <div
                  className={cx(
                    "relative z-0 min-h-[126px] border-r border-border bg-bg-tertiary px-2 py-1.5 text-left transition-colors duration-fast ease-hcb last:border-r-0 hover:bg-surface-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                    isCurrentDay && "bg-surface-0 ring-1 ring-inset ring-accent",
                    day.isOutsideMonth && "opacity-50",
                    rangeContains(dayKey) && "bg-info/15 ring-1 ring-inset ring-info"
                  )}
                  data-calendar-month-today={isCurrentDay || undefined}
                  key={day.id}
                  onClick={() => {
                    if (suppressClick) {
                      setSuppressClick(false);
                      return;
                    }

                    onCreate({ startsAt: `${dayKey}T00:00:00.000Z`, allDay: true });
                  }}
                  onKeyDown={(event) =>
                    handleActivationKeyDown(event, () =>
                      onCreate({ startsAt: `${dayKey}T00:00:00.000Z`, allDay: true })
                    )
                  }
                  onPointerDown={(event) => handleDayPointerDown(event, dayKey)}
                  onPointerEnter={() => handleDayPointerEnter(dayKey)}
                  onPointerUp={() => handleDayPointerUp(dayKey)}
                  ref={(node) => {
                    if (isCurrentDay) {
                      todayCellRef.current = node;
                    }
                  }}
                  role="gridcell"
                  style={{ gridColumn: `${dayIndex + 1}`, gridRow: "1 / -1" }}
                  tabIndex={0}
                >
                  <span className="sr-only">{day.weekday}</span>
                  <span className="text-[var(--text-sm)] font-semibold text-text-primary">{day.dateLabel}</span>
                </div>
              );
            })}
            {week.allDaySegments.map((segment) => (
              <div
                className="z-10 min-w-0 px-1.5"
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
                  labelVariant="title"
                  onKeyDown={(keyEvent) => {
                    keyEvent.stopPropagation();
                    handleActivationKeyDown(keyEvent, () => onOpen(segment.event));
                  }}
                  onOpen={onOpen}
                  onToggleTask={onToggleTask}
                  size="compact"
                />
              </div>
            ))}
            {week.days.flatMap(({ day, visibleEventChips }, dayIndex) =>
              visibleEventChips.map(({ event, laneIndex }) => (
                <div
                  className="z-10 min-w-0 px-1.5"
                  key={`${day.id}-${event.id}`}
                  role="presentation"
                  style={monthEventChipStyle(dayIndex, laneIndex)}
                >
                  <CalendarEventChip
                    className="h-5"
                    event={event}
                    labelVariant="title"
                    onKeyDown={(keyEvent) => {
                      keyEvent.stopPropagation();
                      handleActivationKeyDown(keyEvent, () => onOpen(event));
                    }}
                    onOpen={onOpen}
                    onToggleTask={onToggleTask}
                    size="compact"
                  />
                </div>
              ))
            )}
            {week.days.map(({ day, overflowCount, overflowEvents }, dayIndex) =>
              overflowCount > 0 ? (
                <div
                  className="z-10 min-w-0 px-1.5"
                  key={`${day.id}-overflow`}
                  role="presentation"
                  style={monthOverflowStyle(dayIndex)}
                >
                  <CalendarOverflowChip
                    count={overflowCount}
                    onOpen={() =>
                      setActiveOverflow({
                        events: overflowEvents,
                        title: `More items for ${calendarDateTitle(day)}`
                      })
                    }
                  />
                </div>
              ) : null
            )}
          </div>
        ))}
      </div>
      {activeOverflow ? (
        <CalendarOverflowPopover
          events={activeOverflow.events}
          onClose={() => setActiveOverflow(null)}
          onOpen={onOpen}
          onToggleTask={onToggleTask}
          title={activeOverflow.title}
        />
      ) : null}
    </div>
  );
}
