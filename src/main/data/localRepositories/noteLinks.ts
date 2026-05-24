export type PlannerLinkKind = "note" | "task" | "event";

export interface PlannerLinkReference {
  kind: PlannerLinkKind;
  label: string;
  raw: string;
}

export interface NotePropertyEntry {
  key: string;
  value: string;
}

export function extractPlannerLinks(body: string): PlannerLinkReference[] {
  const pattern = /\[\[([^\]]{1,160})\]\]/g;
  const seen = new Map<string, PlannerLinkReference>();
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(body)) !== null) {
    const raw = match[1]?.trim();
    if (!raw) {
      continue;
    }
    const [maybeKind, ...rest] = raw.split(":");
    const kindToken = maybeKind.toLowerCase();
    const isExplicit = (kindToken === "note" || kindToken === "task" || kindToken === "event") && rest.length > 0;
    const reference: PlannerLinkReference = isExplicit
      ? { kind: kindToken as PlannerLinkKind, label: rest.join(":").trim(), raw }
      : { kind: "note", label: raw, raw };

    const key = `${reference.kind}::${reference.label.toLowerCase()}`;
    if (!seen.has(key)) {
      seen.set(key, reference);
    }
  }

  return Array.from(seen.values());
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
