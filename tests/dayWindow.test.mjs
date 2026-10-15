import assert from 'node:assert/strict';
import test from 'node:test';
import { datesInRange, datesInWeek, shiftRange, weekRange } from '../src/dayWindow.ts';

test('seven-day view covers the selected Monday through Sunday', () => {
  assert.deepEqual(datesInWeek('2026-10-15'), [
    '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15',
    '2026-10-16', '2026-10-17', '2026-10-18',
  ]);
  assert.deepEqual(datesInWeek('2026-11-01'), [
    '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29',
    '2026-10-30', '2026-10-31', '2026-11-01',
  ]);
  assert.deepEqual(weekRange('2026-10-15'), { from: '2026-10-12', to: '2026-10-18' });
});

test('selected ranges include both endpoints across month and leap-day boundaries', () => {
  assert.deepEqual(datesInRange({ from: '2028-02-28', to: '2028-03-01' }), ['2028-02-28', '2028-02-29', '2028-03-01']);
  assert.deepEqual(datesInRange({ from: '2028-03-01', to: '2028-02-28' }), []);
  assert.deepEqual(shiftRange({ from: '2028-02-28', to: '2028-03-01' }, 3), { from: '2028-03-02', to: '2028-03-04' });
});
