import type { GoogleCalendarEvent } from "@/types";
import { matchesEventFilters, type PaletteFilters } from "@/features/paletteFilters";

export interface CalendarSearchDocument {
  readonly id: string;
  readonly calendarId: string;
  readonly event: GoogleCalendarEvent;
  readonly title: string;
  readonly body: string;
}

export interface CalendarSearchHit {
  readonly document: CalendarSearchDocument;
  readonly score: number;
}

export function calendarSearchDocument(event: GoogleCalendarEvent): CalendarSearchDocument | undefined {
  if (event.status === "cancelled") {
    return undefined;
  }
  return {
    id: `${event.calendarId}:${event.id}`,
    calendarId: event.calendarId,
    event,
    title: event.summary || "Untitled event",
    body: `${event.description ?? ""}\n${event.location ?? ""}`
  };
}

export function searchScore(value: string, query: string): number | undefined {
  const source = value.toLocaleLowerCase();
  const target = query.toLocaleLowerCase();
  if (!target) {
    return undefined;
  }
  if (source === target) {
    return 0;
  }
  if (source.startsWith(target)) {
    return 10 + source.length - target.length;
  }
  const containedAt = source.indexOf(target);
  if (containedAt >= 0) {
    return 100 + containedAt;
  }
  let cursor = 0;
  for (const character of source) {
    if (character === target[cursor]) {
      cursor += 1;
    }
    if (cursor === target.length) {
      return 300 + source.length;
    }
  }
  return undefined;
}

export function searchCalendarHistory(
  documents: readonly CalendarSearchDocument[],
  query: string,
  includeBody: boolean,
  limit = 24,
  filters?: PaletteFilters,
  calendarNames?: Readonly<Record<string, string>>
): CalendarSearchHit[] {
  const normalized = query.trim();
  return documents.flatMap((document) => {
    if (filters && !matchesEventFilters(document.event, filters, calendarNames?.[document.calendarId])) {
      return [];
    }
    if (!normalized) {
      return [{ document, score: 500 }];
    }
    const title = searchScore(document.title, normalized);
    if (title !== undefined) {
      return [{ document, score: title }];
    }
    if (!includeBody) {
      return [];
    }
    const body = searchScore(document.body, normalized);
    return body === undefined ? [] : [{ document, score: 1_000 + body }];
  }).sort((left, right) => left.score - right.score || left.document.title.localeCompare(right.document.title)).slice(0, limit);
}

export function calendarResultKind(event: GoogleCalendarEvent): "Event" | "Recurring series" | "Changed occurrence" {
  if (event.recurrence?.length) {
    return "Recurring series";
  }
  if (event.recurringEventId) {
    return "Changed occurrence";
  }
  return "Event";
}
