import { parseJournal, readJournal, serializeJournal } from './journalDocument.ts';
import type { TodoDocument } from './todoText.ts';
import type { MergeChoice } from './todoMerge.ts';
export type { MergeChoice } from './todoMerge.ts';
import type { SourceRange } from './markdownPlanner.ts';

type Change = SourceRange & { text: string };
function changeFrom(base: string, next: string): Change {
  let start = 0, end = base.length, nextEnd = next.length;
  while (start < end && start < nextEnd && base[start] === next[start]) start++;
  if (start && /[\uD800-\uDBFF]/.test(base[start - 1])) start--;
  while (end > start && nextEnd > start && base[end - 1] === next[nextEnd - 1]) { end--; nextEnd--; }
  if (end < base.length && /[\uDC00-\uDFFF]/.test(base[end])) { end++; nextEnd++; }
  return { start, end, text: next.slice(start, nextEnd) };
}
const intersects = (change: Change, range: SourceRange) => change.start === change.end
  ? change.start >= range.start && change.start <= range.end && !(change.start === range.end && /^[\r\n]/.test(change.text))
  : change.start < range.end && change.end > range.start;

function atomicFields(source: string, change: Change): Set<string> {
  const { model } = readJournal(source), keys = new Set<string>();
  for (const group of [...model.days, ...model.undated]) for (const entry of group.entries) {
    const key = String(entry.range.start);
    if (intersects(change, entry.titleRange)) keys.add(key + ':title');
    if ([entry.checkbox, entry.metadata, ...entry.details.map(detail => detail.checkbox)].some(range => range && intersects(change, range))) keys.add(key + ':progress');
    entry.details.forEach((detail, index) => { if (intersects(change, detail.titleRange)) keys.add(`${key}:detail:${index}`); });
  }
  if (model.scratchpad && intersects(change, model.scratchpad)) keys.add('scratchpad');
  return keys;
}

function taskInsertion(source: string, change: Change): boolean {
  if (change.start !== change.end || !change.text.trim()) return false;
  const { model } = readJournal(source);
  const entries = [...model.days, ...model.undated].flatMap(group => group.entries).filter(entry => entry.range.start >= change.start && entry.range.end <= change.start + change.text.length);
  if (!entries.length || entries.some(entry => !entry.id)) return false;
  let remainder = '', cursor = change.start;
  for (const entry of entries) { remainder += source.slice(cursor, entry.range.start); cursor = entry.range.end; }
  remainder += source.slice(cursor, change.start + change.text.length);
  return !remainder.trim();
}

/** bounded conservative source merge; overlapping fields and opaque captures require review. */
export function mergeJournalSources(baseline: TodoDocument, local: TodoDocument, remote: TodoDocument): TodoDocument | null {
  const base = serializeJournal(baseline), ours = serializeJournal(local), theirs = serializeJournal(remote);
  const identity = readJournal(base).model.documentId;
  if (readJournal(ours).model.documentId !== identity || readJournal(theirs).model.documentId !== identity) return null;
  if (ours === theirs || theirs === base) return local;
  if (ours === base) return remote;
  const left = changeFrom(base, ours), right = changeFrom(base, theirs);
  let source: string;
  if (left.start === left.end && right.start === right.end && left.start === right.start) {
    if (!taskInsertion(ours, left) || !taskInsertion(theirs, right)) return null;
    const parts = [left.text, right.text].sort();
    source = base.slice(0, left.start) + parts.join('\n') + base.slice(left.end);
  } else {
    if (left.start < right.end && right.start < left.end || left.start === right.start) return null;
    const localFields = atomicFields(base, left), remoteFields = atomicFields(base, right);
    if ([...localFields].some(key => remoteFields.has(key))) return null;
    const edits = [left, right].sort((a, b) => b.start - a.start);
    source = base;
    for (const change of edits) source = source.slice(0, change.start) + change.text + source.slice(change.end);
  }
  try {
    const parsed = parseJournal(source);
    return parsed.issues.length ? null : parsed.document;
  } catch { return null; }
}

export type JournalMergeProposal = {
  local: TodoDocument; file: TodoDocument; merged: TodoDocument | null;
  conflicts: Array<{ key: 'source' }>;
};
export function proposeMerge(local: TodoDocument, file: TodoDocument, baseline: TodoDocument | null): JournalMergeProposal {
  const ours = serializeJournal(local), theirs = serializeJournal(file);
  const merged = ours === theirs ? local : baseline ? mergeJournalSources(baseline, local, file) : null;
  return { local, file, merged, conflicts: merged ? [] : [{ key: 'source' }] };
}
export function resolveMerge(proposal: JournalMergeProposal, choices: Record<string, MergeChoice>, manual?: string): TodoDocument {
  if (proposal.merged && !choices.source) return proposal.merged;
  if (choices.source === 'local') return proposal.local;
  if (choices.source === 'file') return proposal.file;
  if (choices.source === 'both' && manual !== undefined) {
    const parsed = parseJournal(manual);
    if (parsed.issues.length) throw new Error(parsed.issues.map(issue => issue.message).join(' '));
    return parsed.document;
  }
  throw new Error('Choose the browser version, file version, or a validated manual merge. Both originals remain available for recovery.');
}
export const fileBaseline = (proposal: JournalMergeProposal) => proposal.file;
