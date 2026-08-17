import type { GoogleCalendarEvent, GoogleTask, TaskMetadata } from "@/types";

export type PaletteResultType = "task" | "event" | "calendar" | "drive";

export type DateWindow =
  | { readonly kind: "today" | "past" | "upcoming" | "this-week" | "next-week" }
  | { readonly kind: "day"; readonly day: string }
  | { readonly kind: "range"; readonly start: string; readonly end: string };

export interface PaletteFilters {
  readonly types: readonly PaletteResultType[];
  readonly calendarQuery?: string;
  readonly listQuery?: string;
  readonly source?: "google" | "local";
  readonly status?: string;
  readonly priority?: TaskMetadata["priority"];
  readonly due?: DateWindow | "none";
  readonly completed?: boolean;
  readonly date?: DateWindow;
}

export interface ParsedPaletteQuery {
  readonly text: string;
  readonly filters: PaletteFilters;
  readonly hasFilters: boolean;
  readonly searchBody?: boolean;
}

const resultTypes = new Set<PaletteResultType>(["task", "event", "calendar", "drive"]);
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function validDateKey(value: string): boolean {
  if (!datePattern.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00`);
  return !Number.isNaN(parsed.valueOf()) && localDateKey(parsed) === value;
}

export function dateKey(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  if (validDateKey(value)) {
    return value;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? undefined : localDateKey(parsed);
}

function taskDueDateKey(value: string | undefined): string | undefined {
  const day = value?.slice(0, 10);
  return day && validDateKey(day) ? day : undefined;
}

export function eventDateKey(event: GoogleCalendarEvent): string | undefined {
  const value = event.originalStartTime ?? event.start;
  return value.date ?? dateKey(value.dateTime);
}

function weekStart(day: string): string {
  const value = new Date(`${day}T00:00:00`);
  const offset = (value.getDay() + 6) % 7;
  value.setDate(value.getDate() - offset);
  return localDateKey(value);
}

function addDays(day: string, amount: number): string {
  const value = new Date(`${day}T00:00:00`);
  value.setDate(value.getDate() + amount);
  return localDateKey(value);
}

export function parseDateWindow(value: string): DateWindow | undefined {
  const normalized = value.toLocaleLowerCase();
  if (normalized === "today" || normalized === "past" || normalized === "upcoming" || normalized === "this-week" || normalized === "next-week") {
    return { kind: normalized };
  }
  if (validDateKey(value)) {
    return { kind: "day", day: value };
  }
  const [start, end, extra] = value.split("..");
  if (!extra && start && end && validDateKey(start) && validDateKey(end) && start <= end) {
    return { kind: "range", start, end };
  }
  return undefined;
}

export function matchesDateWindow(day: string | undefined, window: DateWindow | undefined, today = localDateKey(new Date())): boolean {
  if (!window) {
    return true;
  }
  if (!day) {
    return false;
  }
  switch (window.kind) {
    case "today":
      return day === today;
    case "past":
      return day < today;
    case "upcoming":
      return day >= today;
    case "this-week": {
      const start = weekStart(today);
      return day >= start && day <= addDays(start, 6);
    }
    case "next-week": {
      const start = addDays(weekStart(today), 7);
      return day >= start && day <= addDays(start, 6);
    }
    case "day":
      return day === window.day;
    case "range":
      return day >= window.start && day <= window.end;
  }
}

function unquote(value: string): string {
  return value.length >= 2 && value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;
}

function queryTokens(input: string): string[] {
  return input.match(/[^\s"]+:"[^"]*"|"[^"]*"|\S+/g) ?? [];
}

function completedValue(value: string): boolean | undefined {
  switch (value.toLocaleLowerCase()) {
    case "true":
    case "yes":
    case "done":
    case "completed":
      return true;
    case "false":
    case "no":
    case "open":
    case "incomplete":
      return false;
    default:
      return undefined;
  }
}

export function parsePaletteQuery(input: string): ParsedPaletteQuery {
  const types = new Set<PaletteResultType>();
  const terms: string[] = [];
  let calendarQuery: string | undefined;
  let listQuery: string | undefined;
  let source: PaletteFilters["source"];
  let status: string | undefined;
  let priority: TaskMetadata["priority"] | undefined;
  let due: DateWindow | "none" | undefined;
  let completed: boolean | undefined;
  let date: DateWindow | undefined;
  let hasFilters = false;
  let searchBody = false;

  for (const token of queryTokens(input.trim())) {
    const separator = token.indexOf(":");
    if (separator <= 0) {
      terms.push(unquote(token));
      continue;
    }
    const key = token.slice(0, separator).toLocaleLowerCase();
    const value = unquote(token.slice(separator + 1));
    if (key === "type" && resultTypes.has(value as PaletteResultType)) {
      types.add(value as PaletteResultType);
      hasFilters = true;
      continue;
    }
    if (key === "task" || key === "event" || key === "drive") {
      types.add(key);
      hasFilters = true;
      if (value) {
        terms.push(value);
      }
      continue;
    }
    if (key === "calendar") {
      hasFilters = true;
      if (value) {
        calendarQuery = value;
        types.add("event");
      } else {
        types.add("calendar");
      }
      continue;
    }
    if (key === "in" && value) {
      calendarQuery = value;
      types.add("event");
      hasFilters = true;
      continue;
    }
    if (key === "list" && value) {
      listQuery = value;
      types.add("task");
      hasFilters = true;
      continue;
    }
    if (key === "source" && (value === "google" || value === "local")) {
      source = value;
      hasFilters = true;
      continue;
    }
    if (key === "status" && value) {
      status = value.toLocaleLowerCase();
      hasFilters = true;
      continue;
    }
    if (key === "priority" && ["none", "low", "medium", "high"].includes(value.toLocaleLowerCase())) {
      priority = value.toLocaleLowerCase() as TaskMetadata["priority"];
      types.add("task");
      hasFilters = true;
      continue;
    }
    if (key === "start") {
      const window = parseDateWindow(value);
      if (window) {
        date = window;
        types.add("event");
        hasFilters = true;
        continue;
      }
    }
    if ((key === "notes" || key === "body") && value !== "false") {
      searchBody = true;
      hasFilters = true;
      if (value && value !== "true") terms.push(value);
      continue;
    }
    if (key === "due") {
      const window = value === "none" ? "none" : parseDateWindow(value);
      if (window) {
        due = window;
        types.add("task");
        hasFilters = true;
        continue;
      }
    }
    if (key === "completed") {
      const parsed = completedValue(value);
      if (parsed !== undefined) {
        completed = parsed;
        types.add("task");
        hasFilters = true;
        continue;
      }
    }
    if (key === "date") {
      const window = parseDateWindow(value);
      if (window) {
        date = window;
        types.add("event");
        hasFilters = true;
        continue;
      }
    }
    terms.push(unquote(token));
  }

  return {
    text: terms.join(" ").trim(),
    filters: {
      types: [...types],
      ...(calendarQuery ? { calendarQuery } : {}),
      ...(listQuery ? { listQuery } : {}),
      ...(source ? { source } : {}),
      ...(status ? { status } : {}),
      ...(priority ? { priority } : {}),
      ...(due ? { due } : {}),
      ...(completed !== undefined ? { completed } : {}),
      ...(date ? { date } : {})
    },
    hasFilters,
    ...(searchBody ? { searchBody: true } : {})
  };
}

export function includesResultType(filters: PaletteFilters, type: PaletteResultType): boolean {
  return filters.types.length === 0 || filters.types.includes(type);
}

export function matchesCalendar(calendarId: string, calendarName: string | undefined, query: string | undefined): boolean {
  if (!query) {
    return true;
  }
  const target = query.toLocaleLowerCase();
  return calendarId.toLocaleLowerCase().includes(target) || (calendarName?.toLocaleLowerCase().includes(target) ?? false);
}

export function matchesTaskFilters(task: GoogleTask, filters: PaletteFilters, today?: string, metadata?: TaskMetadata, listName?: string): boolean {
  if (!includesResultType(filters, "task")) {
    return false;
  }
  if (filters.completed !== undefined && (task.status === "completed") !== filters.completed) {
    return false;
  }
  if (filters.status && task.status.toLocaleLowerCase() !== filters.status && !(filters.status === "open" && task.status === "needsAction")) return false;
  if (filters.priority && (metadata?.priority ?? "none") !== filters.priority) return false;
  if (filters.listQuery && !(task.listId.toLocaleLowerCase().includes(filters.listQuery.toLocaleLowerCase()) || listName?.toLocaleLowerCase().includes(filters.listQuery.toLocaleLowerCase()))) return false;
  if (filters.source === "local") return false;
  if (filters.due === "none") {
    return !task.due;
  }
  if (!filters.due) {
    return true;
  }
  const due = taskDueDateKey(task.due);
  if (filters.due.kind === "past") {
    return task.status !== "completed" && matchesDateWindow(due, filters.due, today);
  }
  return matchesDateWindow(due, filters.due, today);
}

export function matchesEventFilters(
  event: GoogleCalendarEvent,
  filters: PaletteFilters,
  calendarName: string | undefined,
  today?: string
): boolean {
  return includesResultType(filters, "event")
    && filters.source !== "local"
    && (!filters.status || event.status?.toLocaleLowerCase() === filters.status)
    && matchesCalendar(event.calendarId, calendarName, filters.calendarQuery)
    && matchesDateWindow(eventDateKey(event), filters.date, today);
}
