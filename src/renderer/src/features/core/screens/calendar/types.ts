import type { CalendarEventRecurrence } from "@shared/ipc/contracts";
import type { CalendarDayViewModel, CalendarEventViewModel } from "../../coreViewModels";

export type CalendarRepeatFrequency = "none" | CalendarEventRecurrence["frequency"];
export type CalendarCreateMode = "event" | "task" | "birthday";
export type CalendarCreateSeed = { startsAt?: string; endsAt?: string; allDay?: boolean };

export interface CalendarEventDraft {
  mode: "create" | "edit";
  id?: string;
  mutationState?: CalendarEventViewModel["mutationState"];
  title: string;
  calendarId: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  location: string;
  notes: string;
  guests: string;
  reminderMinutes: string;
  repeatFrequency: CalendarRepeatFrequency;
  repeatInterval: string;
  repeatEndsOn: string;
  repeatCount: string;
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
  visibleEventChips: CalendarEventViewModel[];
  overflowCount: number;
}

export interface VisibleCalendarMonthWeek {
  id: string;
  days: VisibleCalendarMonthDay[];
}

export interface CalendarEventDayIndex {
  eventsByDay: Map<string, CalendarEventViewModel[]>;
}
