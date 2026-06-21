export {
  extractPlannerLinks,
  normalizedPlannerLinkLabel,
  parsePlannerLink,
  plannerLinkDisplayLabel,
  plannerLinkKinds,
  plannerLinkMarker,
  type PlannerLinkKind,
  type PlannerLinkReference,
  type PlannerLinkType
} from "@shared/plannerLinks";

export interface NotePropertyEntry {
  key: string;
  value: string;
}

export function extractNoteProperties(body: string): NotePropertyEntry[] {
  const supportedKeys = new Set(["status", "tags", "project", "date", "source"]);
  const entries: NotePropertyEntry[] = [];
  const seenKeys = new Set<string>();

  for (const line of body.split(/\r?\n/).slice(0, 12)) {
    const match = /^([a-zA-Z][\w-]{1,24}):\s*(.+)$/.exec(line.trim());
    if (!match) {
      continue;
    }
    const key = match[1].toLowerCase();
    const value = match[2].trim();
    if (supportedKeys.has(key) && value && !seenKeys.has(key)) {
      entries.push({ key, value });
      seenKeys.add(key);
    }
  }

  return entries;
}
