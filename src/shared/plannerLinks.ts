export const plannerLinkMarker = "hcb";
export const plannerLinkKinds = ["task", "event", "note"] as const;
export type PlannerLinkKind = any;
export type PlannerLinkType = any;
export type PlannerLinkReference = any;
export function extractPlannerLinks(value: string): any {
  return [...value.matchAll(/hotcrossbuns:\/\/(task|event|note)\/([^\s)]+)/g)].map((match) => ({ raw: match[0], type: match[1], kind: match[1], id: match[2], targetId: match[2] }));
}
export function parsePlannerLink(...args: any[]): any { return extractPlannerLinks(String(args[0] ?? ""))[0] ?? null; }
export function plannerLinkDisplayLabel(...args: any[]): any { const link = args[0]; return link?.label ?? link?.id ?? ""; }
export function normalizedPlannerLinkLabel(...args: any[]): any { return String(plannerLinkDisplayLabel(args[0])).toLowerCase(); }
