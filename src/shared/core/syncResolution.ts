import type { PendingSyncMutation } from "./CoreStore";
import { CoreStoreError } from "./coreStoreError";
import { claimedLocalEventId } from "./googleEventIdentity";

export type SyncRecord = Record<string, any>;
export interface SyncResolutionContext {
  mutation: PendingSyncMutation;
  mutations: PendingSyncMutation[];
  entities: Array<{ kind: "task" | "taskList" | "event"; id: string; local: SyncRecord | null }>;
  version: string;
  uncertainCreation: boolean;
}
export interface GoogleResolutionSnapshot {
  lists?: Array<{ remote: SyncRecord; tasks: SyncRecord[] }>;
  calendars?: Array<{ remote: SyncRecord; events: SyncRecord[]; token?: string }>;
}

export function resolutionLocalRecord(context: SyncResolutionContext, id: string): SyncRecord | null {
  return context.entities.find((entity) => entity.id === id)?.local
    ?? context.mutations.find((mutation) => mutation.entityId === id && mutation.payload.googleId)?.payload
    ?? context.mutations.flatMap((mutation) => mutation.payload.deletedTasks ?? []).find((task) => task.id === id)
    ?? context.mutations.find((mutation) => mutation.entityId === id && mutation.kind.endsWith(".delete"))?.payload
    ?? null;
}

/** Event IDs belong to a calendar. Only queued moves authorize other locations. */
export function resolutionGoogleEvent(context: SyncResolutionContext, id: string, snapshot: GoogleResolutionSnapshot, calendar: (id: string) => SyncRecord | null) {
  const local = resolutionLocalRecord(context, id);
  const moves = context.mutations.filter((mutation) => mutation.entityId === id && mutation.kind === "event.move");
  const originId = moves[0]?.payload.sourceCalendarId ?? local?.calendarId;
  const origin = (typeof originId === "string" ? calendar(originId)?.googleId : null) ?? local?.calendarGoogleId;
  const allowed = new Set([origin, local?.calendarGoogleId]);
  for (const move of moves) for (const value of [move.payload.sourceCalendarId, move.payload.destinationCalendarId]) {
    const googleId = typeof value === "string" ? calendar(value)?.googleId : null;
    if (googleId) allowed.add(googleId);
  }
  const candidates = (snapshot.calendars ?? []).filter((item) => allowed.has(item.remote.id)).flatMap((calendar) =>
    calendar.events.filter((event) => local?.googleId ? event.id === local.googleId : claimedLocalEventId(event, local?.googleCreationId) === id ||
      Boolean(local?.googleRecurringEventId && event.recurringEventId === local.googleRecurringEventId && local.googleOriginalStartTime &&
        Date.parse(event.originalStartTime?.dateTime ?? event.originalStartTime?.date) === Date.parse(local.googleOriginalStartTime))).map((event) => ({ calendar, event })));
  const active = candidates.filter((candidate) => candidate.event.status !== "cancelled");
  const original = active.find((candidate) => candidate.calendar.remote.id === origin);
  if (original) return original;
  if (active.length > 1) throw new CoreStoreError("This event exists in several possible move destinations. Preserve local content and review those calendars before resolving.");
  return active[0] ?? candidates.find((candidate) => candidate.calendar.remote.id === origin) ?? null;
}
