import { rrulestr } from "rrule";

/**
 * Google Calendar stores a recurrence as RFC 5545 property lines, while its
 * DTSTART lives in the Event's `start`.  This module deliberately keeps the
 * property text intact except for the two changes required to split a series:
 *
 * - the old master is bounded immediately before the selected occurrence;
 * - COUNT values on the successor are reduced by the number of rule
 *   occurrences which remain with the old master.
 *
 * RDATE and EXDATE lines are split value-by-value.  This is important: Google
 * commonly serializes several dates in a single property line.
 */
export interface GoogleRecurrenceSplitInput {
  allDay: boolean;
  lines: string[];
  /** DTSTART of the old Google master, as an RFC 3339 instant. */
  seriesStartsAt: string;
  /** Original start of the occurrence selected for the split. */
  splitAt: string;
  timeZone?: string | null;
}

export interface GoogleRecurrenceSplit {
  parentLines: string[];
  successorLines: string[];
}

export interface GoogleRecurrenceExpansionInput {
  allDay: boolean;
  endsAt: string;
  lines: string[];
  rangeEnd: string;
  rangeStart: string;
  startsAt: string;
  timeZone?: string | null;
}

export interface GoogleRecurrenceOccurrence {
  originalStartAt: string;
  startsAt: string;
  endsAt: string;
}

interface ParsedProperty {
  name: "RRULE" | "EXRULE" | "RDATE" | "EXDATE";
  prefix: string;
  value: string;
}

/**
 * Partition an exact Google Calendar recurrence set at `splitAt`.
 *
 * The returned sets have the same behavior as the original before and from
 * the boundary respectively.  We intentionally throw for malformed or
 * unsupported date syntax instead of silently retaining it on the wrong
 * master. Google will continue to accept/preserve those lines outside of a
 * split operation.
 */
export function splitGoogleRecurrenceLines(input: GoogleRecurrenceSplitInput): GoogleRecurrenceSplit {
  const split = splitBoundary(input.splitAt, input.allDay, input.timeZone);
  const absoluteSplit = absoluteSplitBoundary(input.splitAt, input.allDay);
  const parentLines: string[] = [];
  const successorLines: string[] = [];

  for (const line of input.lines) {
    const property = parseProperty(line);
    switch (property.name) {
      case "RRULE": {
        const parent = truncateRule(property, absoluteSplit, input.allDay, input.timeZone);
        if (parent) parentLines.push(parent);
        const successor = successorRule(property, input.seriesStartsAt, input.splitAt, input.allDay, input.timeZone);
        if (successor) successorLines.push(successor);
        break;
      }
      case "EXRULE": {
        // The parent is already bounded by its RRULE/RDATE set. Keeping the
        // original EXRULE retains every pre-split exclusion without needing to
        // alter an EXRULE's own expansion boundary.
        parentLines.push(line);
        const successor = successorRule(property, input.seriesStartsAt, input.splitAt, input.allDay, input.timeZone);
        if (successor) successorLines.push(successor);
        break;
      }
      case "RDATE":
      case "EXDATE": {
        const { before, from } = partitionExplicitDates(property, split, input.allDay, input.timeZone);
        if (before.length) parentLines.push(`${property.prefix}:${before.join(",")}`);
        if (from.length) successorLines.push(`${property.prefix}:${from.join(",")}`);
        break;
      }
    }
  }

  return { parentLines, successorLines };
}

/** Convert an RFC 3339 originalStartTime into the value accepted by instances.originalStart. */
export function googleOriginalStartQueryValue(value: string, allDay: boolean): string {
  if (allDay) return value.slice(0, 10);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error("Recurring split date is invalid.");
  return new Date(parsed).toISOString();
}

/**
 * Express cancelling one otherwise-unmodified generated instance as an
 * EXDATE. This is the native Calendar recurrence representation—no HCB
 * metadata or fake standalone event is needed.
 */
export function withGoogleExdate(
  lines: string[],
  originalStartAt: string,
  allDay: boolean,
  timeZone?: string | null
): string[] {
  const value = allDay
    ? originalStartAt.slice(0, 10).replace(/-/g, "")
    : basicDateTime(floatingFromAbsolute(new Date(Date.parse(originalStartAt)), false, timeZone), false);
  if (!value || (allDay && !/^\d{8}$/.test(value))) throw new Error("Recurring occurrence date is invalid.");
  const prefix = allDay ? "EXDATE;VALUE=DATE" : `EXDATE;TZID=${timeZone || "UTC"}`;
  const normalized = `${prefix}:${value}`;
  if (lines.some((line) => line === normalized || (line.split(":", 1)[0] === prefix && line.slice(prefix.length + 1).split(",").includes(value)))) {
    return [...lines];
  }
  return [...lines, normalized];
}

/**
 * Expand only the requested window for Calendar rendering. The exact RFC
 * lines remain canonical; rrule is used solely to project their occurrences
 * into HCB's local, virtual calendar rows.
 */
export function expandGoogleRecurrenceLines(input: GoogleRecurrenceExpansionInput): GoogleRecurrenceOccurrence[] {
  if (!input.lines.length) return [];
  const duration = Math.max(1, Date.parse(input.endsAt) - Date.parse(input.startsAt));
  const start = floatingRecurrenceDate(input.startsAt, input.allDay, input.timeZone);
  const rangeStart = floatingRecurrenceDate(input.rangeStart, input.allDay, input.timeZone);
  const rangeEnd = floatingRecurrenceDate(input.rangeEnd, input.allDay, input.timeZone);
  try {
    const evaluatorLines = input.lines.map((line) => floatingEvaluatorLine(line, input.allDay, input.timeZone));
    const rule = rrulestr(`DTSTART:${basicDateTime(start, input.allDay)}\n${evaluatorLines.join("\n")}`, {
      compatible: true,
      forceset: true
    });
    const values = rule.between(new Date(rangeStart.getTime() - duration), rangeEnd, true, (_value, index) => index < 2_500);
    return values
      .map((value) => {
        const startsAt = absoluteIsoFromFloating(value, input.allDay, input.timeZone);
        return {
          originalStartAt: startsAt,
          startsAt,
          endsAt: new Date(Date.parse(startsAt) + duration).toISOString()
        };
      })
      .filter((occurrence) => occurrence.startsAt < input.rangeEnd && occurrence.endsAt > input.rangeStart)
      .sort((left, right) => left.startsAt.localeCompare(right.startsAt));
  } catch {
    // Never render invented occurrences when an exotic, provider-accepted
    // RFC line cannot be evaluated locally. The raw rule remains editable and
    // the next Google pull still retains it verbatim.
    return [];
  }
}

function parseProperty(line: string): ParsedProperty {
  const colon = line.indexOf(":");
  const prefix = colon > 0 ? line.slice(0, colon) : "";
  const name = prefix.split(";", 1)[0] as ParsedProperty["name"];
  if (!colon || !["RRULE", "EXRULE", "RDATE", "EXDATE"].includes(name)) {
    throw new Error("Google recurrence lines must be RRULE, EXRULE, RDATE, or EXDATE properties.");
  }
  return { name, prefix, value: line.slice(colon + 1) };
}

function floatingEvaluatorLine(line: string, allDay: boolean, timeZone?: string | null): string {
  const property = parseProperty(line);
  if (property.name === "RRULE" || property.name === "EXRULE") {
    const fields = ruleFields(property.value);
    const until = fields.get("UNTIL");
    if (until?.endsWith("Z")) {
      const instant = recurrenceValueDate(until, allDay, "UTC");
      fields.set("UNTIL", basicDateTime(floatingFromAbsolute(instant, allDay, timeZone), allDay));
    }
    return `${property.prefix}:${serializeRuleFields(fields)}`;
  }
  const zone = propertyTimeZone(property.prefix) ?? timeZone ?? "UTC";
  const values = property.value.split(",").map((value) => floatingExplicitValue(value, allDay, zone, timeZone));
  return `${property.prefix}:${values.join(",")}`;
}

function floatingExplicitValue(value: string, allDay: boolean, propertyZone: string, seriesZone?: string | null): string {
  const [start, end] = value.split("/");
  const normalize = (part: string | undefined): string | undefined => {
    if (!part || !part.endsWith("Z")) return part;
    const instant = recurrenceValueDate(part, allDay, "UTC");
    // A UTC RDATE has an absolute meaning, so convert it into the master
    // series' wall-clock time before rrule evaluates the set as floating.
    void propertyZone;
    return basicDateTime(floatingFromAbsolute(instant, allDay, seriesZone), allDay);
  };
  const normalizedStart = normalize(start) ?? start;
  const normalizedEnd = normalize(end);
  return normalizedEnd ? `${normalizedStart}/${normalizedEnd}` : normalizedStart;
}

function truncateRule(property: ParsedProperty, split: Date, allDay: boolean, timeZone?: string | null): string | null {
  const fields = ruleFields(property.value);
  const existingUntil = fields.get("UNTIL");
  const cutoff = untilImmediatelyBefore(split, allDay);
  const boundedUntil = existingUntil
    ? earlierUntil(existingUntil, cutoff, allDay, timeZone)
    : cutoff;
  fields.delete("COUNT");
  fields.set("UNTIL", boundedUntil);
  return `${property.prefix}:${serializeRuleFields(fields)}`;
}

function successorRule(
  property: ParsedProperty,
  seriesStartsAt: string,
  splitAt: string,
  allDay: boolean,
  timeZone?: string | null
): string | null {
  const fields = ruleFields(property.value);
  const count = positiveInteger(fields.get("COUNT"));
  if (count === null) return `${property.prefix}:${serializeRuleFields(fields)}`;

  const before = ruleOccurrencesBefore(property, seriesStartsAt, splitAt, allDay, timeZone);
  const remaining = Math.max(0, count - before);
  if (remaining === 0) return null;
  fields.set("COUNT", String(remaining));
  return `${property.prefix}:${serializeRuleFields(fields)}`;
}

function ruleFields(value: string): Map<string, string> {
  const fields = new Map<string, string>();
  for (const field of value.split(";")) {
    const equals = field.indexOf("=");
    if (equals <= 0) throw new Error("Google recurrence rule is malformed.");
    fields.set(field.slice(0, equals).toUpperCase(), field.slice(equals + 1));
  }
  if (!fields.get("FREQ")) throw new Error("Each Google recurrence rule must include FREQ.");
  return fields;
}

function serializeRuleFields(fields: Map<string, string>): string {
  return [...fields].map(([key, value]) => `${key}=${value}`).join(";");
}

function positiveInteger(value: string | undefined): number | null {
  if (value === undefined) return null;
  if (!/^\d+$/.test(value) || Number(value) < 1 || !Number.isSafeInteger(Number(value))) {
    throw new Error("Google recurrence COUNT must be a positive integer.");
  }
  return Number(value);
}

function ruleOccurrencesBefore(
  property: ParsedProperty,
  seriesStartsAt: string,
  splitAt: string,
  allDay: boolean,
  timeZone?: string | null
): number {
  const start = floatingRecurrenceDate(seriesStartsAt, allDay, timeZone);
  const split = floatingRecurrenceDate(splitAt, allDay, timeZone);
  try {
    // rrule works in "floating" UTC fields. This is intentional: recurrence
    // COUNT is based on a local calendar pattern, not elapsed milliseconds.
    // Translating both bounds to the series' wall-clock fields makes DST
    // transitions count correctly without altering the original RFC text.
    // rrule parses a standalone EXRULE as an empty RRuleSet. For COUNT math
    // we need that rule's own generated dates, so evaluate it as RRULE while
    // preserving its original EXRULE text everywhere else.
    const evaluatorPrefix = property.name === "EXRULE" ? property.prefix.replace(/^EXRULE/i, "RRULE") : property.prefix;
    const rule = rrulestr(`${evaluatorPrefix}:${property.value}`, { dtstart: start });
    return rule.between(new Date(start.getTime() - 1), new Date(split.getTime() - 1), true).length;
  } catch (error) {
    throw new Error(`Could not evaluate Google ${property.name} COUNT while splitting: ${error instanceof Error ? error.message : "invalid rule"}`);
  }
}

function partitionExplicitDates(
  property: ParsedProperty,
  split: Date,
  allDay: boolean,
  defaultTimeZone?: string | null
): { before: string[]; from: string[] } {
  const timeZone = propertyTimeZone(property.prefix) ?? defaultTimeZone ?? "UTC";
  const before: string[] = [];
  const from: string[] = [];
  for (const value of property.value.split(",")) {
    const startValue = value.split("/", 1)[0] ?? value;
    const date = recurrenceValueDate(startValue, allDay, timeZone);
    if (date.getTime() < split.getTime()) before.push(value);
    else from.push(value);
  }
  return { before, from };
}

function splitBoundary(value: string, allDay: boolean, timeZone?: string | null): Date {
  return floatingRecurrenceDate(value, allDay, timeZone);
}

function absoluteSplitBoundary(value: string, allDay: boolean): Date {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error("Recurring split date is invalid.");
  if (!allDay) return new Date(parsed);
  const date = new Date(parsed);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function floatingRecurrenceDate(value: string, allDay: boolean, timeZone?: string | null): Date {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error("Recurring split date is invalid.");
  if (allDay) {
    const date = new Date(parsed);
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  }
  const zone = timeZone || "UTC";
  const parts = datePartsInZone(new Date(parsed), zone);
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second));
}

function floatingFromAbsolute(value: Date, allDay: boolean, timeZone?: string | null): Date {
  if (allDay) return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  const parts = datePartsInZone(value, timeZone || "UTC");
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second));
}

function absoluteIsoFromFloating(value: Date, allDay: boolean, timeZone?: string | null): string {
  if (allDay) return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate())).toISOString();
  const target = {
    year: value.getUTCFullYear(), month: value.getUTCMonth() + 1, day: value.getUTCDate(),
    hour: value.getUTCHours(), minute: value.getUTCMinutes(), second: value.getUTCSeconds()
  };
  let instant = Date.UTC(target.year, target.month - 1, target.day, target.hour, target.minute, target.second);
  const zone = timeZone || "UTC";
  for (let pass = 0; pass < 4; pass += 1) {
    const actual = datePartsInZone(new Date(instant), zone);
    const wanted = Date.UTC(target.year, target.month - 1, target.day, target.hour, target.minute, target.second);
    const displayed = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second);
    if (wanted === displayed) break;
    instant += wanted - displayed;
  }
  return new Date(instant).toISOString();
}

function recurrenceValueDate(value: string, allDay: boolean, timeZone: string): Date {
  const basic = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!basic) throw new Error(`Cannot safely partition Google recurrence date ${value}.`);
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, zulu] = basic;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (!hourText || allDay) return new Date(Date.UTC(year, month - 1, day));
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  if (zulu) return new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  // A TZID/floating RDATE is compared as a local recurrence value. The split
  // boundary uses the same wall-clock representation above.
  void timeZone;
  return new Date(Date.UTC(year, month - 1, day, hour, minute, second));
}

function untilImmediatelyBefore(split: Date, allDay: boolean): string {
  const previous = new Date(split.getTime() - 1_000);
  if (allDay) return `${previous.getUTCFullYear()}${pad(previous.getUTCMonth() + 1)}${pad(previous.getUTCDate())}`;
  return `${previous.getUTCFullYear()}${pad(previous.getUTCMonth() + 1)}${pad(previous.getUTCDate())}T${pad(previous.getUTCHours())}${pad(previous.getUTCMinutes())}${pad(previous.getUTCSeconds())}Z`;
}

function earlierUntil(existing: string, cutoff: string, allDay: boolean, timeZone?: string | null): string {
  const existingDate = recurrenceValueDate(existing, allDay, timeZone || "UTC");
  const cutoffDate = recurrenceValueDate(cutoff, allDay, "UTC");
  return existingDate.getTime() <= cutoffDate.getTime() ? existing : cutoff;
}

function propertyTimeZone(prefix: string): string | null {
  const match = prefix.match(/(?:^|;)TZID=([^;:]+)/i);
  return match?.[1] ?? null;
}

function datePartsInZone(value: Date, timeZone: string): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23"
    }).formatToParts(value);
    const map = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
    return { year: map.year, month: map.month, day: map.day, hour: map.hour, minute: map.minute, second: map.second };
  } catch {
    throw new Error(`Google recurrence time zone ${timeZone} is not supported on this device.`);
  }
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function basicDateTime(value: Date, allDay: boolean): string {
  const date = `${value.getUTCFullYear()}${pad(value.getUTCMonth() + 1)}${pad(value.getUTCDate())}`;
  if (allDay) return date;
  return `${date}T${pad(value.getUTCHours())}${pad(value.getUTCMinutes())}${pad(value.getUTCSeconds())}`;
}
