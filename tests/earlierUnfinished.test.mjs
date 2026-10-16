import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTodoText } from '../src/todoText.ts';
import { earlierUnfinishedDays } from '../src/earlierUnfinished.ts';

test('earlier unfinished dates include virtual repeats and span continuations, but omit completed and skipped dates', () => {
  const raw = [
    '2026-10-05', '', 'Weekly review',
    '  @repeat: weekly on mon; series weekly-review',
    '  @skip: 2026-10-12', '',
    '2026-10-07', 'Finished item', '', '',
    '2026-10-13', '', 'Conference',
    '  @span: all-day through 2026-10-14', '',
  ].join('\n');
  const { document, issues } = parseTodoText(raw, '2026-10-16');
  assert.deepEqual(issues, []);
  assert.deepEqual(earlierUnfinishedDays(document, '2026-10-16'), [
    { date: '2026-10-05', count: 1 },
    { date: '2026-10-13', count: 1 },
    { date: '2026-10-14', count: 1 },
  ]);
});
