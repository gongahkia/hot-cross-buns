import { useMemo, useRef, useState } from "react";
import type { CSSProperties, DragEvent, PointerEvent, ReactNode } from "react";
import { Minus, Plus } from "lucide-react";
import { IconButton, cx } from "../../../../components/primitives";
import { useCoreViewModelSource } from "../../coreViewModelSource";
import { handleActivationKeyDown } from "../../coreScreenShared";
import type { CalendarDayViewModel, CalendarEventViewModel } from "../../coreViewModels";
import { CalendarEventChip, CalendarOverflowChip } from "./CalendarEventChips";
import {
  addUtcMinutesIso,
  calendarBlocksOverlapHour,
  calendarDateTitle,
  calendarDayKey,
  calendarDisplayHourLabel,
  calendarEventTimeOfDayIso,
  calendarPointerTimeIso,
  calendarRangeTitle,
  calendarTimeBlock,
  calendarTimelineHourRowHeight,
  calendarTimelineHours,
  calendarTimelineVisibleAllDayCount,
  calendarTodayKey,
  hourSlotIso,
  hourSlotLabel,
  visibleCalendarTimeline
} from "./calendarGrid";
import {
  allowCalendarDrop,
  calendarEventDragId,
  calendarEventResizeDragId,
  startCalendarEventDrag,
  startCalendarEventResizeDrag
} from "./calendarDrag";
import type { CalendarCreateSeed, CalendarTimeBlock, CalendarTimelineAllDaySegment } from "./types";

const allDayLaneHeight = 28;

function CalendarTimelineEventChip({
  className,
  event,
  labelVariant,
  onMoveEvent,
  onOpen
}: {
  className?: string;
  event: CalendarEventViewModel;
  labelVariant: "range" | "time" | "title";
  onMoveEvent: (eventId: string, startsAt: string, allDay: boolean) => void;
  onOpen: (event: CalendarEventViewModel) => void;
}): JSX.Element {
  return (
    <div className={cx("grid h-full grid-cols-[minmax(0,1fr)_10px] items-stretch gap-1", className)}>
      <CalendarEventChip
        className="h-full min-h-0 px-1.5 py-0.5 text-[11px]"
        draggable
        event={event}
        labelVariant={labelVariant}
        onDragStart={(dragEvent) => startCalendarEventDrag(dragEvent, event.id)}
        onKeyDown={(keyEvent) => {
          if (keyEvent.key !== "ArrowDown" && keyEvent.key !== "ArrowUp") {
            return;
          }

          keyEvent.preventDefault();
          keyEvent.stopPropagation();
          if (event.allDay) {
            return;
          }

          const direction = keyEvent.key === "ArrowDown" ? 1 : -1;
          onMoveEvent(
            event.id,
            new Date(Date.parse(event.startsAt) + direction * 15 * 60 * 1000).toISOString(),
            event.allDay
          );
        }}
        onOpen={onOpen}
      />
      {!event.allDay ? (
        <button
          aria-label={`Resize ${event.title} end`}
          className="rounded-hcbSm border border-border bg-surface-0 hover:bg-surface-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          draggable
          onDragStart={(dragEvent) => startCalendarEventResizeDrag(dragEvent, event.id)}
          title={`Resize ${event.title} end`}
          type="button"
        />
      ) : null}
    </div>
  );
}

function timelineEventStyle({
  height,
  laneCount,
  laneIndex,
  top
}: {
  height: number;
  laneCount: number;
  laneIndex: number;
  top: number;
}): CSSProperties {
  const laneWidth = 100 / Math.max(1, laneCount);

  return {
    height: `${Math.max(22, height)}px`,
    left: `calc(${laneIndex * laneWidth}% + 4px)`,
    top: `${top}px`,
    width: `calc(${laneWidth}% - 8px)`
  };
}

function allDaySegmentStyle(segment: CalendarTimelineAllDaySegment): CSSProperties {
  return {
    gridColumn: `${segment.startDayIndex + 1} / span ${segment.daySpan}`,
    gridRow: `${segment.laneIndex + 1}`
  };
}

function CalendarTimelineView({
  availabilityMode = false,
  availabilitySlots = [],
  days,
  dayCountControl,
  gridLabel,
  label,
  onAddAvailabilitySlot,
  onCreate,
  onMoveEvent,
  onOpen,
  onResizeEvent,
  timedLabelVariant = "time",
  title,
  visibleCalendarIds
}: {
  availabilityMode?: boolean;
  availabilitySlots?: CalendarTimeBlock[];
  days: CalendarDayViewModel[];
  dayCountControl?: ReactNode;
  gridLabel: string;
  label: string;
  onAddAvailabilitySlot?: (slot: CalendarTimeBlock) => void;
  onCreate: (seed?: CalendarCreateSeed) => void;
  onMoveEvent: (eventId: string, startsAt: string, allDay: boolean) => void;
  onOpen: (event: CalendarEventViewModel) => void;
  onResizeEvent: (eventId: string, endsAt: string) => void;
  timedLabelVariant?: "range" | "time";
  title: string;
  visibleCalendarIds: ReadonlySet<string>;
}): JSX.Element {
  const source = useCoreViewModelSource();
  const [dragSelection, setDragSelection] = useState<CalendarTimeBlock | null>(null);
  const timelineDragRef = useRef<{
    dayKey: string;
    mode: "availability" | "create";
    moved: boolean;
    startClientY: number;
    startsAt: string;
  } | null>(null);
  const suppressNextClickRef = useRef(false);
  const timeline = useMemo(
    () => visibleCalendarTimeline(days, visibleCalendarIds),
    [days, visibleCalendarIds]
  );
  const visibleDays = timeline.days;
  const hasAllDayOverflow = timeline.allDayOverflowCounts.some((count) => count > 0);
  const allDayRowHeight = Math.max(
    112,
    calendarTimelineVisibleAllDayCount * allDayLaneHeight + (hasAllDayOverflow ? allDayLaneHeight : 0) + 16
  );
  const firstVisibleDayKey = visibleDays[0]
    ? calendarDayKey(visibleDays[0].day)
    : days[0]
      ? calendarDayKey(days[0])
      : calendarTodayKey();
  const dayColumnMinWidth = days.length <= 1 ? 520 : days.length <= 3 ? 220 : 160;
  const gridTemplateColumns = `repeat(${Math.max(1, days.length)}, minmax(${dayColumnMinWidth}px, 1fr))`;

  function handleDrop(
    dragEvent: DragEvent<HTMLElement>,
    dayKey: string,
    startsAt: string,
    allDay: boolean
  ): void {
    dragEvent.preventDefault();
    dragEvent.stopPropagation();
    const resizeEventId = calendarEventResizeDragId(dragEvent);

    if (resizeEventId) {
      onResizeEvent(resizeEventId, startsAt);
      return;
    }

    const eventId = calendarEventDragId(dragEvent);
    const draggedEvent = eventId ? source.calendarEventsById[eventId] : undefined;

    if (!draggedEvent) {
      return;
    }

    if (allDay && !draggedEvent.allDay) {
      const nextStartsAt = calendarEventTimeOfDayIso(
        draggedEvent.startsAt,
        dayKey,
        draggedEvent.timeZone || source.settings.defaultTimeZone
      );
      onMoveEvent(draggedEvent.id, nextStartsAt, false);
      return;
    }

    onMoveEvent(
      draggedEvent.id,
      allDay ? `${dayKey}T00:00:00.000Z` : startsAt,
      allDay
    );
  }

  function updateTimeDrag(
    pointerEvent: PointerEvent<HTMLElement>,
    dayKey: string,
    hour: number
  ): CalendarTimeBlock | null {
    const drag = timelineDragRef.current;

    if (!drag || drag.dayKey !== dayKey || (pointerEvent.buttons !== 1 && pointerEvent.type !== "pointerup")) {
      return null;
    }

    const pointerAt = calendarPointerTimeIso(dayKey, hour, pointerEvent, source.settings.defaultTimeZone);
    const nextSelection = calendarTimeBlock(drag.startsAt, pointerAt, source.settings.defaultTimeZone);

    if (
      Math.abs(pointerEvent.clientY - drag.startClientY) > 4 ||
      nextSelection.startsAt !== drag.startsAt ||
      Date.parse(nextSelection.endsAt) - Date.parse(nextSelection.startsAt) > 15 * 60 * 1000
    ) {
      drag.moved = true;
    }

    setDragSelection(nextSelection);
    return nextSelection;
  }

  function handleTimePointerDown(
    pointerEvent: PointerEvent<HTMLElement>,
    dayKey: string,
    hour: number
  ): void {
    if (pointerEvent.button !== 0) {
      return;
    }

    const startsAt = calendarPointerTimeIso(dayKey, hour, pointerEvent, source.settings.defaultTimeZone);
    const initialSelection = calendarTimeBlock(startsAt, startsAt, source.settings.defaultTimeZone);

    timelineDragRef.current = {
      dayKey,
      mode: availabilityMode ? "availability" : "create",
      moved: false,
      startClientY: pointerEvent.clientY,
      startsAt
    };
    setDragSelection(initialSelection);
  }

  function handleTimePointerUp(
    pointerEvent: PointerEvent<HTMLElement>,
    dayKey: string,
    hour: number
  ): void {
    const drag = timelineDragRef.current;

    if (!drag || drag.dayKey !== dayKey) {
      return;
    }

    const finalSelection = updateTimeDrag(pointerEvent, dayKey, hour) ?? dragSelection;
    timelineDragRef.current = null;
    setDragSelection(null);

    if (!drag.moved || !finalSelection) {
      return;
    }

    suppressNextClickRef.current = true;

    if (drag.mode === "availability") {
      onAddAvailabilitySlot?.(finalSelection);
      return;
    }

    onCreate({
      allDay: false,
      startsAt: finalSelection.startsAt,
      endsAt: finalSelection.endsAt
    });
  }

  return (
    <div className="flex h-full min-h-[680px] flex-col overflow-hidden rounded-hcbMd border border-border bg-bg-secondary">
      <div className="flex min-h-12 items-center justify-between gap-3 border-b border-border bg-bg-primary/40 px-3 py-2">
        <div className="min-w-0">
          <div className="truncate text-[var(--text-md)] font-semibold text-text-primary">{title}</div>
          <div className="truncate text-[var(--text-xs)] text-text-muted">{label}</div>
        </div>
        {dayCountControl}
      </div>
      <div className="min-h-0 flex-1 overflow-auto" role="grid" aria-label={gridLabel}>
        <div className="min-w-[720px]">
          <div className="grid grid-cols-[64px_minmax(0,1fr)] border-b border-border bg-bg-secondary/80">
            <div className="border-r border-border" aria-hidden="true" />
            <div className="grid" style={{ gridTemplateColumns }}>
              {visibleDays.map(({ day }) => (
                <div
                  className="min-h-16 border-r border-border px-2 py-2 text-center last:border-r-0"
                  key={day.id}
                  role="columnheader"
                >
                  <div className="text-[var(--text-xs)] font-semibold text-text-muted">{day.weekday}</div>
                  <div
                    className={cx(
                      "mx-auto mt-1 flex size-8 items-center justify-center rounded-full text-[var(--text-md)] font-semibold text-text-primary",
                      day.isToday && "bg-accent text-bg-tertiary"
                    )}
                  >
                    {day.dateLabel}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div
            className="grid grid-cols-[64px_minmax(0,1fr)] border-b border-border"
            style={{ minHeight: allDayRowHeight }}
          >
            <div className="border-r border-border px-2 py-3 text-[var(--text-xs)] font-semibold text-text-muted">
              All-day
            </div>
            <div
              aria-label={`All-day events ${label}`}
              className="relative"
              role="group"
              style={{ minHeight: allDayRowHeight }}
            >
              <div className="absolute inset-0 grid" style={{ gridTemplateColumns }}>
                {visibleDays.map(({ day }) => {
                  const dayKey = calendarDayKey(day);

                  return (
                    <div
                      className="border-r border-border bg-bg-tertiary last:border-r-0 hover:bg-surface-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                      key={day.id}
                      onClick={() => {
                        if (!availabilityMode) {
                          onCreate({ startsAt: `${dayKey}T00:00:00.000Z`, allDay: true });
                        }
                      }}
                      onDragOver={allowCalendarDrop}
                      onDrop={(dragEvent) =>
                        handleDrop(dragEvent, dayKey, `${dayKey}T00:00:00.000Z`, true)
                      }
                      onKeyDown={(event) =>
                        !availabilityMode
                          ? handleActivationKeyDown(event, () =>
                              onCreate({ startsAt: `${dayKey}T00:00:00.000Z`, allDay: true })
                            )
                          : undefined
                      }
                      role="gridcell"
                      tabIndex={0}
                    />
                  );
                })}
              </div>
              <div
                className="pointer-events-none relative grid gap-y-1 py-2"
                style={{
                  gridTemplateColumns,
                  gridTemplateRows: `repeat(${
                    calendarTimelineVisibleAllDayCount + (hasAllDayOverflow ? 1 : 0)
                  }, ${allDayLaneHeight}px)`,
                  minHeight: allDayRowHeight
                }}
              >
                {timeline.allDaySegments.map((segment) => (
                  <div
                    className="pointer-events-auto min-w-0 px-2"
                    data-calendar-all-day-segment={segment.event.id}
                    data-day-span={segment.daySpan}
                    data-ends-after-range={segment.endsAfterRange}
                    data-lane-index={segment.laneIndex}
                    data-start-day-index={segment.startDayIndex}
                    data-starts-before-range={segment.startsBeforeRange}
                    key={segment.event.id}
                    style={allDaySegmentStyle(segment)}
                  >
                    <CalendarTimelineEventChip
                      event={segment.event}
                      labelVariant="title"
                      onMoveEvent={onMoveEvent}
                      onOpen={onOpen}
                    />
                  </div>
                ))}
                {timeline.allDayOverflowCounts.map((count, dayIndex) =>
                  count > 0 ? (
                    <div
                      className="min-w-0 px-2"
                      key={`${visibleDays[dayIndex]?.day.id ?? dayIndex}-overflow`}
                      style={{
                        gridColumn: `${dayIndex + 1}`,
                        gridRow: `${calendarTimelineVisibleAllDayCount + 1}`
                      }}
                    >
                      <CalendarOverflowChip count={count} />
                    </div>
                  ) : null
                )}
              </div>
            </div>
          </div>
          <div className="relative">
            {calendarTimelineHours.map((hour) => (
              <div
                aria-label={`${hourSlotLabel(hour)} Open slot`}
                className="grid grid-cols-[64px_minmax(0,1fr)] border-b border-border last:border-b-0"
                key={hour}
                onDragOver={allowCalendarDrop}
                onDrop={(dragEvent) =>
                  handleDrop(
                    dragEvent,
                    firstVisibleDayKey,
                    hourSlotIso(firstVisibleDayKey, hour, source.settings.defaultTimeZone),
                    false
                  )
                }
                role="row"
                style={{ height: calendarTimelineHourRowHeight }}
              >
                <div className="border-r border-border px-2 py-2 text-right text-[var(--text-xs)] font-semibold text-text-muted">
                  {calendarDisplayHourLabel(hour)}
                </div>
                <div className="grid" style={{ gridTemplateColumns }}>
                  {visibleDays.map(({ day }) => {
                    const dayKey = calendarDayKey(day);
                    const startsAt = hourSlotIso(dayKey, hour, source.settings.defaultTimeZone);
                    const isTimeBlockSelected = calendarBlocksOverlapHour(
                      [
                        ...availabilitySlots,
                        ...(dragSelection ? [dragSelection] : [])
                      ],
                      dayKey,
                      hour,
                      source.settings.defaultTimeZone
                    );

                    return (
                      <div
                        aria-label={`${calendarDateTitle(day)} ${calendarDisplayHourLabel(hour)}`}
                        className={cx(
                          "border-r border-border bg-bg-tertiary px-2 py-1.5 last:border-r-0 hover:bg-surface-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                          isTimeBlockSelected && "bg-info/15 ring-1 ring-inset ring-info"
                        )}
                        key={`${day.id}-${hour}`}
                        onClick={() => {
                          if (suppressNextClickRef.current) {
                            suppressNextClickRef.current = false;
                            return;
                          }

                          if (!availabilityMode) {
                            onCreate({
                              allDay: false,
                              startsAt,
                              endsAt: addUtcMinutesIso(startsAt, 60)
                            });
                          }
                        }}
                        onDragOver={allowCalendarDrop}
                        onDrop={(dragEvent) => handleDrop(dragEvent, dayKey, startsAt, false)}
                        onPointerDown={(pointerEvent) => handleTimePointerDown(pointerEvent, dayKey, hour)}
                        onPointerEnter={(pointerEvent) => {
                          if (timelineDragRef.current) {
                            updateTimeDrag(pointerEvent, dayKey, hour);
                          }
                        }}
                        onPointerMove={(pointerEvent) => updateTimeDrag(pointerEvent, dayKey, hour)}
                        onPointerUp={(pointerEvent) => handleTimePointerUp(pointerEvent, dayKey, hour)}
                        onKeyDown={(event) =>
                          !availabilityMode
                            ? handleActivationKeyDown(event, () =>
                                onCreate({
                                  allDay: false,
                                  startsAt,
                                  endsAt: addUtcMinutesIso(startsAt, 60)
                                })
                              )
                            : undefined
                        }
                        role="gridcell"
                        tabIndex={0}
                      >
                        {!availabilityMode ? (
                          <button
                            aria-label={`Create event at ${hourSlotLabel(hour)}`}
                            className="sr-only"
                            onClick={(buttonEvent) => {
                              buttonEvent.stopPropagation();
                              onCreate({
                                allDay: false,
                                startsAt,
                                endsAt: addUtcMinutesIso(startsAt, 60)
                              });
                            }}
                            type="button"
                          />
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
            <div
              className="pointer-events-none absolute bottom-0 left-16 right-0 top-0 grid"
              style={{ gridTemplateColumns }}
            >
              {visibleDays.map(({ day, timedEventLayouts }) => (
                <div className="relative min-w-0 border-r border-transparent last:border-r-0" key={`${day.id}-events`}>
                  {timedEventLayouts.map((layout) => (
                    <div
                      className="pointer-events-auto absolute min-w-0"
                      data-calendar-event-layout={layout.event.id}
                      data-duration-minutes={layout.durationMinutes}
                      data-lane-count={layout.laneCount}
                      data-lane-index={layout.laneIndex}
                      data-start-minute={layout.startMinute}
                      key={layout.event.id}
                      style={timelineEventStyle(layout)}
                    >
                      <CalendarTimelineEventChip
                        className="min-w-0"
                        event={layout.event}
                        labelVariant={timedLabelVariant}
                        onMoveEvent={onMoveEvent}
                        onOpen={onOpen}
                      />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function DayView({
  availabilityMode,
  availabilitySlots,
  day,
  onAddAvailabilitySlot,
  onCreate,
  onMoveEvent,
  onOpen,
  onResizeEvent,
  visibleCalendarIds
}: {
  availabilityMode: boolean;
  availabilitySlots: CalendarTimeBlock[];
  day: CalendarDayViewModel;
  onAddAvailabilitySlot: (slot: CalendarTimeBlock) => void;
  onCreate: (seed?: CalendarCreateSeed) => void;
  onMoveEvent: (eventId: string, startsAt: string, allDay: boolean) => void;
  onOpen: (event: CalendarEventViewModel) => void;
  onResizeEvent: (eventId: string, endsAt: string) => void;
  visibleCalendarIds: ReadonlySet<string>;
}): JSX.Element {
  return (
    <CalendarTimelineView
      availabilityMode={availabilityMode}
      availabilitySlots={availabilitySlots}
      days={[day]}
      gridLabel="Calendar day view"
      label={calendarDateTitle(day)}
      onAddAvailabilitySlot={onAddAvailabilitySlot}
      onCreate={onCreate}
      onMoveEvent={onMoveEvent}
      onOpen={onOpen}
      onResizeEvent={onResizeEvent}
      timedLabelVariant="range"
      title="Day view"
      visibleCalendarIds={visibleCalendarIds}
    />
  );
}

export function MultiDayView({
  availabilityMode,
  availabilitySlots,
  dayCount,
  days,
  onAddAvailabilitySlot,
  onCreate,
  onDayCountChange,
  onMoveEvent,
  onOpen,
  onResizeEvent,
  visibleCalendarIds
}: {
  availabilityMode: boolean;
  availabilitySlots: CalendarTimeBlock[];
  dayCount: number;
  days: CalendarDayViewModel[];
  onAddAvailabilitySlot: (slot: CalendarTimeBlock) => void;
  onCreate: (seed?: CalendarCreateSeed) => void;
  onDayCountChange: (dayCount: number) => void;
  onMoveEvent: (eventId: string, startsAt: string, allDay: boolean) => void;
  onOpen: (event: CalendarEventViewModel) => void;
  onResizeEvent: (eventId: string, endsAt: string) => void;
  visibleCalendarIds: ReadonlySet<string>;
}): JSX.Element {
  return (
    <CalendarTimelineView
      availabilityMode={availabilityMode}
      availabilitySlots={availabilitySlots}
      dayCountControl={
        <div className="flex shrink-0 items-center gap-2">
          <IconButton
            disabled={dayCount <= 2}
            icon={Minus}
            label="Show fewer days"
            onClick={() => onDayCountChange(Math.max(2, dayCount - 1))}
            size="sm"
            variant="ghost"
          />
          <span className="min-w-14 text-center text-[var(--text-sm)] font-semibold text-text-primary">
            {dayCount} days
          </span>
          <IconButton
            disabled={dayCount >= 6}
            icon={Plus}
            label="Show more days"
            onClick={() => onDayCountChange(Math.min(6, dayCount + 1))}
            size="sm"
            variant="ghost"
          />
        </div>
      }
      days={days}
      gridLabel="Calendar multi-day view"
      label={calendarRangeTitle(days)}
      onAddAvailabilitySlot={onAddAvailabilitySlot}
      onCreate={onCreate}
      onMoveEvent={onMoveEvent}
      onOpen={onOpen}
      onResizeEvent={onResizeEvent}
      title="Multi-Day view"
      visibleCalendarIds={visibleCalendarIds}
    />
  );
}

export function WeekView({
  availabilityMode,
  availabilitySlots,
  days,
  onAddAvailabilitySlot,
  onCreate,
  onMoveEvent,
  onOpen,
  onResizeEvent,
  visibleCalendarIds
}: {
  availabilityMode: boolean;
  availabilitySlots: CalendarTimeBlock[];
  days: CalendarDayViewModel[];
  onAddAvailabilitySlot: (slot: CalendarTimeBlock) => void;
  onCreate: (seed?: CalendarCreateSeed) => void;
  onMoveEvent: (eventId: string, startsAt: string, allDay: boolean) => void;
  onOpen: (event: CalendarEventViewModel) => void;
  onResizeEvent: (eventId: string, endsAt: string) => void;
  visibleCalendarIds: ReadonlySet<string>;
}): JSX.Element {
  return (
    <CalendarTimelineView
      availabilityMode={availabilityMode}
      availabilitySlots={availabilitySlots}
      days={days}
      gridLabel="Calendar week view"
      label={calendarRangeTitle(days)}
      onAddAvailabilitySlot={onAddAvailabilitySlot}
      onCreate={onCreate}
      onMoveEvent={onMoveEvent}
      onOpen={onOpen}
      onResizeEvent={onResizeEvent}
      title="Week view"
      visibleCalendarIds={visibleCalendarIds}
    />
  );
}
