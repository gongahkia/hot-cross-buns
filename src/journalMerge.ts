import { journalModel, materializeJournal, parseJournal, readJournal, serializeJournal } from './journalDocument.ts';
import { applyPlannerEdits } from './markdownPlanner.ts';
import type { TodoDocument } from './todoText.ts';
import type { MarkdownPlanner, SourceRange } from './markdownPlanner.ts';
import { outlineNodes } from './outline.ts';

export type MergeChoice = 'local' | 'file' | 'both' | 'manual';

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

function atomicFields(model: MarkdownPlanner, change: Change): Set<string> {
  const keys = new Set<string>();
  for (const group of [...model.days, ...model.undated]) for (const entry of group.entries) {
    const key = String(entry.range.start);
    if (intersects(change, entry.titleRange)) keys.add(key + ':title');
    const details = outlineNodes(entry.details);
    if ([entry.checkbox, entry.metadata, ...details.map(detail => detail.checkbox)].some(range => range && intersects(change, range))) keys.add(key + ':progress');
    details.forEach(detail => { if (intersects(change, detail.titleRange)) keys.add(`${key}:detail:${detail.range.start}`); });
    for (const node of [entry, ...details]) node.body?.forEach(block => { if (intersects(change, block.range)) keys.add(`${key}:body:${block.range.start}`); });
  }
  if (model.scratchpad && intersects(change, model.scratchpad)) keys.add('scratchpad');
  return keys;
}

function taskInsertion(model: MarkdownPlanner, change: Change): boolean {
  if (change.start !== change.end || !change.text.trim()) return false;
  const source = model.source;
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
  const baseModel = journalModel(baseline), localModel = journalModel(local), remoteModel = journalModel(remote);
  const identity = baseModel.documentId;
  if (localModel.documentId !== identity || remoteModel.documentId !== identity) return null;
  if (ours === theirs || theirs === base) return local;
  if (ours === base) return remote;
  if (localModel.format !== baseModel.format || remoteModel.format !== baseModel.format) return null;
  const left = changeFrom(base, ours), right = changeFrom(base, theirs);
  let source: string;
  if (left.start === left.end && right.start === right.end && left.start === right.start) {
    if (!taskInsertion(localModel, left) || !taskInsertion(remoteModel, right)) return null;
    const parts = [left.text, right.text].sort();
    source = base.slice(0, left.start) + parts.join('\n') + base.slice(left.end);
  } else {
    if (left.start < right.end && right.start < left.end || left.start === right.start) return null;
    const localFields = atomicFields(baseModel, left), remoteFields = atomicFields(baseModel, right);
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
  both?: TodoDocument;
  conflicts: Array<{ key: 'source' }>;
};
function keepBothEntryVersions(local: TodoDocument, remote: TodoDocument): TodoDocument | undefined {
  const ours = serializeJournal(local), theirs = serializeJournal(remote);
  const left = journalModel(local), right = journalModel(remote);
  if (left.documentId !== right.documentId) return;
  const candidates = [...left.days,...left.undated].flatMap(group => group.entries).filter(entry => entry.id);
  const byId = new Map([...right.days,...right.undated].flatMap(group => group.entries).map(entry => [entry.id, entry]));
  for (const entry of candidates) {
    const other = byId.get(entry.id);
    if (!other || other.repeat || other.replaces || entry.date !== other.date || entry.list !== other.list) continue;
    if (ours.slice(0,entry.range.start) !== theirs.slice(0,other.range.start) || ours.slice(entry.range.end) !== theirs.slice(other.range.end)) continue;
    const copy = structuredClone(remote), id = crypto.randomUUID();
    const original = [...copy.days,...copy.undated ?? []].flatMap(group => group.items).find(item => item.id === entry.id)!;
    original.id = id;
    const copied = materializeJournal(copy), model = readJournal(copied.source!).model;
    const node = [...model.days,...model.undated].flatMap(group => group.entries).find(candidate => candidate.id === id)!;
    const nl = /\r\n|\r|\n/.exec(ours)?.[0] ?? '\n';
    const raw = copied.source!.slice(node.range.start,node.range.end);
    const offset = entry.range.end;
    try {
      const next = applyPlannerEdits(left,ours,[{ range: { start: offset, end: offset }, expected: '', text: nl + nl + ' '.repeat(entry.column) + raw }]);
      return readJournal(next.source).document;
    } catch { return; }
  }
}
export function proposeMerge(local: TodoDocument, file: TodoDocument, baseline: TodoDocument | null): JournalMergeProposal {
  const ours = serializeJournal(local), theirs = serializeJournal(file);
  const merged = ours === theirs ? local : baseline ? mergeJournalSources(baseline, local, file) : null;
  return { local, file, merged, ...(merged ? {} : { both: keepBothEntryVersions(local,file) }), conflicts: merged ? [] : [{ key: 'source' }] };
}
export function resolveMerge(proposal: JournalMergeProposal, choices: Record<string, MergeChoice>, manual?: string): TodoDocument {
  if (proposal.merged && !choices.source) return proposal.merged;
  if (choices.source === 'local') return proposal.local;
  if (choices.source === 'file') return proposal.file;
  if (choices.source === 'both' && proposal.both) return proposal.both;
  if (choices.source === 'manual' && manual !== undefined) {
    const parsed = parseJournal(manual);
    if (parsed.issues.length) throw new Error(parsed.issues.map(issue => issue.message).join(' '));
    return parsed.document;
  }
  throw new Error('Choose the browser version, file version, or a validated manual merge. Both originals remain available for recovery.');
}
export const fileBaseline = (proposal: JournalMergeProposal) => proposal.file;
