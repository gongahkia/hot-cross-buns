import { doctorTodoText } from './todoDoctor.ts';
import { parseTodoText, serializeTodoText, validateDocument, type TodoDocument } from './todoText.ts';
import { newSyncLedger, type SyncBundle, type SyncLink, type SyncProvider, type SyncStore } from './journalSync.ts';
import { assertHistorySpace, createRevision, revisionGraph, type Revision, type RevisionTransport } from './revisionProtocol.ts';

export type HistorySnapshot = {
  provider: SyncProvider; linkId: string; generation: string; revision: number; document: TodoDocument; documentText: string;
  journal: string; device: string; records: Revision[]; frontier: string[]; heads: string[]; pending: boolean; needsReview: boolean; stats: { count: number; bytes: number };
};
export async function loadRevisionHistory<L extends SyncLink>(provider: SyncProvider, initial: SyncBundle<L>, transport: RevisionTransport, refresh: () => Promise<SyncBundle<L> | null>): Promise<HistorySnapshot> {
  const graph = await revisionGraph(await transport.list(), transport.journal), latest = await refresh();
  if (!latest || latest.link.id !== initial.link.id || latest.ledger.generation !== initial.ledger.generation) throw new Error('The sync target changed. Close history and open it again.');
  const revisions = latest.ledger.revisions;
  for (const id of [...(revisions?.frontier ?? []), ...(revisions?.seenHeads ?? [])]) if (!graph.byId.has(id)) throw new Error('History is incomplete or changed while loading. Let file transfer finish, then refresh.');
  return { provider, linkId: latest.link.id, generation: latest.ledger.generation, revision: latest.revision, document: latest.document, documentText: serializeTodoText(latest.document), journal: transport.journal,
    device: await transport.device(), records: [...graph.byId.values()], heads: graph.heads, frontier: revisions?.frontier ?? [], pending: !!revisions?.pending || !!latest.ledger.checkpoint || revisions?.recordedText !== serializeTodoText(latest.document), needsReview: latest.link.needsReview, stats: graph.stats };
}
export function historyRows(snapshot: HistorySnapshot) {
  const records = new Map(snapshot.records.map(record => [record.id, record]));
  const depths = new Map<string, number>(), known = new Set<string>();
  const depth = (id: string): number => { if (depths.has(id)) return depths.get(id)!; const value = 1 + Math.max(-1, ...records.get(id)!.parents.map(depth)); depths.set(id, value); return value; };
  const include = (id: string) => { if (known.has(id)) return; known.add(id); records.get(id)?.parents.forEach(include); };
  snapshot.frontier.forEach(include);
  return [...records.values()].sort((a, b) => depth(b.id) - depth(a.id) || a.id.localeCompare(b.id)).map(record => ({ record,
    status: snapshot.frontier.includes(record.id) ? 'Included' : known.has(record.id) ? 'Earlier' : snapshot.heads.includes(record.id) ? 'Needs review' : 'Other branch',
    source: record.origin === 'external' ? 'Text editor' : record.device === snapshot.device ? 'This device' : 'Another device',
  }));
}
export function historyPreview(before: string, after: string, maxCharacters = 24_000) {
  const left = before.split('\n'), right = after.split('\n'); let start = 0, end = 0;
  while (start < left.length && start < right.length && left[start] === right[start]) start++;
  while (end < left.length - start && end < right.length - start && left[left.length - 1 - end] === right[right.length - 1 - end]) end++;
  const from = Math.max(0, start - 2);
  const clip = (lines: string[]) => { const text = lines.slice(from, Math.min(lines.length, lines.length - end + 2)).join('\n'); return { text: text.slice(0, maxCharacters), truncated: text.length > maxCharacters }; };
  return { same: before === after, before: clip(left), after: clip(right) };
}
function checkSnapshot(before: HistorySnapshot, fresh: HistorySnapshot, id: string) {
  const record = fresh.records.find(record => record.id === id), original = before.records.find(record => record.id === id);
  if (before.linkId !== fresh.linkId || before.generation !== fresh.generation || before.provider !== fresh.provider || before.journal !== fresh.journal
    || before.revision !== fresh.revision || before.documentText !== fresh.documentText || JSON.stringify(before.frontier) !== JSON.stringify(fresh.frontier) || JSON.stringify(before.heads) !== JSON.stringify(fresh.heads)
    || !record || record.digest !== original?.digest) throw new Error('The journal or history changed. Refresh and review your choice again.');
  return record;
}
export async function restoreRevision<L extends SyncLink>(before: HistorySnapshot, id: string, fresh: HistorySnapshot, store: SyncStore<L>, validate: (document: TodoDocument) => void): Promise<SyncBundle<L>> {
  const record = checkSnapshot(before, fresh, id);
  if (fresh.pending || fresh.needsReview || historyRows(fresh).some(row => row.status === 'Needs review')) throw new Error('Finish file saving and review pending branches before restoring a version.');
  if (doctorTodoText(record.text).findings.length) throw new Error('This version needs import repair. Download it and use Import TODO.txt.');
  const parsed = parseTodoText(record.text); if (parsed.issues.length) throw new Error('This version needs import repair. Download it and use Import TODO.txt.');
  validateDocument(parsed.document); validate(parsed.document);
  const text = serializeTodoText(parsed.document);
  if (text === serializeTodoText(fresh.document)) throw new Error('This version already matches the journal.');
  const revision = await createRevision(fresh.journal, fresh.device, fresh.frontier, text);
  assertHistorySpace(fresh.stats, revision);
  const result = await store.change((current, integrate) => {
    if (!integrate) throw new Error('Finish editing journal fields in other windows before restoring.');
    if (current.link.id !== fresh.linkId || current.ledger.generation !== fresh.generation || current.revision !== fresh.revision
      || current.link.needsReview || current.ledger.checkpoint || current.ledger.revisions?.pending || JSON.stringify(current.ledger.revisions?.frontier ?? []) !== JSON.stringify(fresh.frontier)) throw new Error('The journal or sync target changed. Refresh history before restoring.');
    const ledger = newSyncLedger(current.link.id, current.ledger);
    if (!ledger.revisions) throw new Error('Revision history is no longer linked.');
    assertHistorySpace(ledger.revisions.stats, revision);
    ledger.revisions.pending = { record: revision };
    return { ...current, document: parsed.document, ledger };
  }, true);
  if (!result) throw new Error('The sync target was unlinked. The journal was kept.');
  return result;
}
export async function reviewHistoryBranch<L extends SyncLink>(before: HistorySnapshot, id: string, fresh: HistorySnapshot, store: SyncStore<L>) {
  const record = checkSnapshot(before, fresh, id);
  if (!historyRows(fresh).some(row => row.record.id === id && row.status === 'Needs review')) throw new Error('This branch is already included. Refresh history.');
  const result = await store.change(current => {
    if (current.link.id !== fresh.linkId || current.ledger.generation !== fresh.generation || current.revision !== fresh.revision || !current.ledger.revisions || current.ledger.revisions.pending) throw new Error('The journal or file saving changed. Refresh history before reviewing.');
    return { ...current, link: { ...current.link, needsReview: true }, ledger: { ...current.ledger, revisions: { ...current.ledger.revisions, review: record }, status: { kind: 'changed' } } };
  });
  if (!result) throw new Error('The sync target was unlinked.');
}
