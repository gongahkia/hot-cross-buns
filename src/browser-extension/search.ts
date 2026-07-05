import type { CacheSummary, PlannerCache, PlannerEvent, PlannerTask, SearchFilter, SearchResult } from "./types";

export function summarizeCache(cache: PlannerCache | undefined): CacheSummary {
  return {
    fetchedAt: cache?.fetchedAt,
    taskCount: cache?.tasks.length ?? 0,
    eventCount: cache?.events.length ?? 0,
    windowStart: cache?.windowStart,
    windowEnd: cache?.windowEnd,
    accountEmail: cache?.accountEmail
  };
}

export function searchPlannerCache(
  cache: PlannerCache,
  input: {
    query: string;
    filter: SearchFilter;
    limit?: number;
    now?: Date;
  }
): SearchResult[] {
  const query = normalize(input.query);
  const tokens = query.split(/\s+/).filter(Boolean);
  const limit = Math.max(1, Math.min(100, input.limit ?? 50));
  const now = input.now ?? new Date();
  const results = [
    ...(input.filter === "events" ? [] : cache.tasks.flatMap((task) => taskResult(task, tokens, query, input.filter, now))),
    ...(input.filter === "tasks" ? [] : cache.events.flatMap((event) => eventResult(event, tokens, query, input.filter, now)))
  ];

  return results
    .sort((a, b) => b.score - a.score || compareResultDates(a, b))
    .slice(0, limit);
}

function taskResult(
  task: PlannerTask,
  tokens: string[],
  query: string,
  filter: SearchFilter,
  now: Date
): SearchResult[] {
  if (!passesDateFilter(task.dueAt, filter, now)) {
    return [];
  }

  const haystack = [task.title, task.notes, task.listTitle, task.dueAt].filter(Boolean).join(" ");
  const score = scoreText(task.title, haystack, tokens, query, task.dueAt, now);

  if (score === undefined) {
    return [];
  }

  return [{
    id: task.id,
    kind: "task",
    title: task.title,
    subtitle: task.listTitle,
    snippet: task.notes,
    dueAt: task.dueAt,
    sourceUrl: task.sourceUrl,
    score
  }];
}

function eventResult(
  event: PlannerEvent,
  tokens: string[],
  query: string,
  filter: SearchFilter,
  now: Date
): SearchResult[] {
  if (!passesDateFilter(event.startsAt, filter, now)) {
    return [];
  }

  const haystack = [
    event.title,
    event.description,
    event.location,
    event.calendarTitle,
    event.startsAt
  ].filter(Boolean).join(" ");
  const score = scoreText(event.title, haystack, tokens, query, event.startsAt, now);

  if (score === undefined) {
    return [];
  }

  return [{
    id: event.id,
    kind: "event",
    title: event.title,
    subtitle: event.calendarTitle,
    snippet: event.location ?? event.description,
    startsAt: event.startsAt,
    sourceUrl: event.sourceUrl,
    score
  }];
}

function scoreText(
  title: string,
  haystack: string,
  tokens: string[],
  query: string,
  dateValue: string | undefined,
  now: Date
): number | undefined {
  const normalizedTitle = normalize(title);
  const normalizedHaystack = normalize(haystack);

  if (tokens.length === 0) {
    return 20 + dateScore(dateValue, now);
  }

  if (!tokens.every((token) => normalizedHaystack.includes(token))) {
    return undefined;
  }

  let score = dateScore(dateValue, now);

  if (normalizedTitle.includes(query)) {
    score += 30;
  }

  for (const token of tokens) {
    score += normalizedTitle.includes(token) ? 10 : 3;
  }

  return score;
}

function passesDateFilter(dateValue: string | undefined, filter: SearchFilter, now: Date): boolean {
  if (filter !== "today" && filter !== "upcoming") {
    return true;
  }

  if (!dateValue) {
    return false;
  }

  const dateKey = localDateKey(dateValue);
  const today = localDateKey(now.toISOString());

  if (filter === "today") {
    return dateKey === today;
  }

  return dateKey >= today;
}

function dateScore(dateValue: string | undefined, now: Date): number {
  if (!dateValue) {
    return 0;
  }

  const parsed = Date.parse(dateValue);

  if (!Number.isFinite(parsed)) {
    return 0;
  }

  const daysAway = Math.abs(parsed - now.getTime()) / (24 * 60 * 60 * 1000);
  return Math.max(0, 15 - Math.floor(daysAway));
}

function compareResultDates(a: SearchResult, b: SearchResult): number {
  const left = Date.parse(a.startsAt ?? a.dueAt ?? "");
  const right = Date.parse(b.startsAt ?? b.dueAt ?? "");

  if (!Number.isFinite(left) && !Number.isFinite(right)) {
    return a.title.localeCompare(b.title);
  }

  if (!Number.isFinite(left)) {
    return 1;
  }

  if (!Number.isFinite(right)) {
    return -1;
  }

  return left - right;
}

function localDateKey(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalize(value: string): string {
  return value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
}
