import { addUtcDaysIso, startOfUtcDayIso } from "../domain/calendar";

export const LOCAL_SEARCH_DOMAINS = ["tasks", "calendar", "notes"] as const;

export type LocalSearchDomain = (typeof LOCAL_SEARCH_DOMAINS)[number];
export type LocalSearchTaskStatus = "active" | "completed" | "hidden" | "deleted";
export type LocalSearchPriority = "none" | "low" | "medium" | "high";
export type LocalSearchDateField = "due" | "start";

export interface LocalSearchDateFilter {
  field: LocalSearchDateField;
  mode: "range" | "present" | "missing";
  from?: string;
  to?: string;
  label: string;
}

export interface LocalSearchDurationFilter {
  fromMinutes?: number;
  toMinutes?: number;
  label: string;
}

export interface LocalSearchFilters {
  domains?: LocalSearchDomain[];
  taskStatus?: LocalSearchTaskStatus;
  due?: LocalSearchDateFilter;
  start?: LocalSearchDateFilter;
  priority?: LocalSearchPriority;
  listTitle?: string;
  calendarTitle?: string;
  hasBody?: boolean;
  tag?: string;
  attendee?: string;
  duration?: LocalSearchDurationFilter;
  regex?: string;
}

export interface LocalSearchFilterChip {
  id: string;
  label: string;
  value: string;
}

export interface LocalSearchQueryIssue {
  code: string;
  message: string;
  token?: string;
}

export interface ParsedLocalSearchQuery {
  raw: string;
  text: string;
  filters: LocalSearchFilters;
  chips: LocalSearchFilterChip[];
  errors: LocalSearchQueryIssue[];
  explain: string[];
  boolean?: LocalSearchBooleanNode;
}

export type LocalSearchBooleanNode =
  | { kind: "term"; token: string }
  | { kind: "not"; child: LocalSearchBooleanNode }
  | { kind: "and" | "or"; left: LocalSearchBooleanNode; right: LocalSearchBooleanNode };

export interface LocalSearchMatcherItem {
  domain: LocalSearchDomain;
  title: string;
  body?: string | null;
  taskStatus?: LocalSearchTaskStatus;
  dueAt?: string | null;
  priority?: LocalSearchPriority | null;
  listTitle?: string | null;
  startAt?: string | null;
  calendarTitle?: string | null;
  tags?: readonly string[];
  attendeeEmails?: readonly string[];
  durationMinutes?: number | null;
}

interface ParseOptions {
  now?: string | Date;
}

interface TokenizeResult {
  tokens: string[];
  errors: LocalSearchQueryIssue[];
}

const FILTER_KEYS = new Set([
  "source",
  "domain",
  "status",
  "due",
  "start",
  "priority",
  "list",
  "calendar",
  "cal",
  "notes",
  "body",
  "tag",
  "attendee",
  "duration",
  "regex"
]);

const DOMAIN_ALIASES: Record<string, LocalSearchDomain | undefined> = {
  task: "tasks",
  tasks: "tasks",
  todo: "tasks",
  todos: "tasks",
  calendar: "calendar",
  calendars: "calendar",
  cal: "calendar",
  event: "calendar",
  events: "calendar",
  note: "notes",
  notes: "notes"
};

const STATUS_ALIASES: Record<string, LocalSearchTaskStatus | undefined> = {
  active: "active",
  open: "active",
  todo: "active",
  incomplete: "active",
  completed: "completed",
  complete: "completed",
  done: "completed",
  hidden: "hidden",
  deleted: "deleted",
  removed: "deleted"
};

const PRIORITY_ALIASES: Record<string, LocalSearchPriority | undefined> = {
  none: "none",
  no: "none",
  low: "low",
  medium: "medium",
  med: "medium",
  high: "high"
};

const TRUE_VALUES = new Set(["yes", "true", "1", "has", "present", "any"]);
const FALSE_VALUES = new Set(["no", "false", "0", "none", "missing", "empty"]);
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const RELATIVE_DAY_PATTERN = /^\+(\d{1,3})d$/;
const MAX_REGEX_LENGTH = 120;
const MAX_REGEX_GROUPS = 8;
const MAX_REGEX_QUANTIFIERS = 12;
const MAX_REGEX_REPEAT_BOUND = 100;

export function parseLocalSearchQuery(
  input: string,
  options: ParseOptions = {}
): ParsedLocalSearchQuery {
  const raw = input.trim();
  const filters: LocalSearchFilters = {};
  const chips: LocalSearchFilterChip[] = [];
  const textTerms: string[] = [];
  const tokenized = tokenize(raw);
  const errors = [...tokenized.errors];
  const now = normalizedNow(options.now);
  const boolean = parseBooleanExpression(tokenized.tokens, errors);
  const booleanMode = boolean !== undefined;

  for (const token of tokenized.tokens) {
    if (isBooleanSyntaxToken(token)) {
      continue;
    }

    const comparisonIssue = parseMalformedComparisonFilterToken(token);

    if (comparisonIssue !== null) {
      errors.push(comparisonIssue);
      continue;
    }

    const parsedFilter = parseComparisonFilterToken(token) ?? parseFilterToken(token);

    if (!parsedFilter) {
      if (booleanMode) {
        continue;
      }
      textTerms.push(token);
      continue;
    }

    const { key, value } = parsedFilter;

    if (booleanMode) {
      continue;
    }

    if (!FILTER_KEYS.has(key)) {
      errors.push({
        code: "unknown_filter",
        message: `Unsupported search filter "${key}".`,
        token
      });
      continue;
    }

    if (!value) {
      errors.push({
        code: "missing_filter_value",
        message: `Add a value after "${key}:".`,
        token
      });
      continue;
    }

    if (key === "source" || key === "domain") {
      const domains = parseDomains(value);

      if (domains.length === 0) {
        errors.push({
          code: "invalid_domain",
          message: `Unsupported source "${value}". Use tasks, calendar, or notes.`,
          token
        });
        continue;
      }

      filters.domains = mergeDomains(filters.domains, domains);
      upsertChip(chips, {
        id: "source",
        label: "Source",
        value: filters.domains.join(", ")
      });
      continue;
    }

    if (key === "status") {
      const status = STATUS_ALIASES[value.toLowerCase()];

      if (!status) {
        errors.push({
          code: "invalid_status",
          message: `Unsupported task status "${value}". Use active, completed, hidden, or deleted.`,
          token
        });
        continue;
      }

      if (filters.taskStatus !== undefined) {
        errors.push(duplicateFilter("status", token));
        continue;
      }

      filters.taskStatus = status;
      chips.push({ id: "status", label: "Status", value: status });
      continue;
    }

    if (key === "priority") {
      const priority = PRIORITY_ALIASES[value.toLowerCase()];

      if (!priority) {
        errors.push({
          code: "invalid_priority",
          message: `Unsupported priority "${value}". Use none, low, medium, or high.`,
          token
        });
        continue;
      }

      if (filters.priority !== undefined) {
        errors.push(duplicateFilter("priority", token));
        continue;
      }

      filters.priority = priority;
      chips.push({ id: "priority", label: "Priority", value: priority });
      continue;
    }

    if (key === "due" || key === "start") {
      const dateFilter = parsedFilter.operator
        ? parseDateComparisonFilter(key, parsedFilter.operator, value, now)
        : parseDateFilter(key, value, now);

      if (!dateFilter) {
        errors.push({
          code: "invalid_date_window",
          message: `Unsupported ${key} window "${value}". Use YYYY-MM-DD, today, before:YYYY-MM-DD, after:YYYY-MM-DD, or YYYY-MM-DD..YYYY-MM-DD.`,
          token
        });
        continue;
      }

      if (filters[key] !== undefined) {
        errors.push(duplicateFilter(key, token));
        continue;
      }

      filters[key] = dateFilter;
      chips.push({ id: key, label: titleCase(key), value: dateFilter.label });
      continue;
    }

    if (key === "duration") {
      const durationFilter = parseDurationFilter(value, parsedFilter.operator);

      if (!durationFilter) {
        errors.push({
          code: "invalid_duration",
          message: `Unsupported duration "${value}". Use duration>30m, duration<2h, or duration:30m..90m.`,
          token
        });
        continue;
      }

      if (filters.duration !== undefined) {
        errors.push(duplicateFilter("duration", token));
        continue;
      }

      filters.duration = durationFilter;
      chips.push({ id: "duration", label: "Duration", value: durationFilter.label });
      continue;
    }

    if (key === "list") {
      if (filters.listTitle !== undefined) {
        errors.push(duplicateFilter("list", token));
        continue;
      }

      filters.listTitle = value;
      chips.push({ id: "list", label: "List", value });
      continue;
    }

    if (key === "calendar" || key === "cal") {
      if (filters.calendarTitle !== undefined) {
        errors.push(duplicateFilter("calendar", token));
        continue;
      }

      filters.calendarTitle = value;
      chips.push({ id: "calendar", label: "Calendar", value });
      continue;
    }

    if (key === "notes" || key === "body") {
      const hasBody = parseBoolean(value);

      if (hasBody === undefined) {
        errors.push({
          code: "invalid_presence",
          message: `Unsupported ${key} presence "${value}". Use yes or no.`,
          token
        });
        continue;
      }

      if (filters.hasBody !== undefined) {
        errors.push(duplicateFilter("notes/body", token));
        continue;
      }

      filters.hasBody = hasBody;
      chips.push({ id: "body", label: "Body", value: hasBody ? "yes" : "no" });
      continue;
    }

    if (key === "tag") {
      if (filters.tag !== undefined) {
        errors.push(duplicateFilter("tag", token));
        continue;
      }

      filters.tag = value;
      chips.push({ id: "tag", label: "Tag", value });
      continue;
    }

    if (key === "attendee") {
      if (filters.attendee !== undefined) {
        errors.push(duplicateFilter("attendee", token));
        continue;
      }

      filters.attendee = value;
      chips.push({ id: "attendee", label: "Attendee", value });
      continue;
    }

    if (key === "regex") {
      const regex = parseRegexFilter(value);

      if (!regex) {
        errors.push({
          code: "invalid_regex",
          message: "Use a valid regex pattern up to 120 chars.",
          token
        });
        continue;
      }

      if (filters.regex !== undefined) {
        errors.push(duplicateFilter("regex", token));
        continue;
      }

      filters.regex = regex;
      chips.push({ id: "regex", label: "Regex", value });
    }
  }

  return {
    raw,
    text: textTerms.join(" ").trim(),
    filters,
    chips,
    errors,
    explain: explainLocalSearch(textTerms, chips, boolean),
    ...(boolean === undefined ? {} : { boolean })
  };
}

function explainLocalSearch(
  textTerms: readonly string[],
  chips: readonly LocalSearchFilterChip[],
  boolean: LocalSearchBooleanNode | undefined
): string[] {
  const explain: string[] = [];
  const text = textTerms.join(" ").trim();

  if (boolean) {
    explain.push(`Boolean: ${booleanLabel(boolean)}`);
  } else if (text) {
    explain.push(`Text: ${text}`);
  }

  for (const chip of chips) {
    explain.push(`${chip.label}: ${chip.value}`);
  }

  return explain;
}

function booleanLabel(node: LocalSearchBooleanNode): string {
  if (node.kind === "term") {
    return node.token;
  }

  if (node.kind === "not") {
    return `NOT ${booleanLabel(node.child)}`;
  }

  return `(${booleanLabel(node.left)} ${node.kind.toUpperCase()} ${booleanLabel(node.right)})`;
}

export function hasRunnableLocalSearch(parsed: ParsedLocalSearchQuery): boolean {
  return parsed.errors.length === 0 &&
    (parsed.text.length > 0 || parsed.chips.length > 0 || parsed.boolean !== undefined);
}

export function resolveLocalSearchDomains(
  parsed: ParsedLocalSearchQuery,
  requestDomains?: readonly LocalSearchDomain[]
): LocalSearchDomain[] {
  let domains = new Set<LocalSearchDomain>(requestDomains ?? LOCAL_SEARCH_DOMAINS);

  if (parsed.filters.domains !== undefined) {
    domains = intersectDomains(domains, parsed.filters.domains);
  }

  if (
    parsed.filters.taskStatus !== undefined ||
    parsed.filters.priority !== undefined ||
    parsed.filters.due !== undefined ||
    parsed.filters.listTitle !== undefined ||
    parsed.filters.duration !== undefined
  ) {
    domains = intersectDomains(domains, ["tasks"]);
  }

  if (
    parsed.filters.start !== undefined ||
    parsed.filters.calendarTitle !== undefined ||
    parsed.filters.attendee !== undefined
  ) {
    domains = intersectDomains(domains, ["calendar"]);
  }

  return LOCAL_SEARCH_DOMAINS.filter((domain) => domains.has(domain));
}

export function matchesLocalSearchItem(
  parsed: ParsedLocalSearchQuery,
  item: LocalSearchMatcherItem
): boolean {
  if (parsed.errors.length > 0) {
    return false;
  }

  if (!resolveLocalSearchDomains(parsed).includes(item.domain)) {
    return false;
  }

  if (parsed.boolean !== undefined && !matchesBooleanNode(parsed.boolean, item)) {
    return false;
  }

  if (!matchesText(parsed.text, item)) {
    return false;
  }

  if (parsed.filters.regex !== undefined && !matchesRegex(parsed.filters.regex, item)) {
    return false;
  }

  if (parsed.filters.hasBody !== undefined && hasContent(item.body) !== parsed.filters.hasBody) {
    return false;
  }

  if (parsed.filters.taskStatus !== undefined) {
    if (item.domain !== "tasks" || item.taskStatus !== parsed.filters.taskStatus) {
      return false;
    }
  }

  if (parsed.filters.priority !== undefined) {
    if (item.domain !== "tasks" || (item.priority ?? "none") !== parsed.filters.priority) {
      return false;
    }
  }

  if (parsed.filters.listTitle !== undefined) {
    if (
      item.domain !== "tasks" ||
      !containsNormalized(item.listTitle ?? "", parsed.filters.listTitle)
    ) {
      return false;
    }
  }

  if (parsed.filters.calendarTitle !== undefined) {
    if (
      item.domain !== "calendar" ||
      !containsNormalized(item.calendarTitle ?? "", parsed.filters.calendarTitle)
    ) {
      return false;
    }
  }

  if (parsed.filters.due !== undefined) {
    if (item.domain !== "tasks" || !matchesDateFilter(item.dueAt ?? null, parsed.filters.due)) {
      return false;
    }
  }

  if (parsed.filters.start !== undefined) {
    if (item.domain !== "calendar" || !matchesDateFilter(item.startAt ?? null, parsed.filters.start)) {
      return false;
    }
  }

  if (parsed.filters.tag !== undefined && !matchesTag(item.tags ?? [], parsed.filters.tag)) {
    return false;
  }

  if (parsed.filters.attendee !== undefined) {
    if (item.domain !== "calendar" || !matchesListFragment(item.attendeeEmails ?? [], parsed.filters.attendee)) {
      return false;
    }
  }

  if (parsed.filters.duration !== undefined) {
    if (item.domain !== "tasks" || !matchesDuration(item.durationMinutes ?? null, parsed.filters.duration)) {
      return false;
    }
  }

  return true;
}

function tokenize(input: string): TokenizeResult {
  const tokens: string[] = [];
  const errors: LocalSearchQueryIssue[] = [];
  let current = "";
  let inQuote = false;

  for (const character of input) {
    if (character === "\"") {
      inQuote = !inQuote;
      continue;
    }

    if (!inQuote && (character === "(" || character === ")") && !current.toLowerCase().startsWith("regex:")) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
      tokens.push(character);
      continue;
    }

    if (/\s/.test(character) && !inQuote) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += character;
  }

  if (current.length > 0) {
    tokens.push(current);
  }

  if (inQuote) {
    errors.push({
      code: "unclosed_quote",
      message: "Close the quoted search value."
    });
  }

  return { tokens, errors };
}

function parseBooleanExpression(
  tokens: readonly string[],
  errors: LocalSearchQueryIssue[]
): LocalSearchBooleanNode | undefined {
  if (!tokens.some(isBooleanSyntaxToken)) {
    return undefined;
  }

  const parser = new BooleanQueryParser(tokens);
  const node = parser.parse();

  errors.push(...parser.errors);
  return node ?? undefined;
}

function isBooleanSyntaxToken(token: string): boolean {
  const upper = token.toUpperCase();
  return upper === "AND" || upper === "OR" || upper === "NOT" || token === "(" || token === ")";
}

class BooleanQueryParser {
  readonly errors: LocalSearchQueryIssue[] = [];
  private index = 0;

  constructor(private readonly tokens: readonly string[]) {}

  parse(): LocalSearchBooleanNode | null {
    const node = this.parseOr();

    if (this.index < this.tokens.length) {
      this.errors.push({
        code: "invalid_boolean_query",
        message: `Unexpected boolean token "${this.tokens[this.index]}".`,
        token: this.tokens[this.index]
      });
    }

    return node;
  }

  private parseOr(): LocalSearchBooleanNode | null {
    let left = this.parseAnd();

    while (this.match("OR")) {
      const right = this.parseAnd();
      if (!left || !right) {
        this.errors.push({
          code: "invalid_boolean_query",
          message: "Add a search term on both sides of OR."
        });
        return left ?? right;
      }
      left = { kind: "or", left, right };
    }

    return left;
  }

  private parseAnd(): LocalSearchBooleanNode | null {
    let left = this.parseNot();

    while (this.match("AND")) {
      const right = this.parseNot();
      if (!left || !right) {
        this.errors.push({
          code: "invalid_boolean_query",
          message: "Add a search term on both sides of AND."
        });
        return left ?? right;
      }
      left = { kind: "and", left, right };
    }

    return left;
  }

  private parseNot(): LocalSearchBooleanNode | null {
    if (this.match("NOT")) {
      const child = this.parseNot();
      if (!child) {
        this.errors.push({
          code: "invalid_boolean_query",
          message: "Add a search term after NOT."
        });
        return null;
      }
      return { kind: "not", child };
    }

    return this.parsePrimary();
  }

  private parsePrimary(): LocalSearchBooleanNode | null {
    const token = this.tokens[this.index];

    if (token === undefined) {
      return null;
    }

    if (token === "(") {
      this.index += 1;
      const node = this.parseOr();
      if (!this.match(")")) {
        this.errors.push({
          code: "invalid_boolean_query",
          message: "Close the boolean search group with )."
        });
      }
      return node;
    }

    if (token === ")") {
      return null;
    }

    if (isBooleanSyntaxToken(token)) {
      this.errors.push({
        code: "invalid_boolean_query",
        message: `Unexpected boolean operator "${token}".`,
        token
      });
      this.index += 1;
      return null;
    }

    this.index += 1;
    return { kind: "term", token };
  }

  private match(token: string): boolean {
    const current = this.tokens[this.index];
    if (current === undefined) {
      return false;
    }

    if (token === ")" ? current === ")" : current.toUpperCase() === token) {
      this.index += 1;
      return true;
    }

    return false;
  }
}

function matchesBooleanNode(node: LocalSearchBooleanNode, item: LocalSearchMatcherItem): boolean {
  if (node.kind === "term") {
    return matchesBooleanTerm(node.token, item);
  }

  if (node.kind === "not") {
    return !matchesBooleanNode(node.child, item);
  }

  if (node.kind === "and") {
    return matchesBooleanNode(node.left, item) && matchesBooleanNode(node.right, item);
  }

  return matchesBooleanNode(node.left, item) || matchesBooleanNode(node.right, item);
}

function matchesBooleanTerm(token: string, item: LocalSearchMatcherItem): boolean {
  const parsedFilter = parseComparisonFilterToken(token) ?? parseFilterToken(token);

  if (!parsedFilter) {
    return matchesText(token, item);
  }

  const { key, value } = parsedFilter;

  if ((key === "source" || key === "domain") && value) {
    return parseDomains(value).includes(item.domain);
  }

  if (key === "tag" && value) {
    return matchesTag(item.tags ?? [], value);
  }

  if ((key === "notes" || key === "body") && value) {
    const hasBody = parseBoolean(value);
    return hasBody === undefined ? false : hasContent(item.body) === hasBody;
  }

  if (key === "status" && value) {
    return item.domain === "tasks" && item.taskStatus === STATUS_ALIASES[value.toLowerCase()];
  }

  if (key === "priority" && value) {
    return item.domain === "tasks" && (item.priority ?? "none") === PRIORITY_ALIASES[value.toLowerCase()];
  }

  if (key === "list" && value) {
    return item.domain === "tasks" && containsNormalized(item.listTitle ?? "", value);
  }

  if ((key === "calendar" || key === "cal") && value) {
    return item.domain === "calendar" && containsNormalized(item.calendarTitle ?? "", value);
  }

  if (key === "attendee" && value) {
    return item.domain === "calendar" && matchesListFragment(item.attendeeEmails ?? [], value);
  }

  return matchesText(value, item);
}

function parseFilterToken(token: string): { key: string; value: string; operator?: "<" | ">" } | null {
  if (token.includes("://")) {
    return null;
  }

  const separatorIndex = token.indexOf(":");

  if (separatorIndex <= 0) {
    return null;
  }

  const key = token.slice(0, separatorIndex).toLowerCase();

  if (!/^[a-z][a-z-]*$/.test(key)) {
    return null;
  }

  return {
    key,
    value: token.slice(separatorIndex + 1).trim()
  };
}

function parseComparisonFilterToken(token: string): { key: string; value: string; operator: "<" | ">" } | null {
  const match = /^(due|start|duration)([<>])(.+)$/i.exec(token);

  if (!match) {
    return null;
  }

  return {
    key: match[1].toLowerCase(),
    operator: match[2] as "<" | ">",
    value: match[3].trim()
  };
}

function parseMalformedComparisonFilterToken(token: string): LocalSearchQueryIssue | null {
  const match = /^(due|start|duration)(<=|>=|<|>|=)(.*)$/i.exec(token);

  if (!match) {
    return null;
  }

  const key = match[1].toLowerCase();
  const operator = match[2];
  const value = match[3].trim();

  if ((operator === "<" || operator === ">") && value.length > 0) {
    return null;
  }

  return {
    code: operator === "<" || operator === ">" ? "missing_filter_value" : "invalid_filter_operator",
    message:
      key === "duration"
        ? `Use duration>30m, duration<2h, or duration:30m..90m.`
        : `Use ${key}<+7d or ${key}>today.`,
    token
  };
}

function parseDomains(value: string): LocalSearchDomain[] {
  const domains = value
    .split(",")
    .map((part) => DOMAIN_ALIASES[part.trim().toLowerCase()])
    .filter((domain): domain is LocalSearchDomain => domain !== undefined);

  if (domains.length !== value.split(",").filter((part) => part.trim().length > 0).length) {
    return [];
  }

  return LOCAL_SEARCH_DOMAINS.filter((domain) => domains.includes(domain));
}

function parseBoolean(value: string): boolean | undefined {
  const normalized = value.toLowerCase();

  if (TRUE_VALUES.has(normalized)) {
    return true;
  }

  if (FALSE_VALUES.has(normalized)) {
    return false;
  }

  return undefined;
}

function parseDateFilter(
  field: LocalSearchDateField,
  value: string,
  now: Date
): LocalSearchDateFilter | null {
  const normalized = value.toLowerCase();

  if (normalized === "any" || normalized === "present") {
    return {
      field,
      mode: "present",
      label: "present"
    };
  }

  if (normalized === "none" || normalized === "missing") {
    return {
      field,
      mode: "missing",
      label: "missing"
    };
  }

  if (normalized === "today" || normalized === "tomorrow" || normalized === "yesterday") {
    const offset = normalized === "tomorrow" ? 1 : normalized === "yesterday" ? -1 : 0;
    const from = addUtcDaysIso(startOfUtcDayIso(now), offset);

    return {
      field,
      mode: "range",
      from,
      to: addUtcDaysIso(from, 1),
      label: normalized
    };
  }

  if (normalized.startsWith("before:")) {
    const date = parseDateOnly(value.slice("before:".length));

    return date === null
      ? null
      : {
          field,
          mode: "range",
          to: date,
          label: `before ${date.slice(0, 10)}`
        };
  }

  if (normalized.startsWith("after:")) {
    const date = parseDateOnly(value.slice("after:".length));

    return date === null
      ? null
      : {
          field,
          mode: "range",
          from: date,
          label: `on/after ${date.slice(0, 10)}`
        };
  }

  if (value.includes("..")) {
    const [start, end] = value.split("..");
    const from = parseDateOnly(start);
    const endDay = parseDateOnly(end);

    if (from === null || endDay === null || from > endDay) {
      return null;
    }

    return {
      field,
      mode: "range",
      from,
      to: addUtcDaysIso(endDay, 1),
      label: `${from.slice(0, 10)} to ${endDay.slice(0, 10)}`
    };
  }

  const exact = parseDateOnly(value);

  return exact === null
    ? null
    : {
        field,
        mode: "range",
        from: exact,
        to: addUtcDaysIso(exact, 1),
        label: exact.slice(0, 10)
      };
}

function parseDateComparisonFilter(
  field: LocalSearchDateField,
  operator: "<" | ">",
  value: string,
  now: Date
): LocalSearchDateFilter | null {
  const date = parseDateAlias(value, now);

  if (date === null) {
    return null;
  }

  return operator === "<"
    ? {
        field,
        mode: "range",
        to: date,
        label: `before ${value}`
      }
    : {
        field,
        mode: "range",
        from: date,
        label: `on/after ${value}`
      };
}

function parseDateAlias(value: string, now: Date): string | null {
  const normalized = value.toLowerCase();
  const relative = RELATIVE_DAY_PATTERN.exec(normalized);

  if (relative) {
    return addUtcDaysIso(startOfUtcDayIso(now), Number.parseInt(relative[1], 10));
  }

  if (normalized === "today") {
    return startOfUtcDayIso(now);
  }

  if (normalized === "tomorrow") {
    return addUtcDaysIso(startOfUtcDayIso(now), 1);
  }

  if (normalized === "yesterday") {
    return addUtcDaysIso(startOfUtcDayIso(now), -1);
  }

  return parseDateOnly(value);
}

function parseDurationFilter(value: string, operator?: "<" | ">"): LocalSearchDurationFilter | null {
  if (operator) {
    const minutes = parseDurationMinutes(value);

    if (minutes === null) {
      return null;
    }

    return operator === "<"
      ? { toMinutes: minutes - 1, label: `< ${durationLabel(minutes)}` }
      : { fromMinutes: minutes + 1, label: `> ${durationLabel(minutes)}` };
  }

  if (!value.includes("..")) {
    return null;
  }

  const [fromValue, toValue] = value.split("..");
  const fromMinutes = parseDurationMinutes(fromValue);
  const toMinutes = parseDurationMinutes(toValue);

  if (fromMinutes === null || toMinutes === null || fromMinutes > toMinutes) {
    return null;
  }

  return {
    fromMinutes,
    toMinutes,
    label: `${durationLabel(fromMinutes)} to ${durationLabel(toMinutes)}`
  };
}

function parseDurationMinutes(value: string | undefined): number | null {
  const match = /^(\d{1,4})(m|h)$/i.exec(value?.trim() ?? "");

  if (!match) {
    return null;
  }

  const amount = Number.parseInt(match[1], 10);
  const minutes = match[2].toLowerCase() === "h" ? amount * 60 : amount;

  return minutes > 0 && minutes <= 24 * 60 ? minutes : null;
}

function durationLabel(minutes: number): string {
  return minutes % 60 === 0 ? `${minutes / 60}h` : `${minutes}m`;
}

function parseRegexFilter(value: string): string | null {
  if (!isSafeLocalRegexPattern(value)) {
    return null;
  }

  try {
    new RegExp(value, "i");
    return value;
  } catch {
    return null;
  }
}

function isSafeLocalRegexPattern(value: string): boolean {
  if (value.length === 0 || value.length > MAX_REGEX_LENGTH) {
    return false;
  }

  if (/\\[1-9]|\\k<[^>]+>/.test(value)) {
    return false;
  }

  if (/\(\?(?!!|=|:)/.test(value) || /\(\?(?:[=!]|<[=!])/.test(value)) {
    return false;
  }

  if (value.includes("|")) {
    return false;
  }

  if ((value.match(/\(/g) ?? []).length > MAX_REGEX_GROUPS) {
    return false;
  }

  if ((value.match(/[+*?]|\{\d{1,5}(?:,\d{0,5})?\}/g) ?? []).length > MAX_REGEX_QUANTIFIERS) {
    return false;
  }

  if (/\((?:[^()\\]|\\.)*[+*?{](?:[^()\\]|\\.)*\)(?:[+*?]|\{\d{1,5}(?:,\d{0,5})?\})/.test(value)) {
    return false;
  }

  for (const match of value.matchAll(/\{(\d{1,5})(?:,(\d{0,5}))?\}/g)) {
    const lower = Number.parseInt(match[1], 10);
    const upper = match[2] === undefined || match[2] === "" ? lower : Number.parseInt(match[2], 10);

    if (!Number.isFinite(lower) || !Number.isFinite(upper) || upper > MAX_REGEX_REPEAT_BOUND || lower > upper) {
      return false;
    }
  }

  if (/\{\d{1,5},\}/.test(value)) {
    return false;
  }

  return true;
}

function parseDateOnly(value: string | undefined): string | null {
  if (value === undefined || !DATE_ONLY_PATTERN.test(value)) {
    return null;
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);

  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    return null;
  }

  return parsed.toISOString();
}

function normalizedNow(value: string | Date | undefined): Date {
  if (value === undefined) {
    return new Date();
  }

  const parsed = typeof value === "string" ? new Date(value) : value;

  return Number.isFinite(parsed.getTime()) ? parsed : new Date();
}

function matchesTag(tags: readonly string[], query: string): boolean {
  return tags.some((tag) => containsNormalized(tag, query));
}

function matchesListFragment(values: readonly string[], query: string): boolean {
  return values.some((value) => containsNormalized(value, query));
}

function matchesDuration(minutes: number | null, filter: LocalSearchDurationFilter): boolean {
  if (minutes === null || !Number.isFinite(minutes)) {
    return false;
  }

  if (filter.fromMinutes !== undefined && minutes < filter.fromMinutes) {
    return false;
  }

  if (filter.toMinutes !== undefined && minutes > filter.toMinutes) {
    return false;
  }

  return true;
}

function matchesRegex(pattern: string, item: LocalSearchMatcherItem): boolean {
  return matchesLocalSearchTextRegex(pattern, item.title, item.body);
}

export function matchesLocalSearchTextRegex(
  pattern: string,
  title: string,
  body?: string | null
): boolean {
  const regex = new RegExp(pattern, "i");
  return regex.test(`${title}\n${body ?? ""}`);
}

function duplicateFilter(key: string, token: string): LocalSearchQueryIssue {
  return {
    code: "duplicate_filter",
    message: `Use ${key}: only once in a search query.`,
    token
  };
}

function mergeDomains(
  existing: LocalSearchDomain[] | undefined,
  next: LocalSearchDomain[]
): LocalSearchDomain[] {
  const merged = new Set<LocalSearchDomain>(existing ?? []);

  for (const domain of next) {
    merged.add(domain);
  }

  return LOCAL_SEARCH_DOMAINS.filter((domain) => merged.has(domain));
}

function upsertChip(chips: LocalSearchFilterChip[], chip: LocalSearchFilterChip): void {
  const existingIndex = chips.findIndex((candidate) => candidate.id === chip.id);

  if (existingIndex === -1) {
    chips.push(chip);
    return;
  }

  chips[existingIndex] = chip;
}

function intersectDomains(
  existing: Set<LocalSearchDomain>,
  next: readonly LocalSearchDomain[]
): Set<LocalSearchDomain> {
  return new Set(next.filter((domain) => existing.has(domain)));
}

function titleCase(value: string): string {
  return `${value[0].toUpperCase()}${value.slice(1)}`;
}

function hasContent(value: string | null | undefined): boolean {
  return (value ?? "").trim().length > 0;
}

function containsNormalized(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

function matchesText(text: string, item: LocalSearchMatcherItem): boolean {
  const tokens = normalizeTerms(text);

  if (tokens.length === 0) {
    return true;
  }

  const haystack = [
    item.title,
    item.body ?? "",
    item.listTitle ?? "",
    item.calendarTitle ?? ""
  ]
    .join(" ")
    .normalize("NFKD")
    .toLowerCase();

  return tokens.every((token) => haystack.includes(token));
}

function normalizeTerms(value: string): string[] {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .match(/[a-z0-9]+/g) ?? [];
}

function matchesDateFilter(value: string | null, filter: LocalSearchDateFilter): boolean {
  if (filter.mode === "present") {
    return value !== null;
  }

  if (filter.mode === "missing") {
    return value === null;
  }

  if (value === null) {
    return false;
  }

  const timestamp = new Date(value).getTime();

  if (!Number.isFinite(timestamp)) {
    return false;
  }

  if (filter.from !== undefined && timestamp < new Date(filter.from).getTime()) {
    return false;
  }

  if (filter.to !== undefined && timestamp >= new Date(filter.to).getTime()) {
    return false;
  }

  return true;
}
