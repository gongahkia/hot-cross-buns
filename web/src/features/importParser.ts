import type { TaskPriority } from "@/types";

export interface ImportedTask {
  readonly kind: "task";
  readonly title: string;
  readonly list?: string;
  readonly due?: string;
  readonly notes?: string;
  readonly priority: TaskPriority;
  readonly rrule?: string;
  readonly until?: string;
  readonly count?: number;
  readonly exclude: readonly string[];
  readonly include: readonly string[];
}

export interface ImportedEvent {
  readonly kind: "event";
  readonly title: string;
  readonly calendar?: string;
  readonly start: string;
  readonly end: string;
  readonly allDay: boolean;
  readonly timeZone?: string;
  readonly description?: string;
  readonly location?: string;
  readonly recurrence: readonly string[];
}

export type ImportedRecord = ImportedTask | ImportedEvent;

export interface ImportPreviewRow {
  readonly line: number;
  readonly record?: ImportedRecord;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

export interface ImportPreview {
  readonly rows: readonly ImportPreviewRow[];
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

const maxBytes = 5 * 1024 * 1024;
const maxRecords = 1_000;
const maxDelimitedLine = 32 * 1024;
const csvHeader = ["kind", "title", "task_list", "calendar", "due", "notes", "priority", "rrule", "until", "count", "exclude", "include", "start", "end", "all_day", "time_zone", "description", "location", "recurrence"];
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

function validDate(value: string): boolean {
  if (!datePattern.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function validDateTime(value: string): boolean {
  return !Number.isNaN(new Date(value).valueOf());
}

function valuesList(value: string | undefined): string[] {
  if (!value) return [];
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function normalisePriority(value: string | undefined): TaskPriority | undefined {
  if (!value) return "none";
  return ["none", "low", "medium", "high"].includes(value) ? value as TaskPriority : undefined;
}

function parseNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const number = Number(value);
  return Number.isInteger(number) && number >= 1 && number <= 10_000 ? number : undefined;
}

function taskFromFields(fields: Readonly<Record<string, string>>, line: number): ImportPreviewRow {
  const errors: string[] = [];
  const title = fields.title?.trim() ?? "";
  if (!title) errors.push("Task title is required");
  const due = fields.due?.trim();
  if (due && !validDate(due)) errors.push("Task due must be YYYY-MM-DD");
  const priority = normalisePriority(fields.priority);
  if (!priority) errors.push("Task priority must be none, low, medium, or high");
  const until = fields.until?.trim();
  if (until && !validDate(until)) errors.push("Task recurrence end date must be YYYY-MM-DD");
  const count = parseNumber(fields.count);
  if (fields.count && !count) errors.push("Task recurrence count must be an integer between 1 and 10,000");
  const exclude = valuesList(fields.exclude);
  const include = valuesList(fields.include);
  if ([...exclude, ...include].some((date) => !validDate(date))) errors.push("Task recurrence exceptions must be YYYY-MM-DD dates");
  if (fields.rrule && !due) errors.push("A recurring task needs a due date");
  return errors.length ? { line, errors, warnings: [] } : { line, errors: [], warnings: [], record: { kind: "task", title, list: fields.list ?? fields.task_list, due, notes: fields.notes, priority: priority!, rrule: fields.rrule?.trim() || undefined, until, count, exclude, include } };
}

function eventFromFields(fields: Readonly<Record<string, string>>, line: number): ImportPreviewRow {
  const errors: string[] = [];
  const title = fields.title?.trim() ?? "";
  const allDay = fields.all_day === "true" || fields.all_day === "1";
  const start = fields.start?.trim() ?? "";
  const end = fields.end?.trim() ?? "";
  if (!title) errors.push("Event title is required");
  if (allDay ? !validDate(start) || !validDate(end) : !validDateTime(start) || !validDateTime(end)) errors.push(allDay ? "All-day event start and end must be YYYY-MM-DD" : "Timed event start and end must be valid ISO timestamps");
  if (!errors.length && new Date(end).valueOf() <= new Date(start).valueOf()) errors.push("Event end must be after start");
  const recurrence = valuesList(fields.recurrence);
  if (recurrence.some((line) => !/^(RRULE|EXDATE|RDATE|EXRULE):/.test(line))) errors.push("Calendar recurrence must use RRULE, EXRULE, RDATE, or EXDATE lines");
  return errors.length ? { line, errors, warnings: [] } : { line, errors: [], warnings: [], record: { kind: "event", title, calendar: fields.calendar, start, end, allDay, timeZone: fields.time_zone, description: fields.description, location: fields.location, recurrence } };
}

function decodeEscapes(value: string): string {
  return value.replace(/\\([nrt"\\])/g, (_whole, escaped: string) => ({ n: "\n", r: "\r", t: "\t", '"': '"', "\\": "\\" })[escaped] ?? escaped);
}

function delimitedTokens(line: string): string[] | undefined {
  const tokens: string[] = [];
  let token = "";
  let quoted = false;
  let escaping = false;
  for (const character of line.trim()) {
    if (escaping) { token += `\\${character}`; escaping = false; continue; }
    if (character === "\\") { escaping = true; continue; }
    if (character === '"') { quoted = !quoted; token += character; continue; }
    if (/\s/.test(character) && !quoted) { if (token) { tokens.push(token); token = ""; } continue; }
    token += character;
  }
  if (quoted || escaping) return undefined;
  if (token) tokens.push(token);
  return tokens;
}

function parseDelimited(text: string): ImportPreview {
  const rows: ImportPreviewRow[] = [];
  const errors: string[] = [];
  for (const [index, source] of text.split(/\r?\n/).entries()) {
    const line = index + 1;
    if (!source.trim()) continue;
    if (new TextEncoder().encode(source).byteLength > maxDelimitedLine) { rows.push({ line, errors: ["Delimited record exceeds 32 KiB"], warnings: [] }); continue; }
    const tokens = delimitedTokens(source);
    if (!tokens || !["task", "event"].includes(tokens[0] ?? "")) { rows.push({ line, errors: ["Record must start with task or event"], warnings: [] }); continue; }
    const fields: Record<string, string> = {};
    for (const token of tokens.slice(1)) {
      const offset = token.indexOf("=");
      if (offset < 1) { rows.push({ line, errors: ["Fields must use key=value"], warnings: [] }); continue; }
      const value = token.slice(offset + 1);
      fields[token.slice(0, offset)] = decodeEscapes(value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value);
    }
    rows.push(tokens[0] === "task" ? taskFromFields(fields, line) : eventFromFields(fields, line));
  }
  if (rows.length > maxRecords) errors.push(`Import accepts at most ${maxRecords} records`);
  return { rows: rows.slice(0, maxRecords), errors, warnings: [] };
}

function parseCsvRows(text: string): string[][] | undefined {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') { value += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else value += character;
      continue;
    }
    if (character === '"') { quoted = true; continue; }
    if (character === ",") { row.push(value); value = ""; continue; }
    if (character === "\n") { row.push(value.replace(/\r$/, "")); rows.push(row); row = []; value = ""; continue; }
    value += character;
  }
  if (quoted) return undefined;
  if (value || row.length) { row.push(value); rows.push(row); }
  return rows;
}

function parseCsv(text: string): ImportPreview {
  const rows = parseCsvRows(text);
  if (!rows?.length) return { rows: [], errors: ["CSV is empty or has unclosed quotes"], warnings: [] };
  if (rows[0]!.join(",") !== csvHeader.join(",")) return { rows: [], errors: ["CSV must use the documented exact header"], warnings: [] };
  const output = rows.slice(1, maxRecords + 1).map((values, index) => {
    const fields = Object.fromEntries(csvHeader.map((key, column) => [key, values[column] ?? ""]));
    return fields.kind === "task" ? taskFromFields(fields, index + 2) : fields.kind === "event" ? eventFromFields(fields, index + 2) : { line: index + 2, errors: ["CSV kind must be task or event"], warnings: [] };
  });
  return { rows: output, errors: rows.length - 1 > maxRecords ? [`Import accepts at most ${maxRecords} records`] : [], warnings: [] };
}

function unescapeIcs(value: string): string {
  return value.replace(/\\n/gi, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\");
}

function icsDate(value: string): { readonly value: string; readonly allDay: boolean } | undefined {
  if (/^\d{8}$/.test(value)) return { value: `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`, allDay: true };
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(value);
  if (!match) return undefined;
  const iso = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}${match[7] ? "Z" : ""}`;
  if (!validDateTime(iso)) return undefined;
  return { value: iso, allDay: false };
}

function addIcsDuration(start: { readonly value: string; readonly allDay: boolean }, duration: string): { readonly value: string; readonly allDay: boolean } | undefined {
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(duration);
  if (!match) return undefined;
  const milliseconds = (Number(match[1] ?? 0) * 86_400 + Number(match[2] ?? 0) * 3_600 + Number(match[3] ?? 0) * 60 + Number(match[4] ?? 0)) * 1_000;
  if (!milliseconds || start.allDay && milliseconds % 86_400_000 !== 0) return undefined;
  const date = new Date(start.allDay ? `${start.value}T00:00:00Z` : start.value);
  if (Number.isNaN(date.valueOf())) return undefined;
  const next = new Date(date.getTime() + milliseconds);
  return start.allDay
    ? { value: `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`, allDay: true }
    : { value: next.toISOString(), allDay: false };
}

function parseIcs(text: string): ImportPreview {
  const unfolded = text.replace(/\r?\n[ \t]/g, "");
  const components = unfolded.split(/BEGIN:VEVENT\r?\n|BEGIN:VEVENT\n/).slice(1);
  const rows: ImportPreviewRow[] = [];
  for (const [index, component] of components.entries()) {
    const fields: Record<string, string[]> = {};
    const warnings: string[] = [];
    for (const line of component.split(/\r?\n/)) {
      if (line === "END:VEVENT") break;
      const separator = line.indexOf(":");
      if (separator < 0) continue;
      const [name, ...params] = line.slice(0, separator).split(";");
      const value = unescapeIcs(line.slice(separator + 1));
      const key = name.toUpperCase();
      if (["ATTENDEE", "VALARM", "ATTACH", "CONFERENCE", "URL"].includes(key)) { warnings.push(`${key} is not imported`); continue; }
      fields[key] ??= [];
      fields[key].push(`${params.join(";")}${params.length ? ":" : ""}${value}`);
    }
    const field = (name: string) => fields[name]?.[0]?.split(/:(.*)/s).at(-1);
    const startLine = fields.DTSTART?.[0];
    const startZone = startLine?.match(/TZID=([^:;]+)/)?.[1];
    const start = field("DTSTART") && icsDate(field("DTSTART")!);
    const end = field("DTEND") ? icsDate(field("DTEND")!) : field("DURATION") && start ? addIcsDuration(start, field("DURATION")!) : undefined;
    if (!start || !end || start.allDay !== end.allDay) { rows.push({ line: index + 1, errors: ["VEVENT needs matching valid DTSTART and DTEND"], warnings }); continue; }
    const result = eventFromFields({ title: field("SUMMARY") ?? "", calendar: "", start: start.value, end: end.value, all_day: String(start.allDay), time_zone: startZone ?? "", description: field("DESCRIPTION") ?? "", location: field("LOCATION") ?? "", recurrence: [ ...(fields.RRULE?.map((value) => `RRULE:${value.split(/:(.*)/s).at(-1)}`) ?? []), ...(fields.RDATE?.map((value) => `RDATE:${value.split(/:(.*)/s).at(-1)}`) ?? []), ...(fields.EXDATE?.map((value) => `EXDATE:${value.split(/:(.*)/s).at(-1)}`) ?? []) ].join(",") }, index + 1);
    rows.push({ ...result, warnings: [...result.warnings, ...warnings] });
  }
  return { rows: rows.slice(0, maxRecords), errors: rows.length > maxRecords ? [`Import accepts at most ${maxRecords} records`] : [], warnings: [] };
}

export function parseImport(name: string, text: string): ImportPreview {
  if (new TextEncoder().encode(text).byteLength > maxBytes) return { rows: [], errors: ["Import source exceeds 5 MiB"], warnings: [] };
  const lower = name.toLocaleLowerCase();
  if (lower.endsWith(".csv")) return parseCsv(text);
  if (lower.endsWith(".ics") || lower.endsWith(".ical")) return parseIcs(text);
  return parseDelimited(text);
}

export const importLimits = { maxBytes, maxRecords, maxDelimitedLine, csvHeader } as const;
