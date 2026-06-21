import type { GoogleCalendarEventMirror } from "../../google";

export function eventTimeZone(
  event: GoogleCalendarEventMirror,
  fallback: string | null | undefined
): string {
  return normalizeTimeZone(event.startTimeZone ?? event.endTimeZone ?? fallback);
}

export function normalizeTimeZone(value: string | null | undefined): string {
  const trimmed = value?.trim();

  if (trimmed) {
    return trimmed;
  }

  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}
