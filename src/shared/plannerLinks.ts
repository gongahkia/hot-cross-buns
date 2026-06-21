export const plannerLinkKinds = ["note", "task", "event", "list", "calendar"] as const;

export type PlannerLinkKind = (typeof plannerLinkKinds)[number];
export type PlannerLinkType = "wikilink" | "transclusion";

export interface PlannerLinkReference {
  alias: string | null;
  kind: PlannerLinkKind;
  label: string;
  raw: string;
  targetId: string | null;
  type: PlannerLinkType;
}

const plannerLinkKindSet = new Set<string>(plannerLinkKinds);

export function normalizedPlannerLinkLabel(value: string): string {
  return value.trim().toLowerCase();
}

export function parsePlannerLink(value: string, type: PlannerLinkType = "wikilink"): PlannerLinkReference {
  const raw = value.trim();
  const [targetPart, aliasPart] = splitPlannerLinkAlias(raw);
  const [maybeKind, ...rest] = targetPart.split(":");
  const kindToken = maybeKind.toLowerCase();
  const hasExplicitKind = plannerLinkKindSet.has(kindToken) && rest.length > 0;
  const kind = hasExplicitKind ? kindToken as PlannerLinkKind : "note";
  const label = (hasExplicitKind ? rest.join(":") : targetPart).trim();
  const targetId = label.startsWith("#") ? label.slice(1).trim() || null : null;
  const alias = aliasPart?.trim() || null;

  return {
    alias,
    kind,
    label,
    raw,
    targetId,
    type
  };
}

export function extractPlannerLinks(body: string): PlannerLinkReference[] {
  const pattern = /(!?)\[\[([^\]]{1,220})\]\]/g;
  const seen = new Map<string, PlannerLinkReference>();
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(body)) !== null) {
    const raw = match[2]?.trim();

    if (!raw) {
      continue;
    }

    const reference = parsePlannerLink(raw, match[1] === "!" ? "transclusion" : "wikilink");
    const key = [
      reference.type,
      reference.kind,
      reference.targetId ?? normalizedPlannerLinkLabel(reference.label),
      normalizedPlannerLinkLabel(reference.raw)
    ].join("::");

    if (!seen.has(key)) {
      seen.set(key, reference);
    }
  }

  return Array.from(seen.values());
}

export function plannerLinkDisplayLabel(link: PlannerLinkReference): string {
  return link.alias ?? link.label.replace(/^#/, "");
}

export function plannerLinkMarker(kind: PlannerLinkKind, label: string, alias?: string | null): string {
  const target = `${kind}:${label.trim()}`;
  return alias?.trim() ? `[[${target}|${alias.trim()}]]` : `[[${target}]]`;
}

function splitPlannerLinkAlias(raw: string): [target: string, alias: string | null] {
  const index = raw.indexOf("|");
  return index === -1 ? [raw, null] : [raw.slice(0, index), raw.slice(index + 1)];
}
