import type { MouseEvent, PointerEvent } from "react";
import type { CalendarTimeBlock } from "./types";
import {
  addUtcMinutesIso,
  calendarAddUtcDays,
  calendarLocalPoint,
  hourSlotIso,
  zonedDateTimeIso
} from "./calendarDateUtils";

export interface CalendarAvailabilityRange {
  /** Inclusive start and exclusive end, represented as canonical instants. */
  end: string;
  start: string;
}

export interface CalendarAvailabilityHoldDraft {
  allDay: false;
  calendarId: string;
  endsAt: string;
  guestEmails: [];
  location: "";
  notes: "Availability hold";
  recurrence: null;
  reminderMinutes: [];
  startsAt: string;
  timeZone: string;
  title: string;
}

/**
 * Translates date-only availability controls into the selected calendar
 * timezone. Date inputs describe local calendar days, never UTC days.
 */
export function calendarAvailabilityRange(
  startDate: string,
  endDate: string,
  timeZone: string
): CalendarAvailabilityRange | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    return null;
  }

  const start = zonedDateTimeIso(startDate, 0, 0, timeZone);
  const end = zonedDateTimeIso(calendarAddUtcDays(endDate, 1), 0, 0, timeZone);

  if (!Number.isFinite(Date.parse(start)) || !Number.isFinite(Date.parse(end)) || Date.parse(end) <= Date.parse(start)) {
    return null;
  }

  return { start, end };
}

export function calendarTimeBlockIsWithinAvailabilityRange(
  block: CalendarTimeBlock,
  range: CalendarAvailabilityRange
): boolean {
  const startsAt = Date.parse(block.startsAt);
  const endsAt = Date.parse(block.endsAt);

  return (
    Number.isFinite(startsAt) &&
    Number.isFinite(endsAt) &&
    startsAt >= Date.parse(range.start) &&
    endsAt <= Date.parse(range.end)
  );
}

export function calendarAvailabilitySlotsInRange(
  slots: CalendarTimeBlock[],
  range: CalendarAvailabilityRange
): CalendarTimeBlock[] {
  return slots.filter((slot) => calendarTimeBlockIsWithinAvailabilityRange(slot, range));
}

/** Builds the exact local event drafts used by Create Holds without writing anything. */
export function calendarAvailabilityHoldDrafts({
  calendarId,
  slots,
  timeZone,
  title
}: {
  calendarId: string;
  slots: CalendarTimeBlock[];
  timeZone: string;
  title: string;
}): CalendarAvailabilityHoldDraft[] {
  const holdTitle = title.trim() || "Hold";

  return sortedCalendarTimeBlocks(slots).map((slot) => ({
    allDay: false,
    calendarId,
    endsAt: slot.endsAt,
    guestEmails: [],
    location: "",
    notes: "Availability hold",
    recurrence: null,
    reminderMinutes: [],
    startsAt: slot.startsAt,
    timeZone,
    title: holdTitle
  }));
}

export function calendarPointerTimeIso(
  dayKey: string,
  hour: number,
  event: PointerEvent<HTMLElement> | MouseEvent<HTMLElement>,
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
