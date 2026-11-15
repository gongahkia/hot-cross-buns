import { assertImportText, MAX_IMPORT_BYTES } from './importLimits.ts';
import { doctorTodoText } from './todoDoctor.ts';
import { fileBaseline, proposeMerge, resolveMerge } from './todoMerge.ts';
import { advanceRecurrences } from './recurrence.ts';
import { parseTodoText, serializeTodoText, validateDocument, type TodoDocument, type TodoItem } from './todoText.ts';
import type { RevisionState, RevisionTransport } from './revisionProtocol.ts';
import { synchronizeRevisions } from './revisionSync.ts';

export type SyncProvider = 'file' | 'drive';
export type SyncStatus = { kind: 'unlinked' | 'saved' | 'saving' | 'waiting' | 'offline' | 'retrying' | 'reauth' | 'permission' | 'changed' | 'error'; name?: string; detail?: string; lastSavedAt?: number | null; retryAt?: number; lastCheckedAt?: number };
export type SyncLink = { id: string; baselineText: string; baselineDocument: TodoDocument; needsReview: boolean; lastSavedAt: number | null };
export type SyncCheckpoint = { id: string; text: string; document: TodoDocument; baselineText: string; createdAt: number; uncertain: boolean };
export type SyncRecovery = { at: number; local: string; remote: string };
export type SyncLedger = { linkId: string; generation: string; checkpoint?: SyncCheckpoint; history: string[]; failures: number; retryAt: number; status: SyncStatus; recovery?: SyncRecovery; revisions?: RevisionState };
export type SyncBundle<L extends SyncLink> = { link: L; document: TodoDocument; revision: number; ledger: SyncLedger };
export type SyncStore<L extends SyncLink> = { change: (work: (current: SyncBundle<L>, canIntegrate: boolean) => SyncBundle<L> | null, integrate?: boolean) => Promise<SyncBundle<L> | null> };
export type SyncAdapter<L extends SyncLink, S extends { text: string }> = {
  name: (link: L) => string;
  ready: (link: L) => Promise<'permission' | 'reauth' | null>;
  read: (link: L, dirty: boolean) => Promise<S>;
  write: (link: L, text: string) => Promise<{ kind: 'saved' | 'unchanged' | 'changed'; snapshot?: S }>;
  acknowledge: (link: L, snapshot: S, document: TodoDocument, wrote: boolean, now: number) => L;
  classify: (error: unknown) => 'permission' | 'reauth' | 'changed' | 'retrying' | 'error';
  network: boolean;
  revisions?: RevisionTransport;
};
export function newSyncLedger(linkId: string, previous?: SyncLedger): SyncLedger {
  const retained = previous?.linkId === linkId ? previous : undefined;
  return { linkId, generation: crypto.randomUUID(), history: retained ? remember(retained, retained.checkpoint?.text) : [], failures: 0, retryAt: 0, status: { kind: 'saving' }, ...(retained?.recovery ? { recovery: retained.recovery } : {}), ...(retained?.revisions ? { revisions: retained.revisions } : {}) };
}
export function retryDelay(failures: number, random = Math.random()): number {
  return Math.round(Math.min(60_000, 2000 * 2 ** Math.min(5, Math.max(0, failures - 1))) * (.8 + .4 * random));
}
function remember(ledger: SyncLedger, ...texts: Array<string | undefined>): string[] {
  const history = [...new Set([...texts.filter((text): text is string => text !== undefined), ...ledger.history])].slice(0, 3);
  while (new TextEncoder().encode(history.join('')).byteLength > MAX_IMPORT_BYTES) history.pop();
  return history;
}
const equal = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
function mergeItem(base: TodoItem, local: TodoItem, remote: TodoItem): TodoItem | null {
  // progress and recurrence are one value: completion can create a successor or alter details.
  const fields = (item: TodoItem) => [item.text, [item.completed, item.details, item.completedOn, item.repeat, item.span, item.skips, item.replaces]];
  const before = fields(base), ours = fields(local), theirs = fields(remote);
  const selected = ours.map((value, index) => equal(value, before[index]) ? theirs[index] : equal(theirs[index], before[index]) || equal(value, theirs[index]) ? value : undefined);
  if (selected.some(value => value === undefined)) return null;
  const source = equal(selected[1], theirs[1]) ? remote : local;
  return { ...source, id: local.id, text: selected[0] as string };
}
export function reconcileJournal(local: TodoDocument, raw: string, baseline: TodoDocument, today: string): { document: TodoDocument; baseline: TodoDocument } | null {
  if (doctorTodoText(raw).findings.length) return null;
  const parsed = parseTodoText(raw); if (parsed.issues.length) return null;
  return mergeDocuments(local, parsed.document, baseline, today);
}
function mergeDocuments(local: TodoDocument, remote: TodoDocument, baseline: TodoDocument, today: string, advance = true, stable = false) {
  const proposal = proposeMerge(local, remote, baseline, stable ? { identity: 'stable' } : { reviewAdditions: true });
  const baseItems = new Map([...baseline.days.flatMap(day => day.items), ...(baseline.undated ?? []).flatMap(list => list.items)].map(item => [item.id, item]));
  for (const row of proposal.conflicts) {
    if (!row.local || !row.file || row.reorderConflict || row.ambiguous) return null;
    const base = baseItems.get(row.local.id); if (!base) return null;
    const merged = mergeItem(base, row.local, row.file); if (!merged) return null;
    row.local = merged; row.choice = 'local'; row.conflict = false;
  }
  try {
    const document = resolveMerge(proposal, {});
    if (advance) advanceRecurrences(local, document, today, true, baseline);
    validateDocument(document); assertImportText(serializeTodoText(document));
    return { document, baseline: fileBaseline(proposal) };
  } catch { return null; }
}

export function rebaseLocalJournal(before: TodoDocument, optimistic: TodoDocument, latest: TodoDocument, today: string): TodoDocument | null {
  return mergeDocuments(optimistic, latest, before, today, true, true)?.document ?? null;
}

/** Keep only a contiguous, safely rebased history suffix within a bounded amount of work. */
export function rebaseSyncHistory(history: TodoDocument[], before: TodoDocument, after: TodoDocument, today: string, budget = 100_000): TodoDocument[] {
  const rows = (document: TodoDocument) => [...document.days.flatMap(day => day.items), ...(document.undated ?? []).flatMap(list => list.items)].reduce((sum, item) => sum + 1 + item.details.length, 0);
  const shared = rows(before) + rows(after), rebased: TodoDocument[] = [];
  for (let index = history.length - 1; index >= 0; index--) {
    budget -= shared + rows(history[index]);
    if (budget < 0) break;
    const result = mergeDocuments(history[index], after, before, today, false, true);
    if (!result) break;
    rebased.unshift(result.document);
  }
  return rebased;
}

/** One frozen submission is acknowledged; later local edits and undo remain in the journal. */
export type JournalSyncOptions<L extends SyncLink, S extends { text: string }> = {
  store: SyncStore<L>; adapter: SyncAdapter<L, S>; canSave: () => boolean; today: () => string;
  online: () => boolean; validate?: (document: TodoDocument) => void; force?: boolean; now?: () => number; random?: () => number;
  target?: { id: string; generation: string };
};
export async function synchronizeJournal<L extends SyncLink, S extends { text: string }>(options: JournalSyncOptions<L, S>): Promise<SyncBundle<L> | null> {
  if (options.adapter.revisions) return synchronizeRevisions(options);
  const { store, adapter, canSave } = options;
  const now = options.now ?? Date.now;
  let expected: { id: string; generation: string } | null = options.target ?? null;
  let observed: SyncBundle<L> | null = null;
  const change = async (work: (bundle: SyncBundle<L>, canIntegrate: boolean) => SyncBundle<L> | null, integrate = false) => {
    const value = await store.change((bundle, canIntegrate) => {
      if (expected && (bundle.link.id !== expected.id || bundle.ledger.generation !== expected.generation)) return null;
      return work(bundle, canIntegrate);
    }, integrate);
    if (value) observed = value;
    return value;
  };
  const state = (bundle: SyncBundle<L>, kind: SyncStatus['kind'], detail?: string): SyncBundle<L> => ({ ...bundle, ledger: { ...bundle.ledger, status: { kind, name: adapter.name(bundle.link), lastSavedAt: bundle.link.lastSavedAt, lastCheckedAt: bundle.ledger.status.lastCheckedAt, ...(detail ? { detail } : {}), ...(kind === 'retrying' ? { retryAt: bundle.ledger.retryAt } : {}) } } });
  try {
    let bundle = await change(current => current); if (!bundle) return null;
    expected = { id: bundle.link.id, generation: bundle.ledger.generation };
    if ('historyDirectory' in bundle.link && bundle.link.historyDirectory || 'revisionProtocol' in bundle.link && bundle.link.revisionProtocol) return await change(current => state(current, 'error', 'This coordinator cannot write a revision-enabled target. Update Hot Cross Buns, or unlink it and export the browser journal.'));
    if (bundle.link.needsReview) return await change(current => state(current, 'changed'));
    if (options.force) bundle = (await change(current => ({ ...current, ledger: { ...current.ledger, failures: 0, retryAt: 0, status: { kind: 'saving' } } })))!;
    if (!bundle) return null;
    if (adapter.network && !options.online()) return await change(current => state(current, 'offline'));
    const unavailable = await adapter.ready(bundle.link);
    if (unavailable) return await change(current => state(current, unavailable));
    if (!options.force && (bundle.ledger.status.kind === 'error' || bundle.ledger.failures >= 8)) return bundle;
    const retryAt = bundle.ledger.retryAt;
    if (!options.force && retryAt > now() && retryAt <= now() + 72_000) return bundle;
    if (!canSave()) return bundle;
    for (let races = 0; races < 3; races++) {
      const snapshot = await adapter.read(bundle.link, !!bundle.ledger.checkpoint || serializeTodoText(bundle.document) !== bundle.link.baselineText);
      let submission: SyncCheckpoint | undefined;
      bundle = await change((current, canIntegrate) => {
        if (current.link.needsReview) return state(current, 'changed');
        if (!canSave()) return state(current, 'waiting', 'Finish the current edit or review to continue syncing.');
        const text = serializeTodoText(current.document), checkpoint = current.ledger.checkpoint;
        const acknowledge = (document: TodoDocument) => ({
          ...current, link: adapter.acknowledge(current.link, snapshot, document, false, now()),
          ledger: { ...current.ledger, checkpoint: undefined, failures: 0, retryAt: 0, history: checkpoint || snapshot.text !== current.link.baselineText ? remember(current.ledger, checkpoint?.text, current.link.baselineText) : current.ledger.history, status: { kind: text === snapshot.text ? 'saved' as const : 'saving' as const, name: adapter.name(current.link), lastSavedAt: current.link.lastSavedAt, lastCheckedAt: now() } },
        });
        if (checkpoint?.text === snapshot.text) return acknowledge(checkpoint.document);
        if (text === snapshot.text) return acknowledge(current.document);
        let document = current.document, baseline = current.link.baselineDocument;
        const remoteChanged = snapshot.text !== current.link.baselineText;
        if (remoteChanged) {
          const recovery = { at: now(), local: text, remote: snapshot.text };
          const reviewed = current.ledger.history.includes(snapshot.text) ? null : reconcileJournal(current.document, snapshot.text, (checkpoint?.uncertain ? checkpoint.document : baseline), options.today());
          if (!reviewed) return { ...state(current, 'changed'), link: { ...current.link, needsReview: true }, ledger: { ...state(current, 'changed').ledger, recovery } };
          try { options.validate?.(reviewed.document); } catch (error) { return { ...state(current, 'changed', String(error)), link: { ...current.link, needsReview: true }, ledger: { ...state(current, 'changed', String(error)).ledger, recovery } }; }
          if (serializeTodoText(reviewed.document) !== text && !canIntegrate) return state(current, 'waiting', 'Finish editing to bring in file changes.');
          document = reviewed.document; baseline = reviewed.baseline;
          current = { ...current, document, ledger: { ...current.ledger, recovery } };
        }
        const outgoing = serializeTodoText(document); assertImportText(outgoing);
        if (outgoing === snapshot.text) return { ...acknowledge(baseline), document, ledger: { ...acknowledge(baseline).ledger, recovery: current.ledger.recovery, status: { kind: 'saved', name: adapter.name(current.link), lastSavedAt: current.link.lastSavedAt, lastCheckedAt: now() } } };
        submission = { id: crypto.randomUUID(), text: outgoing, document, baselineText: snapshot.text, createdAt: now(), uncertain: false };
        return {
          ...current, document, link: adapter.acknowledge(current.link, snapshot, baseline, false, now()),
          ledger: { ...current.ledger, checkpoint: submission, history: remember(current.ledger, checkpoint?.text), retryAt: 0, status: { kind: 'saving', name: adapter.name(current.link), lastSavedAt: current.link.lastSavedAt, lastCheckedAt: now() } },
        };
      }, true);
      if (!bundle || !submission || !canSave()) return bundle;
      const ready = await adapter.ready(bundle.link);
      if (ready) return await change(current => state(current, ready));
      const outgoing = submission;
      // unlink/review can complete during I/O; they invalidate this generation before the next send.
      const current = await change(value => value.ledger.checkpoint?.id === outgoing.id && !value.link.needsReview ? { ...value, ledger: { ...value.ledger, checkpoint: { ...value.ledger.checkpoint, uncertain: true } } } : null);
      if (!current || !canSave()) return current;
      let result: Awaited<ReturnType<typeof adapter.write>>;
      try { result = await adapter.write(current.link, outgoing.text); }
      catch (error) {
        const kind = adapter.classify(error);
        const status = typeof error === 'object' && error !== null && 'status' in error ? Number(error.status) : 0;
        if (kind === 'changed' || status >= 400 && status < 500 && status !== 408) await change(value => ({ ...value, ledger: { ...value.ledger, checkpoint: value.ledger.checkpoint?.id === outgoing.id ? { ...value.ledger.checkpoint, uncertain: false } : value.ledger.checkpoint } }));
        if (kind !== 'changed') throw error;
        result = { kind: 'changed' };
      }
      if (result.kind === 'changed') { bundle = await change(value => ({ ...value, ledger: { ...value.ledger, checkpoint: value.ledger.checkpoint ? { ...value.ledger.checkpoint, uncertain: false } : undefined } })); if (!bundle) return null; continue; }
      const confirmed = await adapter.read(current.link, true);
      if (confirmed.text !== outgoing.text) { bundle = current; continue; }
      return await change(latest => {
        if (latest.ledger.checkpoint?.id !== outgoing.id) return null;
        const link = adapter.acknowledge(latest.link, confirmed, outgoing.document, result.kind === 'saved', now());
        return { ...latest, link, ledger: { ...latest.ledger, checkpoint: undefined, failures: 0, retryAt: 0, history: remember(latest.ledger, outgoing.text, latest.link.baselineText), status: { kind: serializeTodoText(latest.document) === outgoing.text ? 'saved' : 'saving', name: adapter.name(link), lastSavedAt: link.lastSavedAt, lastCheckedAt: now() } } };
      });
    }
    return await change(current => ({ ...state(current, 'changed', 'The file kept changing. Review it before another save.'), link: { ...current.link, needsReview: true } }));
  } catch (error) {
    if (!expected) throw error;
    const kind = adapter.classify(error);
    try {
      return await change(current => {
        const failures = kind === 'reauth' ? current.ledger.failures : current.ledger.failures + 1;
        const next = { ...current, link: kind === 'changed' ? { ...current.link, needsReview: true } : current.link, ledger: { ...current.ledger, failures, retryAt: kind === 'reauth' ? now() + 250 : kind === 'retrying' && failures < 8 ? now() + retryDelay(failures, options.random?.()) : 0 } };
        return kind === 'reauth' ? state(next, 'retrying') : state(next, kind === 'retrying' && failures >= 8 ? 'error' : kind, String(error));
      });
    } catch { throw error; }
  }
  return observed;
}
