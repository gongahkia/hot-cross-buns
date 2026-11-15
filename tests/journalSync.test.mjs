import assert from 'node:assert/strict';
import test from 'node:test';
import { newSyncLedger, reconcileJournal, rebaseSyncHistory, rebaseLocalJournal, retryDelay, synchronizeJournal } from '../src/journalSync.ts';
import { parseTodoText, serializeTodoText } from '../src/todoText.ts';

const raw = title => `UNDATED\n\nLIST: Inbox\n${title}\n- Detail\n`;
const parse = text => parseTodoText(text).document;
function fixture() {
  const baseline = parse(raw('Original'));
  const state = {
    bundle: { link: { id: 'link-1', baselineText: serializeTodoText(baseline), baselineDocument: baseline, needsReview: false, lastSavedAt: null }, document: structuredClone(baseline), revision: 1, ledger: newSyncLedger('link-1') },
    remote: serializeTodoText(baseline), reads: 0, writes: [], canSave: true, canIntegrate: true, online: true, clock: 100_000,
    afterRead: null, afterWrite: null, failCheckpoint: false, failReceipt: false, blocked: null, validate: null,
  };
  const store = { change: async work => {
    if (!state.bundle) return null;
    const previous = structuredClone(state.bundle), next = work(previous, state.canIntegrate);
    if (!next) return null;
    if (state.failCheckpoint && next.ledger.checkpoint && !state.bundle.ledger.checkpoint) throw new Error('Checkpoint storage failed');
    if (state.failReceipt && state.bundle.ledger.checkpoint && !next.ledger.checkpoint) throw new Error('Receipt storage failed');
    state.bundle = structuredClone(next); return structuredClone(next);
  } };
  const adapter = {
    name: () => 'TODO.txt', network: true, ready: async () => state.blocked,
    read: async () => { state.reads++; const snapshot = { text: state.remote }; await state.afterRead?.(); return snapshot; },
    write: async (_link, text) => { state.writes.push(text); state.remote = text; await state.afterWrite?.(); return { kind: 'saved' }; },
    acknowledge: (link, snapshot, document, wrote, now) => ({ ...link, baselineText: snapshot.text, baselineDocument: document, lastSavedAt: wrote ? now : link.lastSavedAt }),
    classify: error => error.status === 412 ? 'changed' : error.status === 401 ? 'reauth' : error instanceof TypeError ? 'retrying' : 'error',
  };
  const cycle = (force = false) => synchronizeJournal({ store, adapter, canSave: () => state.canSave, online: () => state.online, validate: document => state.validate?.(document), today: () => '2026-11-15', now: () => state.clock, random: () => .5, force });
  const title = value => { const document = structuredClone(state.bundle.document); document.undated[0].items[0].text = value; state.bundle.document = document; state.bundle.revision++; };
  return { state, cycle, title, adapter };
}

test('a frozen journal is durable before dispatch and is verified after writing', async () => {
  const { state, cycle, title } = fixture(); title('Queued');
  state.afterWrite = () => {
    assert.equal(state.bundle.ledger.checkpoint.text, state.writes[0]);
    assert.equal(state.bundle.ledger.checkpoint.uncertain, true);
    assert.notEqual(state.bundle.link.baselineText, state.writes[0]);
  };
  await cycle();
  assert.equal(state.writes.length, 1); assert.equal(state.reads, 2);
  assert.equal(state.bundle.ledger.checkpoint, undefined); assert.equal(state.bundle.ledger.status.kind, 'saved');
  assert.equal(state.bundle.link.baselineText, state.remote);
});
test('checkpoint failure stops dispatch and retains the saved browser journal', async () => {
  const { state, cycle, title } = fixture(); title('Saved locally'); state.failCheckpoint = true;
  await cycle(); assert.equal(state.writes.length, 0);
  assert.match(serializeTodoText(state.bundle.document), /Saved locally/);
  assert.equal(state.bundle.ledger.status.kind, 'error');
});
test('a newer edit during delivery is never acknowledged as part of the older submission', async () => {
  const { state, cycle, title } = fixture(); title('First');
  state.afterWrite = () => { title('Newer'); state.afterWrite = null; };
  await cycle();
  assert.match(state.bundle.link.baselineText, /First/); assert.match(serializeTodoText(state.bundle.document), /Newer/);
  assert.equal(state.bundle.ledger.status.kind, 'saving');
  await cycle(); assert.match(state.remote, /Newer/); assert.equal(state.writes.length, 2);
});
test('undo during delivery remains queued after the accepted write', async () => {
  const { state, cycle, title } = fixture(); title('Changed');
  state.afterWrite = () => { title('Original'); state.afterWrite = null; };
  await cycle(); assert.match(state.remote, /Changed/); assert.match(serializeTodoText(state.bundle.document), /Original/);
  await cycle(); assert.match(state.remote, /Original/); assert.equal(state.writes.length, 2);
});
test('accepted write with a lost response recovers after restart without another upload', async () => {
  const { state, cycle, title } = fixture(); title('Accepted');
  state.afterWrite = () => { throw new TypeError('Connection lost'); };
  await cycle(); assert.equal(state.bundle.ledger.status.kind, 'retrying');
  assert.equal(state.bundle.ledger.checkpoint.uncertain, true);
  state.afterWrite = null;
  await cycle(true); assert.equal(state.writes.length, 1); assert.equal(state.bundle.ledger.status.kind, 'saved');
});
test('lost response followed by undo and an independent remote edit preserves both intents', async () => {
  const { state, cycle, title } = fixture(); title('Submitted');
  state.afterWrite = () => { title('Original'); state.remote = state.remote.replace('- Detail', '- From phone'); throw new TypeError('Connection lost'); };
  await cycle(); state.afterWrite = null;
  await cycle(true);
  assert.match(state.remote, /Original\n- From phone/);
  assert.match(serializeTodoText(state.bundle.document), /Original\n- From phone/);
});
test('failed receipt storage retains the checkpoint and reconciles without a duplicate upload', async () => {
  const { state, cycle, title } = fixture(); title('Accepted'); state.failReceipt = true;
  await cycle(); assert.equal(state.writes.length, 1); assert.ok(state.bundle.ledger.checkpoint);
  assert.match(state.bundle.link.baselineText, /Original/);
  state.failReceipt = false; await cycle(true);
  assert.equal(state.writes.length, 1); assert.equal(state.bundle.ledger.status.kind, 'saved');
});
test('late receipts cannot modify a relinked target or a newer reviewed generation', async () => {
  for (const relink of [false, true]) {
    const { state, cycle, title } = fixture(); title('Old submission');
    state.afterWrite = () => { state.bundle.ledger.generation = 'new-generation'; if (relink) state.bundle.link.id = 'new-link'; state.bundle.link.baselineText = 'New target baseline'; };
    await cycle(); assert.equal(state.bundle.link.baselineText, 'New target baseline');
  }
});
test('an unlink during network I/O keeps local edits and cannot be undone by its receipt', async () => {
  const { state, cycle, title } = fixture(); title('Keep locally');
  state.afterWrite = () => { state.bundle = null; };
  await cycle(); assert.equal(state.bundle, null); assert.equal(state.writes.length, 1);
});
test('independent fields merge automatically with a recoverable before-and-file copy', async () => {
  const { state, cycle, title } = fixture(); title('Local title'); state.remote = state.remote.replace('- Detail', '- Phone detail');
  await cycle(); assert.match(state.remote, /Local title\n- Phone detail/);
  assert.match(state.bundle.ledger.recovery.local, /Local title\n- Detail/);
  assert.match(state.bundle.ledger.recovery.remote, /Original\n- Phone detail/);
});
test('overlapping titles, ambiguous identities, deletions and malformed text require review', async () => {
  for (const remote of [raw('Phone title'), '', '2026-11-16\nMissing divider\n']) {
    const { state, cycle, title } = fixture(); title('Local title'); state.remote = remote;
    await cycle(); assert.equal(state.writes.length, 0); assert.equal(state.bundle.link.needsReview, true);
    assert.match(serializeTodoText(state.bundle.document), /Local title/);
  }
  const duplicate = parse('UNDATED\n\nLIST: Inbox\nSame\nSame\n');
  assert.equal(reconcileJournal(duplicate, 'UNDATED\n\nLIST: Inbox\nSame\n', duplicate, '2026-11-15'), null);
});
test('an active editor defers incoming integration across tabs without overwriting its draft', async () => {
  const { state, cycle } = fixture(); state.remote = raw('From phone'); state.canIntegrate = false;
  await cycle(); assert.equal(state.bundle.ledger.status.kind, 'waiting'); assert.match(serializeTodoText(state.bundle.document), /Original/);
  state.canIntegrate = true; await cycle(); assert.match(serializeTodoText(state.bundle.document), /From phone/);
});
test('an over-budget incoming projection retains both copies for review without changing the journal', async () => {
  const { state, cycle } = fixture(); state.remote = raw('From phone');
  state.validate = () => { throw new Error('Projection budget exceeded'); };
  await cycle();
  assert.equal(state.bundle.link.needsReview, true); assert.equal(state.writes.length, 0);
  assert.match(serializeTodoText(state.bundle.document), /Original/);
  assert.match(state.bundle.ledger.recovery.local, /Original/); assert.match(state.bundle.ledger.recovery.remote, /From phone/);
  assert.match(state.bundle.ledger.status.detail, /Projection budget exceeded/);
});
test('offline edits and retry cooldowns survive reload and are shared by potential owners', async () => {
  const { state, cycle, title } = fixture(); title('Offline edit'); state.online = false;
  await cycle(); assert.equal(state.reads, 0); assert.equal(state.bundle.ledger.status.kind, 'offline');
  state.online = true; state.afterWrite = () => { throw new TypeError('Offline again'); };
  await cycle(); const reads = state.reads;
  await cycle(); assert.equal(state.reads, reads);
  state.clock += 2100; state.afterWrite = null; await cycle(); assert.equal(state.writes.length, 1);
  assert.equal(state.bundle.ledger.status.kind, 'saved');
});
test('clock rollback resets an excessive cooldown without dropping the pending submission', async () => {
  const { state, cycle, title } = fixture(); title('Keep queued');
  state.bundle.ledger.retryAt = state.clock + 900_000;
  await cycle(); assert.match(state.remote, /Keep queued/);
  assert.equal(retryDelay(1, 0), 1600); assert.equal(retryDelay(20, 1), 72_000);
});
test('old submitted content returning after a newer acknowledgement is reviewed, not silently restored', async () => {
  const { state, cycle, title } = fixture(); title('First'); await cycle(); const stale = state.remote;
  title('Latest'); await cycle(); state.remote = stale;
  await cycle(); assert.equal(state.bundle.link.needsReview, true); assert.match(serializeTodoText(state.bundle.document), /Latest/);
});
test('an explicit rejection is distinguished from an uncertain accepted request', async () => {
  const { state, cycle, title, adapter } = fixture(); title('Keep queued');
  adapter.write = async () => { throw Object.assign(new Error('Changed before save'), { status: 412 }); };
  await cycle(); assert.equal(state.bundle.ledger.checkpoint.uncertain, false); assert.equal(state.bundle.link.needsReview, true);
});
test('a pending local storage failure pauses transport before or after its remote read', async () => {
  const { state, cycle, title } = fixture(); title('Draft'); state.afterRead = () => { state.canSave = false; };
  await cycle(); assert.equal(state.writes.length, 0); assert.match(serializeTodoText(state.bundle.document), /Draft/);
});
test('conditional races reread before retrying, and repeated contention stops for review', async () => {
  const { state, cycle, title, adapter } = fixture(); title('Draft'); let attempts = 0;
  adapter.write = async () => { attempts++; return { kind: 'changed' }; };
  await cycle(); assert.equal(attempts, 3); assert.equal(state.bundle.link.needsReview, true);
});


test('undo history rebases local title changes while preserving incoming detail edits', () => {
  const before = parse(raw('Local title'));
  const earlier = structuredClone(before); earlier.undated[0].items[0].text = 'Original';
  const after = structuredClone(before); after.undated[0].items[0].details[0].text = 'From phone';
  const history = rebaseSyncHistory([earlier], before, after, '2026-11-15');
  assert.equal(history.length, 1); assert.match(serializeTodoText(history[0]), /Original\n- From phone/);
  assert.equal(history[0].undated[0].items[0].id, before.undated[0].items[0].id);
});
test('ambiguous inverses and the history work budget retire older undo safely', () => {
  const before = parse(raw('Local title'));
  const earlier = structuredClone(before); earlier.undated[0].items[0].text = 'Original';
  const after = structuredClone(before); after.undated[0].items[0].text = 'Phone title';
  assert.equal(rebaseSyncHistory([earlier], before, after, '2026-11-15').length, 0);
  assert.equal(rebaseSyncHistory([earlier], before, before, '2026-11-15', 0).length, 0);
});
test('independent identical additions without portable identities require review', () => {
  const local = parse(raw('Added locally'));
  const result = reconcileJournal(local, raw('Added locally') + 'Another item\n', { days: [] }, '2026-11-15');
  assert.equal(result, null);
});

test('an authentication failure during verification does not call an accepted write rejected', async () => {
  const { state, cycle, title, adapter } = fixture(); title('Submitted');
  let verify = false;
  const read = adapter.read;
  adapter.read = async (...args) => { if (verify) { verify = false; throw Object.assign(new Error('Reconnect'), { status: 401 }); } return read(...args); };
  state.afterWrite = () => { title('Original'); state.remote = state.remote.replace('- Detail', '- From phone'); verify = true; state.afterWrite = null; };
  await cycle(); assert.equal(state.bundle.ledger.checkpoint.uncertain, true);
  await cycle(true); assert.match(state.remote, /Original\n- From phone/);
});
test('review starts a new generation while retaining uncertain payloads for late-echo detection', () => {
  const before = newSyncLedger('same-target'); before.checkpoint = { text: 'Possible late write' }; before.recovery = { at: 1, local: 'Local', remote: 'Remote' };
  const reviewed = newSyncLedger('same-target', before);
  assert.notEqual(reviewed.generation, before.generation); assert.equal(reviewed.checkpoint, undefined);
  assert.ok(reviewed.history.includes('Possible late write')); assert.deepEqual(reviewed.recovery, before.recovery);
  assert.equal(newSyncLedger('different-target', before).history.length, 0);
});
test('automatic retry stops after eight failures and explicit resume resets its budget', async () => {
  const { state, cycle, title, adapter } = fixture(); title('Queued');
  const write = adapter.write;
  adapter.write = async () => { throw new TypeError('Network unavailable'); };
  for (let attempt = 0; attempt < 8; attempt++) { await cycle(); state.clock += 73_000; }
  assert.equal(state.bundle.ledger.status.kind, 'error'); const reads = state.reads;
  await cycle(); assert.equal(state.reads, reads);
  adapter.write = write; await cycle(true); assert.match(state.remote, /Queued/); assert.equal(state.bundle.ledger.failures, 0);
});


test('local field rebasing preserves concurrent progress without replacing incoming identities', () => {
  const before = parse(raw('Original'));
  const ours = structuredClone(before); ours.undated[0].items[0].text = 'Local title';
  const theirs = structuredClone(before); theirs.undated[0].items[0].details[0].text = 'Other tab detail';
  const merged = rebaseLocalJournal(before, ours, theirs, '2026-11-15');
  assert.match(serializeTodoText(merged), /Local title\n- Other tab detail/);
  theirs.undated[0].items[0].text = 'Other title';
  assert.equal(rebaseLocalJournal(before, ours, theirs, '2026-11-15'), null);
});
test('distinct same-text captures in two tabs remain separate items with their original identities', () => {
  const ours = parse(raw('Same')), theirs = parse(raw('Same'));
  const merged = rebaseLocalJournal({ days: [] }, ours, theirs, '2026-11-15');
  assert.equal(merged.undated[0].items.length, 2);
  assert.deepEqual(new Set(merged.undated[0].items.map(item => item.id)), new Set([ours.undated[0].items[0].id, theirs.undated[0].items[0].id]));
});
