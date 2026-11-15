import { test } from 'node:test';
import assert from 'node:assert/strict';
import { saveLinkedText } from '../src/linkedFile.ts';

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
