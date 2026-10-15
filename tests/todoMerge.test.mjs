import assert from 'node:assert/strict';
import test from 'node:test';
import { proposeMerge, resolveMerge } from '../src/todoMerge.ts';

const item = (id, text, completed = false) => ({ id, text, details: [], completed });
const doc = (...items) => ({ days: [{ date: '2026-10-12', items }] });

test('automatically merges a one-sided edit and an independent addition', () => {
  const baseline = doc(item('a', 'Alpha'), item('b', 'Beta'));
  const local = doc(item('a', 'Alpha local'), item('b', 'Beta'));
  const file = doc(item('external-a', 'Alpha'), item('external-b', 'Beta'), item('external-c', 'Gamma'));
  const proposal = proposeMerge(local, file, baseline);
  assert.equal(proposal.conflicts.length, 0);
  assert.deepEqual(resolveMerge(proposal, {}).days[0].items.map(entry => entry.text), ['Alpha local', 'Beta', 'Gamma']);
});

test('reviews both-sided edits and deleted-vs-edited items', () => {
  const baseline = doc(item('a', 'Alpha'), item('b', 'Beta'));
  const local = doc(item('a', 'Alpha local'), item('b', 'Beta local'));
  const file = doc(item('external-a', 'Alpha file'));
  const proposal = proposeMerge(local, file, baseline);
  assert.equal(proposal.conflicts.length, 2);
  const choices = Object.fromEntries(proposal.conflicts.map(row => [row.key, 'file']));
  assert.deepEqual(resolveMerge(proposal, choices).days[0].items.map(entry => entry.text), ['Alpha file']);
});

test('ambiguous duplicate deletion needs review', () => {
  const baseline = doc(item('a', 'Same'), item('b', 'Same'));
  const local = doc(item('a', 'Same'), item('b', 'Same'));
  const file = doc(item('external-a', 'Same'));
  const proposal = proposeMerge(local, file, baseline);
  assert.ok(proposal.conflicts.length >= 1);
});

test('an imported empty heading survives merge and a later explicit removal', () => {
  const empty = { days: [{ date: '2026-10-12', items: [], keepEmpty: true }] };
  const imported = proposeMerge({ days: [] }, empty, null);
  assert.deepEqual(resolveMerge(imported, {}).days, empty.days);
  const removed = proposeMerge(empty, { days: [] }, empty);
  assert.deepEqual(resolveMerge(removed, {}).days, []);
  assert.deepEqual(proposeMerge(empty, empty, empty).fileEmptyDates, ['2026-10-12']);
  const withItem = proposeMerge(empty, doc(item('a', 'New')), empty);
  assert.equal(resolveMerge(withItem, {}).days[0].keepEmpty, true);
});
