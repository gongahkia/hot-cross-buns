type JsonRecord = Record<string, unknown>;

const markerPrefix = "[HCB task metadata v1:";
const markerPattern = /(?:\r?\n){0,2}\[HCB task metadata v1:([A-Za-z0-9_-]+)\]\s*$/;
const priorities = new Set(["high", "medium", "low", "none"]);

export interface HcbTaskMetadata {
  durationMinutes: number | null;
  lockedSchedule: boolean;
  plannedEnd: string | null;
  plannedStart: string | null;
  priority: "high" | "medium" | "low" | "none";
  snoozeUntil: string | null;
  tags: string[];
}

/**
 * Google Tasks does not model HCB planning fields. Store only those fields in
 * a small, versioned footer in `notes`; ordinary user text remains unchanged
 * in HCB and in Google. The marker is deliberately explicit rather than
 * hidden or inferred from a title, which prevents accidental parsing of a
 * user's natural-language task.
 */
export function withHcbTaskMetadata(notes: unknown, source: JsonRecord): string {
  const base = splitHcbTaskMetadata(notes).notes;
  const metadata = taskMetadataForSync(source);
  if (Object.keys(metadata).length === 0) return base;
  const encoded = Buffer.from(JSON.stringify(metadata), "utf8").toString("base64url");
  return `${base}${base ? "\n\n" : ""}${markerPrefix}${encoded}]`;
}

export function splitHcbTaskMetadata(value: unknown): { metadata: HcbTaskMetadata | null; notes: string } {
  const notes = typeof value === "string" ? value : "";
  const match = notes.match(markerPattern);
  if (!match?.[1] || match.index === undefined) return { notes, metadata: null };
  try {
    const decoded = JSON.parse(Buffer.from(match[1], "base64url").toString("utf8"));
    const metadata = normalizeTaskMetadata(decoded);
    if (!metadata) return { notes, metadata: null };
    return { notes: notes.slice(0, match.index), metadata };
  } catch {
    return { notes, metadata: null };
  }
}

function taskMetadataForSync(source: JsonRecord): HcbTaskMetadata {
  const priority = typeof source.priority === "string" && priorities.has(source.priority) ? source.priority as HcbTaskMetadata["priority"] : "none";
  const tags = parseTags(source.tags);
  const durationMinutes = positiveInteger(source.durationMinutes);
  const plannedStart = validDateTime(source.plannedStart) ? source.plannedStart : null;
  const plannedEnd = validDateTime(source.plannedEnd) ? source.plannedEnd : null;
  const snoozeUntil = validDateTime(source.snoozeUntil) ? source.snoozeUntil : null;
  const lockedSchedule = source.lockedSchedule === true || source.lockedSchedule === 1;
  const metadata: HcbTaskMetadata = {
    priority, tags, plannedStart, plannedEnd, durationMinutes: durationMinutes ?? null, lockedSchedule, snoozeUntil
  };
  return priority !== "none" || tags.length > 0 || plannedStart || plannedEnd || durationMinutes || lockedSchedule || snoozeUntil
    ? metadata
    : {} as HcbTaskMetadata;
}

function normalizeTaskMetadata(value: unknown): HcbTaskMetadata | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as JsonRecord;
  const priority = typeof source.priority === "string" && priorities.has(source.priority)
    ? source.priority as HcbTaskMetadata["priority"]
    : "none";
  const tags = parseTags(source.tags);
  const durationMinutes = positiveInteger(source.durationMinutes);
  const metadata: HcbTaskMetadata = {
    priority,
    tags,
    plannedStart: validDateTime(source.plannedStart) ? source.plannedStart : null,
    plannedEnd: validDateTime(source.plannedEnd) ? source.plannedEnd : null,
    durationMinutes: durationMinutes ?? null,
    lockedSchedule: source.lockedSchedule === true,
    snoozeUntil: validDateTime(source.snoozeUntil) ? source.snoozeUntil : null
  };
  // Older HCB versions may have written an empty or partially understood
  // marker. Treat that as regular text rather than overriding local values.
  return Object.keys(source).some((key) => ["priority", "tags", "plannedStart", "plannedEnd", "durationMinutes", "lockedSchedule", "snoozeUntil"].includes(key))
    ? metadata
    : null;
}

function parseTags(value: unknown): string[] {
  const candidate = typeof value === "string"
    ? (() => { try { return JSON.parse(value); } catch { return []; } })()
    : value;
  if (!Array.isArray(candidate)) return [];
  return [...new Set(candidate.filter((item): item is string => typeof item === "string")
    .map((item) => item.trim()).filter(Boolean).map((item) => item.slice(0, 100)))].slice(0, 100);
}

function positiveInteger(value: unknown): number | undefined {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isInteger(number) && number > 0 && number <= 10_080 ? number : undefined;
}

function validDateTime(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}
