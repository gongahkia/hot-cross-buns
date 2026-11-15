import assert from 'node:assert/strict';
import test from 'node:test';
import { historyPreview, historyRows, loadRevisionHistory, restoreRevision, reviewHistoryBranch } from '../src/revisionHistory.ts';
import { createRevision, MAX_REVISIONS } from '../src/revisionProtocol.ts';
import { newSyncLedger } from '../src/journalSync.ts';
import { parseTodoText, serializeTodoText } from '../src/todoText.ts';

const raw = title => `UNDATED\n\nLIST: Inbox\n${title}\n`;
async function fixture() {
  const device = crypto.randomUUID(), root = await createRevision('test', device, [], raw('Original'));
  const latest = await createRevision('test', device, [root.id], raw('Current'));
  const state = { records: [latest, root], canIntegrate: true, fail: false, bundle: {
    link: { id: 'link', baselineText: latest.text, baselineDocument: parseTodoText(latest.text).document, needsReview: false, lastSavedAt: null },
    document: parseTodoText(latest.text).document, revision: 2,
    ledger: { ...newSyncLedger('link'), revisions: { frontier: [latest.id], seenHeads: [latest.id], recordedText: latest.text, stats: { count: 2, bytes: 1000 } } },
  } };
  const transport = { journal: 'test', device: async () => device, list: async () => state.records };
  const load = () => loadRevisionHistory('file', structuredClone(state.bundle), transport, async () => structuredClone(state.bundle));
  const store = { change: async work => {
    if (!state.bundle) return null;
    const next = work(structuredClone(state.bundle), state.canIntegrate);
    if (state.fail) throw new DOMException('Disk is full', 'QuotaExceededError');
    if (next) { next.revision++; state.bundle = next; }
    return next;
  } };
  return { root, latest, state, load, store };
}
test('history follows ancestry, deduplicates records and labels concurrent heads without inventing dates', async () => {
  const f = await fixture();
  const branch = await createRevision('test', crypto.randomUUID(), [f.root.id], raw('Other device'));
  f.state.records = [f.root, branch, f.latest, f.root];
  const snapshot = await f.load(), rows = historyRows(snapshot);
  assert.equal(rows.length, 3); assert.equal(rows.at(-1).record.id, f.root.id);
  assert.equal(rows.find(row => row.record.id === branch.id).status, 'Needs review');
  assert.equal(rows.find(row => row.record.id === branch.id).source, 'Another device');
  assert.equal(rows.find(row => row.record.id === f.latest.id).status, 'Included');
  f.state.records.reverse(); assert.deepEqual(historyRows(await f.load()), rows);
});
test('browsing is read-only, validates integrity and refuses missing known history', async () => {
  const f = await fixture(), before = structuredClone(f.state.bundle);
  await f.load(); assert.deepEqual(f.state.bundle, before);
  f.state.records[0] = { ...f.latest, text: raw('Corruption') };
  await assert.rejects(f.load(), /integrity/);
  f.state.records = [f.root]; await assert.rejects(f.load(), /incomplete/);
});
test('restoring atomically records a new pending child of the current frontier and retains later history', async () => {
  const f = await fixture(), snapshot = await f.load(), generation = snapshot.generation;
  const restored = await restoreRevision(snapshot, f.root.id, await f.load(), f.store, () => {});
  assert.equal(serializeTodoText(restored.document), f.root.text);
  assert.notEqual(restored.ledger.generation, generation);
  const pending = restored.ledger.revisions.pending;
  assert.deepEqual(pending.record.parents, [f.latest.id]); assert.equal(pending.record.text, f.root.text);
  assert.notEqual(pending.record.id, f.root.id); assert.equal(pending.transportId, undefined);
  assert.deepEqual(f.state.records, [f.latest, f.root]);
  assert.equal(restored.link.baselineText, f.latest.text);
});
test('stale selections, changed targets, new branches, active drafts and unsent work cannot be replaced', async () => {
  for (const mutate of [
    f => f.state.bundle.revision++, f => f.state.bundle.ledger.generation = 'replacement',
    f => f.state.bundle.link.id = 'replacement', f => f.state.bundle.link.needsReview = true,
    f => f.state.bundle.ledger.revisions.recordedText = 'unpublished', f => f.state.canIntegrate = false,
    f => f.state.bundle.ledger.checkpoint = { text: raw('Current'), uncertain: true },
    async f => f.state.records.push(await createRevision('test', crypto.randomUUID(), [f.root.id], raw('Late branch'))),
  ]) {
    const f = await fixture(), snapshot = await f.load(); await mutate(f);
    const before = structuredClone(f.state.bundle);
    await assert.rejects(async () => restoreRevision(snapshot, f.root.id, await f.load(), f.store, () => {}));
    assert.deepEqual(f.state.bundle, before);
  }
});
test('a writer racing the final transaction is fenced and quota failures keep the journal', async () => {
  for (const kind of ['quota', 'new-edit', 'unlinked']) {
    const f = await fixture(), snapshot = await f.load(), fresh = await f.load();
    if (kind === 'quota') f.state.fail = true;
    if (kind === 'new-edit') f.state.bundle.revision++;
    if (kind === 'unlinked') f.state.bundle = null;
    const before = structuredClone(f.state.bundle);
    await assert.rejects(restoreRevision(snapshot, f.root.id, fresh, f.store, () => {}));
    assert.deepEqual(f.state.bundle, before);
  }
});
test('malformed text, view limits and history capacity block restoration without altering history', async () => {
  for (const kind of ['format', 'view', 'capacity']) {
    const f = await fixture();
    if (kind === 'format') {
      f.root = await createRevision('test', f.root.device, [], '- [ ] Orphan detail\n');
      f.latest = await createRevision('test', f.latest.device, [f.root.id], raw('Current'));
      f.state.records = [f.latest, f.root];
      f.state.bundle.ledger.revisions.frontier = f.state.bundle.ledger.revisions.seenHeads = [f.latest.id];
    }
    const snapshot = await f.load();
    if (kind === 'capacity') f.state.bundle.ledger.revisions.stats.count = MAX_REVISIONS;
    const before = structuredClone(f.state.bundle);
    await assert.rejects(restoreRevision(snapshot, f.root.id, await f.load(), f.store, () => { if (kind === 'view') throw new Error('View limit'); }));
    assert.deepEqual(f.state.bundle, before);
  }
});
test('a selected incoming branch enters the existing explicit review without changing journal contents', async () => {
  const f = await fixture(), branch = await createRevision('test', crypto.randomUUID(), [f.root.id], raw('Incoming'));
  f.state.records.push(branch); const snapshot = await f.load();
  const before = serializeTodoText(f.state.bundle.document);
  await reviewHistoryBranch(snapshot, branch.id, await f.load(), f.store);
  assert.equal(f.state.bundle.link.needsReview, true);
  assert.equal(f.state.bundle.ledger.revisions.review.id, branch.id);
  assert.equal(serializeTodoText(f.state.bundle.document), before);
});
test('changed-region previews retain context and bound long-line rendering', () => {
  const preview = historyPreview('a\nb\nc\nd\ne\nf\ng\n', 'a\nb\nc\nchanged\ne\nf\ng\n');
  assert.equal(preview.before.text, 'b\nc\nd\ne\nf'); assert.equal(preview.after.text, 'b\nc\nchanged\ne\nf');
  const huge = historyPreview('x'.repeat(100_000), 'y'.repeat(100_000), 100);
  assert.equal(huge.before.text.length, 100); assert.equal(huge.after.truncated, true);
  assert.equal(historyPreview('same', 'same').same, true);
});
