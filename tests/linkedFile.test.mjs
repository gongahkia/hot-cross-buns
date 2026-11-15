import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyLinkedFileError, isJournalConflictCopy, readLinkedFile, saveLinkedText } from '../src/linkedFile.ts';

function fixture(raw = 'original') {
  const state = { raw, reads: 0, writes: 0, closes: 0, aborts: 0, permission: 'granted', fail: false, afterRead: null, afterWrite: null };
  const handle = {
    name: 'TODO.txt',
    queryPermission: async () => state.permission,
    getFile: async () => {
      const text = state.raw;
      state.reads++;
      state.afterRead?.(state.reads);
      return { size: Buffer.byteLength(text), text: async () => text };
    },
    createWritable: async options => {
      assert.equal(options.mode, 'exclusive');
      let staged;
      return {
        write: async text => { state.writes++; if (state.fail) throw new Error('Disk full'); staged = text; state.afterWrite?.(); },
        close: async () => { state.closes++; state.raw = staged; },
        abort: async () => { state.aborts++; },
      };
    },
  };
  const link = { id: 'link', handle, baselineText: raw, baselineDocument: { days: [] }, lastSavedAt: null, needsReview: false };
  return { state, link };
}

test('linked saves stage a complete file and skip unchanged text', async () => {
  const { state, link } = fixture();
  assert.equal(await saveLinkedText(link, 'original'), 'unchanged');
  assert.equal(state.writes, 0);
  assert.equal(await saveLinkedText(link, 'new journal'), 'saved');
  assert.equal(state.raw, 'new journal');
  assert.equal(state.closes, 1);
  assert.equal(state.aborts, 0);
});

test('external changes are detected before opening a writer', async () => {
  const { state, link } = fixture(); state.raw = 'remote edit';
  assert.equal(await saveLinkedText(link, 'local edit'), 'changed');
  assert.equal(state.raw, 'remote edit'); assert.equal(state.writes, 0); assert.equal(state.closes, 0);
});

test('a change while opening the writer aborts without replacing the remote text', async () => {
  const { state, link } = fixture();
  state.afterRead = count => { if (count === 1) state.raw = 'remote edit'; };
  assert.equal(await saveLinkedText(link, 'local edit'), 'changed');
  assert.equal(state.raw, 'remote edit'); assert.equal(state.writes, 0); assert.equal(state.aborts, 1);
});

test('a change during a staged write is checked again before close', async () => {
  const { state, link } = fixture(); state.afterWrite = () => { state.raw = 'remote edit'; };
  assert.equal(await saveLinkedText(link, 'local edit'), 'changed');
  assert.equal(state.raw, 'remote edit'); assert.equal(state.closes, 0); assert.equal(state.aborts, 1);
});

test('legacy reproduction: a write after the last check is overwritten by close', async () => {
  const { state, link } = fixture();
  state.afterRead = count => { if (count === 3) state.raw = 'unobserved device edit'; };
  assert.equal(await saveLinkedText(link, 'local edit'), 'saved');
  assert.equal(state.raw, 'local edit');
  assert.equal(state.reads, 3);
});

test('permission loss does not read or write the file', async () => {
  const { state, link } = fixture(); state.permission = 'prompt';
  assert.equal(await saveLinkedText(link, 'local edit'), 'permission');
  assert.equal(state.reads, 0); assert.equal(state.writes, 0);
});

test('failed writes abort and leave the prior file intact', async () => {
  const { state, link } = fixture(); state.fail = true;
  await assert.rejects(saveLinkedText(link, 'local edit'), /Disk full/);
  assert.equal(state.raw, 'original'); assert.equal(state.closes, 0); assert.equal(state.aborts, 1);
});

test('oversized local and remote files stop before a write', async () => {
  const { state, link } = fixture();
  await assert.rejects(saveLinkedText(link, 'x'.repeat(5 * 1024 * 1024 + 1)), /5 MiB/);
  state.raw = 'x'.repeat(5 * 1024 * 1024 + 1);
  await assert.rejects(saveLinkedText(link, 'local edit'), /5 MiB/);
  assert.equal(state.writes, 0);
});

test('folder reads and writes resolve the granted directory instead of a stale remembered entry', async () => {
  const { state, link } = fixture(), stale = { ...link.handle, getFile: async () => { throw new DOMException('Replaced entry', 'NotFoundError'); } };
  const current = { ...link.handle, isSameEntry: async other => other === current };
  link.handle = stale;
  link.historyDirectory = { queryPermission: async () => 'granted', getFileHandle: async name => { assert.equal(name, 'TODO.txt'); return current; }, values: async function* () {} };
  const snapshot = await readLinkedFile(link); assert.equal(snapshot.handle, current); assert.equal(snapshot.text, 'original');
  assert.equal(await saveLinkedText(link, 'After replacement'), 'saved'); assert.equal(state.raw, 'After replacement');
});
test('an entry replacement during staging aborts without committing to the wrong entry', async () => {
  const { state, link } = fixture(), first = { ...link.handle, isSameEntry: async other => other === first }, second = { ...link.handle, isSameEntry: async other => other === second };
  let active = first; state.afterWrite = () => { active = second; };
  link.historyDirectory = { queryPermission: async () => 'granted', getFileHandle: async () => active };
  assert.equal(await saveLinkedText(link, 'Local edit'), 'changed'); assert.equal(state.raw, 'original'); assert.equal(state.aborts, 1);
});
test('folder lookup never recreates a missing projection or escapes the granted directory', async () => {
  const { state, link } = fixture();
  link.historyDirectory = { queryPermission: async () => 'granted', getFileHandle: async (name, options) => { assert.equal(name, 'TODO.txt'); assert.equal(options, undefined); throw new DOMException('File is downloading', 'NotFoundError'); } };
  await assert.rejects(readLinkedFile(link), /downloading/); await assert.rejects(saveLinkedText(link, 'Local edit'), /downloading/);
  assert.equal(state.writes, 0);
});
test('a renamed or differently cased entry cannot silently switch the history namespace', async () => {
  const { state, link } = fixture(); link.historyDirectory = { getFileHandle: async () => ({ ...link.handle, name: 'Todo.txt' }) };
  await assert.rejects(readLinkedFile(link), /filename changed/); assert.equal(state.writes, 0);
});
test('temporary folder failures retry; permission and permanent failures need the appropriate action', () => {
  for (const name of ['NotFoundError', 'NotReadableError', 'NoModificationAllowedError', 'AbortError', 'InvalidStateError', 'TimeoutError']) assert.equal(classifyLinkedFileError(new DOMException('Temporary', name)), 'retrying');
  for (const name of ['NotAllowedError', 'SecurityError']) assert.equal(classifyLinkedFileError(new DOMException('Permission', name)), 'permission');
  assert.equal(classifyLinkedFileError(new DOMException('Disk full', 'QuotaExceededError')), 'error');
  assert.equal(classifyLinkedFileError(new Error('Unknown disk failure')), 'error');
});
test('provider conflict-copy signatures are scoped to the selected journal filename', () => {
  for (const name of ['TODO (conflicted copy 2026-11-15 120000).txt', "TODO (Kai's conflicted copy 2026-11-15).txt", 'TODO.sync-conflict-20261115-120000-DEVICE.txt']) assert.equal(isJournalConflictCopy(name, 'TODO.txt'), true);
  for (const name of ['TODO.txt', 'OTHER (conflicted copy 2026-11-15).txt', 'TODO (conflicted copy).txt.part', 'TODO (notes).txt', 'TODO (conflicted copy).json']) assert.equal(isJournalConflictCopy(name, 'TODO.txt'), false);
  assert.equal(isJournalConflictCopy('My.log (conflicted copy).txt', 'My.log.txt'), true);
});
test('conflict-copy discovery lists names without reading, merging or deleting those files', async () => {
  const { link } = fixture(); let reads = 0;
  link.historyDirectory = { getFileHandle: async () => link.handle, values: async function* () {
    for (const name of ['TODO.txt', 'TODO (conflicted copy 2026-11-15).txt', 'NOTES.txt']) yield { kind: 'file', name, getFile: async () => { reads++; throw new Error('Conflict copies must not be opened automatically'); } };
  } };
  assert.deepEqual((await readLinkedFile(link)).conflictCopies, ['TODO (conflicted copy 2026-11-15).txt']); assert.equal(reads, 0);
});
test('root folder enumeration has a work limit even when every entry is unrelated', async () => {
  const { link } = fixture(); let visited = 0;
  link.historyDirectory = { getFileHandle: async () => link.handle, values: async function* () {
    for (let i = 0; i < 2001; i++) { visited++; yield { kind: 'file', name: i + '.tmp' }; }
  } };
  await assert.rejects(readLinkedFile(link), /scan limit/); assert.equal(visited, 2001);
});
