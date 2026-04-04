// NLP task input parser for Hot Cross Buns.
// pure TS, zero deps. never throws.

export interface ParsedTask {
  title: string;
  startDate?: string; // YYYY-MM-DD
  dueDate?: string; // YYYY-MM-DD
  priority?: number; // 0-3
  tags: string[];
  estimatedMinutes?: number;
}

// -- helpers ------------------------------------------------------------------

function pad2(n: number): string { return n.toString().padStart(2, '0'); }
function isoDate(d: Date): string { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function addDays(d: Date, n: number): Date { const r = new Date(d); r.setDate(r.getDate() + n); return r; }

const WEEKDAY_MAP: Record<string, number> = {
  sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tuesday: 2, wed: 3, wednesday: 3,
  thu: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6,
};

const MONTH_MAP: Record<string, number> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
  may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7,
  sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
};

function nextWeekday(ref: Date, target: number): Date {
  const cur = ref.getDay();
  let diff = target - cur;
  if (diff <= 0) diff += 7;
  return addDays(ref, diff);
}

function resolveWeekday(name: string): number | undefined {
  return WEEKDAY_MAP[name.toLowerCase()];
}

function resolveMonth(name: string): number | undefined {
  return MONTH_MAP[name.toLowerCase()];
}

function cleanTitle(s: string): string {
  return s.replace(/\s{2,}/g, ' ').trim();
}

// -- extractors ---------------------------------------------------------------

interface ExtractResult<T> { value: T; remaining: string; }

export function extractTags(input: string): { tags: string[]; remaining: string } {
  const tags: string[] = [];
  // #"tag with spaces"
  let remaining = input.replace(/#"([^"]+)"/g, (_m, t) => { tags.push(t); return ''; });
  // #tag-name (word chars + hyphens)
  remaining = remaining.replace(/#([\w][\w-]*)/g, (_m, t) => { tags.push(t); return ''; });
  return { tags, remaining };
}

export function extractPriority(input: string): { priority?: number; remaining: string } {
  let priority: number | undefined;
  let remaining = input;
  // !high, !3, etc
  const bangPatterns: [RegExp, number][] = [
    [/!(?:high|hi|h|3)\b/gi, 3],
    [/!(?:med|medium|m|2)\b/gi, 2],
    [/!(?:low|lo|l|1)\b/gi, 1],
    [/!(?:none|n|0)\b/gi, 0],
  ];
  for (const [re, val] of bangPatterns) {
    if (re.test(remaining)) { priority = val; remaining = remaining.replace(re, ''); break; }
  }
  // p0-p3 (only if ! form didn't match)
  if (priority === undefined) {
    const pMatch = remaining.match(/\bp([0-3])\b/i);
    if (pMatch) {
      priority = parseInt(pMatch[1], 10);
      remaining = remaining.replace(/\bp[0-3]\b/i, '');
    }
  }
  return { priority, remaining };
}

export function extractDuration(input: string): { minutes?: number; remaining: string } {
  let minutes: number | undefined;
  let remaining = input;
  // compound: 2h30m
  const compound = remaining.match(/\b(\d+)\s*h\s*(\d+)\s*m(?:in|ins)?\b/i);
  if (compound) {
    minutes = parseInt(compound[1], 10) * 60 + parseInt(compound[2], 10);
    remaining = remaining.replace(compound[0], '');
    return { minutes, remaining };
  }
  // decimal hours: 2.5h
  const decHour = remaining.match(/\b(\d+\.\d+)\s*h(?:r|rs|our|ours)?\b/i);
  if (decHour) {
    minutes = Math.round(parseFloat(decHour[1]) * 60);
    remaining = remaining.replace(decHour[0], '');
    return { minutes, remaining };
  }
  // hours: 1h, 1hr, 1hour
  const hours = remaining.match(/\b(\d+)\s*h(?:r|rs|our|ours)?\b/i);
  if (hours) {
    minutes = parseInt(hours[1], 10) * 60;
    remaining = remaining.replace(hours[0], '');
    return { minutes, remaining };
  }
  // minutes: 30m, 30min, 30mins
  const mins = remaining.match(/\b(\d+)\s*m(?:in|ins)?\b/i);
  if (mins) {
    minutes = parseInt(mins[1], 10);
    remaining = remaining.replace(mins[0], '');
    return { minutes, remaining };
  }
  return { minutes, remaining };
}

export function extractDates(input: string, refDate?: Date): { startDate?: string; dueDate?: string; remaining: string } {
  const ref = refDate ?? new Date();
  let remaining = input;
  let startDate: string | undefined;
  let dueDate: string | undefined;

  // -- date range: day-day or day to day -----------------------------------------

  // day name range: mon-fri, mon to fri
  const dayRange = remaining.match(/\b(mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\s*(?:-|to)\s*(mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b/i);
  if (dayRange) {
    const d1 = resolveWeekday(dayRange[1]);
    const d2 = resolveWeekday(dayRange[2]);
    if (d1 !== undefined && d2 !== undefined) {
      startDate = isoDate(nextWeekday(ref, d1));
      dueDate = isoDate(nextWeekday(ref, d2));
      // if due < start, push due forward a week
      if (dueDate < startDate) {
        dueDate = isoDate(addDays(nextWeekday(ref, d2), 7));
      }
      remaining = remaining.replace(dayRange[0], '');
      return { startDate, dueDate, remaining };
    }
  }

  // month day-day range: mar 25-28, mar 25 to mar 28
  const monthDayRange = remaining.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})\s*(?:-|to)\s*(?:(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+)?(\d{1,2})\b/i);
  if (monthDayRange) {
    const m1 = resolveMonth(monthDayRange[1]);
    const d1 = parseInt(monthDayRange[2], 10);
    const m2 = monthDayRange[3] ? resolveMonth(monthDayRange[3]) : m1;
    const d2 = parseInt(monthDayRange[4], 10);
    if (m1 !== undefined && m2 !== undefined) {
      const sd = new Date(ref.getFullYear(), m1, d1);
      const dd = new Date(ref.getFullYear(), m2!, d2);
      if (sd < ref) sd.setFullYear(sd.getFullYear() + 1);
      if (dd < sd) dd.setFullYear(dd.getFullYear() + 1);
      startDate = isoDate(sd);
      dueDate = isoDate(dd);
      remaining = remaining.replace(monthDayRange[0], '');
      return { startDate, dueDate, remaining };
    }
  }

  // -- single dates (order: specific first, then relative) -----------------------

  // ISO: 2026-03-25
  const isoMatch = remaining.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (isoMatch) {
    dueDate = `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
    remaining = remaining.replace(isoMatch[0], '');
    return { startDate, dueDate, remaining };
  }

  // MM/DD: 3/25 or 03/25
  const slashDate = remaining.match(/\b(\d{1,2})\/(\d{1,2})\b/);
  if (slashDate) {
    const m = parseInt(slashDate[1], 10) - 1;
    const d = parseInt(slashDate[2], 10);
    const dt = new Date(ref.getFullYear(), m, d);
    if (dt < ref) dt.setFullYear(dt.getFullYear() + 1);
    dueDate = isoDate(dt);
    remaining = remaining.replace(slashDate[0], '');
    return { startDate, dueDate, remaining };
  }

  // "25 mar" / "25 march" (day before month)
  const dayMonthMatch = remaining.match(/\b(\d{1,2})\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i);
  if (dayMonthMatch) {
    const mi = resolveMonth(dayMonthMatch[2]);
    const di = parseInt(dayMonthMatch[1], 10);
    if (mi !== undefined) {
      const dt = new Date(ref.getFullYear(), mi, di);
      if (dt < ref) dt.setFullYear(dt.getFullYear() + 1);
      dueDate = isoDate(dt);
      remaining = remaining.replace(dayMonthMatch[0], '');
      return { startDate, dueDate, remaining };
    }
  }

  // "mar 25" / "march 25" (month before day)
  const monthDayMatch = remaining.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})\b/i);
  if (monthDayMatch) {
    const mi = resolveMonth(monthDayMatch[1]);
    const di = parseInt(monthDayMatch[2], 10);
    if (mi !== undefined) {
      const dt = new Date(ref.getFullYear(), mi, di);
      if (dt < ref) dt.setFullYear(dt.getFullYear() + 1);
      dueDate = isoDate(dt);
      remaining = remaining.replace(monthDayMatch[0], '');
      return { startDate, dueDate, remaining };
    }
  }

  // "next week" -> next monday
  const nextWeekMatch = remaining.match(/\bnext\s+week\b/i);
  if (nextWeekMatch) {
    dueDate = isoDate(nextWeekday(ref, 1));
    remaining = remaining.replace(nextWeekMatch[0], '');
    return { startDate, dueDate, remaining };
  }

  // "next month"
  const nextMonthMatch = remaining.match(/\bnext\s+month\b/i);
  if (nextMonthMatch) {
    const dt = new Date(ref);
    dt.setMonth(dt.getMonth() + 1);
    dt.setDate(1);
    dueDate = isoDate(dt);
    remaining = remaining.replace(nextMonthMatch[0], '');
    return { startDate, dueDate, remaining };
  }

  // "next <weekday>"
  const nextDayMatch = remaining.match(/\bnext\s+(mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b/i);
  if (nextDayMatch) {
    const wd = resolveWeekday(nextDayMatch[1]);
    if (wd !== undefined) {
      dueDate = isoDate(nextWeekday(ref, wd));
      remaining = remaining.replace(nextDayMatch[0], '');
      return { startDate, dueDate, remaining };
    }
  }

  // "in N days/weeks/months"
  const inNMatch = remaining.match(/\bin\s+(\d+)\s+(day|days|week|weeks|month|months)\b/i);
  if (inNMatch) {
    const n = parseInt(inNMatch[1], 10);
    const unit = inNMatch[2].toLowerCase().replace(/s$/, '');
    const dt = new Date(ref);
    if (unit === 'day') dt.setDate(dt.getDate() + n);
    else if (unit === 'week') dt.setDate(dt.getDate() + n * 7);
    else if (unit === 'month') dt.setMonth(dt.getMonth() + n);
    dueDate = isoDate(dt);
    remaining = remaining.replace(inNMatch[0], '');
    return { startDate, dueDate, remaining };
  }

  // relative: today, tomorrow, tmr, tmrw, yesterday
  const relMap: [RegExp, number][] = [
    [/\btoday\b/i, 0],
    [/\btomorrow\b/i, 1],
    [/\btmrw?\b/i, 1],
    [/\byesterday\b/i, -1],
  ];
  for (const [re, offset] of relMap) {
    const m = remaining.match(re);
    if (m) {
      dueDate = isoDate(addDays(ref, offset));
      remaining = remaining.replace(re, '');
      return { startDate, dueDate, remaining };
    }
  }

  // bare weekday name (next occurrence)
  const bareDay = remaining.match(/\b(monday|mon|tuesday|tue|wednesday|wed|thursday|thu|friday|fri|saturday|sat|sunday|sun)\b/i);
  if (bareDay) {
    const wd = resolveWeekday(bareDay[1]);
    if (wd !== undefined) {
      dueDate = isoDate(nextWeekday(ref, wd));
      remaining = remaining.replace(bareDay[0], '');
      return { startDate, dueDate, remaining };
    }
  }

  return { startDate, dueDate, remaining };
}

// -- main entry point ---------------------------------------------------------

export function parseTaskInput(input: string, referenceDate?: Date): ParsedTask {
  try {
    if (!input || typeof input !== 'string') return { title: input ?? '', tags: [] };
    const step1 = extractTags(input);
    const step2 = extractPriority(step1.remaining);
    const step3 = extractDuration(step2.remaining);
    const step4 = extractDates(step3.remaining, referenceDate);
    let title = cleanTitle(step4.remaining);
    if (!title) title = input.trim(); // fallback to original
    const result: ParsedTask = { title, tags: step1.tags };
    if (step4.startDate) result.startDate = step4.startDate;
    if (step4.dueDate) result.dueDate = step4.dueDate;
    if (step2.priority !== undefined) result.priority = step2.priority;
    if (step3.minutes !== undefined) result.estimatedMinutes = step3.minutes;
    return result;
  } catch {
    return { title: (input ?? '').toString(), tags: [] }; // absolute safety net
  }
}
