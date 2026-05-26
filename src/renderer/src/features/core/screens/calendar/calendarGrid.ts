import type { PointerEvent } from "react";
import { startOfUtcDayIso } from "../../coreScreenShared";
import type {
  CalendarDayViewModel,
  CalendarEventViewModel,
  CalendarMonthWeekViewModel,
  CalendarViewId
} from "../../coreViewModels";
import type {
  CalendarDaySlot,
  CalendarEventDayIndex,
  CalendarTimelineAllDaySegment,
  CalendarTimelineEventLayout,
  CalendarTimeBlock,
  VisibleCalendarDay,
  VisibleCalendarMonthWeek,
  VisibleCalendarTimeline,
  VisibleCalendarTimelineDay
} from "./types";

export const dayPlanningHours = Array.from({ length: 12 }, (_, index) => index + 7);
export const calendarTimelineHours = Array.from({ length: 24 }, (_, index) => index);
export const calendarDaySlotRowHeight = 64;
export const calendarDayViewportHeight = 520;
export const calendarWeekColumnWidth = 160;
export const calendarMonthVisibleChipCount = 3;
export const calendarWeekVisibleTimedCount = 4;
export const calendarWeekVisibleAllDayCount = 2;
export const calendarTimelineVisibleAllDayCount = 4;
export const calendarTimelineHourRowHeight = 96;

interface CalendarLocalPoint {
  dayKey: string;
  minutes: number;
}

export function hourSlotIso(day: string, hour: number, timeZone = "UTC"): string {
  return zonedDateTimeIso(day, hour, 0, timeZone);
}

export function addUtcMinutesIso(value: string, minutes: number): string {
  return new Date(Date.parse(value) + minutes * 60 * 1000).toISOString();
}

export function hourSlotLabel(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

export function calendarDisplayHourLabel(hour: number): string {
  if (hour === 0) {
    return "12 AM";
  }

  if (hour === 12) {
    return "12 PM";
  }

  return hour < 12 ? `${hour} AM` : `${hour - 12} PM`;
}

export function calendarDayKey(day: CalendarDayViewModel): string {
  const separatorIndex = day.id.indexOf("-");
  return separatorIndex >= 0 ? day.id.slice(separatorIndex + 1) : day.id;
}

export function calendarViewLabel(viewId: CalendarViewId): string {
  if (viewId === "multiDay") {
    return "Multi-Day";
  }

  return `${viewId[0].toUpperCase()}${viewId.slice(1)}`;
}

export function isCalendarTimelineView(viewId: CalendarViewId): boolean {
  return viewId === "day" || viewId === "multiDay" || viewId === "week";
}

function calendarDateFromDay(day: CalendarDayViewModel): Date {
  return new Date(`${calendarDayKey(day)}T00:00:00.000Z`);
}

export function calendarDateTitle(day: CalendarDayViewModel, includeYear = true): string {
  return calendarDateTitleFromIso(calendarDayKey(day), includeYear);
}

export function calendarDateTitleFromIso(day: string, includeYear = true): string {
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "long",
    year: includeYear ? "numeric" : undefined,
    timeZone: "UTC"
  }).format(new Date(`${day}T00:00:00.000Z`));
}

export function calendarRangeTitle(days: CalendarDayViewModel[]): string {
  const firstDay = days[0];
  const lastDay = days.at(-1);

  if (!firstDay || !lastDay) {
    return "Calendar";
  }

  const start = calendarDateFromDay(firstDay);
  const end = calendarDateFromDay(lastDay);
  const sameMonth =
    start.getUTCFullYear() === end.getUTCFullYear() &&
    start.getUTCMonth() === end.getUTCMonth();

  if (sameMonth) {
    const month = new Intl.DateTimeFormat(undefined, {
      month: "long",
      timeZone: "UTC"
    }).format(start);
    return `${month} ${start.getUTCDate()}-${end.getUTCDate()}, ${start.getUTCFullYear()}`;
  }

  const formatter = new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    timeZone: "UTC"
  });
  return `${formatter.format(start)} - ${formatter.format(end)}, ${end.getUTCFullYear()}`;
}

function calendarIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function calendarDateFromIsoDate(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

function calendarUtcDayOffset(fromDay: string, toDay: string): number {
  return Math.round(
    (calendarDateFromIsoDate(toDay).getTime() - calendarDateFromIsoDate(fromDay).getTime()) / 86_400_000
  );
}

export function calendarTodayKey(): string {
  return calendarIsoDate(new Date(startOfUtcDayIso(new Date())));
}

function calendarStartOfUtcDate(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function calendarAddUtcDays(day: string, days: number): string {
  const date = calendarDateFromIsoDate(day);
  date.setUTCDate(date.getUTCDate() + days);
  return calendarIsoDate(date);
}

export function calendarAddUtcMonths(day: string, months: number): string {
  const source = calendarDateFromIsoDate(day);
  const target = new Date(Date.UTC(source.getUTCFullYear(), source.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();

  target.setUTCDate(Math.min(source.getUTCDate(), lastDay));
  return calendarIsoDate(target);
}

export function calendarMonthOffset(fromDay: string, toDay: string): number {
  const from = calendarDateFromIsoDate(fromDay);
  const to = calendarDateFromIsoDate(toDay);

  return (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + to.getUTCMonth() - from.getUTCMonth();
}

export function calendarMonthTitle(day: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "long",
    year: "numeric",
    timeZone: "UTC"
  }).format(calendarDateFromIsoDate(day));
}

function calendarWeekdayLabel(date: Date, style: "long" | "short" = "short"): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: style,
    timeZone: "UTC"
  }).format(date);
}

function calendarEventRangeDayKeys(event: CalendarEventViewModel): string[] {
  if (event.allDay) {
    return calendarUtcRangeDayKeys(event.startsAt, event.endsAt);
  }

  const startMs = Date.parse(event.startsAt);
  const endMs = Date.parse(event.endsAt);

  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return [];
  }

  const timeZone = event.timeZone || "UTC";
  const start = calendarLocalPoint(event.startsAt, timeZone);
  const end = calendarLocalPoint(new Date(endMs - 1).toISOString(), timeZone);
  const keys: string[] = [];
  const cursor = calendarDateFromIsoDate(start.dayKey);
  const lastDay = calendarDateFromIsoDate(end.dayKey);

  while (cursor.getTime() <= lastDay.getTime()) {
    keys.push(calendarIsoDate(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return keys;
}

function calendarUtcRangeDayKeys(startsAt: string, endsAt: string): string[] {
  const startMs = Date.parse(startsAt);
  const endMs = Date.parse(endsAt);

  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return [];
  }

  const keys: string[] = [];
  const cursor = calendarStartOfUtcDate(new Date(startMs));
  const lastDay = calendarStartOfUtcDate(new Date(endMs - 1));

  while (cursor.getTime() <= lastDay.getTime()) {
    keys.push(calendarIsoDate(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return keys;
}

export function buildCalendarEventDayIndex(events: CalendarEventViewModel[]): CalendarEventDayIndex {
  const eventsByDay = new Map<string, CalendarEventViewModel[]>();

  for (const event of events) {
    for (const day of calendarEventRangeDayKeys(event)) {
      const dayEvents = eventsByDay.get(day) ?? [];
      dayEvents.push(event);
      eventsByDay.set(day, dayEvents);
    }
  }

  for (const dayEvents of eventsByDay.values()) {
    dayEvents.sort(
      (left, right) =>
        left.startsAt.localeCompare(right.startsAt) ||
        left.endsAt.localeCompare(right.endsAt) ||
        left.id.localeCompare(right.id)
    );
  }

  return { eventsByDay };
}

export function calendarEventsForDay(index: CalendarEventDayIndex, day: string): CalendarEventViewModel[] {
  return index.eventsByDay.get(day) ?? [];
}

export function calendarDayViewForDate(
  index: CalendarEventDayIndex,
  day: string,
  variant: "day" | "range" | "month" = "range",
  currentMonth?: number
): CalendarDayViewModel {
  const date = calendarDateFromIsoDate(day);

  return {
    id: `${variant}-${day}`,
    weekday: calendarWeekdayLabel(date, variant === "day" ? "long" : "short"),
    dateLabel: String(date.getUTCDate()),
    isToday: day === calendarTodayKey(),
    isOutsideMonth: currentMonth === undefined ? false : date.getUTCMonth() !== currentMonth,
    events: calendarEventsForDay(index, day)
  };
}

export function calendarWeekDaysForDate(index: CalendarEventDayIndex, day: string): CalendarDayViewModel[] {
  const anchor = calendarDateFromIsoDate(day);
  const sunday = new Date(anchor);
  sunday.setUTCDate(anchor.getUTCDate() - anchor.getUTCDay());

  return Array.from({ length: 7 }, (_, dayOffset) => {
    const date = new Date(sunday);
    date.setUTCDate(sunday.getUTCDate() + dayOffset);
    return calendarDayViewForDate(index, calendarIsoDate(date), "range");
  });
}

export function calendarRangeDaysForDate(
  index: CalendarEventDayIndex,
  day: string,
  dayCount: number
): CalendarDayViewModel[] {
  const count = Math.max(1, dayCount);

  return Array.from({ length: count }, (_, dayOffset) =>
    calendarDayViewForDate(index, calendarAddUtcDays(day, dayOffset), count === 1 ? "day" : "range")
  );
}

export function calendarMonthWeeksForDate(
  index: CalendarEventDayIndex,
  day: string
): CalendarMonthWeekViewModel[] {
  const anchor = calendarDateFromIsoDate(day);
  const first = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1));
  const gridStart = new Date(first);
  gridStart.setUTCDate(first.getUTCDate() - first.getUTCDay());

  return Array.from({ length: 6 }, (_, weekIndex) => ({
    id: `month-${day}-week-${weekIndex}`,
    days: Array.from({ length: 7 }, (_, dayIndex) => {
      const date = new Date(gridStart);
      date.setUTCDate(gridStart.getUTCDate() + weekIndex * 7 + dayIndex);
      return calendarDayViewForDate(index, calendarIsoDate(date), "month", first.getUTCMonth());
    })
  }));
}

export function calendarPointerTimeIso(
  dayKey: string,
  hour: number,
  event: PointerEvent<HTMLElement>,
  timeZone = "UTC"
): string {
  const rect = event.currentTarget.getBoundingClientRect();
  const offset = Math.min(Math.max(event.clientY - rect.top, 0), Math.max(1, rect.height) - 1);
  const quarter = Math.min(3, Math.max(0, Math.floor((offset / Math.max(1, rect.height)) * 4)));
  const minutes = quarter * 15;

  return zonedDateTimeIso(dayKey, hour, minutes, timeZone);
}

export function calendarTimeBlock(startsAt: string, pointerAt: string, timeZone = "UTC"): CalendarTimeBlock {
  const startMs = Date.parse(startsAt);
  const pointerMs = Date.parse(pointerAt);
  const pointerEnd = addUtcMinutesIso(pointerAt, 15);
  const starts = pointerMs < startMs ? pointerAt : startsAt;
  const ends = pointerMs < startMs ? addUtcMinutesIso(startsAt, 15) : pointerEnd;

  return {
    id: `${starts}-${ends}`,
    dayKey: calendarLocalPoint(starts, timeZone).dayKey,
    startsAt: starts,
    endsAt: ends
  };
}

export function calendarBlocksOverlapHour(
  blocks: CalendarTimeBlock[],
  dayKey: string,
  hour: number,
  timeZone = "UTC"
): boolean {
  const startsAt = Date.parse(hourSlotIso(dayKey, hour, timeZone));
  const endsAt = Date.parse(hourSlotIso(dayKey, hour + 1, timeZone));

  return blocks.some(
    (block) =>
      block.dayKey === dayKey &&
      Date.parse(block.startsAt) < endsAt &&
      Date.parse(block.endsAt) > startsAt
  );
}

export function sortedCalendarTimeBlocks(blocks: CalendarTimeBlock[]): CalendarTimeBlock[] {
  return [...blocks].sort(
    (left, right) =>
      left.startsAt.localeCompare(right.startsAt) ||
      left.endsAt.localeCompare(right.endsAt) ||
      left.id.localeCompare(right.id)
  );
}

export function calendarTimeBlockLabel(block: CalendarTimeBlock, timeZone = "UTC"): string {
  const day = new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    timeZone,
    weekday: "short"
  }).format(new Date(block.startsAt));
  const timeFormatter = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZone
  });

  return `${day} ${timeFormatter.format(new Date(block.startsAt))}-${timeFormatter.format(new Date(block.endsAt))}`;
}

export function calendarAvailabilitySnippet({
  durationMinutes,
  slots,
  timeZone,
  title
}: {
  durationMinutes: number;
  slots: CalendarTimeBlock[];
  timeZone: string;
  title: string;
}): string {
  const lines = sortedCalendarTimeBlocks(slots).map((slot) => `- ${calendarTimeBlockLabel(slot, timeZone)}`);

  return [
    title.trim() || "Meeting",
    `${durationMinutes} minutes - ${timeZone}`,
    ...lines
  ].join("\n");
}

function eventOverlapsHour(event: CalendarEventViewModel, day: string, hour: number): boolean {
  const timeZone = event.timeZone || "UTC";
  const startsAt = calendarLocalPoint(event.startsAt, timeZone);
  const endsAt = calendarLocalPoint(event.endsAt, timeZone);
  const hourStart: CalendarLocalPoint = { dayKey: day, minutes: hour * 60 };
  const hourEnd: CalendarLocalPoint =
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
  visibleCalendarIds: ReadonlySet<string>
): VisibleCalendarTimelineDay[] {
  return days.map((day) => {
    const visibleDay = visibleCalendarDay(day, visibleCalendarIds);
    const dayKey = calendarDayKey(day);

    return {
      ...visibleDay,
      timedEventLayouts: calendarTimelineEventLayouts(visibleDay.timedEvents, dayKey)
    };
  });
}

export function visibleCalendarTimeline(
  days: CalendarDayViewModel[],
  visibleCalendarIds: ReadonlySet<string>
): VisibleCalendarTimeline {
  const visibleDays = visibleCalendarTimelineDays(days, visibleCalendarIds);
  const allDayLayout = calendarTimelineAllDayLayout(visibleDays.map(({ day }) => day), visibleCalendarIds);

  return {
    allDayOverflowCounts: allDayLayout.overflowCounts,
    allDaySegments: allDayLayout.segments,
    days: visibleDays
  };
}

function calendarTimelineAllDayLayout(
  days: CalendarDayViewModel[],
  visibleCalendarIds: ReadonlySet<string>
): { overflowCounts: number[]; segments: CalendarTimelineAllDaySegment[] } {
  const dayKeys = days.map(calendarDayKey);
  const firstDayKey = dayKeys[0];
  const lastDayKey = dayKeys.at(-1);
  const uniqueEvents = new Map<string, CalendarEventViewModel>();

  if (!firstDayKey || !lastDayKey) {
    return { overflowCounts: [], segments: [] };
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
  const segments: CalendarTimelineAllDaySegment[] = [];

  for (const candidate of candidates) {
    let laneIndex = laneEnds.findIndex((endDayIndex) => endDayIndex < candidate.startDayIndex);

    if (laneIndex < 0) {
      laneIndex = laneEnds.length;
      laneEnds.push(candidate.endDayIndex);
    } else {
      laneEnds[laneIndex] = candidate.endDayIndex;
    }

    if (laneIndex >= calendarTimelineVisibleAllDayCount) {
      for (let dayIndex = candidate.startDayIndex; dayIndex <= candidate.endDayIndex; dayIndex += 1) {
        overflowCounts[dayIndex] += 1;
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

  return { overflowCounts, segments };
}

function calendarTimelineEventLayouts(
  events: CalendarEventViewModel[],
  dayKey: string
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
  const layouts: CalendarTimelineEventLayout[] = [];
  let cluster: typeof candidates = [];
  let clusterEnd = -1;

  function flushCluster(): void {
    if (cluster.length === 0) {
      return;
    }

    const laneEnds: number[] = [];
    const pending: CalendarTimelineEventLayout[] = [];

    for (const item of cluster) {
      let laneIndex = laneEnds.findIndex((endMinute) => endMinute <= item.startMinute);

      if (laneIndex < 0) {
        laneIndex = laneEnds.length;
        laneEnds.push(item.endMinute);
      } else {
        laneEnds[laneIndex] = item.endMinute;
      }

      const durationMinutes = Math.max(5, item.endMinute - item.startMinute);

      pending.push({
        event: item.event,
        startMinute: item.startMinute,
        durationMinutes,
        top: (item.startMinute / 60) * calendarTimelineHourRowHeight,
        height: (durationMinutes / 60) * calendarTimelineHourRowHeight,
        laneIndex,
        laneCount: 1
      });
    }

    const laneCount = Math.max(1, laneEnds.length);
    layouts.push(...pending.map((layout) => ({ ...layout, laneCount })));
    cluster = [];
    clusterEnd = -1;
  }

  for (const item of candidates) {
    if (cluster.length > 0 && item.startMinute >= clusterEnd) {
      flushCluster();
    }

    cluster.push(item);
    clusterEnd = Math.max(clusterEnd, item.endMinute);
  }

  flushCluster();
  return layouts;
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

export function visibleCalendarMonthWeeks(
  weeks: CalendarMonthWeekViewModel[],
  visibleCalendarIds: ReadonlySet<string>
): VisibleCalendarMonthWeek[] {
  return weeks.map((week) => ({
    id: week.id,
    days: week.days.map((day) => {
      const visibleEvents = day.events.filter((event) => visibleCalendarEvent(event, visibleCalendarIds));
      const visibleEventChips = visibleEvents.slice(0, calendarMonthVisibleChipCount);

      return {
        day,
        overflowCount: Math.max(0, visibleEvents.length - visibleEventChips.length),
        visibleEventChips
      };
    })
  }));
}

function splitAllDayEvents(events: CalendarEventViewModel[]): {
  allDayEvents: CalendarEventViewModel[];
  timedEvents: CalendarEventViewModel[];
} {
  const allDayEvents: CalendarEventViewModel[] = [];
  const timedEvents: CalendarEventViewModel[] = [];

  for (const event of events) {
    if (event.allDay) {
      allDayEvents.push(event);
    } else {
      timedEvents.push(event);
    }
  }

  return { allDayEvents, timedEvents };
}

export function sameTimeOnDate(value: string, day: string): string {
  return `${day}T${value.slice(11)}`;
}

export function visibleCalendarEvent(
  event: CalendarEventViewModel,
  visibleCalendarIds: ReadonlySet<string>
): boolean {
  return visibleCalendarIds.has(event.calendarId);
}

export function calendarEventTimeOfDayIso(sourceIso: string, dayKey: string, timeZone = "UTC"): string {
  const parsed = new Date(sourceIso);

  if (!Number.isFinite(parsed.getTime())) {
    return zonedDateTimeIso(dayKey, 0, 0, timeZone);
  }

  const point = calendarLocalPoint(sourceIso, timeZone);

  return zonedDateTimeIso(dayKey, Math.floor(point.minutes / 60), point.minutes % 60, timeZone);
}

function calendarLocalPoint(value: string, timeZone: string): CalendarLocalPoint {
  const date = new Date(value);

  if (!Number.isFinite(date.getTime())) {
    return { dayKey: value.slice(0, 10), minutes: 0 };
  }

  const parts = calendarLocalDateTimeParts(date, timeZone);

  return {
    dayKey: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute)
  };
}

function calendarLocalDateTimeParts(
  date: Date,
  timeZone: string
): { year: string; month: string; day: string; hour: string; minute: string } {
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
      minute: "2-digit",
      month: "2-digit",
      timeZone,
      year: "numeric"
    });
    const parts = Object.fromEntries(
      formatter.formatToParts(date).map((part) => [part.type, part.value])
    );

    return {
      year: parts.year ?? "1970",
      month: parts.month ?? "01",
      day: parts.day ?? "01",
      hour: parts.hour ?? "00",
      minute: parts.minute ?? "00"
    };
  } catch {
    return calendarLocalDateTimeParts(date, "UTC");
  }
}

function zonedDateTimeIso(dayKey: string, hour: number, minute: number, timeZone: string): string {
  const [year = 1970, month = 1, day = 1] = dayKey.split("-").map(Number);
  const baseDate = new Date(Date.UTC(year, month - 1, day));
  const normalizedMinute = Math.max(0, Math.min(59, minute));
  const dayOffset = Math.floor(hour / 24);
  const normalizedHour = ((hour % 24) + 24) % 24;

  baseDate.setUTCDate(baseDate.getUTCDate() + dayOffset);

  const target: CalendarLocalPoint = {
    dayKey: calendarIsoDate(baseDate),
    minutes: normalizedHour * 60 + normalizedMinute
  };
  let utcMs = Date.UTC(
    baseDate.getUTCFullYear(),
    baseDate.getUTCMonth(),
    baseDate.getUTCDate(),
    Math.floor(target.minutes / 60),
    target.minutes % 60
  );

  for (let index = 0; index < 4; index += 1) {
    const actual = calendarLocalPoint(new Date(utcMs).toISOString(), timeZone);
    const deltaMinutes = calendarLocalPointSerial(target) - calendarLocalPointSerial(actual);

    if (deltaMinutes === 0) {
      break;
    }

    utcMs += deltaMinutes * 60_000;
  }

  return new Date(utcMs).toISOString();
}

function compareCalendarLocalPoints(left: CalendarLocalPoint, right: CalendarLocalPoint): number {
  return left.dayKey.localeCompare(right.dayKey) || left.minutes - right.minutes;
}

function calendarLocalPointSerial(point: CalendarLocalPoint): number {
  return Date.parse(`${point.dayKey}T00:00:00.000Z`) / 60_000 + point.minutes;
}
