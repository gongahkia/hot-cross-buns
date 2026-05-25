export interface QuickTaskParseResult {
  title: string;
  dueDate: string;
  listId: string;
  plannedStart: string | null;
  plannedEnd: string | null;
  durationMinutes: number | null;
  lockedSchedule: boolean;
  tags: string[];
}

export function dateOnlyFromLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

export function addLocalDays(seed: Date, days: number): Date {
  const date = new Date(seed.getTime());
  date.setDate(date.getDate() + days);
  return date;
}

function endOfCurrentWeek(seed: Date): Date {
  return addLocalDays(seed, (7 - seed.getDay()) % 7);
}

function endOfCurrentMonth(seed: Date): Date {
  return new Date(seed.getFullYear(), seed.getMonth() + 1, 0);
}

function nextSaturday(seed: Date): Date {
  return addLocalDays(seed, (6 - seed.getDay() + 7) % 7);
}

function normalizedListToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizedTagToken(value: string): string {
  return value.trim().replace(/^\+/, "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 120);
}

function parseDurationToken(token: string): number | null {
  const match = /^~(\d{1,3})(m|h)?$/i.exec(token);

  if (!match) {
    return null;
  }

  const amount = Number(match[1]);
  const unit = match[2]?.toLowerCase() ?? "m";
  const minutes = unit === "h" ? amount * 60 : amount;

  return minutes > 0 ? minutes : null;
}

function parsePlannedStartToken(token: string, dueDate: string, now: Date): string | null {
  const match = /^@(\d{1,2})(?::(\d{2}))?(am|pm)?$/i.exec(token);

  if (!match) {
    return null;
  }

  const hourValue = Number(match[1]);
  const minuteValue = match[2] ? Number(match[2]) : 0;
  const meridiem = match[3]?.toLowerCase();

  if (hourValue > 23 || minuteValue > 59 || (meridiem && (hourValue < 1 || hourValue > 12))) {
    return null;
  }

  const planned = dueDate ? new Date(`${dueDate}T00:00:00`) : new Date(now.getTime());
  let hour = hourValue;

  if (meridiem === "pm" && hour < 12) {
    hour += 12;
  } else if (meridiem === "am" && hour === 12) {
    hour = 0;
  }

  planned.setHours(hour, minuteValue, 0, 0);
  return planned.toISOString();
}

export function parseQuickTaskInput(
  input: string,
  taskLists: readonly { id: string; title: string }[],
  now = new Date()
): QuickTaskParseResult {
  const tokens = input.trim().split(/\s+/).filter(Boolean);
  let dueDate = "";
  let listId = taskLists[0]?.id ?? "";
  let plannedToken = "";
  let durationMinutes: number | null = null;
  let lockedSchedule = false;
  const tags: string[] = [];
  const titleTokens: string[] = [];

  for (const token of tokens) {
    const lower = token.toLowerCase();

    if (lower.startsWith("#") && lower.length > 1) {
      const listToken = normalizedListToken(lower.slice(1));
      const matchedList = taskLists.find((list) => normalizedListToken(list.title) === listToken);

      if (matchedList) {
        listId = matchedList.id;
        continue;
      }
    }

    if (lower.startsWith("+") && lower.length > 1) {
      const tag = normalizedTagToken(token.slice(1));

      if (tag && !tags.includes(tag)) {
        tags.push(tag);
      }

      continue;
    }

    if (lower === "!locked") {
      lockedSchedule = true;
      continue;
    }

    const parsedDuration = parseDurationToken(lower);

    if (parsedDuration !== null) {
      durationMinutes = parsedDuration;
      continue;
    }

    if (/^@\d{1,2}(?::\d{2})?(am|pm)?$/i.test(token)) {
      plannedToken = token;
      continue;
    }

    if (lower === "today" || lower === "tdy") {
      dueDate = dateOnlyFromLocalDate(now);
      continue;
    }

    if (lower === "tomorrow" || lower === "tmr" || lower === "tom") {
      dueDate = dateOnlyFromLocalDate(addLocalDays(now, 1));
      continue;
    }

    if (lower === "eow") {
      dueDate = dateOnlyFromLocalDate(endOfCurrentWeek(now));
      continue;
    }

    if (lower === "eom") {
      dueDate = dateOnlyFromLocalDate(endOfCurrentMonth(now));
      continue;
    }

    if (lower === "weekend") {
      dueDate = dateOnlyFromLocalDate(nextSaturday(now));
      continue;
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(lower)) {
      dueDate = lower;
      continue;
    }

    titleTokens.push(token);
  }

  const plannedStart = plannedToken ? parsePlannedStartToken(plannedToken, dueDate, now) : null;
  const plannedEnd = plannedStart && durationMinutes
    ? new Date(Date.parse(plannedStart) + durationMinutes * 60 * 1000).toISOString()
    : null;

  return {
    title: titleTokens.join(" ").trim(),
    dueDate,
    listId,
    plannedStart,
    plannedEnd,
    durationMinutes,
    lockedSchedule,
    tags
  };
}
