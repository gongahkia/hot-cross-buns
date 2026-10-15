import { newSeriesId, parseRecurrence } from './recurrence.ts';
import { parseTodoText, todayString, validDate } from './todoText.ts';

export type DoctorFinding = {
  code: 'metadata-indent' | 'detail-indent' | 'detail-spacing' | 'divider' | 'completion-date' | 'series-id' | 'syntax';
  line: number;
  level: 'repaired' | 'review';
  message: string;
  before?: string;
  after?: string;
  date?: string;
};

export type DoctorReport = { candidate: string; findings: DoctorFinding[]; ready: boolean };
export type DoctorAction = 'mark-upcoming' | 'mark-done' | 'set-completion-date' | 'start-series';

function linesOf(raw: string) {
  const lines = raw.split(/\r\n|\n|\r/);
  const trailing = /[\r\n]$/.test(raw);
  if (trailing) lines.pop();
  return { lines, trailing, ending: raw.includes('\r\n') ? '\r\n' : raw.includes('\r') ? '\r' : '\n' };
}

function joined(lines: string[], trailing: boolean, ending: string) {
  return lines.join(ending) + (trailing ? ending : '');
}

/** Suggest only edits whose likely structure is explicit; leave every ambiguous line for review. */
export function doctorTodoText(raw: string, today = todayString()): DoctorReport {
  const chunks = raw.split(/(\r\n|\n|\r)/);
  const repairs: DoctorFinding[] = [];
  for (let index = 0; index < chunks.length; index += 2) {
    const before = chunks[index];
    const line = Math.floor(index / 2) + 1;
    let after = before;
    const repeat = /^([ \t]+)@repeat\s*:\s*(.+)$/i.exec(before);
    const completed = /^([ \t]+)@completed\s*:\s*(.+)$/i.exec(before);
    if (repeat && parseRecurrence(repeat[2])) after = `  @repeat: ${repeat[2].trim()}`;
    else if (completed && validDate(completed[2].trim())) after = `  @completed: ${completed[2].trim()}`;
    else if (/^[ \t]+- \[[xX ]\] /.test(before)) after = before.trimStart();
    else if (/^-\[[xX ]\] /.test(before)) after = `- ${before.slice(1)}`;
    else if (/^- \[[xX ]\](?! )/.test(before)) after = before.replace(/^(- \[[xX ]\])/, '$1 ');
    if (after !== before) {
      const code = repeat || completed ? 'metadata-indent' : before.startsWith('- ') ? 'detail-spacing' : 'detail-indent';
      repairs.push({ code, line, level: 'repaired', message: code === 'metadata-indent' ? 'Normalized metadata indentation and marker.' : 'Normalized the detail marker.', before, after });
      chunks[index] = after;
    }
  }
  const candidate = chunks.join('');
  const { lines } = linesOf(candidate);
  const scanLines = lines.map((line, index) => index === 0 ? line.replace(/^\uFEFF/, '') : line);
  const findings: DoctorFinding[] = [...repairs];
  const parsed = parseTodoText(candidate, today);
  findings.push(...parsed.issues.map(issue => ({ code: 'syntax' as const, line: issue.line, level: 'review' as const, message: issue.message })));

  if (!parsed.issues.length) {
    const undatedStart = scanLines.indexOf('UNDATED');
    const datedLines = undatedStart >= 0 ? scanLines.slice(0,undatedStart) : scanLines;
    const headings = datedLines.flatMap((line, index) => validDate(line) ? [index] : []);
    for (let index = 0; index < headings.length; index++) {
      const start = headings[index];
      const end = headings[index + 1] ?? datedLines.length;
      const body = datedLines.slice(start + 1, end);
      if (body.some(line => line.trim()) && !body.some(line => !line.trim())) findings.push({
        code: 'divider', line: start + 1, level: 'review', date: scanLines[start],
        message: 'This date has no completed/upcoming divider. Choose whether its items are done or upcoming.',
      });
    }
    if (!findings.some(finding => finding.code === 'divider')) {
      const itemLines = new Map<string, number[]>();
      let date = '';
      for (let index = 0; index < datedLines.length; index++) {
        const line = datedLines[index];
        if (validDate(line)) { date = line; itemLines.set(date, []); }
        else if (date && line.trim() && !/^  @[a-z][\w-]*:/.test(line) && !/^- /.test(line)) itemLines.get(date)!.push(index + 1);
      }
      for (const day of parsed.document.days) day.items.forEach((item, index) => {
        if (!item.completed || item.repeat?.kind !== 'after') return;
        const line = itemLines.get(day.date)?.[index] ?? 0;
        if (!item.completedOn) findings.push({ code: 'completion-date', line, level: 'review', date: day.date, message: `“${item.text}” repeats but has no completion date. Choose the actual date to calculate its next item.` });
        if (!item.repeat.series || !item.repeat.occurrence) findings.push({ code: 'series-id', line, level: 'review', date: day.date, message: `“${item.text}” repeats but has no series identity. Start a new series here, or edit the rule to link it to existing occurrences.` });
      });
    }
  }
  return { candidate, findings, ready: findings.every(finding => finding.level === 'repaired') };
}

/** Apply a choice to the working text; the original imported file is never written. */
export function applyDoctorAction(raw: string, finding: DoctorFinding, action: DoctorAction, value?: string): string {
  const { lines, trailing, ending } = linesOf(raw);
  const at = finding.line - 1;
  if (at < 0 || at >= lines.length) return raw;
  if (finding.code === 'divider' && (action === 'mark-upcoming' || action === 'mark-done')) {
    if (!validDate(lines[at].replace(/^\uFEFF/, ''))) return raw;
    if (action === 'mark-upcoming') lines.splice(at + 1, 0, '');
    else {
      let end = at + 1;
      while (end < lines.length && !validDate(lines[end])) end++;
      lines.splice(end, 0, '');
    }
  } else if (finding.code === 'completion-date' && action === 'set-completion-date') {
    if (!value || !validDate(value)) return raw;
    lines.splice(at + 1, 0, `  @completed: ${value}`);
  } else if (finding.code === 'series-id' && action === 'start-series') {
    let repeatLine = at + 1;
    while (repeatLine < lines.length && (/^  @completed:/.test(lines[repeatLine]) || /^- /.test(lines[repeatLine]))) repeatLine++;
    if (!/^  @repeat:/.test(lines[repeatLine])) return raw;
    const rule = parseRecurrence(lines[repeatLine].slice('  @repeat:'.length));
    if (!rule || rule.series || rule.occurrence || !finding.date) return raw;
    lines[repeatLine] += `; series ${newSeriesId(lines[at], finding.date)}; occurrence 1`;
  } else return raw;
  return joined(lines, trailing, ending);
}
