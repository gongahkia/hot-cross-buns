// Natural language date parser for TickClone.
// Regex-based — no external dependencies.

export interface ParsedDate {
  /** ISO 8601 date string (YYYY-MM-DDTHH:mm:ss or YYYY-MM-DD). */
  date: string;
  /** Whether the parsed input contained a specific time. */
  hasTime: boolean;
  /** iCal-style recurrence rule, or null if not recurring. */
  recurrenceRule: string | null;
  /** The substring of the input that was interpreted as a date. */
  matchedText: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const WEEKDAYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const;

const WEEKDAY_ABBREVS: Record<string, number> = {
  sun: 0,
  sunday: 0,
  mon: 1,
  monday: 1,
  tue: 2,
  tues: 2,
  tuesday: 2,
  wed: 3,
  wednesday: 3,
  thu: 4,
  thur: 4,
  thurs: 4,
  thursday: 4,
  fri: 5,
  friday: 5,
  sat: 6,
  saturday: 6,
};

const MONTHS: Record<string, number> = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
};

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

function toISODate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function toISODateTime(d: Date): string {
  return `${toISODate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function nextWeekday(ref: Date, targetDay: number): Date {
  const current = ref.getDay();
  let diff = targetDay - current;
  if (diff <= 0) diff += 7;
  return addDays(ref, diff);
}

// ---------------------------------------------------------------------------
// Time extraction
// ---------------------------------------------------------------------------

interface TimeResult {
  hours: number;
  minutes: number;
  matchedText: string;
}

const TIME_12H = /\b(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*(am|pm)\b/i;
const TIME_24H = /\b([01]?\d|2[0-3]):([0-5]\d)\b/;

function extractTime(input: string): TimeResult | null {
  let m = TIME_12H.exec(input);
  if (m) {
    let hours = parseInt(m[1], 10);
    const minutes = m[2] ? parseInt(m[2], 10) : 0;
    const meridiem = m[3].toLowerCase();
    if (meridiem === 'pm' && hours !== 12) hours += 12;
    if (meridiem === 'am' && hours === 12) hours = 0;
    return { hours, minutes, matchedText: m[0] };
  }

  m = TIME_24H.exec(input);
  if (m) {
    return {
      hours: parseInt(m[1], 10),
      minutes: parseInt(m[2], 10),
      matchedText: m[0],
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Date extraction (returns a Date and the matched text fragment)
// ---------------------------------------------------------------------------

interface DateResult {
  date: Date;
  matchedText: string;
  recurrenceRule: string | null;
}

// Order matters: more-specific patterns first.
const DATE_PATTERNS: {
  regex: RegExp;
  handler: (m: RegExpMatchArray, ref: Date) => DateResult;
}[] = [
  // "today"
  {
    regex: /\btoday\b/i,
    handler: (m, ref) => ({
      date: new Date(ref),
      matchedText: m[0],
      recurrenceRule: null,
    }),
  },
  // "tomorrow"
  {
    regex: /\btomorrow\b/i,
    handler: (m, ref) => ({
      date: addDays(ref, 1),
      matchedText: m[0],
      recurrenceRule: null,
    }),
  },
  // "next <weekday>"
  {
    regex: /\bnext\s+(sun(?:day)?|mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?)\b/i,
    handler: (m, ref) => {
      const dayIdx = WEEKDAY_ABBREVS[m[1].toLowerCase()];
      return {
        date: nextWeekday(ref, dayIdx),
        matchedText: m[0],
        recurrenceRule: null,
      };
    },
  },
  // "in N days/weeks/months"
  {
    regex: /\bin\s+(\d+)\s+(day|days|week|weeks|month|months)\b/i,
    handler: (m, ref) => {
      const n = parseInt(m[1], 10);
      const unit = m[2].toLowerCase().replace(/s$/, '');
      const d = new Date(ref);
      if (unit === 'day') d.setDate(d.getDate() + n);
      else if (unit === 'week') d.setDate(d.getDate() + n * 7);
      else if (unit === 'month') d.setMonth(d.getMonth() + n);
      return { date: d, matchedText: m[0], recurrenceRule: null };
    },
  },
  // "every weekday"
  {
    regex: /\bevery\s+weekday\b/i,
    handler: (m, ref) => ({
      date: new Date(ref),
      matchedText: m[0],
      recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
    }),
  },
  // "every day" / "daily"
  {
    regex: /\b(?:every\s+day|daily)\b/i,
    handler: (m, ref) => ({
      date: new Date(ref),
      matchedText: m[0],
      recurrenceRule: 'FREQ=DAILY;INTERVAL=1',
    }),
  },
  // "every week" / "weekly"
  {
    regex: /\b(?:every\s+week|weekly)\b/i,
    handler: (m, ref) => ({
      date: new Date(ref),
      matchedText: m[0],
      recurrenceRule: 'FREQ=WEEKLY;INTERVAL=1',
    }),
  },
  // "every month" / "monthly"
  {
    regex: /\b(?:every\s+month|monthly)\b/i,
    handler: (m, ref) => ({
      date: new Date(ref),
      matchedText: m[0],
      recurrenceRule: 'FREQ=MONTHLY;INTERVAL=1',
    }),
  },
  // "Mar 25" / "March 25"
  {
    regex: /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})\b/i,
    handler: (m, ref) => {
      const monthIdx = MONTHS[m[1].toLowerCase()];
      const day = parseInt(m[2], 10);
      const d = new Date(ref.getFullYear(), monthIdx, day);
      // If the date has already passed this year, use next year.
      if (d < ref) {
        d.setFullYear(d.getFullYear() + 1);
      }
      return { date: d, matchedText: m[0], recurrenceRule: null };
    },
  },
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse a natural-language date/time string and return a structured result.
 *
 * @param input         Free-form text potentially containing a date expression.
 * @param referenceDate The date to resolve relative expressions against (defaults to now).
 * @returns             A `ParsedDate` if a date was detected, otherwise `null`.
 */
export function parseNaturalDate(
  input: string,
  referenceDate?: Date,
): ParsedDate | null {
  const ref = referenceDate ?? new Date();

  // 1. Try to extract a date expression.
  let dateResult: DateResult | null = null;
  for (const pattern of DATE_PATTERNS) {
    const m = input.match(pattern.regex);
    if (m) {
      dateResult = pattern.handler(m, ref);
      break;
    }
  }

  // 2. Try to extract a time expression.
  const timeResult = extractTime(input);

  // If neither a date nor a time was found, nothing to return.
  if (!dateResult && !timeResult) {
    return null;
  }

  // Use the reference date when only a time was found.
  const baseDate = dateResult?.date ?? new Date(ref);

  const hasTime = timeResult !== null;
  if (timeResult) {
    baseDate.setHours(timeResult.hours, timeResult.minutes, 0, 0);
  }

  // Combine matched text fragments.
  const matchedFragments: string[] = [];
  if (dateResult) matchedFragments.push(dateResult.matchedText);
  if (timeResult) matchedFragments.push(timeResult.matchedText);
  const matchedText = matchedFragments.join(' ').trim();

  const dateString = hasTime ? toISODateTime(baseDate) : toISODate(baseDate);

  return {
    date: dateString,
    hasTime,
    recurrenceRule: dateResult?.recurrenceRule ?? null,
    matchedText,
  };
}

/**
 * Extract a natural date from free-form text and return the remaining text
 * (useful for splitting "Buy milk tomorrow at 3pm" into title + date).
 */
export function extractDateFromText(
  input: string,
  referenceDate?: Date,
): { title: string; parsed: ParsedDate } | null {
  const parsed = parseNaturalDate(input, referenceDate);
  if (!parsed) return null;

  // Remove all matched fragments from the original input to derive the title.
  let title = input;

  // Remove the date portion if present.
  for (const pattern of DATE_PATTERNS) {
    title = title.replace(pattern.regex, '');
  }

  // Remove the time portion if present.
  title = title.replace(TIME_12H, '');
  title = title.replace(TIME_24H, '');

  // Clean up leftover whitespace and punctuation artefacts.
  title = title.replace(/\s{2,}/g, ' ').trim();
  // Strip leading/trailing conjunctions left behind (e.g. "at", "on", "by").
  title = title.replace(/^(?:at|on|by|for)\s+/i, '').trim();
  title = title.replace(/\s+(?:at|on|by|for)$/i, '').trim();

  return { title, parsed };
}
