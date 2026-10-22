export type AutoTagTargetKind = "task" | "event" | "note";
export interface AutoTagInput { hcbKind?: string | null; [key: string]: unknown; }
export function validateAutoTagRule(rule: any): any {
  return rule?.name ? [] : [{ field: "name", message: "A rule needs a name." }];
}
export function previewAutoTagRules(rules: readonly any[], _input: AutoTagInput): any {
  return { traces: rules.map((rule, index) => ({ ruleId: rule.id ?? String(index), ruleName: rule.name ?? "Rule", order: index + 1, status: rule.enabled === false ? "disabled" : "no-output", issues: [], tagsAdded: [], eventColorStatus: "not-configured" })) };
}
