import assert from 'node:assert/strict';
import test from 'node:test';
import { createRevision, parseRevision, revisionGraph, revisionText, MAX_REVISIONS } from '../src/revisionProtocol.ts';
import { reviewedRevision } from '../src/revisionSync.ts';
import { newSyncLedger, synchronizeJournal } from '../src/journalSync.ts';
import { parseTodoText, serializeTodoText } from '../src/todoText.ts';

const raw = title => `UNDATED\n\nLIST: Inbox\n${title}\n`;
const doc = text => parseTodoText(text).document;
const remote = () => ({ text: raw('Original'), records: new Map(), puts: [], writes: [] });
function device(server, source) {
  const id = crypto.randomUUID(), baseline = doc(server.text);
  const state = { bundle: source ? structuredClone(source) : { link: { id: 'link', baselineText: server.text, baselineDocument: baseline, needsReview: false, lastSavedAt: null }, document: baseline, revision: 1, ledger: newSyncLedger('link') }, visible: null, canIntegrate: true, online: true, canSave: true, failCheckpoint: false, failReceipt: false, afterPut: null, beforeWrite: null, reservations: 0 };
  const store = { change: async work => {
    if (!state.bundle) return null;
    const next = work(structuredClone(state.bundle), state.canIntegrate); if (!next) return null;
    if (state.failCheckpoint && next.ledger.revisions?.pending && !state.bundle.ledger.revisions?.pending) throw new Error('Checkpoint storage full');
    if (state.failReceipt && state.bundle.ledger.revisions?.pending && !next.ledger.revisions?.pending) throw new Error('Receipt storage full');
    state.bundle = structuredClone(next); return structuredClone(next);
  } };
  const adapter = {
    name: () => 'TODO.txt', network: true, ready: async () => null,
    read: async () => ({ text: server.text }),
    write: async (_link, text) => { await state.beforeWrite?.(); server.writes.push(text); server.text = text; return { kind: 'saved' }; },
    acknowledge: (link, snapshot, document, wrote) => ({ ...link, baselineText: snapshot.text, baselineDocument: document, lastSavedAt: wrote ? 1 : link.lastSavedAt }),
    classify: error => error instanceof TypeError ? 'retrying' : error.status === 401 ? 'reauth' : error.status === 412 ? 'changed' : 'error',
    revisions: { journal: 'test', device: async () => id, reserve: async () => 'reserved-' + ++state.reservations,
      list: async () => [...server.records.values()].filter(record => !state.visible || state.visible.has(record.id) || record.device === id),
      put: async (record, transportId) => { assert.ok(state.bundle.ledger.revisions.pending); assert.equal(state.bundle.ledger.revisions.pending.transportId, transportId); server.puts.push({ record, transportId });
        const old = server.records.get(record.id); if (old) assert.equal(revisionText(old), revisionText(record)); else server.records.set(record.id, record);
        await state.afterPut?.();
      },
    },
  };
  const cycle = (force = false) => synchronizeJournal({ store, adapter, canSave: () => state.canSave, online: () => state.online, today: () => '2026-11-15', now: () => 100_000, force });
  const edit = title => { state.bundle.document = doc(raw(title)); };
  const accept = () => { state.bundle.ledger.revisions = reviewedRevision(state.bundle.ledger.revisions, state.bundle.ledger.revisions.review.id); state.bundle.link.needsReview = false; state.bundle.ledger.generation = crypto.randomUUID(); state.bundle.ledger.status.kind = 'saving'; };
  return { state, adapter, cycle, edit, accept };
}

test('a verified immutable revision precedes the first projection write', async () => {
  const server = remote(), app = device(server); app.edit('Saved');
  app.state.beforeWrite = () => assert.ok([...server.records.values()].some(record => record.text === raw('Saved')));
  await app.cycle(); assert.equal(server.text, raw('Saved')); assert.equal(app.state.bundle.ledger.status.kind, 'saved');
});
test('a restoration queued without a transport ID reserves once and reuses that identity after a lost reply', async () => {
  const server = remote(), app = device(server); await app.cycle();
  const root = [...server.records.values()][0]; app.edit('Later version'); await app.cycle();
  const frontier = app.state.bundle.ledger.revisions.frontier;
  const restored = await createRevision('test', root.device, frontier, root.text);
  app.state.bundle.document = doc(root.text);
  app.state.bundle.ledger.revisions.pending = { record: restored };
  const reservations = app.state.reservations;
  app.state.afterPut = () => { throw new TypeError('Lost restoration receipt'); };
  await app.cycle();
  const pending = structuredClone(app.state.bundle.ledger.revisions.pending);
  assert.equal(pending.record.id, restored.id); assert.ok(pending.transportId);
  assert.equal(app.state.reservations, reservations + 1);
  app.state.afterPut = null; await app.cycle(true);
  assert.equal(app.state.reservations, reservations + 1);
  assert.equal(server.records.size, 3); assert.equal(server.text, root.text);
  assert.equal(app.state.bundle.ledger.revisions.pending, undefined);
  assert.ok([...server.records.values()].some(record => record.text === raw('Later version')));
});
test('failed identity reservation retains the restored document and frozen identity alongside later local edits', async () => {
  const server = remote(), app = device(server); await app.cycle();
  const root = [...server.records.values()][0]; app.edit('Later version'); await app.cycle();
  const restored = await createRevision('test', root.device, app.state.bundle.ledger.revisions.frontier, root.text);
  app.state.bundle.document = doc(root.text); app.state.bundle.ledger.revisions.pending = { record: restored };
  const reserve = app.adapter.revisions.reserve;
  app.adapter.revisions.reserve = async () => { throw new TypeError('Offline before reservation'); };
  await app.cycle(); assert.equal(app.state.bundle.ledger.revisions.pending.record.id, restored.id);
  assert.equal(serializeTodoText(app.state.bundle.document), root.text); assert.equal(server.records.size, 2);
  app.edit('Newer edit after restoration'); app.adapter.revisions.reserve = reserve;
  await app.cycle(true); await app.cycle(true);
  assert.ok(server.records.has(restored.id)); assert.equal(server.text, raw('Newer edit after restoration'));
  assert.equal(server.records.size, 4);
});
test('both app revisions survive the exact last-check/commit race', async () => {
  const server = remote(), first = device(server); await first.cycle();
  const second = device(server, first.state.bundle), root = [...server.records.keys()][0];
  first.edit('First device'); second.edit('Second device');
  first.state.beforeWrite = async () => {
    second.state.visible = new Set([root]);
    await second.cycle();
    assert.equal(server.text, raw('Second device'));
    first.state.beforeWrite = null;
  };
  await first.cycle(); assert.equal(server.text, raw('First device'));
  assert.ok([...server.records.values()].some(record => record.text === raw('First device')));
  assert.ok([...server.records.values()].some(record => record.text === raw('Second device')));
  second.state.visible = null; await first.cycle(); await second.cycle();
  assert.equal(first.state.bundle.link.needsReview, true); assert.equal(second.state.bundle.link.needsReview, true);
  assert.equal(server.records.size, 3);
});
test('an offline branch keeps its original ancestry and becomes an explicit conflict on return', async () => {
  const server = remote(), first = device(server); await first.cycle(); const second = device(server, first.state.bundle);
  second.state.online = false; second.edit('Offline branch'); await second.cycle();
  first.edit('Online branch'); await first.cycle();
  second.state.online = true; await second.cycle();
  const revision = [...server.records.values()].find(record => record.text === raw('Offline branch'));
  assert.equal(revision.parents.length, 1); assert.notEqual(revision.parents[0], first.state.bundle.ledger.revisions.frontier[0]);
  assert.equal(second.state.bundle.link.needsReview, true); assert.equal(server.text, raw('Online branch'));
});
test('lost publication replies and failed receipt transactions reuse the frozen record and transport identity', async () => {
  for (const failure of ['reply', 'receipt']) {
    const server = remote(), app = device(server); app.edit('Submitted');
    if (failure === 'reply') app.state.afterPut = () => { throw new TypeError('Lost reply'); }; else app.state.failReceipt = true;
    await app.cycle(); assert.ok(app.state.bundle.ledger.revisions.pending); assert.equal(server.writes.length, 0);
    app.state.afterPut = null; app.state.failReceipt = false;
    const reopened = device(server, app.state.bundle); await reopened.cycle(true);
    assert.equal(server.records.size, 1); assert.equal(server.puts[0].transportId, server.puts[1].transportId);
    assert.equal(reopened.state.reservations, 0); assert.equal(server.text, raw('Submitted'));
  }
});
test('a failed checkpoint stops publication and leaves the projection untouched', async () => {
  const server = remote(), app = device(server); app.edit('Local'); app.state.failCheckpoint = true;
  await app.cycle(); assert.equal(server.records.size, 0); assert.equal(server.text, raw('Original'));
  assert.match(serializeTodoText(app.state.bundle.document), /Local/);
});
test('an explicit rejected projection retains the confirmed merge baseline and clears uncertainty', async () => {
  const server = remote(), app = device(server); await app.cycle(); app.edit('Retained locally');
  app.adapter.write = async () => { throw Object.assign(new Error('Conditional rejection'), { status: 412 }); };
  await app.cycle(); assert.equal(app.state.bundle.link.needsReview, true);
  assert.equal(app.state.bundle.ledger.checkpoint.uncertain, false);
  assert.equal(serializeTodoText(app.state.bundle.link.baselineDocument), raw('Original'));
  assert.equal(serializeTodoText(app.state.bundle.document), raw('Retained locally'));
});
test('a previously listed revision disappearing is not hidden by a browser cache', async () => {
  const server = remote(), app = device(server); await app.cycle(); server.records.clear();
  await app.cycle(); assert.equal(app.state.bundle.ledger.status.kind, 'retrying'); assert.equal(server.writes.length, 0);
});
test('the observed retention limit blocks another publication before reserving an identity', async () => {
  const server = remote(), app = device(server); await app.cycle();
  app.state.bundle.ledger.revisions.stats = { count: MAX_REVISIONS, bytes: 0 }; app.edit('Keep locally');
  await app.cycle(); assert.equal(server.records.size, 1); assert.equal(app.state.reservations, 1);
  assert.equal(app.state.bundle.ledger.status.kind, 'error'); assert.equal(server.text, raw('Original'));
});
test('newer edits and undo during revision publication stay queued', async () => {
  for (const newer of ['Newer edit', 'Original']) {
    const server = remote(), app = device(server); app.edit('Submitted');
    app.state.afterPut = () => { app.edit(newer); app.state.afterPut = null; };
    await app.cycle(); assert.equal(server.text, raw('Original')); assert.equal(server.records.size, 1);
    await app.cycle(); assert.equal(server.text, raw(newer)); assert.equal(server.records.size, 2);
  }
});
test('a late publication receipt cannot modify an unlinked or relinked generation', async () => {
  for (const unlink of [false, true]) {
    const server = remote(), app = device(server); app.edit('Submitted');
    app.state.afterPut = () => { if (unlink) app.state.bundle = null; else app.state.bundle.ledger.generation = 'replacement'; };
    await app.cycle(); assert.equal(server.writes.length, 0); assert.equal(server.records.size, 1);
  }
});
test('linear incoming revisions wait for active drafts before integrating', async () => {
  const server = remote(), first = device(server); await first.cycle(); const second = device(server, first.state.bundle);
  first.edit('From another device'); await first.cycle(); second.state.canIntegrate = false;
  await second.cycle(); assert.equal(second.state.bundle.ledger.status.kind, 'waiting');
  assert.equal(serializeTodoText(second.state.bundle.document), raw('Original'));
  second.state.canIntegrate = true; await second.cycle(); await second.cycle();
  assert.equal(serializeTodoText(second.state.bundle.document), raw('From another device'));
});
test('missing ancestors or previously observed heads pause without changing the projection', async () => {
  const server = remote(), app = device(server); await app.cycle(); app.edit('New revision'); await app.cycle();
  const child = [...server.records.values()].at(-1); server.records = new Map([[child.id, child]]);
  await app.cycle(); assert.equal(app.state.bundle.ledger.status.kind, 'retrying');
  assert.equal(server.text, raw('New revision'));
});
test('external editor contents are recorded before replacement and overlap needs review', async () => {
  const server = remote(), app = device(server); await app.cycle();
  app.edit('Local edit'); server.text = raw('Editor edit');
  await app.cycle(); assert.equal(server.text, raw('Editor edit'));
  const captured = [...server.records.values()].find(record => record.origin === 'external'); assert.ok(captured);
  await app.cycle(); assert.equal(app.state.bundle.link.needsReview, true);
  assert.equal(app.state.bundle.ledger.revisions.review.text, raw('Editor edit'));
});
test('restoring historical text externally requires review instead of silently ignoring the rollback', async () => {
  const server = remote(), app = device(server); await app.cycle(); app.edit('Latest'); await app.cycle();
  server.text = raw('Original'); await app.cycle(); await app.cycle();
  assert.equal(app.state.bundle.link.needsReview, true);
  assert.equal(serializeTodoText(app.state.bundle.document), raw('Latest'));
  assert.equal(app.state.bundle.ledger.revisions.review.text, raw('Original'));
});
test('a known pre-upgrade delayed payload cannot silently replace the migrated journal', async () => {
  const server = remote(), app = device(server); await app.cycle();
  app.state.bundle.ledger.history.push(raw('Old uncertain submission'));
  server.text = raw('Old uncertain submission'); await app.cycle(); await app.cycle();
  assert.equal(app.state.bundle.link.needsReview, true);
  assert.equal(serializeTodoText(app.state.bundle.document), raw('Original'));
});
test('undo after a lost projection reply remains deliverable without a spurious external branch', async () => {
  const server = remote(), app = device(server); await app.cycle(); app.edit('Submitted');
  const write = app.adapter.write;
  app.adapter.write = async (_link, text) => { server.text = text; app.edit('Original'); throw new TypeError('Lost projection receipt'); };
  await app.cycle(); assert.equal(app.state.bundle.ledger.checkpoint.uncertain, true);
  app.adapter.write = write; await app.cycle(true);
  assert.equal(server.text, raw('Original')); assert.equal(app.state.bundle.link.needsReview, false);
  assert.equal([...server.records.values()].filter(record => record.origin === 'external').length, 0);
});
test('linear recurring completion records one successor without mistaking its projection for a rollback', async () => {
  const server = remote(); server.text = '2026-11-15\n\nWater\n  @repeat: every 1 day after completion; series plants; occurrence 1\n';
  const app = device(server); await app.cycle();
  const completed = '2026-11-15\nWater\n  @repeat: every 1 day after completion; series plants; occurrence 1\n  @completed: 2026-11-15\n\n';
  const record = await createRevision('test', crypto.randomUUID(), app.state.bundle.ledger.revisions.frontier, completed);
  server.records.set(record.id, record); server.text = completed;
  await app.cycle(); await app.cycle(); await app.cycle();
  assert.equal(app.state.bundle.link.needsReview, false);
  assert.equal((server.text.match(/occurrence 2/g) ?? []).length, 1);
  assert.equal([...server.records.values()].filter(record => record.origin === 'external').length, 0);
});
test('reviewed merges record only acknowledged branches and keep a third branch pending', async () => {
  const server = remote(), app = device(server); await app.cycle(); const seed = structuredClone(app.state.bundle);
  const other = device(server, seed); other.edit('Second'); await other.cycle();
  app.edit('First'); await app.cycle(); app.edit('Resolved first and second'); app.accept(); await app.cycle();
  const merge = [...server.records.values()].find(record => record.text === raw('Resolved first and second'));
  assert.equal(merge.parents.length, 2);
  const late = device(server, seed); late.edit('Third offline branch'); await late.cycle();
  await app.cycle(); assert.equal(app.state.bundle.link.needsReview, true);
  assert.equal(app.state.bundle.ledger.revisions.review.text, raw('Third offline branch'));
});
test('integrity, identity collisions, future protocols, and history bounds fail closed', async () => {
  const record = await createRevision('test', crypto.randomUUID(), [], raw('One'));
  await assert.rejects(parseRevision(revisionText(record).replace('One', 'Two'), 'test'), /integrity/);
  await assert.rejects(parseRevision(JSON.stringify({ ...record, protocol: 2 }), 'test'), /unsupported/);
  await assert.rejects(parseRevision(revisionText(record), 'another-journal'), /different journal/);
  const other = await createRevision('test', record.device, [], raw('Other'));
  const collision = { ...record, text: other.text, digest: '' };
  const { sha256 } = await import('../src/revisionProtocol.ts');
  collision.digest = await sha256(JSON.stringify(Object.fromEntries(Object.entries(collision).filter(([key]) => key !== 'digest'))));
  await assert.rejects(revisionGraph([record, collision], 'test'), /same identity/);
  assert.equal((await revisionGraph([record, record], 'test')).stats.count, 1);
  const records = await Promise.all(Array.from({ length: MAX_REVISIONS + 1 }, () => createRevision('test', record.device, [], '')));
  await assert.rejects(revisionGraph(records, 'test'), /limit/);
});
