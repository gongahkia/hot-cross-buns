import assert from 'node:assert/strict';
import test from 'node:test';
import { createMemorySamples } from './memory-samples.mjs';

test('memory samples cover every section and allow correction, forgetting, and reset in isolation', async () => {
  const preview = createMemorySamples(), other = createMemorySamples();
  const original = await preview.request();
  assert.equal(Object.keys(original.categories).length, 6);
  assert.deepEqual(new Set(original.entries.map(item => item.status)), new Set(['Active', 'Needs review', 'Saved', 'Awaiting review', 'Disabled', 'Rejected']));
  const item = original.entries.find(item => item.editable);
  const corrected = await preview.request({ action: 'correct', id: item.id, revision: item.revision, text: 'A corrected sample preference.' });
  const current = corrected.entries.find(entry => entry.id === item.id);
  assert.equal(current.text, 'A corrected sample preference.');
  await assert.rejects(preview.request({ action: 'forget', id: item.id, revision: item.revision }), /changed/);
  const filtered = await preview.request({ query: 'corrected preference', category: item.category });
  assert.deepEqual(filtered.entries, [current]);
  const forgotten = await preview.request({ action: 'forget', id: item.id, revision: current.revision });
  assert.equal(forgotten.total, original.total - 1);
  assert.equal(forgotten.entries.some(entry => entry.id === item.id), false);
  assert.deepEqual((await other.request()).entries.map(entry => entry.text), original.entries.map(entry => entry.text));
  preview.reset();
  assert.equal((await preview.request()).total, original.total);
  await assert.rejects(preview.request({ action: 'forget', id: current.id, revision: current.revision }), /changed/);
  const scoped = (await preview.request()).entries.find(entry => !entry.editable);
  await assert.rejects(preview.request({ action: 'forget', id: scoped.id, revision: scoped.revision }), /management controls/);
});
