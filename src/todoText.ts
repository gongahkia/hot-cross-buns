/** The portable document contains only dates, plain lines, detail lines, and the divider. */
export type TodoItem = { id: string; text: string; details: string[]; completed: boolean };
export type TodoDay = { date: string; items: TodoItem[] };
export type TodoDocument = { days: TodoDay[] };
export type ParseIssue = { line: number; message: string };
export type ParseResult = { document: TodoDocument; issues: ParseIssue[] };

export const emptyDocument = (): TodoDocument => ({ days: [] });
export const newId = () => crypto.randomUUID();
export const cloneDocument = (document: TodoDocument): TodoDocument => structuredClone(document);
export const itemValue = (item: TodoItem) => JSON.stringify([item.text, item.details, item.completed]);
export const itemContent = (item: TodoItem) => JSON.stringify([item.text, item.details]);

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
  return /^\\(?:\\|- |\d{4}-\d{2}-\d{2}$)/.test(line) ? line.slice(1) : line;
}

function escapeLine(line: string) {
  return /^(?:\\|- |\d{4}-\d{2}-\d{2}$)/.test(line) ? `\\${line}` : line;
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
  const finishDay = () => {
    if (day && pendingBlank) sawDivider = true;
    if (day && !sawDivider) {
      const completed = day.date < today;
      day.items.forEach(item => { item.completed = completed; });
    }
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
    if (/^- /.test(line)) {
      if (!lastItem) { issues.push({ line: lineNumber, message: 'A detail line needs an item above it.' }); return; }
      if (pendingBlank) { issues.push({ line: lineNumber, message: 'A detail line cannot follow the completed/upcoming divider.' }); return; }
      lastItem.details.push(unescapeLine(line.slice(2)));
      return;
    }
    if (pendingBlank && !sawDivider) { divider = true; sawDivider = true; }
    pendingBlank = false;
    const text = unescapeLine(line);
    if (!text.trim()) { issues.push({ line: lineNumber, message: 'Items cannot be empty.' }); return; }
    lastItem = { id: newId(), text, details: [], completed: !divider };
    day.items.push(lastItem);
  });
  finishDay();
  document.days.sort((a, b) => a.date.localeCompare(b.date));
  return { document, issues };
}

export function serializeTodoText(document: TodoDocument) {
  const sections = [...document.days].filter(day => day.items.length).sort((a, b) => a.date.localeCompare(b.date)).map(day => {
    const completed = day.items.filter(item => item.completed);
    const upcoming = day.items.filter(item => !item.completed);
    const lines = [day.date];
    for (const item of completed) {
      lines.push(escapeLine(item.text));
      item.details.forEach(detail => lines.push(`- ${escapeLine(detail)}`));
    }
    lines.push('');
    for (const item of upcoming) {
      lines.push(escapeLine(item.text));
      item.details.forEach(detail => lines.push(`- ${escapeLine(detail)}`));
    }
    return lines.join('\n');
  });
  return sections.length ? `${sections.join('\n\n')}\n` : '';
}

export function validateDocument(document: TodoDocument) {
  for (const day of document.days) {
    if (!validDate(day.date)) throw new Error(`Invalid date: ${day.date}`);
    for (const item of day.items) {
      for (const line of [item.text, ...item.details]) {
        if (!line.trim() || /[\r\n]/.test(line)) throw new Error('Every item and detail must be one nonempty line.');
      }
    }
  }
}
