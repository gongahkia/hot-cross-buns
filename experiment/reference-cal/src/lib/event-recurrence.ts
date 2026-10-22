import * as recurrenceModule from "rrule";
import type {
  CalendarEvent,
  EventRecurrenceRule,
  EventOccurrenceException,
} from "../components/week-view-types";
import {
  eventTimeZone,
  fromWallDate,
  inTimeZone,
  wallDate,
  zoneDateKey,
} from "./event-timezone.ts";

// rrule publishes ESM to bundlers and CommonJS to Node's native test runner.
const { RRule } = (
  "RRule" in recurrenceModule
    ? recurrenceModule
    : Reflect.get(recurrenceModule, "default")
) as typeof recurrenceModule;
const FREQUENCY = {
  daily: RRule.DAILY,
  weekly: RRule.WEEKLY,
  monthly: RRule.MONTHLY,
  yearly: RRule.YEARLY,
};
const WEEKDAYS = [
  RRule.SU,
  RRule.MO,
  RRule.TU,
  RRule.WE,
  RRule.TH,
  RRule.FR,
  RRule.SA,
];
const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const EDITABLE_KEYS = [
  "kind",
  "title",
  "start",
  "end",
  "isAllDay",
  "color",
  "description",
  "location",
  "timezone",
  "reminders",
  "status",
  "visibility",
  "calendarId",
  "calendarEmail",
  "responseStatus",
] as const;
const expansionCache = new WeakMap<
  CalendarEvent,
  { start: number; end: number; zone: string; events: CalendarEvent[] }
>();

export function recurrenceSummary(
  rule: EventRecurrenceRule | undefined,
  start: Date,
  zone: string,
): string {
  if (!rule) return "Does not repeat";
  const unit = {
    daily: "day",
    weekly: "week",
    monthly: "month",
    yearly: "year",
  }[rule.frequency];
  let summary =
    rule.interval === 1 ? `Every ${unit}` : `Every ${rule.interval} ${unit}s`;
  if (rule.frequency === "weekly")
    summary += ` on ${(rule.weekdays?.length ? rule.weekdays : [inTimeZone(start, zone).getDay()]).map((day) => DAY_LABELS[day]).join(", ")}`;
  if (rule.frequency === "monthly") {
    const day = inTimeZone(start, zone);
    summary +=
      rule.monthlyMode === "weekday"
        ? ` on the ${["first", "second", "third", "fourth", "last"][Math.min(Math.floor((day.getDate() - 1) / 7), 4)]} ${DAY_LABELS[day.getDay()]}`
        : ` on day ${day.getDate()}`;
  }
  if (rule.count)
    summary += ` · ${rule.count} ${rule.count === 1 ? "occurrence" : "occurrences"}`;
  if (rule.until) summary += ` · until ${rule.until}`;
  return summary;
}

export function legacyRecurrence(
  label?: string,
): EventRecurrenceRule | undefined {
  const match = label?.match(
    /^Every (?:(\d+) )?weeks? on (Sun|Mon|Tue|Wed|Thu|Fri|Sat)$/,
  );
  return match
    ? {
        frequency: "weekly",
        interval: Number(match[1] ?? 1),
        weekdays: [DAY_LABELS.indexOf(match[2])],
      }
    : undefined;
}

function floatingOccurrences(
  event: CalendarEvent,
  rangeStart: Date,
  rangeEnd: Date,
): Date[] {
  const rule = event.recurrenceRule;
  if (!rule) return [];
  const zone = eventTimeZone(event),
    anchor = wallDate(event.start, zone);
  const lower = wallDate(rangeStart, zone),
    upper = wallDate(rangeEnd, zone);
  // Padding accommodates offset changes and events overlapping the range boundary.
  lower.setUTCDate(
    lower.getUTCDate() -
      Math.max(
        2,
        Math.ceil((event.end.getTime() - event.start.getTime()) / 86400000) + 1,
      ),
  );
  upper.setUTCDate(upper.getUTCDate() + 2);
  let until = upper;
  if (rule.until) {
    const limit = new Date(`${rule.until}T23:59:59.999Z`);
    if (limit < until) until = limit;
  }
  const weekday = WEEKDAYS[anchor.getUTCDay()];
  const monthlyOrdinal = Math.floor((anchor.getUTCDate() - 1) / 7) + 1;
  const iterator = new RRule({
    freq: FREQUENCY[rule.frequency],
    interval: Math.max(1, rule.interval),
    dtstart: anchor,
    until,
    wkst: RRule.MO,
    byweekday:
      rule.frequency === "weekly"
        ? rule.weekdays?.length
          ? rule.weekdays.map((day) => WEEKDAYS[day])
          : [weekday]
        : rule.frequency === "monthly" && rule.monthlyMode === "weekday"
          ? [weekday.nth(monthlyOrdinal === 5 ? -1 : monthlyOrdinal)]
          : undefined,
  });
  if (!rule.count) return iterator.between(lower, upper, true);
  const result: Date[] = [];
  let validCount = 0;
  // A DST gap does not spend an occurrence in an end-after-N schedule.
  iterator.all((wall) => {
    if (!fromWallDate(wall, zone)) return true;
    validCount++;
    if (wall >= lower && wall <= upper) result.push(wall);
    return validCount < rule.count!;
  });
  return result;
}

export function occurrenceFor(
  master: CalendarEvent,
  originalStart: Date,
): CalendarEvent | null {
  const key = originalStart.toISOString();
  const exception = master.recurrenceExceptions?.[key];
  if (exception === null) return null;
  const zone = eventTimeZone(master);
  const endWall = new Date(
    wallDate(originalStart, zone).getTime() +
      wallDate(master.end, zone).getTime() -
      wallDate(master.start, zone).getTime(),
  );
  const end = master.isAllDay
    ? fromWallDate(endWall, zone)
    : new Date(
        originalStart.getTime() + master.end.getTime() - master.start.getTime(),
      );
  if (!end || end < originalStart) return null;
  return {
    ...master,
    start: originalStart,
    end,
    id:
      originalStart.getTime() === master.start.getTime()
        ? master.id
        : `${master.id}::${key}`,
    ...exception,
    seriesId: master.id,
    occurrenceStart: originalStart,
    recurrenceAnchor: { start: master.start, timezone: zone },
  };
}

export function expandRecurringEvents(
  events: CalendarEvent[],
  rangeStart: Date,
  rangeEnd: Date,
): CalendarEvent[] {
  return events.flatMap((event) => {
    if (!event.recurrenceRule) return [event];
    const zone = eventTimeZone(event);
    const cached = expansionCache.get(event);
    if (
      cached?.start === rangeStart.getTime() &&
      cached.end === rangeEnd.getTime() &&
      cached.zone === zone
    )
      return cached.events;
    const occurrences = new Map<string, CalendarEvent>();
    const scheduled = new Set<string>();
    for (const wall of floatingOccurrences(event, rangeStart, rangeEnd)) {
      const start = fromWallDate(wall, zone);
      if (!start) continue;
      scheduled.add(start.toISOString());
      const occurrence = occurrenceFor(event, start);
      if (
        occurrence &&
        occurrence.start <= rangeEnd &&
        occurrence.end >= rangeStart
      )
        occurrences.set(occurrence.id, occurrence);
    }
    // Include an occurrence moved into this window from outside it.
    for (const [key, exception] of Object.entries(
      event.recurrenceExceptions ?? {},
    )) {
      if (
        exception?.start &&
        exception.start <= rangeEnd &&
        (exception.end ?? exception.start) >= rangeStart
      ) {
        if (scheduled.has(key)) continue;
        const original = new Date(key);
        const isScheduled = floatingOccurrences(
          event,
          original,
          new Date(original.getTime() + 1),
        ).some(
          (wall) => fromWallDate(wall, zone)?.getTime() === original.getTime(),
        );
        if (!isScheduled) continue;
        const occurrence = occurrenceFor(event, original);
        if (occurrence) occurrences.set(occurrence.id, occurrence);
      }
    }
    const result = [...occurrences.values()];
    expansionCache.set(event, {
      start: rangeStart.getTime(),
      end: rangeEnd.getTime(),
      zone,
      events: result,
    });
    return result;
  });
}

/** Resolve a selected occurrence even after it is moved beyond the rendered window. */
export function findCalendarEvent(
  events: CalendarEvent[],
  id: string,
): CalendarEvent | null {
  for (const master of events) {
    if (!master.recurrenceRule) {
      if (master.id === id) return master;
      continue;
    }
    const savedKey = Object.entries(master.recurrenceExceptions ?? {}).find(
      ([, value]) => value?.id === id,
    )?.[0];
    const key =
      savedKey ??
      (id === master.id
        ? master.start.toISOString()
        : id.startsWith(`${master.id}::`)
          ? id.slice(master.id.length + 2)
          : undefined);
    if (!key) continue;
    const original = new Date(key);
    if (Number.isNaN(original.getTime())) continue;
    const zone = eventTimeZone(master);
    const valid = floatingOccurrences(
      master,
      original,
      new Date(original.getTime() + 1),
    ).some(
      (wall) => fromWallDate(wall, zone)?.getTime() === original.getTime(),
    );
    if (valid) return occurrenceFor(master, original);
  }
  return null;
}

function different(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) !== JSON.stringify(b);
}

function occurrenceChanges(
  base: CalendarEvent,
  updated: CalendarEvent,
): EventOccurrenceException {
  return Object.fromEntries(
    EDITABLE_KEYS.filter((key) => different(base[key], updated[key])).map(
      (key) => [key, updated[key]],
    ),
  );
}

export function updateCalendarEvents(
  events: CalendarEvent[],
  updated: CalendarEvent,
): CalendarEvent[] {
  const master = events.find(
    (event) => event.id === (updated.seriesId ?? updated.id),
  );
  if (!master) return events;
  if (updated.kind === "birthday" && master.kind !== "birthday") {
    // Changing a series to a birthday uses the selected date as its annual
    // anchor. Preserve the selected ID so its popup/search result stays open.
    const birthday: CalendarEvent = {
      ...updated,
      id: master.id,
      seriesId: undefined,
      occurrenceStart: undefined,
      recurrenceAnchor: undefined,
      recurrenceExceptions:
        updated.id !== master.id
          ? { [updated.start.toISOString()]: { id: updated.id } }
          : undefined,
    };
    return events.map((event) => (event.id === master.id ? birthday : event));
  }
  const recurrenceChanged = different(
    master.recurrenceRule,
    updated.recurrenceRule,
  );
  if (recurrenceChanged) {
    const next = {
      ...master,
      recurrenceRule: updated.recurrenceRule,
      recurrence: updated.recurrenceRule
        ? recurrenceSummary(
            updated.recurrenceRule,
            master.start,
            eventTimeZone(master),
          )
        : undefined,
    };
    if (!master.recurrenceRule) {
      next.timezone = eventTimeZone(updated);
      next.start = updated.start;
      next.end = updated.end;
    }
    if (!updated.recurrenceRule && updated.occurrenceStart) {
      // Stopping repeat keeps the selected event as a normal event.
      return events.map((event) =>
        event.id === master.id
          ? {
              ...updated,
              id: updated.id,
              seriesId: undefined,
              occurrenceStart: undefined,
              recurrenceAnchor: undefined,
              recurrenceExceptions: undefined,
              recurrenceRule: undefined,
              recurrence: undefined,
            }
          : event,
      );
    }
    return events.map((event) => (event.id === master.id ? next : event));
  }
  if (!master.recurrenceRule || !updated.occurrenceStart)
    return events.map((event) => (event.id === updated.id ? updated : event));
  const originalStart = updated.occurrenceStart;
  const base = occurrenceFor(
    { ...master, recurrenceExceptions: undefined },
    originalStart,
  );
  if (!base) return events;
  const exception = occurrenceChanges(base, updated);
  if (updated.id !== base.id) exception.id = updated.id;
  return events.map((event) =>
    event.id === master.id
      ? {
          ...master,
          recurrenceExceptions: {
            ...master.recurrenceExceptions,
            [originalStart.toISOString()]: exception,
          },
        }
      : event,
  );
}

/** Only sample records are grouped; newly authored events are never merged by title. */
export function prepareSampleSeries(events: CalendarEvent[]): CalendarEvent[] {
  const groups = new Map<string, CalendarEvent[]>(),
    ordinary: CalendarEvent[] = [];
  for (const event of events) {
    if (!legacyRecurrence(event.recurrence)) {
      ordinary.push(event);
      continue;
    }
    const key = JSON.stringify([
      event.kind ?? "event",
      event.title,
      event.calendarId,
      event.recurrence,
      event.isAllDay ?? false,
    ]);
    groups.set(key, [...(groups.get(key) ?? []), event]);
  }
  for (const entries of groups.values()) {
    entries.sort((a, b) => a.start.getTime() - b.start.getTime());
    const first = entries[0],
      zone = eventTimeZone(first);
    const master: CalendarEvent = {
      ...first,
      id: `recurring:${first.id}`,
      timezone: zone,
      recurrenceRule: legacyRecurrence(first.recurrence),
      recurrenceExceptions: {},
    };
    const byDate = new Map(
      entries.map((event) => [zoneDateKey(event.start, zone), event]),
    );
    for (const wall of floatingOccurrences(
      master,
      first.start,
      entries.at(-1)!.end,
    )) {
      const start = fromWallDate(wall, zone);
      if (!start) continue;
      const existing = byDate.get(zoneDateKey(start, zone));
      master.recurrenceExceptions![start.toISOString()] = existing
        ? {
            ...occurrenceChanges(occurrenceFor(master, start)!, existing),
            id: existing.id,
          }
        : null;
      if (existing) byDate.delete(zoneDateKey(start, zone));
    }
    // A hand-authored sample outside its stated cadence remains a one-off.
    ordinary.push(
      ...[...byDate.values()].map((event) => ({
        ...event,
        recurrence: undefined,
      })),
    );
    ordinary.push(master);
  }
  return ordinary;
}
