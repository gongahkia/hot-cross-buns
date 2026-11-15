import { assertHistorySpace, createRevision, MissingHistoryError, revisionGraph, type RevisionState } from './revisionProtocol.ts';
import { reconcileJournal, retryDelay, type JournalSyncOptions, type SyncBundle, type SyncLink, type SyncStatus } from './journalSync.ts';
import { serializeTodoText } from './todoText.ts';

/** Immutable publication precedes projection writes; concurrent heads require explicit review. */
export async function synchronizeRevisions<L extends SyncLink, S extends { text: string }>(options: JournalSyncOptions<L, S>): Promise<SyncBundle<L> | null> {
  const { store, adapter, canSave } = options, transport = adapter.revisions!;
  const now = options.now ?? Date.now;
  let expected = options.target;
  const change = (work: (bundle: SyncBundle<L>, integrate: boolean) => SyncBundle<L> | null, integrate = false) => store.change((bundle, allowed) => {
    if (expected && (bundle.link.id !== expected.id || bundle.ledger.generation !== expected.generation)) return null;
    return work(bundle, allowed);
  }, integrate);
  const state = (bundle: SyncBundle<L>, kind: SyncStatus['kind'], detail?: string): SyncBundle<L> => ({ ...bundle, ledger: { ...bundle.ledger, status: { kind, detail, name: adapter.name(bundle.link), lastSavedAt: bundle.link.lastSavedAt, lastCheckedAt: now(), retryAt: bundle.ledger.retryAt } } });
  const publish = async (bundle: SyncBundle<L>): Promise<SyncBundle<L> | null> => {
    let pending = bundle.ledger.revisions!.pending;
    if (!pending) return bundle;
    if (!pending.transportId && transport.reserve) {
      const id = pending.record.id, transportId = await transport.reserve();
      const prepared = await change(current => current.ledger.revisions?.pending?.record.id === id ? { ...current, ledger: { ...current.ledger, revisions: { ...current.ledger.revisions, pending: { ...current.ledger.revisions.pending, transportId } } } } : null);
      if (!prepared) return null;
      pending = prepared.ledger.revisions!.pending!;
    }
    await transport.put(pending.record, pending.transportId);
    return await change(latest => {
      const revisions = latest.ledger.revisions!;
      if (revisions.pending?.record.id !== pending.record.id) return null;
      const journal = pending.record.origin === 'journal';
      return { ...state(latest, 'saving'), ledger: { ...state(latest, 'saving').ledger, failures: 0, retryAt: 0, revisions: { ...revisions, pending: undefined,
        ...(journal ? { frontier: [pending.record.id], recordedText: pending.record.text } : { handledProjection: pending.record.text }) } } };
    });
  };
  try {
    let bundle = await change(current => current); if (!bundle) return null;
    expected = { id: bundle.link.id, generation: bundle.ledger.generation };
    if (bundle.link.needsReview) return await change(current => state(current, 'changed'));
    if (options.force) bundle = await change(current => ({ ...current, ledger: { ...current.ledger, failures: 0, retryAt: 0, status: { kind: 'saving' } } }));
    if (!bundle) return null;
    if (adapter.network && !options.online()) return await change(current => state(current, 'offline'));
    const ready = await adapter.ready(bundle.link); if (ready) return await change(current => state(current, ready));
    if (!options.force && (bundle.ledger.status.kind === 'error' || bundle.ledger.failures >= 8)) return bundle;
    if (!options.force && bundle.ledger.retryAt > now() && bundle.ledger.retryAt <= now() + 72_000 || !canSave()) return bundle;
    if (!bundle.ledger.revisions) bundle = await change(current => ({ ...current, ledger: { ...current.ledger, revisions: { frontier: [], seenHeads: [], recordedText: null } } }));
    if (!bundle) return null;
    if (bundle.ledger.revisions!.pending) { bundle = await publish(bundle); if (!bundle) return null; }
    let revisions = bundle.ledger.revisions!, text = serializeTodoText(bundle.document);
    // freeze our own intent before discovery; a newly discovered branch must not become its parent.
    if (text !== revisions.recordedText || revisions.frontier.length > 1) {
      const record = await createRevision(transport.journal, await transport.device(), revisions.frontier, text);
      assertHistorySpace(revisions.stats, record);
      const transportId = await transport.reserve?.();
      bundle = await change(current => {
        if (!canSave() || serializeTodoText(current.document) !== text || current.ledger.revisions!.pending) return state(current, 'saving');
        return { ...state(current, 'saving'), ledger: { ...state(current, 'saving').ledger, revisions: { ...current.ledger.revisions!, pending: { record, transportId } } } };
      });
      if (!bundle) return null;
      bundle = await publish(bundle); if (!bundle) return null;
    }
    revisions = bundle.ledger.revisions!;
    const listed = await transport.list();
    const graph = await revisionGraph(listed, transport.journal);
    for (const id of [...revisions.frontier, ...revisions.seenHeads]) if (!graph.byId.has(id)) throw new MissingHistoryError('Previously observed sync history is missing. Waiting for a complete listing; the journal and TODO.txt are unchanged.');
    bundle = await change(current => ({ ...current, ledger: { ...current.ledger, revisions: { ...current.ledger.revisions!, seenHeads: graph.heads, stats: graph.stats } } }));
    if (!bundle) return null;
    revisions = bundle.ledger.revisions!;
    if (!canSave() || serializeTodoText(bundle.document) !== revisions.recordedText) return await change(current => state(current, 'saving'));
    const known = new Set(revisions.frontier.flatMap(id => [...graph.ancestors.get(id)!]));
    const incoming = graph.heads.find(id => !known.has(id));
    if (incoming) {
      const record = graph.byId.get(incoming)!;
      const linear = graph.heads.length === 1 && revisions.frontier.length > 0 && revisions.frontier.every(id => graph.ancestors.get(incoming)!.has(id));
      const merged = linear ? reconcileJournal(bundle.document, record.text, bundle.document, options.today()) : null;
      let valid = !!merged; try { if (merged) options.validate?.(merged.document); } catch { valid = false; }
      if (!merged || !valid) return await change(current => ({ ...state(current, 'changed', 'A concurrent or external journal revision needs review.'), link: { ...current.link, needsReview: true }, ledger: { ...state(current, 'changed').ledger,
        revisions: { ...current.ledger.revisions!, review: record }, recovery: { at: now(), local: serializeTodoText(current.document), remote: record.text } } }));
      return await change((current, integrate) => {
        if (!integrate || !canSave()) return state(current, 'waiting', 'Finish editing to bring in journal revisions.');
        if (serializeTodoText(current.document) !== revisions.recordedText) return state(current, 'saving');
        return { ...state(current, 'saving'), document: merged.document, ledger: { ...state(current, 'saving').ledger, revisions: { ...current.ledger.revisions!, frontier: [incoming], recordedText: record.text, handledProjection: record.text }, recovery: { at: now(), local: serializeTodoText(current.document), remote: record.text } } };
      }, true);
    }
    // TODO.txt is a projection. Capture newly observed editor text before replacing it.
    const snapshot = await adapter.read(bundle.link, true);
    text = serializeTodoText(bundle.document);
    const expectedReceipt = bundle.ledger.checkpoint?.uncertain && snapshot.text === bundle.ledger.checkpoint.text;
    if (snapshot.text !== bundle.link.baselineText && snapshot.text !== text && !expectedReceipt && revisions.handledProjection !== snapshot.text) {
      // an old projection and an intentional editor rollback are indistinguishable; review either.
      const historical = bundle.ledger.history.includes(snapshot.text) || [...graph.byId.values()].some(record => record.text === snapshot.text);
      const record = await createRevision(transport.journal, await transport.device(), historical ? [] : revisions.projectedHeads ?? [], snapshot.text, 'external');
      assertHistorySpace(revisions.stats, record);
      const transportId = await transport.reserve?.();
      bundle = await change(current => ({ ...state(current, 'saving'), ledger: { ...state(current, 'saving').ledger, revisions: { ...current.ledger.revisions!, pending: { record, transportId } } } }));
      if (!bundle) return null;
      await publish(bundle);
      return await change(current => state(current, 'saving'));
    }
    if (snapshot.text === text) return await change(current => {
      const matches = serializeTodoText(current.document) === snapshot.text;
      return { ...state(current, matches ? 'saved' : 'saving'), link: adapter.acknowledge(current.link, snapshot, bundle!.document, false, now()), ledger: { ...state(current, matches ? 'saved' : 'saving').ledger, checkpoint: undefined, failures: 0, retryAt: 0, revisions: { ...current.ledger.revisions!, projectedHeads: revisions.frontier, handledProjection: undefined } } };
    });
    const frozen = { id: crypto.randomUUID(), text, document: bundle.document, baselineText: snapshot.text, createdAt: now(), uncertain: true };
    bundle = await change(current => {
      if (!canSave() || serializeTodoText(current.document) !== text) return state(current, 'saving');
      return { ...state(current, 'saving'), link: adapter.acknowledge(current.link, snapshot, current.link.baselineDocument, false, now()), ledger: { ...state(current, 'saving').ledger, checkpoint: frozen } };
    });
    if (!bundle || bundle.ledger.checkpoint?.id !== frozen.id || !canSave()) return bundle;
    const rejected = () => change(current => ({ ...current, ledger: { ...current.ledger, checkpoint: current.ledger.checkpoint?.id === frozen.id ? { ...current.ledger.checkpoint, uncertain: false } : current.ledger.checkpoint } }));
    let result: Awaited<ReturnType<typeof adapter.write>>;
    try { result = await adapter.write(bundle.link, frozen.text); }
    catch (error) {
      const status = typeof error === 'object' && error !== null && 'status' in error ? Number(error.status) : 0;
      if (status >= 400 && status < 500 && status !== 408) await rejected();
      throw error;
    }
    if (result.kind === 'changed') { await rejected(); return await change(current => state(current, 'saving')); }
    const confirmed = await adapter.read(bundle.link, true);
    if (confirmed.text !== frozen.text) return await change(current => state(current, 'saving'));
    return await change(current => {
      const link = adapter.acknowledge(current.link, confirmed, frozen.document, result.kind === 'saved', now());
      const matches = serializeTodoText(current.document) === frozen.text;
      return { ...state({ ...current, link }, matches ? 'saved' : 'saving'), ledger: { ...state({ ...current, link }, matches ? 'saved' : 'saving').ledger, checkpoint: undefined, failures: 0, retryAt: 0, revisions: { ...current.ledger.revisions!, projectedHeads: revisions.frontier, handledProjection: undefined } } };
    });
  } catch (error) {
    if (!expected) throw error;
    const kind = error instanceof MissingHistoryError ? 'retrying' : adapter.classify(error);
    return await change(current => {
      const failures = kind === 'reauth' ? current.ledger.failures : current.ledger.failures + 1;
      const next = { ...current, link: kind === 'changed' ? { ...current.link, needsReview: true } : current.link, ledger: { ...current.ledger, failures, retryAt: kind === 'reauth' ? now() + 250 : kind === 'retrying' && failures < 8 ? now() + retryDelay(failures, options.random?.()) : 0 } };
      return state(next, kind === 'reauth' ? 'retrying' : kind === 'retrying' && failures >= 8 ? 'error' : kind, kind === 'reauth' ? undefined : String(error));
    });
  }
}

export function reviewedRevision(state: RevisionState, id: string): RevisionState {
  if (state.pending || state.review?.id !== id) throw new Error('The journal revision changed. Cancel and review it again.');
  return { ...state, frontier: [...new Set([...state.frontier, id])].sort(), handledProjection: state.review.text, review: undefined };
}
