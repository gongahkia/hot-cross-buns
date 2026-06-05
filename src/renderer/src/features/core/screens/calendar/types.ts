import type { CalendarEventRecurrence } from "@shared/ipc/contracts";
import type { CalendarDayViewModel, CalendarEventViewModel } from "../../coreViewModels";

export type CalendarRepeatFrequency = "none" | CalendarEventRecurrence["frequency"] | "custom";
export type CalendarRepeatEndMode = "never" | "on" | "after";
export type CalendarRepeatWeekday = NonNullable<CalendarEventRecurrence["byDay"]>[number];
export type CalendarCreateMode = "event" | "task" | "birthday";
export type CalendarCreateSeed = { startsAt?: string; endsAt?: string; allDay?: boolean };

export interface CalendarEventDraft {
  mode: "create" | "edit";
  id?: string;
  mutationState?: CalendarEventViewModel["mutationState"];
  completedAt?: string | null;
  title: string;
  calendarId: string;
  colorId: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  location: string;
  notes: string;
  guests: string;
  reminderMinutes: string;
  conference: CalendarEventViewModel["conference"];
  repeatFrequency: CalendarRepeatFrequency;
  repeatCustomFrequency: CalendarEventRecurrence["frequency"];
  repeatEndMode: CalendarRepeatEndMode;
  repeatInterval: string;
  repeatEndsOn: string;
  repeatCount: string;
  repeatWeekdays: CalendarRepeatWeekday[];
}

export interface CalendarDaySlot {
  hour: number;
  label: string;
  startsAt: string;
  events: CalendarEventViewModel[];
}

export interface VisibleCalendarDay {
  day: CalendarDayViewModel;
  visibleEvents: CalendarEventViewModel[];
  allDayEvents: CalendarEventViewModel[];
  timedEvents: CalendarEventViewModel[];
}

export interface VisibleCalendarTimelineDay extends VisibleCalendarDay {
  timedEventLayouts: CalendarTimelineEventLayout[];
}

export interface VisibleCalendarTimeline {
  allDayOverflowCounts: number[];
  allDayOverflowEvents: CalendarEventViewModel[][];
  allDaySegments: CalendarTimelineAllDaySegment[];
  days: VisibleCalendarTimelineDay[];
}

export interface CalendarTimelineAllDaySegment {
  daySpan: number;
  endsAfterRange: boolean;
  event: CalendarEventViewModel;
  laneIndex: number;
  startDayIndex: number;
  startsBeforeRange: boolean;
}

export interface CalendarTimelineEventLayout {
  event: CalendarEventViewModel;
  startMinute: number;
  durationMinutes: number;
  top: number;
  height: number;
  laneIndex: number;
  laneCount: number;
}

export interface CalendarTimeBlock {
  id: string;
  dayKey: string;
  startsAt: string;
  endsAt: string;
}

export interface VisibleCalendarMonthDay {
  day: CalendarDayViewModel;
  overflowEvents: CalendarEventViewModel[];
  visibleEventChips: Array<{
    event: CalendarEventViewModel;
    laneIndex: number;
  }>;
  overflowCount: number;
}

export interface VisibleCalendarMonthWeek {
  allDaySegments: CalendarTimelineAllDaySegment[];
  id: string;
  days: VisibleCalendarMonthDay[];
}

export interface CalendarEventDayIndex {
  eventsByDay: Map<string, CalendarEventViewModel[]>;
}
