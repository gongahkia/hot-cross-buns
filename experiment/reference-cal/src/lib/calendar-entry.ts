import type {
  CalendarEntryKind,
  CalendarEvent,
} from "../components/week-view-types";
import { recurrenceSummary } from "./event-recurrence.ts";
import { eventTimeZone } from "./event-timezone.ts";

/** Shared by direct creation and the inline type selector. */
export function withCalendarEntryKind(
  entry: CalendarEvent,
  kind: CalendarEntryKind,
): CalendarEvent {
  if (kind !== "birthday") return { ...entry, kind };
  const recurrenceRule = { frequency: "yearly", interval: 1 } as const;
  return {
    ...entry,
    kind,
    recurrenceRule,
    recurrence: recurrenceSummary(
      recurrenceRule,
      entry.start,
      eventTimeZone(entry),
    ),
  };
}
