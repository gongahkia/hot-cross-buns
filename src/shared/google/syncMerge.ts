import { splitHcbTaskMetadata, withHcbTaskMetadata } from "../core/hcbTaskMetadata";

export type GoogleEntityKind = "taskList" | "task" | "event";
type JsonRecord = Record<string, any>;
export type SyncFields = Record<string, any>;

/** A baseline is a remote observation, never the optimistic local record. */
export interface GoogleSyncBaseline {
  remoteId: string;
  collectionId: string | null;
  etag: string | null;
  fields: SyncFields;
  deleted: boolean;
  recurring: boolean;
  structure?: SyncFields;
  taskNotesWire?: string;
  taskMetadataRetained?: boolean;
}

export function googleRemoteBaseline(kind: GoogleEntityKind, remote: JsonRecord, collectionId: string | null, metadataFallback?: SyncFields): GoogleSyncBaseline {
  return {
    remoteId: remote.id, collectionId, etag: remote.etag ?? null, fields: googleSyncFields(kind, remote, kind === "task" ? metadataFallback : undefined),
    deleted: remote.deleted === true || remote.status === "cancelled",
    recurring: Boolean(remote.recurringEventId || remote.recurrence?.length),
    ...(kind === "task" ? {
      structure: { parent: remote.parent ?? null, position: remote.position ?? null },
      taskNotesWire: typeof remote.notes === "string" ? remote.notes : "",
      taskMetadataRetained: !splitHcbTaskMetadata(remote.notes).metadata && Boolean(metadataFallback)
    } : {})
  };
}

/** Object key order is not a change; array order remains significant. */
export function syncValuesEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object") return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length &&
      left.every((value, index) => syncValuesEqual(value, right[index]));
  }
  const a = left as Record<string, unknown>, b = right as Record<string, unknown>;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key) && syncValuesEqual(a[key], b[key]));
}

export function changedSyncFields(base: SyncFields, value: SyncFields): string[] {
  return [...new Set([...Object.keys(base), ...Object.keys(value)])]
    .filter((key) => !syncValuesEqual(base[key], value[key])).sort();
}

export interface SyncMergeResult {
  fields: SyncFields;
  localChanges: string[];
  remoteChanges: string[];
  conflicts: string[];
}

/** Related fields must be grouped by the caller before comparing versions. */
export function mergeSyncFields(base: SyncFields, local: SyncFields, remote: SyncFields): SyncMergeResult {
  const localChanges = changedSyncFields(base, local);
  const remoteChanges = changedSyncFields(base, remote);
  const localSet = new Set(localChanges);
  const remoteSet = new Set(remoteChanges);
  const conflicts = localChanges.filter((key) => remoteSet.has(key) && !syncValuesEqual(local[key], remote[key]));
  const fields: SyncFields = { ...remote };
  // Keep the complete local value for a conflict. Never discard either side's
  // baseline/review data by presenting an arbitrary last writer as a merge.
  for (const key of localSet) {
    if (Object.hasOwn(local, key)) fields[key] = local[key];
    else delete fields[key];
  }
  return { fields, localChanges, remoteChanges, conflicts };
}

/**
 * Compare the editable projection of full Google resources / outgoing bodies.
 * Task metadata is independently mergeable even though Google stores it in one
 * notes string. Calendar time, reminders and arrays are indivisible values.
 * Conference creation is a command and is deliberately handled by delivery.
 */
export function googleSyncFields(kind: GoogleEntityKind, body: JsonRecord, fallback?: SyncFields): SyncFields {
  if (kind === "taskList") return { title: body.title ?? "" };
  if (kind === "task") {
    const parsed = splitHcbTaskMetadata(body.notes);
    const metadata = parsed.metadata;
    return {
      title: body.title ?? "Untitled task", notes: parsed.notes,
      due: typeof body.due === "string" && body.due ? body.due.slice(0, 10) : null,
      status: body.status === "completed" ? "completed" : "needsAction",
      priority: metadata ? metadata.priority : fallback?.priority ?? "none", tags: metadata ? metadata.tags : fallback?.tags ?? [],
      planning: metadata ? {
        plannedStart: canonicalInstant(metadata?.plannedStart), plannedEnd: canonicalInstant(metadata?.plannedEnd),
        durationMinutes: metadata?.durationMinutes ?? null, lockedSchedule: Boolean(metadata?.lockedSchedule)
      } : fallback?.planning ?? { plannedStart: null, plannedEnd: null, durationMinutes: null, lockedSchedule: false },
      snoozeUntil: metadata ? canonicalInstant(metadata.snoozeUntil) : fallback?.snoozeUntil ?? null
    };
  }
  return {
    summary: body.summary ?? "Untitled event", description: body.description ?? "",
    location: body.location || "", colorId: body.colorId || null,
    time: { start: eventTime(body.start), end: eventTime(body.end) },
    recurrence: body.recurrence ?? [], attendees: body.attendees ?? [],
    reminders: body.reminders?.useDefault === false
      ? { useDefault: false, overrides: body.reminders.overrides ?? [] } : { useDefault: true },
    transparency: body.transparency || "opaque", visibility: body.visibility || "default",
    eventType: {
      type: body.eventType || "default",
      focusTimeProperties: body.focusTimeProperties ?? null,
      outOfOfficeProperties: body.outOfOfficeProperties ?? null,
      workingLocationProperties: body.workingLocationProperties ?? null
    },
    // An unmanaged attachment list is absent from an outgoing body, not a
    // request to erase attachments added by another client.
    attachments: body.attachments ? body.attachments.map((attachment: JsonRecord) => ({
      fileUrl: attachment.fileUrl,
      title: attachment.title || attachment.fileUrl,
      ...(attachment.mimeType ? { mimeType: attachment.mimeType } : {})
    })) : fallback?.attachments ?? []
  };
}

export function googleBodyFromSyncFields(kind: GoogleEntityKind, fields: SyncFields): JsonRecord {
  if (kind === "taskList") return { title: fields.title };
  if (kind === "task") return {
    title: fields.title,
    notes: withHcbTaskMetadata(fields.notes, {
      priority: fields.priority, tags: fields.tags, ...fields.planning, snoozeUntil: fields.snoozeUntil
    }),
    due: fields.due ? `${fields.due}T00:00:00.000Z` : null,
    status: fields.status
  };
  return {
    summary: fields.summary, description: fields.description, location: fields.location,
    colorId: fields.colorId, start: fields.time.start, end: fields.time.end,
    recurrence: fields.recurrence, attendees: fields.attendees, reminders: fields.reminders,
    transparency: fields.transparency, visibility: fields.visibility, attachments: fields.attachments,
    ...(fields.eventType.type !== "default" ? { eventType: fields.eventType.type } : {}),
    ...Object.fromEntries(["focusTimeProperties", "outOfOfficeProperties", "workingLocationProperties"]
      .filter((key) => fields.eventType[key] !== null).map((key) => [key, fields.eventType[key]]))
  };
}

/** Omit unchanged keys; explicit empty/null values clear optional fields. */
export function googlePatchFromSyncFields(kind: GoogleEntityKind, base: SyncFields, desired: SyncFields): JsonRecord {
  const before = googleBodyFromSyncFields(kind, base);
  const after = googleBodyFromSyncFields(kind, desired);
  if (kind === "task" && ["priority", "tags", "planning", "snoozeUntil"].some((field) => !syncValuesEqual(base[field], desired[field])) &&
    !splitHcbTaskMetadata(after.notes).metadata) {
    // Absence retains HCB-only values when Google clients edit ordinary text.
    // An HCB reset must therefore encode explicit defaults instead of absence.
    after.notes = withHcbTaskMetadata(desired.notes, {
      priority: desired.priority, tags: desired.tags, ...desired.planning, snoozeUntil: desired.snoozeUntil
    }, { includeDefaults: true });
  }
  const keys = changedSyncFields(before, after);
  // Calendar dates are a pair. Sending both also avoids mixed all-day/timed
  // boundaries when a partial update changes the event's representation.
  if (kind === "event" && (keys.includes("start") || keys.includes("end"))) {
    for (const key of ["start", "end"]) if (!keys.includes(key)) keys.push(key);
  }
  return Object.fromEntries(keys.map((key) => [key, after[key] ?? null]));
}

export function mergeGoogleVersions(base: GoogleSyncBaseline, local: SyncFields, remote: GoogleSyncBaseline): SyncMergeResult {
  const result = mergeSyncFields(base.fields, local, remote.fields);
  const structural: string[] = [];
  if (base.remoteId !== remote.remoteId || base.collectionId !== remote.collectionId) structural.push("location");
  if (!syncValuesEqual(base.structure, remote.structure)) structural.push("structure");
  if (base.deleted !== remote.deleted || remote.deleted) structural.push("deletion");
  // An ETag change on a series/exception may include changes outside HCB's
  // projection (e.g. an exception). Do not infer that it is safe to rebase.
  if ((base.recurring || remote.recurring || Boolean(local.recurrence?.length)) && base.etag !== remote.etag) structural.push("recurrence");
  return { ...result, conflicts: [...new Set([...result.conflicts, ...structural])].sort() };
}

function canonicalInstant(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  const date = Date.parse(value);
  return Number.isFinite(date) ? new Date(date).toISOString() : value;
}

function eventTime(value: JsonRecord | undefined): JsonRecord | null {
  if (!value) return null;
  return {
    ...(value.date ? { date: value.date } : { dateTime: canonicalInstant(value.dateTime) }),
    ...(value.timeZone ? { timeZone: value.timeZone } : {})
  };
}
