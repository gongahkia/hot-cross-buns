/** TODO.txt keeps ISO date headings; detail checkboxes and repeat rules extend item lines. */
import { formatRecurrence, parseRecurrence, type RecurrenceRule } from './recurrence.ts';
import { parseTimeBlock } from './timeBlock.ts';

export type TodoDetail = { text: string; completed: boolean };
export type TodoItem = { id: string; text: string; details: TodoDetail[]; completed: boolean; repeat?: RecurrenceRule; completedOn?: string };
export type TodoDay = { date: string; items: TodoItem[]; keepEmpty?: boolean };
export type TodoDocument = { days: TodoDay[] };
export type ParseIssue = { line: number; message: string };
export type ParseResult = { document: TodoDocument; issues: ParseIssue[] };

export const emptyDocument = (): TodoDocument => ({ days: [] });
export const newId = () => crypto.randomUUID();
export const cloneDocument = (document: TodoDocument): TodoDocument => structuredClone(document);
/** Upgrade journal records saved before details had their own completion state. */
export function normalizeDocument(document: TodoDocument): TodoDocument {
  return { days: document.days.map(day => ({ ...day, items: day.items.map(item => ({
    ...item,
    details: item.details.map(detail => typeof detail === 'string'
      ? { text: detail, completed: item.completed }
      : { text: detail.text, completed: !!detail.completed }),
  })) })) };
}
export const itemValue = (item: TodoItem) => JSON.stringify([item.text, item.details, item.completed, item.repeat, item.completedOn]);
export const itemContent = (item: TodoItem) => JSON.stringify([item.text, item.details, item.repeat]);

export function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function todayString() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function unescapeLine(line: string) {
  return /^\\(?:\\|- |[ \t]*(?:@[a-z][\w-]*:|@(?:repeat|completed)\b)|\d{4}-\d{2}-\d{2}$|\[(?:x|X| )\] )/i.test(line) ? line.slice(1) : line;
}

function escapeLine(line: string) {
  return /^(?:\\|- |[ \t]*(?:@[a-z][\w-]*:|@(?:repeat|completed)\b)|\d{4}-\d{2}-\d{2}$)/i.test(line) ? `\\${line}` : line;
}

function escapeDetail(line: string) {
  return /^\[(?:x|X| )\] /.test(line) ? `\\${line}` : escapeLine(line);
}

export function parseTodoText(raw: string, today = todayString()): ParseResult {
  const lines = raw.replace(/^\uFEFF/, '').split(/\r\n|\n|\r/);
  // A terminal line break is not itself an empty divider line.
  if (lines.at(-1) === '' && /[\r\n]$/.test(raw)) lines.pop();
  const document = emptyDocument();
  const issues: ParseIssue[] = [];
  let day: TodoDay | null = null;
  let divider = false;
  let sawDivider = false;
  let pendingBlank = false;
  let lastItem: TodoItem | null = null;
  const seriesOccurrences = new Map<string, number>();
  const implicitDetails = new WeakMap<TodoItem, number[]>();
  const completionLines = new WeakMap<TodoItem, number>();
  const finishDay = () => {
    if (day && !day.items.length) day.keepEmpty = true;
    if (day && pendingBlank) sawDivider = true;
    if (day && !sawDivider) {
      const completed = day.date < today;
      day.items.forEach(item => { item.completed = completed; });
    }
    day?.items.forEach(item => {
      implicitDetails.get(item)?.forEach(index => { item.details[index].completed = item.completed; });
      if (item.details.length) item.completed = item.details.every(detail => detail.completed);
      if (item.completedOn && !item.completed) issues.push({ line: completionLines.get(item) ?? 0, message: 'A completion date requires a completed item.' });
    });
  };
  lines.forEach((rawLine, index) => {
    const line = rawLine.replace(/[\t ]+$/, '');
    const lineNumber = index + 1;
    if (/^\d{4}-\d{2}-\d{2}$/.test(line)) {
      if (!validDate(line)) { finishDay(); day = null; issues.push({ line: lineNumber, message: `Invalid date: ${line}` }); return; }
      finishDay();
      if (document.days.some(candidate => candidate.date === line)) {
        issues.push({ line: lineNumber, message: `Repeated date: ${line}` });
        day = null;
        return;
      }
      day = { date: line, items: [] };
      document.days.push(day);
      divider = false;
      sawDivider = false;
      pendingBlank = false;
      lastItem = null;
      return;
    }
    if (!line.trim()) {
      if (day) pendingBlank = true;
      return;
    }
    if (!day) { issues.push({ line: lineNumber, message: 'Text must follow a valid date heading.' }); return; }
    if (/^  @repeat:/.test(line)) {
      if (!lastItem || pendingBlank) { issues.push({ line: lineNumber, message: 'A repeat rule needs an item directly above it.' }); return; }
      if (lastItem.repeat) { issues.push({ line: lineNumber, message: 'An item can have only one repeat rule.' }); return; }
      const rule = parseRecurrence(line.slice('  @repeat:'.length));
      if (!rule) { issues.push({ line: lineNumber, message: 'Invalid repeat rule.' }); return; }
      if (rule.series && rule.occurrence) {
        const key = rule.series + ':' + rule.occurrence;
        const first = seriesOccurrences.get(key);
        if (first) issues.push({ line: lineNumber, message: 'Repeated series occurrence; first defined on line ' + first + '.' });
        else seriesOccurrences.set(key, lineNumber);
      }
      lastItem.repeat = rule;
      return;
    }
    if (/^  @completed:/.test(line)) {
      if (!lastItem || pendingBlank) { issues.push({ line: lineNumber, message: 'A completion date needs an item directly above it.' }); return; }
      if (lastItem.completedOn) { issues.push({ line: lineNumber, message: 'An item can have only one completion date.' }); return; }
      const completedOn = line.slice('  @completed:'.length).trim();
      if (!validDate(completedOn)) { issues.push({ line: lineNumber, message: 'Completion date must be YYYY-MM-DD.' }); return; }
      lastItem.completedOn = completedOn;
      completionLines.set(lastItem, lineNumber);
      return;
    }
    if (/^[ \t]*@[a-z][\w-]*\s*:/i.test(line) || /^[ \t]*@(?:repeat|completed)\b/i.test(line)) {
      issues.push({ line: lineNumber, message: 'Metadata needs exactly two spaces and a supported marker. Escape a literal title with \\.' });
      return;
    }
    if (/^[ \t]+- /.test(line)) {
      issues.push({ line: lineNumber, message: 'Detail lines must start at the left margin. Escape a literal item title with \\.' });
      return;
    }
    if (/^- /.test(line)) {
      if (!lastItem) { issues.push({ line: lineNumber, message: 'A detail line needs an item above it.' }); return; }
      if (pendingBlank) { issues.push({ line: lineNumber, message: 'A detail line cannot follow the completed/upcoming divider.' }); return; }
      const rawDetail = line.slice(2);
      if (/^\[[xX ]\](?! )/.test(rawDetail)) { issues.push({ line: lineNumber, message: 'A detail checkbox needs a space after its closing bracket.' }); return; }
      const marker = /^\[([xX ])\] (.*)$/.exec(rawDetail);
      const explicit = !!marker;
      lastItem.details.push({ text: unescapeLine(marker ? marker[2] : rawDetail), completed: marker ? marker[1].toLowerCase() === 'x' : lastItem.completed });
      if (!explicit) implicitDetails.set(lastItem, [...implicitDetails.get(lastItem) ?? [], lastItem.details.length - 1]);
      return;
    }
    if (pendingBlank && !sawDivider) { divider = true; sawDivider = true; }
    pendingBlank = false;
    const text = unescapeLine(line);
    if (!text.trim()) { issues.push({ line: lineNumber, message: 'Items cannot be empty.' }); return; }
    if (/^\d{2}:\d{2}-\d{2}:\d{2} /.test(text) && !parseTimeBlock(text)) { issues.push({ line: lineNumber, message: 'Time blocks need valid start and end times on the same day.' }); return; }
    lastItem = { id: newId(), text, details: [], completed: !divider };
    day.items.push(lastItem);
  });
  finishDay();
  document.days.sort((a, b) => a.date.localeCompare(b.date));
  return { document, issues };
}

export function serializeTodoText(document: TodoDocument) {
  const sections = [...document.days].sort((a, b) => a.date.localeCompare(b.date)).map(day => {
    if (!day.items.length) return day.date;
    const completed = day.items.filter(item => item.completed);
    const upcoming = day.items.filter(item => !item.completed);
    const lines = [day.date];
    for (const item of completed) {
      lines.push(escapeLine(item.text));
      if (item.repeat) lines.push(`  @repeat: ${formatRecurrence(item.repeat)}`);
      if (item.completedOn) lines.push(`  @completed: ${item.completedOn}`);
      item.details.forEach(detail => lines.push(`- [${detail.completed ? 'x' : ' '}] ${escapeDetail(detail.text)}`));
    }
    lines.push('');
    for (const item of upcoming) {
      lines.push(escapeLine(item.text));
      if (item.repeat) lines.push(`  @repeat: ${formatRecurrence(item.repeat)}`);
      if (item.completedOn) lines.push(`  @completed: ${item.completedOn}`);
      item.details.forEach(detail => lines.push(`- [${detail.completed ? 'x' : ' '}] ${escapeDetail(detail.text)}`));
    }
    return lines.join('\n');
  });
  return sections.length ? `${sections.join('\n\n')}\n` : '';
}

export function validateDocument(document: TodoDocument) {
  const seriesOccurrences = new Set<string>();
  const dates = new Set<string>();
  for (const day of document.days) {
    if (!validDate(day.date)) throw new Error(`Invalid date: ${day.date}`);
    if (dates.has(day.date)) throw new Error(`Repeated date: ${day.date}`);
    dates.add(day.date);
    for (const item of day.items) {
      if (item.repeat && parseRecurrence(formatRecurrence(item.repeat)) === null) throw new Error('Invalid repeat rule.');
      if (item.repeat?.series || item.repeat?.occurrence) {
        if (!item.repeat.series || !item.repeat.occurrence) throw new Error('A recurring series needs both series and occurrence.');
        const key = item.repeat.series + ':' + item.repeat.occurrence;
        if (seriesOccurrences.has(key)) throw new Error('Repeated series occurrence.');
        seriesOccurrences.add(key);
      }
      if (item.completedOn && (!validDate(item.completedOn) || !item.completed)) throw new Error('A completion date requires a completed item and a valid YYYY-MM-DD date.');
      if (/^\d{2}:\d{2}-\d{2}:\d{2} /.test(item.text) && !parseTimeBlock(item.text)) throw new Error('Time blocks need valid start and end times on the same day.');
      for (const line of [item.text, ...item.details.map(detail => detail.text)]) {
        if (!line.trim() || /[\r\n]/.test(line)) throw new Error('Every item and detail must be one nonempty line.');
      }
    }
  }
}
