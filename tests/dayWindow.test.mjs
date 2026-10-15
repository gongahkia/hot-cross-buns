import assert from 'node:assert/strict';
import test from 'node:test';
import { datesInWindow } from '../src/dayWindow.ts';

test('seven-day view covers the selected Monday through Sunday', () => {
  assert.deepEqual(datesInWindow('2026-10-15', 7), [
    '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15',
    '2026-10-16', '2026-10-17', '2026-10-18',
  ]);
  assert.deepEqual(datesInWindow('2026-11-01', 7), [
    '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29',
    '2026-10-30', '2026-10-31', '2026-11-01',
  ]);
});

test('other day counts start on the selected date and month view stops at month end', () => {
  assert.deepEqual(datesInWindow('2026-10-15', 1), ['2026-10-15']);
  assert.deepEqual(datesInWindow('2026-10-30', 3), ['2026-10-30', '2026-10-31', '2026-11-01']);
  assert.deepEqual(datesInWindow('2026-10-30', 'month'), ['2026-10-30', '2026-10-31']);
  assert.deepEqual(datesInWindow('2028-02-28', 'month'), ['2028-02-28', '2028-02-29']);
});
