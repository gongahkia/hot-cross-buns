import type { AutoTagRule } from "./contracts";

export type AutoTagTargetKind = "task" | "event" | "note";
export type AutoTagMatchField = "title" | "body";
export type AutoTagRuleTraceStatus =
  | "disabled"
  | "target-mismatch"
  | "invalid"
  | "no-output"
  | "not-matched"
  | "matched";
export type AutoTagEventColorStatus =
  | "not-configured"
  | "not-event"
  | "applied"
  | "skipped-explicit"
  | "skipped-existing";

export interface AutoTagInput {
  kind: AutoTagTargetKind;
  title: string;
  body: string;
  explicitTags?: readonly string[];
  existingTags?: readonly string[];
  existingEventColorId?: string | null;
  requestedEventColorId?: string | null;
  hcbKind?: string | null;
}

export interface AutoTagResult {
  title: string;
  body: string;
  tags: string[];
  eventColorId?: string | null;
}

export interface AutoTagRuleValidationIssue {
  ruleId: string;
  ruleName: string;
  field: "pattern" | "targetKinds" | "output";
  severity: "error" | "warning";
  message: string;
}

export interface AutoTagRuleTrace {
  ruleId: string;
  ruleName: string;
  order: number;
  status: AutoTagRuleTraceStatus;
  issues: AutoTagRuleValidationIssue[];
  matchedField?: AutoTagMatchField;
  tagsAdded: string[];
  strippedField?: AutoTagMatchField;
  eventColorId?: string | null;
  eventColorStatus: AutoTagEventColorStatus;
  titleAfter: string;
  bodyAfter: string;
  tagsAfter: string[];
}

export interface AutoTagPreviewResult extends AutoTagResult {
  traces: AutoTagRuleTrace[];
  issues: AutoTagRuleValidationIssue[];
  matchedRuleCount: number;
  hasConflicts: boolean;
  invalidRuleIds: string[];
}

export function applyAutoTagRules(rules: readonly AutoTagRule[], input: AutoTagInput): AutoTagResult {
  return evaluateAutoTagRules(rules, input).result;
}

export function previewAutoTagRules(rules: readonly AutoTagRule[], input: AutoTagInput): AutoTagPreviewResult {
  const evaluated = evaluateAutoTagRules(rules, input);
  const matchedRuleCount = evaluated.traces.filter((trace) => trace.status === "matched").length;

  return {
    ...evaluated.result,
    traces: evaluated.traces,
    issues: evaluated.issues,
    matchedRuleCount,
    hasConflicts: matchedRuleCount > 1,
    invalidRuleIds: [...new Set(evaluated.issues
      .filter((issue) => issue.severity === "error")
      .map((issue) => issue.ruleId))]
  };
}

export function validateAutoTagRule(rule: AutoTagRule): AutoTagRuleValidationIssue[] {
  const issues: AutoTagRuleValidationIssue[] = [];

  if (rule.targetKinds.length === 0) {
    issues.push(ruleIssue(rule, "targetKinds", "error", "Select at least one target."));
  }

  if (rule.pattern.trim().length === 0) {
    issues.push(ruleIssue(rule, "pattern", "error", "Pattern is required."));
  }

  if (rule.matchType === "regex" && rule.pattern.trim().length > 0) {
    const compiled = compileRegex(rule.pattern);

    if (!compiled.ok) {
      issues.push(ruleIssue(rule, "pattern", "error", `Invalid regex: ${compiled.message}`));
    }
  }

  if (rule.tags.length === 0 && !rule.eventColorId) {
    issues.push(ruleIssue(rule, "output", "warning", "Add tags or an event color so the rule has an output."));
  }

  if (rule.tags.length === 0 && rule.eventColorId && !rule.targetKinds.includes("event")) {
    issues.push(ruleIssue(rule, "output", "warning", "Event color only applies to event targets."));
  }

  return issues;
}

export function normalizeTags(tags: readonly string[]): string[] {
  const normalized: string[] = [];
  mergeTags(normalized, tags);
  return normalized;
}

function evaluateAutoTagRules(
  rules: readonly AutoTagRule[],
  input: AutoTagInput
): { result: AutoTagResult; traces: AutoTagRuleTrace[]; issues: AutoTagRuleValidationIssue[] } {
  if (input.hcbKind === "birthday") {
    const result = {
      title: input.title,
      body: input.body,
      tags: normalizeTags(input.explicitTags ?? input.existingTags ?? []),
      eventColorId: input.requestedEventColorId
    };

    return { result, traces: [], issues: [] };
  }

  let title = input.title;
  let body = input.body;
  let eventColorId = input.requestedEventColorId;
  const tags = normalizeTags([...(input.existingTags ?? []), ...(input.explicitTags ?? [])]);
  const traces: AutoTagRuleTrace[] = [];
  const issues: AutoTagRuleValidationIssue[] = [];

  rules.forEach((rule, index) => {
    const ruleIssues = validateAutoTagRule(rule);
    issues.push(...ruleIssues);

    const baseTrace = {
      ruleId: rule.id,
      ruleName: rule.name,
      order: index + 1,
      issues: ruleIssues,
      tagsAdded: [],
      eventColorStatus: "not-configured" as const,
      titleAfter: title,
      bodyAfter: body,
      tagsAfter: [...tags]
    };

    if (!rule.enabled) {
      traces.push({ ...baseTrace, status: "disabled" });
      return;
    }

    if (!rule.targetKinds.includes(input.kind)) {
      traces.push({ ...baseTrace, status: "target-mismatch" });
      return;
    }

    if (ruleIssues.some((issue) => issue.severity === "error")) {
      traces.push({ ...baseTrace, status: "invalid" });
      return;
    }

    if (!ruleHasOutputForInput(rule, input.kind)) {
      traces.push({ ...baseTrace, status: "no-output" });
      return;
    }

    const match = ruleMatches(rule, title, body);

    if (!match.matched) {
      traces.push({ ...baseTrace, status: "not-matched" });
      return;
    }

    const tagsAdded = mergeTags(tags, rule.tags);
    let strippedField: AutoTagMatchField | undefined;

    if (rule.stripMatchedPrefix && rule.matchType === "prefix") {
      if (match.field === "title") {
        title = stripPrefix(title, rule.pattern);
        strippedField = "title";
      } else if (match.field === "body") {
        body = stripPrefix(body, rule.pattern);
        strippedField = "body";
      }
    }

    const colorStatus = applyEventColor(rule, input, (nextColorId) => {
      eventColorId = nextColorId;
    });

    traces.push({
      ...baseTrace,
      status: "matched",
      matchedField: match.field,
      tagsAdded,
      strippedField,
      eventColorId: eventColorId ?? null,
      eventColorStatus: colorStatus,
      titleAfter: title,
      bodyAfter: body,
      tagsAfter: [...tags]
    });
  });

  return {
    result: { title, body, tags, eventColorId },
    traces,
    issues
  };
}

function applyEventColor(
  rule: AutoTagRule,
  input: AutoTagInput,
  applyColor: (eventColorId: string) => void
): AutoTagEventColorStatus {
  if (!rule.eventColorId) {
    return "not-configured";
  }

  if (input.kind !== "event") {
    return "not-event";
  }

  const hasExplicitColor = input.requestedEventColorId !== undefined && input.requestedEventColorId !== null;
  const hasExistingColor = input.existingEventColorId !== undefined && input.existingEventColorId !== null;

  if (rule.overrideExistingEventColor || (!hasExplicitColor && !hasExistingColor)) {
    applyColor(rule.eventColorId);
    return "applied";
  }

  return hasExplicitColor ? "skipped-explicit" : "skipped-existing";
}

function ruleHasOutputForInput(rule: AutoTagRule, kind: AutoTagTargetKind): boolean {
  return rule.tags.length > 0 || (kind === "event" && Boolean(rule.eventColorId));
}

function ruleIssue(
  rule: AutoTagRule,
  field: AutoTagRuleValidationIssue["field"],
  severity: AutoTagRuleValidationIssue["severity"],
  message: string
): AutoTagRuleValidationIssue {
  return {
    ruleId: rule.id,
    ruleName: rule.name,
    field,
    severity,
    message
  };
}

function mergeTags(target: string[], incoming: readonly string[]): string[] {
  const added: string[] = [];
  const seen = new Set(target.map((tag) => tag.toLocaleLowerCase()));

  for (const value of incoming) {
    const tag = value.trim();
    const key = tag.toLocaleLowerCase();

    if (!tag || seen.has(key)) {
      continue;
    }

    target.push(tag);
    added.push(tag);
    seen.add(key);
  }

  return added;
}

function ruleMatches(
  rule: AutoTagRule,
  title: string,
  body: string
): { matched: boolean; field?: AutoTagMatchField } {
  const fields = rule.matchField === "title"
    ? [{ key: "title" as const, value: title }]
    : rule.matchField === "body"
      ? [{ key: "body" as const, value: body }]
      : [
          { key: "title" as const, value: title },
          { key: "body" as const, value: body }
        ];

  for (const field of fields) {
    if (matchesValue(rule, field.value)) {
      return { matched: true, field: field.key };
    }
  }

  return { matched: false };
}

function matchesValue(rule: AutoTagRule, value: string): boolean {
  const candidate = value.trim();
  const pattern = rule.pattern.trim();

  if (!candidate || !pattern) {
    return false;
  }

  if (rule.matchType === "prefix") {
    return candidate.toLocaleLowerCase().startsWith(pattern.toLocaleLowerCase());
  }

  if (rule.matchType === "contains") {
    return candidate.toLocaleLowerCase().includes(pattern.toLocaleLowerCase());
  }

  const compiled = compileRegex(pattern);
  return compiled.ok ? compiled.regex.test(candidate) : false;
}

function compileRegex(pattern: string): { ok: true; regex: RegExp } | { ok: false; message: string } {
  try {
    return { ok: true, regex: new RegExp(pattern, "i") };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "could not compile pattern"
    };
  }
}

function stripPrefix(value: string, prefix: string): string {
  if (!value.toLocaleLowerCase().startsWith(prefix.toLocaleLowerCase())) {
    return value;
  }

  return value.slice(prefix.length).replace(/^[\s:;-]+/, "");
}
