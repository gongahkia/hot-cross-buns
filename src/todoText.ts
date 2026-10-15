/** TODO.txt keeps ISO date headings; detail checkboxes and repeat rules extend item lines. */
import { formatRecurrence, parseRecurrence, type RecurrenceRule } from './recurrence.ts';
import { parseTimeBlock } from './timeBlock.ts';

export type TodoDetail = { text: string; completed: boolean };
export type TodoSpan = { kind: 'all-day'; through?: string } | { kind: 'time'; start: string; endDate: string; end: string };
export type TodoReplacement = { series: string; on: string };
export type TodoItem = { id: string; text: string; details: TodoDetail[]; completed: boolean; repeat?: RecurrenceRule; completedOn?: string; span?: TodoSpan; skips?: string[]; replaces?: TodoReplacement };
export type TodoDay = { date: string; items: TodoItem[]; keepEmpty?: boolean };
export type TodoList = { name: string; items: TodoItem[] };
export type TodoDocument = { days: TodoDay[]; undated?: TodoList[] };
export type ParseIssue = { line: number; message: string };
export type ParseResult = { document: TodoDocument; issues: ParseIssue[] };

export const emptyDocument = (): TodoDocument => ({ days: [] });
export const newId = () => crypto.randomUUID();
export const cloneDocument = (document: TodoDocument): TodoDocument => structuredClone(document);
/** Upgrade journal records saved before details had their own completion state. */
export function normalizeDocument(document: TodoDocument): TodoDocument {
  const normalizeItem = (item: TodoItem) => ({
    ...item,
    details: item.details.map(detail => typeof detail === 'string'
      ? { text: detail, completed: item.completed }
      : { text: detail.text, completed: !!detail.completed }),
  });
  return { days: document.days.map(day => ({ ...day, items: day.items.map(normalizeItem) })),
    ...(document.undated ? { undated: document.undated.map(list => ({ ...list, items: list.items.map(normalizeItem) })) } : {}) };
}
export const itemValue = (item: TodoItem) => JSON.stringify([item.text, item.details, item.completed, item.repeat, item.completedOn, item.span, item.skips, item.replaces]);
export const itemContent = (item: TodoItem) => JSON.stringify([item.text, item.details, item.repeat, item.span, item.skips, item.replaces]);

const validClock = (value: string) => /^\d{2}:\d{2}$/.test(value) && Number(value.slice(0, 2)) < 24 && Number(value.slice(3)) < 60;
export function parseSpan(value: string, heading: string): TodoSpan | null {
  if (value === 'all-day') return { kind: 'all-day' };
  const allDay = /^all-day through (\d{4}-\d{2}-\d{2})$/.exec(value);
  if (allDay) return validDate(allDay[1]) && allDay[1] > heading ? { kind: 'all-day', through: allDay[1] } : null;
  const timed = /^(\d{2}:\d{2}) to (\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})$/.exec(value);
  if (timed && validClock(timed[1]) && validDate(timed[2]) && timed[2] > heading && validClock(timed[3])) return { kind: 'time', start: timed[1], endDate: timed[2], end: timed[3] };
  return null;
}
export function formatSpan(span: TodoSpan) {
  return span.kind === 'all-day' ? `all-day${span.through ? ` through ${span.through}` : ''}` : `${span.start} to ${span.endDate} ${span.end}`;
}

export function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function importedSeriesId(text: string, date: string, position: number) {
  const slug = text.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,24) || 'item';
  const input = `${date}\0${position}\0${text}`;
  let hash = 2166136261;
  for (let index = 0; index < input.length; index++) hash = Math.imul(hash ^ input.charCodeAt(index), 16777619);
  return `${slug}-${date.replaceAll('-','')}-${(hash >>> 0).toString(36)}`;
}

export function todayString() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function unescapeLine(line: string) {
  return /^\\(?:\\|- |[ \t]*(?:@[a-z][\w-]*:|@(?:repeat|completed)\b)|\d{4}-\d{2}-\d{2}$|\[(?:x|X| )\] |UNDATED$|LIST: )/i.test(line) ? line.slice(1) : line;
}

function escapeLine(line: string) {
  return /^(?:\\|- |[ \t]*(?:@[a-z][\w-]*:|@(?:repeat|completed)\b)|\d{4}-\d{2}-\d{2}$|UNDATED$|LIST: )/i.test(line) ? `\\${line}` : line;
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
  let list: TodoList | null = null;
  let inUndated = false;
  let divider = false;
  let sawDivider = false;
  let pendingBlank = false;
  let lastItem: TodoItem | null = null;
  const seriesOccurrences = new Map<string, number>();
  const scheduledSeries = new Map<string, number>();
  const replacementLines = new Map<string, number>();
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
    if (line === 'UNDATED') {
      if (inUndated) { issues.push({ line: lineNumber, message: 'Undated section appears twice.' }); return; }
      finishDay();
      day = null; lastItem = null; inUndated = true; pendingBlank = false;
      document.undated = [];
      return;
    }
    if (inUndated && /^LIST: /.test(line)) {
      const name = line.slice(6).trim();
      if (!name) { issues.push({ line: lineNumber, message: 'An undated list needs a name.' }); return; }
      if (document.undated!.some(candidate => candidate.name === name)) { issues.push({ line: lineNumber, message: `Repeated undated list: ${name}` }); return; }
      list = { name, items: [] }; document.undated!.push(list); lastItem = null; pendingBlank = false;
      return;
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(line)) {
      if (inUndated) { issues.push({ line: lineNumber, message: 'Dated sections must appear before the undated section.' }); return; }
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
      if (day || list) pendingBlank = true;
      return;
    }
    if (!day && !list) { issues.push({ line: lineNumber, message: inUndated ? 'Text must follow a LIST: heading.' : 'Text must follow a valid date heading.' }); return; }
    if (list) {
      if (/^- /.test(line)) {
        if (!lastItem) { issues.push({ line: lineNumber, message: 'A detail line needs an item above it.' }); return; }
        if (pendingBlank) { issues.push({ line: lineNumber, message: 'A detail line cannot follow a blank separator.' }); return; }
        const value = line.slice(2);
        if (/^\[[xX ]\] /.test(value)) { issues.push({ line: lineNumber, message: 'Undated details have no checkboxes.' }); return; }
        if (!value.trim()) { issues.push({ line: lineNumber, message: 'Details cannot be empty.' }); return; }
        lastItem.details.push({ text: unescapeLine(value), completed: false });
        return;
      }
      if (/^[ \t]*@[a-z][\w-]*\s*:/i.test(line)) { issues.push({ line: lineNumber, message: 'Undated items do not use dated metadata.' }); return; }
      const text = unescapeLine(line);
      if (!text.trim()) { issues.push({ line: lineNumber, message: 'Items cannot be empty.' }); return; }
      lastItem = { id: newId(), text, details: [], completed: false };
      list.items.push(lastItem);
      pendingBlank = false;
      return;
    }
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
      if (rule.kind !== 'after' && rule.series) {
        const first = scheduledSeries.get(rule.series);
        if (first) issues.push({ line: lineNumber, message: `Repeated scheduled series identifier; first defined on line ${first}.` });
        else scheduledSeries.set(rule.series,lineNumber);
      }
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
    if (/^  @span:/.test(line)) {
      if (!lastItem || pendingBlank) { issues.push({ line: lineNumber, message: 'A span needs an item directly above it.' }); return; }
      if (lastItem.span) { issues.push({ line: lineNumber, message: 'An item can have only one span.' }); return; }
      const span = parseSpan(line.slice('  @span:'.length).trim(), day!.date);
      if (!span || parseTimeBlock(lastItem.text)) { issues.push({ line: lineNumber, message: 'Invalid or conflicting span.' }); return; }
      lastItem.span = span;
      return;
    }
    if (/^  @skip:/.test(line)) {
      if (!lastItem || pendingBlank) { issues.push({ line: lineNumber, message: 'A skipped date needs a recurring item directly above it.' }); return; }
      const skipped = line.slice('  @skip:'.length).trim();
      if (!validDate(skipped) || lastItem.skips?.includes(skipped)) { issues.push({ line: lineNumber, message: 'A skipped date must be unique and use YYYY-MM-DD.' }); return; }
      (lastItem.skips ??= []).push(skipped);
      return;
    }
    if (/^  @replaces:/.test(line)) {
      if (!lastItem || pendingBlank) { issues.push({ line: lineNumber, message: 'A replacement needs an item directly above it.' }); return; }
      const match = /^([a-z0-9][a-z0-9-]{0,79}) on (\d{4}-\d{2}-\d{2})$/.exec(line.slice('  @replaces:'.length).trim());
      if (!match || !validDate(match[2]) || lastItem.replaces) { issues.push({ line: lineNumber, message: 'A replacement needs one series identifier and original date.' }); return; }
      lastItem.replaces = { series: match[1], on: match[2] };
      const key = `${match[1]}:${match[2]}`;
      const first = replacementLines.get(key);
      if (first) issues.push({ line: lineNumber, message: `This occurrence is already replaced on line ${first}.` });
      else replacementLines.set(key,lineNumber);
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
    day!.items.push(lastItem);
  });
  finishDay();
  for (const entry of document.days) for (const [position,item] of entry.items.entries()) {
    if (item.repeat && item.repeat.kind !== 'after' && !item.repeat.series) {
      const series = importedSeriesId(item.text, entry.date, position);
      item.repeat = { ...item.repeat, series };
      scheduledSeries.set(series,0);
    }
    if (item.skips?.length && (!item.repeat || item.repeat.kind === 'after')) issues.push({ line: 0, message: 'Skipped dates require a scheduled repeat rule.' });
    if (item.replaces && item.repeat) issues.push({ line: replacementLines.get(`${item.replaces.series}:${item.replaces.on}`) ?? 0, message: 'A replacement cannot also have a repeat rule.' });
  }
  for (const [key,line] of replacementLines) if (!scheduledSeries.has(key.slice(0,key.lastIndexOf(':')))) issues.push({ line, message: 'A replacement refers to a missing scheduled series.' });
  document.days.sort((a, b) => a.date.localeCompare(b.date));
  return { document, issues };
}

export function serializeTodoText(document: TodoDocument) {
  const itemLines = (item: TodoItem, undated = false) => {
    const lines = [escapeLine(item.text)];
    if (undated) { item.details.forEach(detail => lines.push(`- ${escapeDetail(detail.text)}`)); return lines; }
    if (item.repeat) lines.push(`  @repeat: ${formatRecurrence(item.repeat)}`);
    if (item.span) lines.push(`  @span: ${formatSpan(item.span)}`);
    for (const date of [...item.skips ?? []].sort()) lines.push(`  @skip: ${date}`);
    if (item.replaces) lines.push(`  @replaces: ${item.replaces.series} on ${item.replaces.on}`);
    if (item.completedOn) lines.push(`  @completed: ${item.completedOn}`);
    item.details.forEach(detail => lines.push(`- [${detail.completed ? 'x' : ' '}] ${escapeDetail(detail.text)}`));
    return lines;
  };
  const sections = [...document.days].sort((a, b) => a.date.localeCompare(b.date)).map(day => {
    if (!day.items.length) return day.date;
    const completed = day.items.filter(item => item.completed);
    const upcoming = day.items.filter(item => !item.completed);
    const lines = [day.date];
    for (const item of completed) lines.push(...itemLines(item));
    lines.push('');
    for (const item of upcoming) lines.push(...itemLines(item));
    return lines.join('\n');
  });
  if (document.undated?.length) {
    sections.push(['UNDATED', ...document.undated.flatMap(list => ['', `LIST: ${list.name}`, ...list.items.flatMap(item => itemLines(item, true))])].join('\n'));
  }
  return sections.length ? `${sections.join('\n\n')}\n` : '';
}

export function validateDocument(document: TodoDocument) {
  const seriesOccurrences = new Set<string>();
  const scheduledSeries = new Set<string>();
  const replacements = new Set<string>();
  const dates = new Set<string>();
  for (const day of document.days) {
    if (!validDate(day.date)) throw new Error(`Invalid date: ${day.date}`);
    if (dates.has(day.date)) throw new Error(`Repeated date: ${day.date}`);
    dates.add(day.date);
    for (const item of day.items) {
      if (item.repeat && parseRecurrence(formatRecurrence(item.repeat)) === null) throw new Error('Invalid repeat rule.');
      if (item.repeat?.kind !== 'after' && item.repeat?.series) {
        if (scheduledSeries.has(item.repeat.series)) throw new Error('A scheduled series identifier can have only one rule.');
        scheduledSeries.add(item.repeat.series);
      }
      if (item.repeat?.series || item.repeat?.occurrence) {
        if (!item.repeat.series || (item.repeat.kind === 'after' && !item.repeat.occurrence)) throw new Error('An after-completion series needs an identifier and occurrence.');
        if (item.repeat.occurrence) {
          const key = item.repeat.series + ':' + item.repeat.occurrence;
          if (seriesOccurrences.has(key)) throw new Error('Repeated series occurrence.');
          seriesOccurrences.add(key);
        }
      }
      if (item.completedOn && (!validDate(item.completedOn) || !item.completed)) throw new Error('A completion date requires a completed item and a valid YYYY-MM-DD date.');
      if (item.span && (!parseSpan(formatSpan(item.span), day.date) || parseTimeBlock(item.text))) throw new Error('Invalid or conflicting span.');
      if (item.skips && (!item.repeat || item.repeat.kind === 'after' || new Set(item.skips).size !== item.skips.length || item.skips.some(date => !validDate(date)))) throw new Error('Skipped dates require a scheduled repeat rule and unique valid dates.');
      if (item.replaces && (!validDate(item.replaces.on) || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(item.replaces.series) || item.repeat)) throw new Error('A replacement needs a valid original date and series, without its own repeat rule.');
      if (item.replaces) {
        const key = `${item.replaces.series}:${item.replaces.on}`;
        if (replacements.has(key)) throw new Error('An occurrence can have only one replacement.');
        replacements.add(key);
      }
      if (/^\d{2}:\d{2}-\d{2}:\d{2} /.test(item.text) && !parseTimeBlock(item.text)) throw new Error('Time blocks need valid start and end times on the same day.');
      for (const line of [item.text, ...item.details.map(detail => detail.text)]) {
        if (!line.trim() || /[\r\n]/.test(line)) throw new Error('Every item and detail must be one nonempty line.');
      }
    }
  }
  for (const key of replacements) if (!scheduledSeries.has(key.slice(0,key.lastIndexOf(':')))) throw new Error('A replacement refers to a missing series.');
  const lists = new Set<string>();
  for (const list of document.undated ?? []) {
    if (!list.name.trim() || /[\r\n]/.test(list.name) || lists.has(list.name)) throw new Error('Undated list names must be unique, nonempty lines.');
    lists.add(list.name);
    for (const item of list.items) {
      if (item.completed || item.completedOn || item.repeat || item.span || item.skips?.length || item.replaces || item.details.some(detail => detail.completed)) throw new Error('Undated items and details have no completion or dated metadata.');
      for (const line of [item.text, ...item.details.map(detail => detail.text)]) if (!line.trim() || /[\r\n]/.test(line)) throw new Error('Every item and detail must be one nonempty line.');
    }
  }
}
