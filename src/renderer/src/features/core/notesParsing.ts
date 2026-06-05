export interface NoteProperty {
  key: string;
  value: string;
}

export type PlannerLinkKind = "note" | "task" | "event";

export interface PlannerLinkReference {
  kind: PlannerLinkKind;
  label: string;
  raw: string;
}

export function buildNotePreview(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) {
    return "Empty note";
  }

  return trimmed.length > 92 ? `${trimmed.slice(0, 89)}...` : trimmed;
}

export function normalizedNoteTitle(title: string): string {
  return title.trim().toLowerCase();
}

export function extractNoteLinks(body: string): string[] {
  const links = new Set<string>();
  const pattern = /\[\[([^\]]{1,160})\]\]/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(body)) !== null) {
    const title = match[1]?.trim();

    if (title) {
      links.add(title);
    }
  }

  return Array.from(links);
}

export function parsePlannerLink(raw: string): PlannerLinkReference {
  const [maybeKind, ...rest] = raw.split(":");
  const kind = maybeKind.toLowerCase();

  if ((kind === "note" || kind === "task" || kind === "event") && rest.length > 0) {
    return {
      kind,
      label: rest.join(":").trim(),
      raw
    };
  }

  return {
    kind: "note",
    label: raw.trim(),
    raw
  };
}

export function extractNoteProperties(body: string): NoteProperty[] {
  const supportedKeys = new Set(["status", "tags", "project", "date", "source"]);
  const properties: NoteProperty[] = [];

  for (const line of body.split(/\r?\n/).slice(0, 12)) {
    const match = /^([a-zA-Z][\w-]{1,24}):\s*(.+)$/.exec(line.trim());

    if (!match) {
      continue;
    }

    const key = match[1].toLowerCase();
    const value = match[2].trim();

    if (supportedKeys.has(key) && value) {
      properties.push({ key, value });
    }
  }

  return properties;
}
