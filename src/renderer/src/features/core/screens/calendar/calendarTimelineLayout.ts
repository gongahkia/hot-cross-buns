import type { CalendarDayViewModel, CalendarEventViewModel } from "../../coreViewModels";
import type {
  CalendarDaySlot,
  CalendarTimelineAllDaySegment,
  CalendarTimelineEventLayout,
  CalendarTimelineEventSegment,
  VisibleCalendarDay,
  VisibleCalendarTimeline,
  VisibleCalendarTimelineDay
} from "./types";
import {
  calendarTimelineHourRowHeight,
  calendarTimelineVisibleAllDayCount,
  dayPlanningHours
} from "./calendarConstants";
import {
  calendarAddUtcDays,
  calendarDayKey,
  calendarLocalPoint,
  calendarUtcDayOffset,
  compareCalendarLocalPoints,
  hourSlotIso,
  hourSlotLabel
} from "./calendarDateUtils";
import { calendarEventRangeDayKeys } from "./calendarEventIndex";
import { splitAllDayEvents, visibleCalendarEvent } from "./calendarVisibility";

function eventOverlapsHour(event: CalendarEventViewModel, day: string, hour: number): boolean {
  const timeZone = event.timeZone || "UTC";
  const startsAt = calendarLocalPoint(event.startsAt, timeZone);
  const endsAt = calendarLocalPoint(event.endsAt, timeZone);
  const hourStart = { dayKey: day, minutes: hour * 60 };
  const hourEnd =
    hour >= 23
      ? { dayKey: calendarAddUtcDays(day, 1), minutes: 0 }
      : { dayKey: day, minutes: (hour + 1) * 60 };

  return compareCalendarLocalPoints(startsAt, hourEnd) < 0 && compareCalendarLocalPoints(endsAt, hourStart) > 0;
}

function visibleCalendarDay(
  day: CalendarDayViewModel,
  visibleCalendarIds: ReadonlySet<string>
): VisibleCalendarDay {
  const visibleEvents = day.events.filter((event) => visibleCalendarEvent(event, visibleCalendarIds));
  const { allDayEvents, timedEvents } = splitAllDayEvents(visibleEvents);

  return {
    allDayEvents,
    day,
    timedEvents,
    visibleEvents
  };
}

export function visibleCalendarTimelineDays(
  days: CalendarDayViewModel[],
  visibleCalendarIds: ReadonlySet<string>,
  hourRowHeight = calendarTimelineHourRowHeight
): VisibleCalendarTimelineDay[] {
  return days.map((day) => {
    const visibleDay = visibleCalendarDay(day, visibleCalendarIds);
    const dayKey = calendarDayKey(day);

    return {
      ...visibleDay,
      timedEventLayouts: calendarTimelineEventLayouts(visibleDay.timedEvents, dayKey, hourRowHeight)
    };
  });
}

export function visibleCalendarTimeline(
  days: CalendarDayViewModel[],
  visibleCalendarIds: ReadonlySet<string>,
  hourRowHeight = calendarTimelineHourRowHeight
): VisibleCalendarTimeline {
  const visibleDays = visibleCalendarTimelineDays(days, visibleCalendarIds, hourRowHeight);
  const allDayLayout = calendarAllDayLayout(
    visibleDays.map(({ day }) => day),
    visibleCalendarIds,
    calendarTimelineVisibleAllDayCount
  );

  return {
    allDayOverflowCounts: allDayLayout.overflowCounts,
    allDaySegments: allDayLayout.segments,
    days: visibleDays
  };
}

export function calendarAllDayLayout(
  days: CalendarDayViewModel[],
  visibleCalendarIds: ReadonlySet<string>,
  visibleLaneCount: number
): { overflowCounts: number[]; overflowEvents: CalendarEventViewModel[][]; segments: CalendarTimelineAllDaySegment[] } {
  const dayKeys = days.map(calendarDayKey);
  const firstDayKey = dayKeys[0];
  const lastDayKey = dayKeys.at(-1);
  const uniqueEvents = new Map<string, CalendarEventViewModel>();

  if (!firstDayKey || !lastDayKey) {
    return { overflowCounts: [], overflowEvents: [], segments: [] };
  }

  for (const day of days) {
    for (const event of day.events) {
      if (event.allDay && visibleCalendarEvent(event, visibleCalendarIds)) {
        uniqueEvents.set(event.id, event);
      }
    }
  }

  const candidates = [...uniqueEvents.values()]
    .map((event) => {
      const range = calendarEventRangeDayKeys(event);
      const eventStartDay = range[0];
      const eventEndDay = range.at(-1);

      if (!eventStartDay || !eventEndDay || eventEndDay < firstDayKey || eventStartDay > lastDayKey) {
        return null;
      }

      const startDayIndex = Math.max(0, calendarUtcDayOffset(firstDayKey, eventStartDay));
      const endDayIndex = Math.min(days.length - 1, calendarUtcDayOffset(firstDayKey, eventEndDay));

      if (startDayIndex > endDayIndex) {
        return null;
      }

      return {
        daySpan: endDayIndex - startDayIndex + 1,
        endDayIndex,
        endsAfterRange: eventEndDay > lastDayKey,
        event,
        startDayIndex,
        startsBeforeRange: eventStartDay < firstDayKey
      };
    })
    .filter((candidate): candidate is Omit<CalendarTimelineAllDaySegment, "laneIndex"> & {
      endDayIndex: number;
    } => candidate !== null)
    .sort(
      (left, right) =>
        left.startDayIndex - right.startDayIndex ||
        right.daySpan - left.daySpan ||
        left.event.startsAt.localeCompare(right.event.startsAt) ||
        left.event.endsAt.localeCompare(right.event.endsAt) ||
        left.event.id.localeCompare(right.event.id)
    );
  const laneEnds: number[] = [];
  const overflowCounts = Array.from({ length: days.length }, () => 0);
  const overflowEvents = Array.from({ length: days.length }, () => [] as CalendarEventViewModel[]);
  const segments: CalendarTimelineAllDaySegment[] = [];

  for (const candidate of candidates) {
    let laneIndex = laneEnds.findIndex((endDayIndex) => endDayIndex < candidate.startDayIndex);

    if (laneIndex < 0) {
      laneIndex = laneEnds.length;
      laneEnds.push(candidate.endDayIndex);
    } else {
      laneEnds[laneIndex] = candidate.endDayIndex;
    }

    if (laneIndex >= visibleLaneCount) {
      for (let dayIndex = candidate.startDayIndex; dayIndex <= candidate.endDayIndex; dayIndex += 1) {
        overflowCounts[dayIndex] += 1;
        overflowEvents[dayIndex]?.push(candidate.event);
      }
      continue;
    }

    segments.push({
      daySpan: candidate.daySpan,
      endsAfterRange: candidate.endsAfterRange,
      event: candidate.event,
      laneIndex,
      startDayIndex: candidate.startDayIndex,
      startsBeforeRange: candidate.startsBeforeRange
    });
  }

  return { overflowCounts, overflowEvents, segments };
}

export function calendarTimelineEventLayouts(
  events: CalendarEventViewModel[],
  dayKey: string,
  hourRowHeight: number
): CalendarTimelineEventLayout[] {
  const candidates = events
    .map((event) => {
      const range = calendarEventLocalMinuteRange(event, dayKey);

      return range ? { event, ...range } : null;
    })
    .filter((candidate): candidate is {
      event: CalendarEventViewModel;
      startMinute: number;
      endMinute: number;
    } => candidate !== null)
    .sort(
      (left, right) =>
        left.startMinute - right.startMinute ||
        left.endMinute - right.endMinute ||
        left.event.id.localeCompare(right.event.id)
    );
  const segmentMap = new Map<string, CalendarTimelineEventSegment[]>();
  const boundaries = [...new Set(candidates.flatMap((item) => [item.startMinute, item.endMinute]))]
    .sort((left, right) => left - right);

  for (let boundaryIndex = 0; boundaryIndex < boundaries.length - 1; boundaryIndex += 1) {
    const startMinute = boundaries[boundaryIndex];
    const endMinute = boundaries[boundaryIndex + 1];
    if (startMinute === undefined || endMinute === undefined || endMinute <= startMinute) continue;

    // Every active event overlaps for this complete interval. Reassigning
    // lanes at each boundary lets a long event reclaim width as neighbouring
    // events finish instead of being constrained by the peak cluster width.
    const active = candidates.filter((item) => item.startMinute < endMinute && item.endMinute > startMinute);
    active.forEach((item, laneIndex) => {
      const segments = segmentMap.get(item.event.id) ?? [];
      const durationMinutes = endMinute - startMinute;
      segments.push({
        startMinute,
        durationMinutes,
        top: (startMinute / 60) * hourRowHeight,
        height: (durationMinutes / 60) * hourRowHeight,
        laneIndex,
        laneCount: active.length
      });
      segmentMap.set(item.event.id, segments);
    });
  }

  return candidates.map((item) => {
    const segments = segmentMap.get(item.event.id) ?? [];
    const first = segments[0];
    const durationMinutes = Math.max(5, item.endMinute - item.startMinute);

    return {
      event: item.event,
      startMinute: item.startMinute,
      durationMinutes,
      top: (item.startMinute / 60) * hourRowHeight,
      height: (durationMinutes / 60) * hourRowHeight,
      laneIndex: first?.laneIndex ?? 0,
      laneCount: Math.max(1, ...segments.map((segment) => segment.laneCount)),
      segments
    };
  });
}

function calendarEventLocalMinuteRange(
  event: CalendarEventViewModel,
  dayKey: string
): { startMinute: number; endMinute: number } | null {
  const timeZone = event.timeZone || "UTC";
  const start = calendarLocalPoint(event.startsAt, timeZone);
  const end = calendarLocalPoint(event.endsAt, timeZone);
  const startMinute = start.dayKey < dayKey ? 0 : start.dayKey > dayKey ? 1_440 : start.minutes;
  const endMinute = end.dayKey > dayKey ? 1_440 : end.dayKey < dayKey ? 0 : end.minutes;
  const clampedStart = Math.max(0, Math.min(1_440, startMinute));
  const clampedEnd = Math.max(0, Math.min(1_440, endMinute));

  if (clampedEnd <= clampedStart) {
    return null;
  }

  return {
    startMinute: clampedStart,
    endMinute: clampedEnd
  };
}

export function calendarDaySlots(day: string, timedEvents: CalendarEventViewModel[]): CalendarDaySlot[] {
  const eventsByHour = new Map<number, CalendarEventViewModel[]>();

  for (const event of timedEvents) {
    for (const hour of dayPlanningHours) {
      if (!eventOverlapsHour(event, day, hour)) {
        continue;
      }

      const hourEvents = eventsByHour.get(hour) ?? [];
      hourEvents.push(event);
      eventsByHour.set(hour, hourEvents);
    }
  }

  return dayPlanningHours.map((hour) => ({
    hour,
    label: hourSlotLabel(hour),
    startsAt: hourSlotIso(day, hour),
    events: eventsByHour.get(hour) ?? []
  }));
}
