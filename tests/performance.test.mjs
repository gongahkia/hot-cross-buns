import assert from 'node:assert/strict';
import test from 'node:test';
import { performance } from 'node:perf_hooks';
import { parseTodoText, serializeTodoText } from '../src/todoText.ts';

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
