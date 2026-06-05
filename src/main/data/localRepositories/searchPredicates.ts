import type { LocalSearchDateFilter, ParsedLocalSearchQuery } from "@shared/search/localSearch";

export function ftsMatchQuery(value: string): string {
  const tokens = value
    .normalize("NFKD")
    .toLowerCase()
    .match(/[a-z0-9]+/g)
    ?.slice(0, 8) ?? [];

  return tokens.map((token) => `${token}*`).join(" ");
}

export function taskSearchPredicates(parsed: ParsedLocalSearchQuery): {
  predicates: string[];
  params: Array<string | number | boolean | null>;
} {
  const predicates = ["lists.deleted_at IS NULL"];
  const params: Array<string | number | boolean | null> = [];
  const status = parsed.filters.taskStatus;

  if (status === "deleted") {
    predicates.push("tasks.deleted_at IS NOT NULL");
  } else {
    predicates.push("tasks.deleted_at IS NULL");

    if (status === "hidden") {
      predicates.push("tasks.is_hidden = 1");
    } else {
      predicates.push("tasks.is_hidden = 0");
    }

    if (status === "active") {
      predicates.push("tasks.status != 'completed'");
    } else if (status === "completed") {
      predicates.push("tasks.status = 'completed'");
    }
  }

  if (parsed.filters.priority !== undefined) {
    predicates.push("COALESCE(tasks.local_priority, 'none') = ?");
    params.push(parsed.filters.priority);
  }

  if (parsed.filters.listTitle !== undefined) {
    predicates.push("LOWER(lists.title) LIKE ? ESCAPE '\\'");
    params.push(likeContainsParam(parsed.filters.listTitle));
  }

  if (parsed.filters.hasBody !== undefined) {
    predicates.push(
      parsed.filters.hasBody
        ? "TRIM(COALESCE(tasks.notes, '')) != ''"
        : "TRIM(COALESCE(tasks.notes, '')) = ''"
    );
  }

  addDatePredicate(predicates, params, "tasks.due_at", parsed.filters.due);
  predicates.push("NOT (tasks.due_at IS NULL AND tasks.parent_task_id IS NULL AND tasks.status != 'completed')");

  return { predicates, params };
}

export function eventSearchPredicates(parsed: ParsedLocalSearchQuery): {
  predicates: string[];
  params: Array<string | number | boolean | null>;
} {
  const predicates = [
    "events.deleted_at IS NULL",
    "events.status != 'cancelled'",
    "calendars.deleted_at IS NULL"
  ];
  const params: Array<string | number | boolean | null> = [];

  if (parsed.filters.calendarTitle !== undefined) {
    predicates.push("LOWER(calendars.summary) LIKE ? ESCAPE '\\'");
    params.push(likeContainsParam(parsed.filters.calendarTitle));
  }

  if (parsed.filters.hasBody !== undefined) {
    predicates.push(
      parsed.filters.hasBody
        ? "TRIM(COALESCE(events.description, '')) != ''"
        : "TRIM(COALESCE(events.description, '')) = ''"
    );
  }

  addDatePredicate(predicates, params, "events.start_at", parsed.filters.start);

  return { predicates, params };
}

export function noteSearchPredicates(parsed: ParsedLocalSearchQuery): {
  predicates: string[];
  params: Array<string | number | boolean | null>;
} {
  const predicates = [
    "tasks.deleted_at IS NULL",
    "tasks.is_hidden = 0",
    "tasks.status != 'completed'",
    "tasks.parent_task_id IS NULL",
    "tasks.due_at IS NULL",
    "lists.deleted_at IS NULL"
  ];
  const params: Array<string | number | boolean | null> = [];

  if (parsed.filters.hasBody !== undefined) {
    predicates.push(
      parsed.filters.hasBody
        ? "TRIM(COALESCE(tasks.notes, '')) != ''"
        : "TRIM(COALESCE(tasks.notes, '')) = ''"
    );
  }

  return { predicates, params };
}

export function addDatePredicate(
  predicates: string[],
  params: Array<string | number | boolean | null>,
  column: string,
  filter: LocalSearchDateFilter | undefined
): void {
  if (filter === undefined) {
    return;
  }

  if (filter.mode === "present") {
    predicates.push(`${column} IS NOT NULL`);
    return;
  }

  if (filter.mode === "missing") {
    predicates.push(`${column} IS NULL`);
    return;
  }

  if (filter.from !== undefined) {
    predicates.push(`${column} >= ?`);
    params.push(filter.from);
  }

  if (filter.to !== undefined) {
    predicates.push(`${column} < ?`);
    params.push(filter.to);
  }
}

export function likeContainsParam(value: string): string {
  return `%${value.toLowerCase().replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}
