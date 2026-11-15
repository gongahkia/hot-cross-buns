import assert from 'node:assert/strict';
import test from 'node:test';
import { fileRevisions } from '../src/fileRevisions.ts';
import { createRevision, MAX_REVISION_BYTES, parseRevision, revisionText, sha256 } from '../src/revisionProtocol.ts';

function fixture() {
  const state = { files: new Map(), sizes: new Map(), opened: 0, written: 0, closed: 0, aborted: 0, texts: 0, visited: 0, onOpen: null, onWrite: null, onClose: null };
  const folder = {
    getFileHandle: async (name, options) => {
      if (!state.files.has(name)) { if (!options?.create) throw new DOMException('Missing file', 'NotFoundError'); state.files.set(name, ''); }
      return { name, kind: 'file', getFile: async () => {
        const raw = state.files.get(name); if (raw === undefined) throw new DOMException('Missing file', 'NotFoundError');
        return { size: state.sizes.get(name) ?? Buffer.byteLength(raw), text: async () => { state.texts++; return raw; } };
      }, createWritable: async () => {
        state.opened++; await state.onOpen?.(name); let staged;
        return { write: async raw => { state.written++; staged = raw; await state.onWrite?.(name); }, close: async () => { state.closed++; state.files.set(name, staged); await state.onClose?.(name); }, abort: async () => { state.aborted++; } };
      } };
    },
    values: async function* () { for (const name of state.files.keys()) { state.visited++; yield await folder.getFileHandle(name); } },
  };
  const root = { getDirectoryHandle: async () => ({ getDirectoryHandle: async () => folder }) };
  const device = crypto.randomUUID(), link = { handle: { name: 'TODO.txt' }, historyDirectory: root };
  return { state, transport: fileRevisions(link, async () => device), record: () => createRevision('file:TODO.txt', device, [], 'UNDATED\n\nLIST: Inbox\nSaved\n') };
}
async function collision(record) {
  const other = { ...record, text: record.text.replace('Saved', 'Conflicting') };
  const { digest: _digest, ...body } = other; other.digest = await sha256(JSON.stringify(body));
  return other;
}

test('immutable retries leave a verified existing file untouched', async () => {
  const f = fixture(), record = await f.record(), name = record.id + '.json';
  await f.transport.put(record); const raw = f.state.files.get(name);
  await f.transport.put(record); assert.equal(f.state.files.get(name), raw); assert.equal(f.state.opened, 1);
});
test('a conflicting revision delivered while a writer opens or stages is never overwritten', async () => {
  for (const phase of ['onOpen', 'onWrite']) {
    const f = fixture(), record = await f.record(), other = await collision(record), name = record.id + '.json';
    await parseRevision(revisionText(other), 'file:TODO.txt');
    f.state[phase] = () => { f.state.files.set(name, revisionText(other)); };
    await assert.rejects(f.transport.put(record), /different revision/);
    assert.equal(f.state.files.get(name), revisionText(other)); assert.equal(f.state.closed, 0); assert.equal(f.state.aborted, 1);
  }
});
test('an identical revision arriving during creation is kept byte-for-byte', async () => {
  const f = fixture(), record = await f.record(), name = record.id + '.json', raw = JSON.stringify(record, null, 2);
  f.state.onOpen = () => { f.state.files.set(name, raw); };
  await f.transport.put(record); assert.equal(f.state.files.get(name), raw); assert.equal(f.state.closed, 0);
});
test('revision discovery includes uppercase extensions and identical client conflict copies', async () => {
  const f = fixture(), record = await f.record();
  f.state.files.set(record.id + '.JSON', revisionText(record));
  f.state.files.set(record.id + ' (conflicted copy 2026-11-15).json', revisionText(record));
  assert.equal((await f.transport.list()).length, 2);
});
test('directory scan work includes ignored temporary entries', async () => {
  const f = fixture(); for (let i = 0; i < 2001; i++) f.state.files.set(i + '.part', '');
  await assert.rejects(f.transport.list(), /scan limit/); assert.ok(f.state.visited <= 2001);
});
test('an oversized file colliding with a pending identity is rejected before loading its text', async () => {
  const f = fixture(), record = await f.record(), name = record.id + '.json';
  f.state.files.set(name, '{}'); f.state.sizes.set(name, MAX_REVISION_BYTES + 1);
  await assert.rejects(f.transport.put(record), /size limit/); assert.equal(f.state.texts, 0); assert.equal(f.state.opened, 0);
});
test('a lost close response verifies the same existing identity rather than creating another file', async () => {
  const f = fixture(), record = await f.record();
  f.state.onClose = () => { throw new DOMException('Lost close response', 'AbortError'); };
  await assert.rejects(f.transport.put(record), /Lost close response/); f.state.onClose = null;
  await f.transport.put(record); assert.equal(f.state.files.size, 1); assert.equal(f.state.opened, 1); assert.equal(f.state.closed, 1);
});
test('interrupted staging leaves its empty identity repairable by the same pending revision', async () => {
  const f = fixture(), record = await f.record();
  f.state.onWrite = () => { throw new DOMException('Interrupted staging', 'AbortError'); };
  await assert.rejects(f.transport.put(record), /Interrupted staging/);
  assert.equal(f.state.files.get(record.id + '.json'), ''); f.state.onWrite = null;
  await f.transport.put(record); assert.equal(f.state.files.size, 1); assert.equal(f.state.files.get(record.id + '.json'), revisionText(record));
});
