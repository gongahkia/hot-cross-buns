import type { QuickCapturePreferences, TaskPriority } from "@/types";

export type QuickCaptureKind = "task" | "event";

export interface QuickCaptureRecognition {
  readonly id: string;
  readonly label: string;
  readonly removable: boolean;
}

export interface QuickCaptureResult {
  readonly kind: QuickCaptureKind;
  readonly rawTitle: string;
  readonly parsedTitle: string;
  readonly date?: string;
  readonly time?: string;
  readonly allDay: boolean;
  readonly eventDurationMinutes: number;
  readonly taskPriority: TaskPriority;
  readonly recurrence?: { readonly frequency: "daily" | "weekly" | "monthly" | "yearly"; readonly interval: number; readonly rrule: string };
  readonly recognitions: readonly QuickCaptureRecognition[];
  readonly eventReady: boolean;
}

interface Span extends QuickCaptureRecognition {
  readonly start: number;
  readonly length: number;
}

const defaultAliases: Pick<QuickCapturePreferences, "taskAliases" | "eventAliases" | "highPriorityAliases" | "mediumPriorityAliases" | "lowPriorityAliases"> = {
  taskAliases: ["task"],
  eventAliases: ["event"],
  highPriorityAliases: ["p1"],
  mediumPriorityAliases: ["p2"],
  lowPriorityAliases: ["p3"]
};

function localDate(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function addDays(value: Date, amount: number): Date {
  const result = new Date(value);
  result.setDate(result.getDate() + amount);
  return result;
}

function aliasMatch(text: string, aliases: readonly string[]): RegExpMatchArray | undefined {
  const safe = aliases.map((alias) => alias.trim()).filter(Boolean).map((alias) => alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (safe.length === 0) return undefined;
  return text.match(new RegExp(`\\b(?:${safe.join("|")})\\b`, "i")) ?? undefined;
}

function spanFor(match: RegExpMatchArray, prefix: string, label: string, removable = true): Span {
  return { id: `${prefix}:${match.index ?? 0}:${match[0].length}`, label, removable, start: match.index ?? 0, length: match[0].length };
}

function overlaps(left: Span, right: Span): boolean {
  return left.start < right.start + right.length && right.start < left.start + left.length;
}

function useSpan(spans: Span[], disabled: ReadonlySet<string>, span: Span, recognitions: QuickCaptureRecognition[]): boolean {
  if (disabled.has(span.id) || spans.some((existing) => overlaps(existing, span))) return false;
  spans.push(span);
  recognitions.push({ id: span.id, label: span.label, removable: span.removable });
  return true;
}

function parseDate(text: string, now: Date): { readonly date: string; readonly span: Span } | undefined {
  const numeric = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(text);
  if (numeric) {
    const candidate = new Date(Number(numeric[1]), Number(numeric[2]) - 1, Number(numeric[3]));
    if (candidate.getFullYear() === Number(numeric[1]) && candidate.getMonth() === Number(numeric[2]) - 1 && candidate.getDate() === Number(numeric[3])) {
      return { date: localDate(candidate), span: spanFor(numeric, "date", localDate(candidate)) };
    }
  }
  const today = /\btoday\b/i.exec(text);
  if (today) return { date: localDate(now), span: spanFor(today, "date", localDate(now)) };
  const tomorrow = /\btomorrow\b/i.exec(text);
  if (tomorrow) return { date: localDate(addDays(now, 1)), span: spanFor(tomorrow, "date", localDate(addDays(now, 1))) };
  const nextWeekday = /\bnext\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.exec(text);
  if (nextWeekday) {
    const names = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
    const target = names.indexOf(nextWeekday[1]!.toLowerCase());
    const days = ((target - now.getDay() + 6) % 7) + 1;
    const date = addDays(now, days);
    return { date: localDate(date), span: spanFor(nextWeekday, "date", localDate(date)) };
  }
  const relative = /\bin\s+(\d{1,3})\s+(days?|weeks?)\b/i.exec(text);
  if (relative) {
    const date = addDays(now, Number(relative[1]) * (relative[2]!.toLowerCase().startsWith("week") ? 7 : 1));
    return { date: localDate(date), span: spanFor(relative, "date", localDate(date)) };
  }
  const named = /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/i.exec(text);
  if (named) {
    const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
    let year = named[3] ? Number(named[3]) : now.getFullYear();
    let date = new Date(year, months.indexOf(named[1]!.toLowerCase()), Number(named[2]));
    if (!named[3] && date < new Date(now.getFullYear(), now.getMonth(), now.getDate())) {
      year += 1;
      date = new Date(year, months.indexOf(named[1]!.toLowerCase()), Number(named[2]));
    }
    if (date.getMonth() === months.indexOf(named[1]!.toLowerCase()) && date.getDate() === Number(named[2])) return { date: localDate(date), span: spanFor(named, "date", localDate(date)) };
  }
  return undefined;
}

function parseTime(text: string): { readonly time: string; readonly span: Span } | undefined {
  const twelveHour = /\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i.exec(text);
  if (twelveHour) {
    let hour = Number(twelveHour[1]);
    const minute = Number(twelveHour[2] ?? "0");
    if (hour >= 1 && hour <= 12 && minute <= 59) {
      hour %= 12;
      if (twelveHour[3]!.toLowerCase() === "pm") hour += 12;
      const time = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
      return { time, span: spanFor(twelveHour, "time", time) };
    }
  }
  const twentyFourHour = /\b(?:at\s+)?([01]?\d|2[0-3]):([0-5]\d)\b/.exec(text);
  if (!twentyFourHour) return undefined;
  const time = `${String(Number(twentyFourHour[1])).padStart(2, "0")}:${twentyFourHour[2]}`;
  return { time, span: spanFor(twentyFourHour, "time", time) };
}

function removeSpans(text: string, spans: readonly Span[]): string {
  let result = text;
  for (const span of [...spans].filter((item) => item.removable).sort((left, right) => right.start - left.start)) result = `${result.slice(0, span.start)}${result.slice(span.start + span.length)}`;
  return result.replace(/\s+/g, " ").trim();
}

export function parseQuickCapture(
  text: string,
  requestedKind: QuickCaptureKind,
  preferences: Pick<QuickCapturePreferences, "defaultEventDurationMinutes" | "removeRecognizedText" | "taskAliases" | "eventAliases" | "highPriorityAliases" | "mediumPriorityAliases" | "lowPriorityAliases"> = { defaultEventDurationMinutes: 30, removeRecognizedText: true, ...defaultAliases },
  disabledRecognitionIds: readonly string[] = [],
  now = new Date()
): QuickCaptureResult {
  const aliases = { ...defaultAliases, ...preferences };
  const disabled = new Set(disabledRecognitionIds);
  const spans: Span[] = [];
  const recognitions: QuickCaptureRecognition[] = [];
  let kind = requestedKind;
  const taskAlias = aliasMatch(text, aliases.taskAliases);
  const eventAlias = aliasMatch(text, aliases.eventAliases);
  const firstAlias = !taskAlias || eventAlias && (eventAlias.index ?? 0) < (taskAlias.index ?? 0)
    ? eventAlias && { match: eventAlias, kind: "event" as const, label: "Event" }
    : { match: taskAlias, kind: "task" as const, label: "Task" };
  if (firstAlias?.match) {
    const span = spanFor(firstAlias.match, "type", firstAlias.label);
    if (useSpan(spans, disabled, span, recognitions)) kind = firstAlias.kind;
  }
  let taskPriority: TaskPriority = "none";
  if (kind === "task") {
    for (const candidate of [
      { aliases: aliases.highPriorityAliases, priority: "high" as const, label: "High priority" },
      { aliases: aliases.mediumPriorityAliases, priority: "medium" as const, label: "Medium priority" },
      { aliases: aliases.lowPriorityAliases, priority: "low" as const, label: "Low priority" }
    ]) {
      const match = aliasMatch(text, candidate.aliases);
      if (match && useSpan(spans, disabled, spanFor(match, "priority", candidate.label), recognitions)) {
        taskPriority = candidate.priority;
        break;
      }
    }
  }
  let recurrence: QuickCaptureResult["recurrence"];
  const recurrenceMatch = /\bevery(?:\s+(\d{1,3}))?\s+(day|week|month|year)s?\b/i.exec(text);
  if (recurrenceMatch) {
    const interval = Number(recurrenceMatch[1] ?? "1");
    const frequency = `${recurrenceMatch[2]!.toLowerCase()}ly`.replace("dayly", "daily") as NonNullable<QuickCaptureResult["recurrence"]>["frequency"];
    const label = interval === 1 ? `Repeats every ${recurrenceMatch[2]!.toLowerCase()}` : `Repeats every ${interval} ${recurrenceMatch[2]!.toLowerCase()}s`;
    if (useSpan(spans, disabled, spanFor(recurrenceMatch, "recurrence", label), recognitions)) recurrence = { frequency, interval, rrule: `RRULE:FREQ=${frequency.toUpperCase()};INTERVAL=${interval}` };
  }
  let eventDurationMinutes = Math.max(1, Math.min(1_440, preferences.defaultEventDurationMinutes || 30));
  if (kind === "event") {
    const duration = /\bfor\s+(\d{1,4})\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours)\b/i.exec(text);
    if (duration) {
      const minutes = Number(duration[1]) * (duration[2]!.toLowerCase().startsWith("h") ? 60 : 1);
      if (minutes >= 1 && minutes <= 1_440 && useSpan(spans, disabled, spanFor(duration, "duration", `${minutes} minutes`), recognitions)) eventDurationMinutes = minutes;
    }
  }
  const parsedDate = parseDate(text, now);
  let date = parsedDate?.date;
  if (parsedDate) useSpan(spans, disabled, parsedDate.span, recognitions);
  const parsedTime = parseTime(text);
  const time = parsedTime?.time;
  if (parsedTime && kind === "event") useSpan(spans, disabled, parsedTime.span, recognitions);
  if (parsedTime && kind === "task" && !disabled.has(parsedTime.span.id)) recognitions.push({ ...parsedTime.span, label: `${parsedTime.time} remains in task title`, removable: false });
  if (kind === "task" && recurrence && !date) date = localDate(now);
  if (kind === "event" && time && !date) {
    const [hour, minute] = time.split(":").map(Number);
    const todayAtTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute);
    date = localDate(todayAtTime <= now ? addDays(now, 1) : now);
  }
  return {
    kind,
    rawTitle: text.trim(),
    parsedTitle: preferences.removeRecognizedText === false ? text.trim() : removeSpans(text, spans),
    date,
    time,
    allDay: kind === "event" && Boolean(date) && !time,
    eventDurationMinutes,
    taskPriority,
    recurrence,
    recognitions,
    eventReady: kind === "task" || Boolean(date)
  };
}
