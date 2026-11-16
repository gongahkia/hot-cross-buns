import { readJournal } from './journalDocument.ts';

export type JournalFinding = { line: number; code: string; message: string; level: 'review' | 'warning' };
export function doctorJournal(raw: string) {
  const { model } = readJournal(raw);
  return { original: raw, candidate: raw, findings: model.issues.map(issue => ({
    line: raw.slice(0, issue.range.start).split(/\r\n|\r|\n/).length,
    code: issue.code, message: issue.message, level: issue.severity === 'error' ? 'review' as const : 'warning' as const,
  })) };
}
