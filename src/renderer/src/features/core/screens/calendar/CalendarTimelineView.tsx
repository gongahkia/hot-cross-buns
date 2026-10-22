import { CalendarOverflowPopover } from "./CalendarOverflowPopover";
import { useCalendarGridFocus } from "./useCalendarGridFocus";
import { useCalendarWheelNavigation } from "./useCalendarWheelNavigation";
import { useCalendarPointerGesture } from "./useCalendarPointerGesture";
import { calendarGestureRange, type CalendarEventRange, type CalendarGestureKind } from "./calendarGesture";
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { PaneIdentity, readPanePreference, writePanePreference } from "../../../shell/panePreferences";
import type { CSSProperties, DragEvent, PointerEvent, ReactNode } from "react";
import type { CalendarEventCompletionScope } from "@shared/ipc/contracts";
import { Minus, Plus } from "lucide-react";
import { IconButton, cx } from "../../../../components/primitives";
import { useCoreViewModelSource } from "../../coreViewModelSource";
import { handleActivationKeyDown } from "../../coreScreenShared";
import type { CalendarDayViewModel, CalendarEventViewModel } from "../../coreViewModels";
import {
  CalendarEventChip,
  CalendarOverflowChip,
  type EventCompletionDefaultScope
} from "./CalendarEventChips";
import {
  addUtcMinutesIso,
  calendarDateTitle,
  calendarContextualDateTitleFromIso,
  calendarDayKey,
  calendarDisplayHourLabel,
  calendarEventTimeOfDayIso,
  calendarLocalPoint,
  calendarPointerTimeIso,
  calendarRangeTitle,
  calendarTimeBlock,
  calendarTimelineHourHeight,
  calendarTimelineHours,
  calendarTimelineVisibleAllDayCount,
  calendarTodayKey,
  hourSlotIso,
  hourSlotLabel,
  visibleCalendarTimeline,
  zonedDateTimeIso
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

export interface SmartScheduleGhostBlock {
  id: string;
  startsAt: string;
  endsAt: string;
  stale: boolean;
  title: string;
}

function CalendarTimelineEventChip({
  className,
  event,
  eventCompletionDefaultScope,
  labelVariant,
  onMoveEvent,
  onOpen,
  onToggleEvent,
  onToggleTask,
  showContent = true,
  onGestureStart,
  onResizeKey,
  allowStart = true,
  allowEnd = true
}: {
  className?: string;
  event: CalendarEventViewModel;
  eventCompletionDefaultScope?: EventCompletionDefaultScope;
  labelVariant: "range" | "time" | "title";
  onMoveEvent: (eventId: string, startsAt: string, allDay: boolean) => void;
  onOpen: (event: CalendarEventViewModel) => void;
  onToggleEvent?: (eventId: string, scope?: CalendarEventCompletionScope) => void;
  onToggleTask?: (taskId: string) => void;
  showContent?: boolean;
  allowStart?: boolean;
  allowEnd?: boolean;
  onGestureStart?: (pointer: PointerEvent<HTMLElement>, event: CalendarEventViewModel, kind?: CalendarGestureKind) => void;
  onResizeKey?: (event: CalendarEventViewModel, edge: "start" | "end", direction: -1 | 1) => void;
}): JSX.Element {
  const draggable = event.sourceKind !== "task" && event.canWrite !== false;

  return (
    <>
      <CalendarEventChip
        className={cx("h-full min-h-0", className)}
        draggable={draggable && !onGestureStart}
        event={event}
        eventCompletionDefaultScope={eventCompletionDefaultScope}
        labelVariant={labelVariant}
        onDragStart={draggable ? (dragEvent) => startCalendarEventDrag(dragEvent, event.id) : undefined}
        onPointerDown={onGestureStart ? (pointer) => onGestureStart(pointer, event) : undefined}
        onKeyDown={(keyEvent) => {
          if (!draggable) {
            return;
          }

          if (event.allDay && (keyEvent.key === "ArrowLeft" || keyEvent.key === "ArrowRight")) {
            keyEvent.preventDefault(); keyEvent.stopPropagation();
            onMoveEvent(event.id, addUtcMinutesIso(event.startsAt, (keyEvent.key === "ArrowRight" ? 1 : -1) * 1440), true);
            return;
          }
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
        onToggleEvent={onToggleEvent}
        onToggleTask={onToggleTask}
        showContent={showContent}
        size={event.allDay ? "compact" : "default"}
      />
      {draggable ? (["start", "end"] as const).filter(edge => edge === "start" ? allowStart && !!onGestureStart : allowEnd).map((edge) => (
        <button key={edge}
          aria-label={`Resize ${event.title} ${edge}`}
          className={event.allDay ? `calendar-month-resize calendar-month-resize-${edge}` : `calendar-event-resize-handle calendar-event-resize-${edge}`}
          draggable={!onGestureStart && edge === "end"}
          onDragStart={!onGestureStart ? (dragEvent) => startCalendarEventResizeDrag(dragEvent, event.id) : undefined}
          onPointerDown={onGestureStart ? (pointer) => onGestureStart(pointer, event, edge) : undefined}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(key) => {
            const negative = event.allDay ? "ArrowLeft" : "ArrowUp", positive = event.allDay ? "ArrowRight" : "ArrowDown";
            if (key.key !== negative && key.key !== positive) return;
            key.preventDefault(); key.stopPropagation(); onResizeKey?.(event, edge, key.key === positive ? 1 : -1);
          }}
          title={`Resize ${edge}: drag or use ${event.allDay ? "Left/Right" : "Up/Down"} arrow keys`}
          type="button"
        />
      )) : null}
    </>
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
    // A minimum card height spills short segments into the next appointment.
    // Preserve time geometry; short cards use a single compact title line.
    height: `${Math.max(1, height)}px`,
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

function timelinePreviewSegments(
  blocks: Array<Pick<CalendarTimeBlock, "id" | "startsAt" | "endsAt">>,
  days: Array<{ day: CalendarDayViewModel }>,
  hourRowHeight: number,
  timeZone: string
): Array<{ dayId: string; height: number; id: string; sourceId: string; top: number }> {
  return blocks.flatMap((block) => {
    const start = calendarLocalPoint(block.startsAt, timeZone);
    const end = calendarLocalPoint(block.endsAt, timeZone);

    return days.flatMap(({ day }) => {
      const dayKey = calendarDayKey(day);
      const startMinute = start.dayKey < dayKey ? 0 : start.dayKey > dayKey ? 1_440 : start.minutes;
      const endMinute = end.dayKey > dayKey ? 1_440 : end.dayKey < dayKey ? 0 : end.minutes;
      const clampedStart = Math.max(0, Math.min(1_440, startMinute));
      const clampedEnd = Math.max(0, Math.min(1_440, endMinute));

      if (clampedEnd <= clampedStart) {
        return [];
      }

      return [{
        dayId: day.id,
        height: Math.max(6, ((clampedEnd - clampedStart) / 60) * hourRowHeight),
        id: `${block.id}-${day.id}`,
        sourceId: block.id,
        top: (clampedStart / 60) * hourRowHeight
      }];
    });
  });
}

function CalendarTimelineView({
  availabilityMode = false,
  availabilitySlots = [],
  days,
  dayCountControl,
  eventCompletionDefaultScope,
  gridLabel,
  label,
  onAddAvailabilitySlot,
  onCreate,
  onMoveEvent,
  onOpen,
  onResizeEvent,
  onChangeEvent,
  onNavigate,
  onScrollPeriod,
  onToggleEvent,
  onToggleTask,
  smartScheduleGhostBlocks = [],
  timedLabelVariant = "time",
  visibleCalendarIds
}: {
  availabilityMode?: boolean;
  availabilitySlots?: CalendarTimeBlock[];
  days: CalendarDayViewModel[];
  dayCountControl?: ReactNode;
  eventCompletionDefaultScope?: EventCompletionDefaultScope;
  gridLabel: string;
  label: string;
  onAddAvailabilitySlot?: (slot: CalendarTimeBlock) => void;
  onCreate: (seed?: CalendarCreateSeed) => void;
  onMoveEvent: (eventId: string, startsAt: string, allDay: boolean) => void;
  onOpen: (event: CalendarEventViewModel) => void;
  onResizeEvent: (eventId: string, endsAt: string) => void;
  onChangeEvent?: (event: CalendarEventViewModel, range: CalendarEventRange) => void;
  onNavigate?: (direction: -1 | 1) => void;
  onScrollPeriod?: (direction: -1 | 1) => void;
  onToggleEvent?: (eventId: string, scope?: CalendarEventCompletionScope) => void;
  onToggleTask?: (taskId: string) => void;
  smartScheduleGhostBlocks?: SmartScheduleGhostBlock[];
  timedLabelVariant?: "range" | "time";
  visibleCalendarIds: ReadonlySet<string>;
}): JSX.Element {
  const source = useCoreViewModelSource();
  const [activeOverflow, setActiveOverflow] = useState<{
    events: CalendarEventViewModel[];
    title: string;
  } | null>(null);
  const [dragSelection, setDragSelection] = useState<CalendarTimeBlock | null>(null);
  const [dropPreview, setDropPreview] = useState<CalendarTimeBlock | null>(null);
  const [nowIso, setNowIso] = useState(() => new Date().toISOString());
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  useCalendarWheelNavigation(scrollContainerRef, "horizontal", onScrollPeriod);
  const paneId = useContext(PaneIdentity);
  const timeGridRef = useRef<HTMLDivElement | null>(null);
  const timelineDragRef = useRef<{
    dayKey: string;
    mode: "availability" | "create";
    moved: boolean;
    startClientY: number;
    startsAt: string;
  } | null>(null);
  const pendingDragSelectionRef = useRef<CalendarTimeBlock | null>(null);
  const dragSelectionFrameRef = useRef<number | null>(null);
  const suppressNextClickRef = useRef(false);
  const hourRowHeight = calendarTimelineHourHeight(source.settings.calendarTimelineDensity);
  const timeline = useMemo(
    () => visibleCalendarTimeline(days, visibleCalendarIds, hourRowHeight),
    [days, hourRowHeight, visibleCalendarIds]
  );
  const visibleDays = timeline.days;
  const cellKeys = useMemo(() => [-1, ...calendarTimelineHours].flatMap(hour => visibleDays.map(({ day }) => `${calendarDayKey(day)}:${hour}`)), [visibleDays]);
  const gridFocus = useCalendarGridFocus(cellKeys, visibleDays.length);
  const visibleDayKeys = visibleDays.map(({ day }) => calendarDayKey(day)).join("|");
  const scrollKey = `calendar.scroll:${gridLabel}:${visibleDayKeys}`;
  const currentPoint = useMemo(
    () => calendarLocalPoint(nowIso, source.settings.defaultTimeZone),
    [nowIso, source.settings.defaultTimeZone]
  );
  const currentDayIndex = visibleDays.findIndex(({ day }) => calendarDayKey(day) === currentPoint.dayKey);
  const currentTimeTop = (currentPoint.minutes / 60) * hourRowHeight;
  const hasAllDayOverflow = timeline.allDayOverflowCounts.some((count) => count > 0);
  const allDayRowHeight = Math.max(
    40,
    (Math.max(0, ...timeline.allDaySegments.map(segment => segment.laneIndex + 1)) + (hasAllDayOverflow ? 1 : 0)) * allDayLaneHeight + 12
  );
  const firstVisibleDayKey = visibleDays[0]
    ? calendarDayKey(visibleDays[0].day)
    : days[0]
      ? calendarDayKey(days[0])
      : calendarTodayKey();
  const dayColumnMinWidth = days.length <= 1 ? 240 : days.length <= 3 ? 140 : 84;
  const gridTemplateColumns = `repeat(${Math.max(1, days.length)}, minmax(${dayColumnMinWidth}px, 1fr))`;
  const initializedScrollView = useRef<string | undefined>(undefined);
  const edgeNavigation = useRef<{ direction: -1 | 1; at: number } | null>(null);
  const scrollSave = useRef<{ timer: ReturnType<typeof setTimeout> | null; key: string; top: number; left: number } | null>(null);
  function saveScroll(): void {
    const pending = scrollSave.current;
    if (!pending) return;
    if (pending.timer) clearTimeout(pending.timer);
    writePanePreference(paneId, pending.key, { top: pending.top, left: pending.left });
    scrollSave.current = null;
  }
  useEffect(() => () => saveScroll(), [paneId]);
  function gesturePoint(x: number, y: number) {
    const scroller = scrollContainerRef.current;
    const columns = scroller?.querySelectorAll<HTMLElement>("[data-calendar-day-events]");
    if (!scroller || !columns?.length) return null;
    const viewport = scroller.getBoundingClientRect();
    const allDay = scroller.querySelector<HTMLElement>("[data-calendar-all-day-events]")?.getBoundingClientRect();
    const inAllDay = Boolean(allDay && y >= allDay.top && y <= allDay.bottom);
    const index = [...columns].findIndex(column => { const rect = column.getBoundingClientRect(); return x >= rect.left && x <= rect.right; });
    const resolved = index >= 0 ? index : x < columns[0].getBoundingClientRect().left ? 0 : columns.length - 1;
    const day = visibleDays[resolved]?.day;
    if (!day) return null;
    if (inAllDay) return { day: calendarDayKey(day), allDay: true };
    const grid = timeGridRef.current?.getBoundingClientRect();
    if (!grid) return null;
    const clampedY = Math.min(viewport.bottom - 1, Math.max((allDay?.bottom ?? viewport.top) + 1, y));
    return { day: calendarDayKey(day), minutes: Math.max(0, Math.min(1440, Math.round((clampedY - grid.top) / hourRowHeight * 4) * 15)), allDay: false };
  }
  const gesture = useCalendarPointerGesture({
    locate: gesturePoint,
    resizeCursor: "ns-resize",
    onCommit: (event, range) => onChangeEvent?.(event, range),
    onFinish: () => { edgeNavigation.current = null; saveScroll(); },
    onEdge: (x, y) => {
      const node = scrollContainerRef.current;
      if (!node) return false;
      const rect = node.getBoundingClientRect();
      const allDay = node.querySelector<HTMLElement>("[data-calendar-all-day-events]")?.getBoundingClientRect();
      const top = allDay?.bottom ?? rect.top;
      let active = false;
      const before = node.scrollTop;
      if (y > rect.bottom - 36) node.scrollTop += Math.min(18, (y - rect.bottom + 36) / 2);
      else if (y > top && y < top + 36) node.scrollTop -= Math.min(18, (top + 36 - y) / 2);
      active = node.scrollTop !== before;
      const direction = x > rect.right - 28 ? 1 : x < rect.left + 80 ? -1 : 0;
      if (direction && onNavigate) {
        const beforeLeft = node.scrollLeft;
        node.scrollLeft += direction * 12;
        if (node.scrollLeft !== beforeLeft) { edgeNavigation.current = null; return true; }
        const now = performance.now(), current = edgeNavigation.current;
        if (!current || current.direction !== direction) edgeNavigation.current = { direction, at: now + 600 };
        else if (now >= current.at) { current.at = now + 800; onNavigate(direction); }
        active = true;
      } else edgeNavigation.current = null;
      return active;
    }
  });
  function openAfterGesture(event: CalendarEventViewModel): void { if (!gesture.consumeClick()) onOpen(event); }
  function resizeWithKey(event: CalendarEventViewModel, edge: "start" | "end", direction: -1 | 1): void {
    const point = calendarLocalPoint(edge === "start" ? event.startsAt : event.endsAt, event.displayTimeZone || event.timeZone);
    if (event.allDay) {
      const day = (edge === "start" ? event.startsAt : addUtcMinutesIso(event.endsAt, -1440)).slice(0, 10);
      onChangeEvent?.(event, calendarGestureRange(event, edge, { day }, { day: addUtcMinutesIso(`${day}T00:00:00Z`, direction * 1440).slice(0, 10) }));
    } else onChangeEvent?.(event, calendarGestureRange(event, edge, { day: point.dayKey, minutes: point.minutes }, { day: point.dayKey, minutes: point.minutes + direction * 15 }));
  }
  const previewSegments = timelinePreviewSegments(
    [
      ...availabilitySlots,
      ...(dragSelection ? [dragSelection] : []),
      ...(dropPreview ? [dropPreview] : []),
      ...(gesture.preview && !gesture.preview.allDay ? [calendarTimeBlock(gesture.preview.startsAt, gesture.preview.endsAt, source.settings.defaultTimeZone)] : [])
    ],
    visibleDays,
    hourRowHeight,
    source.settings.defaultTimeZone
  );
  const smartScheduleGhostSegments = useMemo(() => {
    const titles = new Map(smartScheduleGhostBlocks.map((block) => [block.id, block]));
    return timelinePreviewSegments(smartScheduleGhostBlocks, visibleDays, hourRowHeight, source.settings.defaultTimeZone)
      .flatMap((segment) => {
        const block = titles.get(segment.sourceId);
        return block ? [{ ...segment, stale: block.stale, title: block.title }] : [];
      });
  }, [hourRowHeight, smartScheduleGhostBlocks, source.settings.defaultTimeZone, visibleDays]);

  useEffect(() => {
    const timer = window.setInterval(() => setNowIso(new Date().toISOString()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => () => {
    if (dragSelectionFrameRef.current !== null) {
      window.cancelAnimationFrame(dragSelectionFrameRef.current);
    }
  }, []);

  useEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    const timeGrid = timeGridRef.current;

    if (!scrollContainer || !timeGrid) {
      return;
    }

    const firstVisit = initializedScrollView.current !== `${gridLabel}:${hourRowHeight}`;
    initializedScrollView.current = `${gridLabel}:${hourRowHeight}`;
    const frame = window.requestAnimationFrame(() => {
      if (document.body.dataset.calendarDragging) return;
      const saved = readPanePreference<{ top: number; left: number } | null>(paneId, scrollKey, null);
      if (saved) {
        scrollContainer.scrollTop = saved.top;
        scrollContainer.scrollLeft = saved.left;
        return;
      }
      if (!firstVisit || currentDayIndex < 0) return;
      const targetTop = timeGrid.offsetTop + currentTimeTop - scrollContainer.clientHeight * 0.35;
      scrollContainer.scrollTop = Math.max(0, targetTop);
    });

    return () => window.cancelAnimationFrame(frame);
  }, [currentDayIndex, currentPoint.dayKey, gridLabel, hourRowHeight, visibleDayKeys, paneId, scrollKey]);

  function handleDrop(
    dragEvent: DragEvent<HTMLElement>,
    dayKey: string,
    startsAt: string,
    allDay: boolean
  ): void {
    dragEvent.preventDefault();
    dragEvent.stopPropagation();
    setDropPreview(null);
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

  function previewDrop(
    dragEvent: DragEvent<HTMLElement>,
    dayKey: string,
    startsAt: string,
    allDay: boolean
  ): void {
    allowCalendarDrop(dragEvent);
    if (dragEvent.defaultPrevented === false) {
      return;
    }

    const resizeEventId = calendarEventResizeDragId(dragEvent);

    if (resizeEventId) {
      const event = source.calendarEventsById[resizeEventId];

      if (event) {
        setDropPreview(calendarTimeBlock(event.startsAt, startsAt, event.displayTimeZone || event.timeZone || source.settings.defaultTimeZone));
      }
      return;
    }

    const eventId = calendarEventDragId(dragEvent);
    const event = eventId ? source.calendarEventsById[eventId] : undefined;

    if (!event) {
      return;
    }

    const durationMs = Math.max(15 * 60 * 1000, Date.parse(event.endsAt) - Date.parse(event.startsAt));
    const nextStartsAt = allDay
      ? `${dayKey}T00:00:00.000Z`
      : startsAt;
    const nextEndsAt = allDay
      ? addUtcMinutesIso(nextStartsAt, 24 * 60)
      : new Date(Date.parse(nextStartsAt) + durationMs).toISOString();

    setDropPreview(calendarTimeBlock(nextStartsAt, nextEndsAt, event.displayTimeZone || event.timeZone || source.settings.defaultTimeZone));
  }

  function dayKeyForAllDayDrag(dragEvent: DragEvent<HTMLElement>): string | null {
    const container = dragEvent.currentTarget.closest<HTMLElement>("[data-calendar-all-day-events]");
    const rect = container?.getBoundingClientRect();

    if (!rect || visibleDays.length === 0) {
      return null;
    }

    const clientX = Number.isFinite(dragEvent.clientX) ? dragEvent.clientX : rect.left;
    const offset = Math.min(Math.max(clientX - rect.left, 0), Math.max(1, rect.width) - 1);
    const index = Math.min(visibleDays.length - 1, Math.floor((offset / Math.max(1, rect.width)) * visibleDays.length));
    const day = visibleDays[index]?.day;
    return day ? calendarDayKey(day) : null;
  }

  function startIsoForTimedDrag(dragEvent: DragEvent<HTMLElement>, dayKey: string): string | null {
    const container = dragEvent.currentTarget.closest<HTMLElement>("[data-calendar-day-events]");
    const rect = container?.getBoundingClientRect();

    if (!rect) {
      return null;
    }

    const clientY = Number.isFinite(dragEvent.clientY) ? dragEvent.clientY : rect.top;
    const offset = Math.min(Math.max(clientY - rect.top, 0), Math.max(1, rect.height) - 1);
    const totalMinutes = Math.min(
      23 * 60 + 45,
      Math.max(0, Math.floor(((offset / Math.max(1, rect.height)) * 24 * 60) / 15) * 15)
    );

    return zonedDateTimeIso(
      dayKey,
      Math.floor(totalMinutes / 60),
      totalMinutes % 60,
      source.settings.defaultTimeZone
    );
  }

  function previewAllDayEventDrop(dragEvent: DragEvent<HTMLElement>): void {
    const dayKey = dayKeyForAllDayDrag(dragEvent);

    if (dayKey) {
      previewDrop(dragEvent, dayKey, `${dayKey}T00:00:00.000Z`, true);
    }
  }

  function handleAllDayEventDrop(dragEvent: DragEvent<HTMLElement>): void {
    const dayKey = dayKeyForAllDayDrag(dragEvent);

    if (dayKey) {
      handleDrop(dragEvent, dayKey, `${dayKey}T00:00:00.000Z`, true);
    }
  }

  function previewTimedEventDrop(dragEvent: DragEvent<HTMLElement>, dayKey: string): void {
    const startsAt = startIsoForTimedDrag(dragEvent, dayKey);

    if (startsAt) {
      previewDrop(dragEvent, dayKey, startsAt, false);
    }
  }

  function handleTimedEventDrop(dragEvent: DragEvent<HTMLElement>, dayKey: string): void {
    const startsAt = startIsoForTimedDrag(dragEvent, dayKey);

    if (startsAt) {
      handleDrop(dragEvent, dayKey, startsAt, false);
    }
  }

  function scheduleDragSelection(nextSelection: CalendarTimeBlock): void {
    pendingDragSelectionRef.current = nextSelection;
    if (dragSelectionFrameRef.current !== null) return;

    dragSelectionFrameRef.current = window.requestAnimationFrame(() => {
      dragSelectionFrameRef.current = null;
      const pending = pendingDragSelectionRef.current;
      pendingDragSelectionRef.current = null;
      if (!pending) return;
      setDragSelection((current) => current?.id === pending.id ? current : pending);
    });
  }

  function clearDragSelection(): void {
    pendingDragSelectionRef.current = null;
    if (dragSelectionFrameRef.current !== null) {
      window.cancelAnimationFrame(dragSelectionFrameRef.current);
      dragSelectionFrameRef.current = null;
    }
    setDragSelection(null);
  }

  function updateTimeDrag(
    pointerEvent: PointerEvent<HTMLElement>,
    dayKey: string,
    hour: number
  ): CalendarTimeBlock | null {
    const drag = timelineDragRef.current;

    if (!drag || (pointerEvent.buttons !== 1 && pointerEvent.type !== "pointerup")) {
      return null;
    }

    pointerEvent.preventDefault();
    const pointerAt = calendarPointerTimeIso(dayKey, hour, pointerEvent, source.settings.defaultTimeZone);
    const nextSelection = calendarTimeBlock(drag.startsAt, pointerAt, source.settings.defaultTimeZone);

    if (
      Math.abs(pointerEvent.clientY - drag.startClientY) > 4 ||
      nextSelection.startsAt !== drag.startsAt ||
      Date.parse(nextSelection.endsAt) - Date.parse(nextSelection.startsAt) > 15 * 60 * 1000
    ) {
      drag.moved = true;
    }

    scheduleDragSelection(nextSelection);
    return nextSelection;
  }

  function handleTimePointerDown(
    pointerEvent: PointerEvent<HTMLElement>,
    dayKey: string,
    hour: number
  ): void {
    if (!pointerEvent.isPrimary || pointerEvent.button !== 0) {
      return;
    }

    pointerEvent.preventDefault();
    const startsAt = calendarPointerTimeIso(dayKey, hour, pointerEvent, source.settings.defaultTimeZone);
    const initialSelection = calendarTimeBlock(startsAt, startsAt, source.settings.defaultTimeZone);

    timelineDragRef.current = {
      dayKey,
      mode: availabilityMode ? "availability" : "create",
      moved: false,
      startClientY: pointerEvent.clientY,
      startsAt
    };
    scheduleDragSelection(initialSelection);
  }

  function handleTimePointerUp(
    pointerEvent: PointerEvent<HTMLElement>,
    dayKey: string,
    hour: number
  ): void {
    const drag = timelineDragRef.current;

    if (!drag) {
      return;
    }

    const finalSelection = updateTimeDrag(pointerEvent, dayKey, hour) ?? dragSelection;
    timelineDragRef.current = null;
    clearDragSelection();

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
    <div className="calendar-timeline flex h-full min-h-0 flex-col overflow-hidden bg-bg-primary">
      {dayCountControl ? (
        <div className="flex min-h-10 items-center justify-end border-b border-border bg-bg-primary/40 px-3 py-1.5">
          {dayCountControl}
        </div>
      ) : null}
      <div
        className="min-h-0 flex-1 overflow-auto"
        data-calendar-timeline-scroll
        onScroll={(event) => {
          if (scrollSave.current?.timer) clearTimeout(scrollSave.current.timer);
          scrollSave.current = { key: scrollKey, top: event.currentTarget.scrollTop, left: event.currentTarget.scrollLeft, timer: setTimeout(saveScroll, 160) };
        }}
        ref={scrollContainerRef}
        role="grid"
        aria-description="Use arrow keys to move between days and hours, Home or End for a row, and Enter to create an event. Tab moves to event controls."
        aria-label={gridLabel}
      >
        <div style={{ minWidth: `${64 + dayColumnMinWidth * Math.max(1, days.length)}px` }}>
          <div className="calendar-timeline-head sticky top-0 z-40 grid grid-cols-[64px_minmax(0,1fr)] border-b border-border bg-bg-primary">
            <div className="calendar-zone" title={source.settings.defaultTimeZone}>{new Intl.DateTimeFormat("en", { timeZone: source.settings.defaultTimeZone, timeZoneName: "shortOffset" }).formatToParts(new Date()).find(part => part.type === "timeZoneName")?.value}</div>
            <div className="grid" style={{ gridTemplateColumns }}>
              {visibleDays.map(({ day }) => (
                <div
                  className="calendar-day-heading"
                  key={day.id}
                  role="columnheader"
                >
                  <div className="text-[var(--text-xs)] font-semibold text-text-muted">{day.weekday}</div>
                  <div
                    className={cx(
                      "calendar-day-number",
                      day.isToday && "bg-accent text-[var(--color-accent-foreground)]"
                    )}
                  >
                    {day.dateLabel}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div
            className="calendar-all-day-row sticky top-11 z-[35] grid grid-cols-[64px_minmax(0,1fr)] border-b border-border bg-bg-primary"
            style={{ minHeight: allDayRowHeight }}
          >
            <div className="border-r border-border px-2 py-3 text-[var(--text-xs)] font-semibold text-text-muted">
              All-day
            </div>
            <div
              aria-label={`All-day events ${label}`}
              className="relative"
              data-calendar-all-day-events
              role="group"
              style={{ minHeight: allDayRowHeight }}
            >
              <div className="absolute inset-0 grid" style={{ gridTemplateColumns }}>
                {visibleDays.map(({ day }) => {
                  const dayKey = calendarDayKey(day);

                  return (
                    <div
                      className="border-r border-border bg-bg-tertiary last:border-r-0 hover:bg-surface-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                      data-calendar-all-day-date={dayKey}
                      data-calendar-drop-preview={Boolean(gesture.preview?.allDay && dayKey >= gesture.preview.startsAt.slice(0, 10) && dayKey < gesture.preview.endsAt.slice(0, 10))}
                      key={day.id}
                      onClick={() => {
                        if (!availabilityMode) {
                          onCreate({ startsAt: `${dayKey}T00:00:00.000Z`, allDay: true });
                        }
                      }}
                      onDragOver={(dragEvent) =>
                        previewDrop(dragEvent, dayKey, `${dayKey}T00:00:00.000Z`, true)
                      }
                      onDrop={(dragEvent) =>
                        handleDrop(dragEvent, dayKey, `${dayKey}T00:00:00.000Z`, true)
                      }
                      onKeyDown={(event) => {
                        if (gridFocus.onKeyDown(event)) return;
                        if (!availabilityMode) handleActivationKeyDown(event, () =>
                              onCreate({ startsAt: `${dayKey}T00:00:00.000Z`, allDay: true })
                            );
                      }}
                      role="gridcell"
                      aria-label={`All day ${calendarDateTitle(day)}`}
                      {...gridFocus.cellProps(`${dayKey}:-1`)}
                    />
                  );
                })}
              </div>
              <div
                className="pointer-events-none relative grid gap-y-1 py-2"
                style={{
                  gridTemplateColumns,
                  gridTemplateRows: `repeat(${
                    Math.max(1, ...timeline.allDaySegments.map(segment => segment.laneIndex + 1)) + (hasAllDayOverflow ? 1 : 0)
                  }, ${allDayLaneHeight}px)`,
                  minHeight: allDayRowHeight
                }}
              >
                {timeline.allDaySegments.map((segment) => (
                  <div
                    className="calendar-all-day-event relative pointer-events-auto min-w-0 px-2"
                    data-calendar-all-day-segment={segment.event.id}
                    data-day-span={segment.daySpan}
                    data-ends-after-range={segment.endsAfterRange}
                    data-lane-index={segment.laneIndex}
                    data-start-day-index={segment.startDayIndex}
                    data-starts-before-range={segment.startsBeforeRange}
                    key={segment.event.id}
                    onDragOver={previewAllDayEventDrop}
                    onDrop={handleAllDayEventDrop}
                    style={allDaySegmentStyle(segment)}
                  >
                    <CalendarTimelineEventChip
                      event={segment.event}
                      eventCompletionDefaultScope={eventCompletionDefaultScope}
                      labelVariant="title"
                      allowStart={!segment.startsBeforeRange}
                      allowEnd={!segment.endsAfterRange}
                      onMoveEvent={onMoveEvent}
                      onOpen={openAfterGesture}
                      onGestureStart={onChangeEvent ? gesture.begin : undefined}
                      onResizeKey={resizeWithKey}
                      onToggleEvent={onToggleEvent}
                      onToggleTask={onToggleTask}
                    />
                  </div>
                ))}
                {timeline.allDayOverflowCounts.map((count, dayIndex) => {
                  const visibleDay = visibleDays[dayIndex];
                  const day = visibleDay?.day;
                  const popupEvents = visibleDay?.allDayEvents ?? [];

                  return count > 0 && day ? (
                    <div
                      className="pointer-events-auto min-w-0 px-2"
                      key={`${visibleDays[dayIndex]?.day.id ?? dayIndex}-overflow`}
                      style={{
                        gridColumn: `${dayIndex + 1}`,
                        gridRow: `${calendarTimelineVisibleAllDayCount + 1}`
                      }}
                    >
                      <CalendarOverflowChip
                        count={count}
                        onOpen={() =>
                          setActiveOverflow({
                            events: popupEvents,
                            title: calendarContextualDateTitleFromIso(calendarDayKey(day))
                          })
                        }
                      />
                    </div>
                  ) : null;
                })}
              </div>
            </div>
          </div>
          <div className="relative" ref={timeGridRef}>
            {calendarTimelineHours.map((hour) => (
              <div
                aria-label={`${hourSlotLabel(hour)} Open slot`}
                className="grid grid-cols-[64px_minmax(0,1fr)] border-b border-border last:border-b-0"
                key={hour}
                onDragLeave={() => setDropPreview(null)}
                onDragOver={(dragEvent) =>
                  previewDrop(
                    dragEvent,
                    firstVisibleDayKey,
                    hourSlotIso(firstVisibleDayKey, hour, source.settings.defaultTimeZone),
                    false
                  )
                }
                onDrop={(dragEvent) =>
                  handleDrop(
                    dragEvent,
                    firstVisibleDayKey,
                    hourSlotIso(firstVisibleDayKey, hour, source.settings.defaultTimeZone),
                    false
                  )
                }
                role="row"
                style={{ height: hourRowHeight }}
              >
                <div className="calendar-hour-label border-r border-border px-2 py-2 text-right text-[var(--text-xs)] text-text-muted">
                  {calendarDisplayHourLabel(hour)}
                </div>
                <div className="grid" style={{ gridTemplateColumns }}>
                  {visibleDays.map(({ day }) => {
                    const dayKey = calendarDayKey(day);
                    const startsAt = hourSlotIso(dayKey, hour, source.settings.defaultTimeZone);

                    return (
                      <div
                        aria-label={`${calendarDateTitle(day)} ${calendarDisplayHourLabel(hour)}`}
                        className="border-r border-border bg-bg-tertiary px-2 py-1.5 last:border-r-0 hover:bg-surface-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
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
                        onDragOver={(dragEvent) => previewDrop(dragEvent, dayKey, startsAt, false)}
                        onDrop={(dragEvent) => handleDrop(dragEvent, dayKey, startsAt, false)}
                        onPointerDown={(pointerEvent) => handleTimePointerDown(pointerEvent, dayKey, hour)}
                        onPointerEnter={(pointerEvent) => {
                          if (timelineDragRef.current) {
                            updateTimeDrag(pointerEvent, dayKey, hour);
                          }
                        }}
                        onPointerMove={(pointerEvent) => updateTimeDrag(pointerEvent, dayKey, hour)}
                        onPointerUp={(pointerEvent) => handleTimePointerUp(pointerEvent, dayKey, hour)}
                        onPointerCancel={() => {
                          timelineDragRef.current = null;
                          clearDragSelection();
                        }}
                        onKeyDown={(event) => {
                          if (gridFocus.onKeyDown(event)) return;
                          if (!availabilityMode) handleActivationKeyDown(event, () =>
                                onCreate({
                                  allDay: false,
                                  startsAt,
                                  endsAt: addUtcMinutesIso(startsAt, 60)
                                })
                              );
                        }}
                        role="gridcell"
                        {...gridFocus.cellProps(`${dayKey}:${hour}`)}
                      >
                        {!availabilityMode ? (
                          <button
                            aria-label={`Create event at ${hourSlotLabel(hour)}`}
                            className="sr-only"
                            tabIndex={-1}
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
              {visibleDays.map(({ day }) => (
                <div className="relative min-w-0 border-r border-transparent last:border-r-0" key={`${day.id}-previews`}>
                {previewSegments
                    .filter((segment) => segment.dayId === day.id)
                    .map((segment) => (
                      <div
                        className="absolute left-2 right-2 rounded-hcbSm border border-info bg-info/15"
                        data-calendar-drop-preview
                        key={segment.id}
                        style={{ height: segment.height, top: segment.top }}
                      />
                    ))}
                  {smartScheduleGhostSegments
                    .filter((segment) => segment.dayId === day.id)
                    .map((segment) => (
                      <div
                        className={cx(
                          "absolute left-2 right-2 overflow-hidden rounded-hcbSm border border-dashed border-accent bg-accent/10 px-1.5 py-0.5 text-[11px] leading-tight text-accent",
                          segment.stale && "opacity-35"
                        )}
                        data-calendar-smart-schedule-ghost={segment.stale ? "stale" : "current"}
                        key={`smart-${segment.id}`}
                        style={{ height: segment.height, top: segment.top }}
                        title={`${segment.stale ? "Outdated proposal" : "Proposed schedule"}: ${segment.title}`}
                      >
                        {segment.height >= 22 ? <span className="block truncate">{segment.title}</span> : null}
                      </div>
                    ))}
                </div>
              ))}
            </div>
            <div
              className="pointer-events-none absolute bottom-0 left-16 right-0 top-0 grid"
              style={{ gridTemplateColumns }}
            >
              {visibleDays.map(({ day, timedEventLayouts }) => (
                <div
                  className="relative min-w-0 border-r border-transparent last:border-r-0"
                  data-calendar-day-events
                  data-calendar-date={calendarDayKey(day)}
                  key={`${day.id}-events`}
                >
                  {timedEventLayouts.flatMap((layout) => {
                    if (layout.segments.length === 0) return [];
                    const contentSegment = layout.segments.reduce((best, segment) =>
                      segment.height / Math.max(1, segment.laneCount) > best.height / Math.max(1, best.laneCount)
                        ? segment
                        : best
                    , layout.segments[0]!);

                    return layout.segments.map((segment) => (
                      <div
                        className="pointer-events-auto absolute min-w-0"
                        data-calendar-event-layout={layout.event.id}
                        data-duration-minutes={segment.durationMinutes}
                        data-lane-count={segment.laneCount}
                        data-lane-index={segment.laneIndex}
                        data-start-minute={segment.startMinute}
                        key={`${layout.event.id}-${segment.startMinute}-${segment.durationMinutes}`}
                        onDragOver={(dragEvent) => previewTimedEventDrop(dragEvent, calendarDayKey(day))}
                        onDrop={(dragEvent) => handleTimedEventDrop(dragEvent, calendarDayKey(day))}
                        style={timelineEventStyle(segment)}
                      >
                        <CalendarTimelineEventChip
                          className={cx("min-w-0", segment.height < 40 && "calendar-event-short")}
                          event={layout.event}
                          eventCompletionDefaultScope={eventCompletionDefaultScope}
                          labelVariant={timedLabelVariant}
                          allowStart={segment === layout.segments[0] && calendarLocalPoint(layout.event.startsAt, source.settings.defaultTimeZone).dayKey === calendarDayKey(day)}
                          allowEnd={segment === layout.segments[layout.segments.length - 1] && (calendarLocalPoint(layout.event.endsAt, source.settings.defaultTimeZone).dayKey === calendarDayKey(day) || calendarLocalPoint(addUtcMinutesIso(layout.event.endsAt, -1), source.settings.defaultTimeZone).dayKey === calendarDayKey(day))}
                          onMoveEvent={onMoveEvent}
                          onOpen={openAfterGesture}
                          onGestureStart={onChangeEvent ? gesture.begin : undefined}
                          onResizeKey={resizeWithKey}
                          onToggleEvent={onToggleEvent}
                          onToggleTask={onToggleTask}
                          showContent={segment === contentSegment}
                        />
                      </div>
                    ));
                  })}
                </div>
              ))}
            </div>
            {currentDayIndex >= 0 ? <div aria-hidden="true" className="calendar-now-guide" style={{ top: currentTimeTop }}><span>{new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", timeZone: source.settings.defaultTimeZone }).format(new Date(nowIso))}</span></div> : null}
            {currentDayIndex >= 0 ? (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute bottom-0 left-16 right-0 top-0 z-30 grid"
                style={{ gridTemplateColumns }}
              >
                {visibleDays.map(({ day }, dayIndex) => (
                  <div className="relative min-w-0" key={`${day.id}-now-line`}>
                    {dayIndex === currentDayIndex ? (
                      <div
                        className="absolute left-0 right-0"
                        data-calendar-now-line
                        data-calendar-now-minute={currentPoint.minutes}
                        style={{ top: currentTimeTop }}
                      >
                        <span className="absolute -left-1.5 -top-1 block size-2.5 rounded-full bg-accent" />
                        <span className="block h-[3px] bg-accent" />
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </div>
      {gesture.preview ? <div className="calendar-gesture-status" role="status" data-calendar-gesture-preview>
        {gesture.preview.event.title}: {gesture.preview.allDay
          ? `${gesture.preview.startsAt.slice(0, 10)} – ${addUtcMinutesIso(gesture.preview.endsAt, -1440).slice(0, 10)} (all day)`
          : `${new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short", timeZone: source.settings.defaultTimeZone }).format(new Date(gesture.preview.startsAt))} – ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short", timeZone: source.settings.defaultTimeZone }).format(new Date(gesture.preview.endsAt))}`}. Release to save; Escape to cancel.
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

export function DayView({
  availabilityMode,
  availabilitySlots,
  day,
  eventCompletionDefaultScope,
  onAddAvailabilitySlot,
  onCreate,
  onMoveEvent,
  onOpen,
  onResizeEvent,
  onChangeEvent,
  onNavigate,
  onScrollPeriod,
  onToggleEvent,
  onToggleTask,
  smartScheduleGhostBlocks,
  visibleCalendarIds
}: {
  availabilityMode: boolean;
  availabilitySlots: CalendarTimeBlock[];
  day: CalendarDayViewModel;
  eventCompletionDefaultScope?: EventCompletionDefaultScope;
  onAddAvailabilitySlot: (slot: CalendarTimeBlock) => void;
  onCreate: (seed?: CalendarCreateSeed) => void;
  onMoveEvent: (eventId: string, startsAt: string, allDay: boolean) => void;
  onOpen: (event: CalendarEventViewModel) => void;
  onResizeEvent: (eventId: string, endsAt: string) => void;
  onChangeEvent?: (event: CalendarEventViewModel, range: CalendarEventRange) => void;
  onNavigate?: (direction: -1 | 1) => void;
  onScrollPeriod?: (direction: -1 | 1) => void;
  onToggleEvent?: (eventId: string, scope?: CalendarEventCompletionScope) => void;
  onToggleTask?: (taskId: string) => void;
  smartScheduleGhostBlocks?: SmartScheduleGhostBlock[];
  visibleCalendarIds: ReadonlySet<string>;
}): JSX.Element {
  return (
    <CalendarTimelineView
      availabilityMode={availabilityMode}
      availabilitySlots={availabilitySlots}
      days={[day]}
      eventCompletionDefaultScope={eventCompletionDefaultScope}
      gridLabel="Calendar day view"
      label={calendarDateTitle(day)}
      onAddAvailabilitySlot={onAddAvailabilitySlot}
      onCreate={onCreate}
      onMoveEvent={onMoveEvent}
      onOpen={onOpen}
      onResizeEvent={onResizeEvent}
      onChangeEvent={onChangeEvent}
      onNavigate={onNavigate}
      onScrollPeriod={onScrollPeriod}
      onToggleEvent={onToggleEvent}
      onToggleTask={onToggleTask}
      smartScheduleGhostBlocks={smartScheduleGhostBlocks}
      timedLabelVariant="range"
      visibleCalendarIds={visibleCalendarIds}
    />
  );
}

export function MultiDayView({
  availabilityMode,
  availabilitySlots,
  dayCount,
  days,
  eventCompletionDefaultScope,
  onAddAvailabilitySlot,
  onCreate,
  onDayCountChange,
  onMoveEvent,
  onOpen,
  onResizeEvent,
  onChangeEvent,
  onNavigate,
  onScrollPeriod,
  onToggleEvent,
  onToggleTask,
  smartScheduleGhostBlocks,
  visibleCalendarIds
}: {
  availabilityMode: boolean;
  availabilitySlots: CalendarTimeBlock[];
  dayCount: number;
  days: CalendarDayViewModel[];
  eventCompletionDefaultScope?: EventCompletionDefaultScope;
  onAddAvailabilitySlot: (slot: CalendarTimeBlock) => void;
  onCreate: (seed?: CalendarCreateSeed) => void;
  onDayCountChange: (dayCount: number) => void;
  onMoveEvent: (eventId: string, startsAt: string, allDay: boolean) => void;
  onOpen: (event: CalendarEventViewModel) => void;
  onResizeEvent: (eventId: string, endsAt: string) => void;
  onChangeEvent?: (event: CalendarEventViewModel, range: CalendarEventRange) => void;
  onNavigate?: (direction: -1 | 1) => void;
  onScrollPeriod?: (direction: -1 | 1) => void;
  onToggleEvent?: (eventId: string, scope?: CalendarEventCompletionScope) => void;
  onToggleTask?: (taskId: string) => void;
  smartScheduleGhostBlocks?: SmartScheduleGhostBlock[];
  visibleCalendarIds: ReadonlySet<string>;
}): JSX.Element {
  return (
    <CalendarTimelineView
      availabilityMode={availabilityMode}
      availabilitySlots={availabilitySlots}
      days={days}
      eventCompletionDefaultScope={eventCompletionDefaultScope}
      gridLabel="Calendar multi-day view"
      label={calendarRangeTitle(days)}
      onAddAvailabilitySlot={onAddAvailabilitySlot}
      onCreate={onCreate}
      onMoveEvent={onMoveEvent}
      onOpen={onOpen}
      onResizeEvent={onResizeEvent}
      onChangeEvent={onChangeEvent}
      onNavigate={onNavigate}
      onScrollPeriod={onScrollPeriod}
      onToggleEvent={onToggleEvent}
      onToggleTask={onToggleTask}
      smartScheduleGhostBlocks={smartScheduleGhostBlocks}
      visibleCalendarIds={visibleCalendarIds}
    />
  );
}

export function WeekView({
  availabilityMode,
  availabilitySlots,
  days,
  eventCompletionDefaultScope,
  onAddAvailabilitySlot,
  onCreate,
  onMoveEvent,
  onOpen,
  onResizeEvent,
  onChangeEvent,
  onNavigate,
  onScrollPeriod,
  onToggleEvent,
  onToggleTask,
  smartScheduleGhostBlocks,
  visibleCalendarIds
}: {
  availabilityMode: boolean;
  availabilitySlots: CalendarTimeBlock[];
  days: CalendarDayViewModel[];
  eventCompletionDefaultScope?: EventCompletionDefaultScope;
  onAddAvailabilitySlot: (slot: CalendarTimeBlock) => void;
  onCreate: (seed?: CalendarCreateSeed) => void;
  onMoveEvent: (eventId: string, startsAt: string, allDay: boolean) => void;
  onOpen: (event: CalendarEventViewModel) => void;
  onResizeEvent: (eventId: string, endsAt: string) => void;
  onChangeEvent?: (event: CalendarEventViewModel, range: CalendarEventRange) => void;
  onNavigate?: (direction: -1 | 1) => void;
  onScrollPeriod?: (direction: -1 | 1) => void;
  onToggleEvent?: (eventId: string, scope?: CalendarEventCompletionScope) => void;
  onToggleTask?: (taskId: string) => void;
  smartScheduleGhostBlocks?: SmartScheduleGhostBlock[];
  visibleCalendarIds: ReadonlySet<string>;
}): JSX.Element {
  return (
    <CalendarTimelineView
      availabilityMode={availabilityMode}
      availabilitySlots={availabilitySlots}
      days={days}
      eventCompletionDefaultScope={eventCompletionDefaultScope}
      gridLabel="Calendar week view"
      label={calendarRangeTitle(days)}
      onAddAvailabilitySlot={onAddAvailabilitySlot}
      onCreate={onCreate}
      onMoveEvent={onMoveEvent}
      onOpen={onOpen}
      onResizeEvent={onResizeEvent}
      onChangeEvent={onChangeEvent}
      onNavigate={onNavigate}
      onScrollPeriod={onScrollPeriod}
      onToggleEvent={onToggleEvent}
      onToggleTask={onToggleTask}
      smartScheduleGhostBlocks={smartScheduleGhostBlocks}
      visibleCalendarIds={visibleCalendarIds}
    />
  );
}
