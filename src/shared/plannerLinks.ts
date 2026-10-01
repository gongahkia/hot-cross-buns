export const plannerLinkMarker = "hcb";
export const plannerLinkKinds = ["task", "event", "note"] as const;
export type PlannerLinkKind = any;
export type PlannerLinkType = any;
export type PlannerLinkReference = any;
export function extractPlannerLinks(value: string): any[] {
  const links = [...String(value).matchAll(/\[\[([^\]]{1,300})\]\]/g)]
    .map((match) => parsePlannerLink(match[1], "wikilink"))
    .filter(Boolean);
  const directLinks = [...String(value).matchAll(/hotcrossbuns:\/\/(task|event|note)\/([^\s)|\]]+)/g)]
    .map((match) => parsePlannerLink(match[0], "url"))
    .filter(Boolean);
  return [...links, ...directLinks];
}

/**
 * The stable in-body reference format is `[[hcb:task:<id>|Label]]`.  It keeps
 * the remote/local identifier separate from a human-readable label so renamed
 * tasks and events do not break a reference. Legacy `[[task:Label]]` and raw
 * `hotcrossbuns://task/<id>` links remain readable.
 */
export function parsePlannerLink(value: unknown, type: PlannerLinkType = "wikilink"): any {
  const raw = String(value ?? "").trim().replace(/^\[\[|\]\]$/g, "");
  const stable = /^hcb:(task|event|note):([^|\s]+)(?:\|(.+))?$/i.exec(raw);
  if (stable) {
    return {
      id: stable[2],
      kind: stable[1].toLowerCase(),
      label: stable[3]?.trim() || stable[2],
      raw,
      targetId: stable[2],
      type
    };
  }
  const url = /^hotcrossbuns:\/\/(task|event|note)\/([^\s)|\]]+)(?:\|(.+))?$/i.exec(raw);
  if (url) {
    return {
      id: url[2],
      kind: url[1].toLowerCase(),
      label: url[3]?.trim() || url[2],
      raw,
      targetId: url[2],
      type
    };
  }
  const legacy = /^(task|event|note):(.+)$/i.exec(raw);
  if (legacy) {
    return {
      kind: legacy[1].toLowerCase(),
      label: legacy[2].trim(),
      raw,
      targetId: undefined,
      type
    };
  }
  return null;
}
export function plannerLinkDisplayLabel(...args: any[]): any { const link = args[0]; return link?.label ?? link?.id ?? ""; }
export function normalizedPlannerLinkLabel(...args: any[]): any { return String(plannerLinkDisplayLabel(args[0])).toLowerCase(); }
