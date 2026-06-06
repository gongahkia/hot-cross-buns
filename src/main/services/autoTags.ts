import type { AutoTagRule } from "@shared/ipc/contracts";

export type AutoTagTargetKind = "task" | "event" | "note";

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

export function applyAutoTagRules(rules: readonly AutoTagRule[], input: AutoTagInput): AutoTagResult {
  if (input.hcbKind === "birthday") {
    return {
      title: input.title,
      body: input.body,
      tags: normalizeTags(input.explicitTags ?? input.existingTags ?? []),
      eventColorId: input.requestedEventColorId
    };
  }

  let title = input.title;
  let body = input.body;
  let eventColorId = input.requestedEventColorId;
  const tags = normalizeTags([...(input.existingTags ?? []), ...(input.explicitTags ?? [])]);

  for (const rule of rules) {
    if (!rule.enabled || !rule.targetKinds.includes(input.kind) || rule.tags.length === 0) {
      continue;
    }

    const match = ruleMatches(rule, title, body);

    if (!match.matched) {
      continue;
    }

    mergeTags(tags, rule.tags);

    if (input.kind === "event" && rule.eventColorId) {
      const hasExplicitColor = input.requestedEventColorId !== undefined && input.requestedEventColorId !== null;
      const hasExistingColor = input.existingEventColorId !== undefined && input.existingEventColorId !== null;

      if (rule.overrideExistingEventColor || (!hasExplicitColor && !hasExistingColor)) {
        eventColorId = rule.eventColorId;
      }
    }

    if (rule.stripMatchedPrefix && rule.matchType === "prefix") {
      if (match.field === "title") {
        title = stripPrefix(title, rule.pattern);
      } else if (match.field === "body") {
        body = stripPrefix(body, rule.pattern);
      }
    }
  }

  return { title, body, tags, eventColorId };
}

export function normalizeTags(tags: readonly string[]): string[] {
  const normalized: string[] = [];
  mergeTags(normalized, tags);
  return normalized;
}

function mergeTags(target: string[], incoming: readonly string[]): void {
  const seen = new Set(target.map((tag) => tag.toLocaleLowerCase()));

  for (const value of incoming) {
    const tag = value.trim();
    const key = tag.toLocaleLowerCase();

    if (!tag || seen.has(key)) {
      continue;
    }

    target.push(tag);
    seen.add(key);
  }
}

function ruleMatches(
  rule: AutoTagRule,
  title: string,
  body: string
): { matched: boolean; field?: "title" | "body" } {
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

  try {
    return new RegExp(pattern, "i").test(candidate);
  } catch {
    return false;
  }
}

function stripPrefix(value: string, prefix: string): string {
  if (!value.toLocaleLowerCase().startsWith(prefix.toLocaleLowerCase())) {
    return value;
  }

  return value.slice(prefix.length).replace(/^[\s:;-]+/, "");
}
