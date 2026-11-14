import assert from 'node:assert/strict';
import test from 'node:test';
import { performance } from 'node:perf_hooks';
import { parseTodoText, serializeTodoText } from '../src/todoText.ts';
import { proposeMerge, resolveMerge } from '../src/todoMerge.ts';

test('round-trips a 10,000-line journal within a practical time budget', () => {
  const items = Array.from({ length: 10000 }, (_, index) => ({
    id: `item-${index}`,
    text: `Task ${index} #longlist`,
    completed: false,
    details: [{ text: `Step ${index}`, completed: false }],
  }));
  const journal = { days: [{ date: '2026-10-13', items }] };
  const start = performance.now();
  const raw = serializeTodoText(journal);
  const parsed = parseTodoText(raw, '2026-10-13');
  const elapsed = performance.now() - start;
  assert.deepEqual(parsed.issues, []);
  assert.equal(parsed.document.days[0].items.length, items.length);
  assert.equal(parsed.document.days[0].items.at(-1).details[0].text, 'Step 9999');
  console.log(`10,000-line TODO.txt round-trip: ${elapsed.toFixed(0)}ms`);
  assert.ok(elapsed < 5000, `round-trip took ${elapsed.toFixed(0)}ms`);
});

test('merges a 10,000-item raw edit without quadratic slowdown', () => {
  const items = Array.from({ length: 10000 }, (_, index) => ({
    id: `item-${index}`, text: `Task ${index}`, completed: false, details: [],
  }));
  const baseline = { days: [{ date: '2026-10-13', items }] };
  const raw = serializeTodoText(baseline).replace('Task 5000', 'Task 5000 edited');
  const parsed = parseTodoText(raw, '2026-10-13');
  const start = performance.now();
  const proposal = proposeMerge(baseline, parsed.document, baseline);
  const merged = resolveMerge(proposal, {});
  const elapsed = performance.now() - start;
  assert.deepEqual(proposal.conflicts, []);
  assert.equal(merged.days[0].items[5000].text, 'Task 5000 edited');
  assert.equal(merged.days[0].items[5000].id, 'item-5000');
  assert.equal(merged.days[0].items.length, 10000);
  console.log(`10,000-item TODO.txt merge: ${elapsed.toFixed(0)}ms`);
  assert.ok(elapsed < 5000, `merge took ${elapsed.toFixed(0)}ms`);
});
