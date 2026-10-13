import assert from 'node:assert/strict';
import test from 'node:test';
import { advanceRecurrences, formatRecurrence, nextRecurrenceDate, parseRecurrence } from '../src/recurrence.ts';
import { parseTimeBlock, setTimeBlock } from '../src/timeBlock.ts';
import { parseTodoText, serializeTodoText } from '../src/todoText.ts';

test('human-readable repeat rules and time blocks survive TODO.txt round trips', () => {
  const raw = '2026-10-13\n\n09:00-09:30 Team sync #work\n  @repeat: weekly on mon, wed, fri\n- [ ] share update\n';
  const parsed = parseTodoText(raw, '2026-10-13');
  assert.deepEqual(parsed.issues, []);
  assert.deepEqual(parsed.document.days[0].items[0].repeat, { kind: 'weekly', days: ['mon', 'wed', 'fri'] });
  assert.equal(serializeTodoText(parsed.document), raw);
  assert.deepEqual(parseTimeBlock(parsed.document.days[0].items[0].text), { start: '09:00', end: '09:30', title: 'Team sync #work' });
  assert.equal(setTimeBlock('09:00-09:30 Team sync', '10:15', '11:00'), '10:15-11:00 Team sync');
  assert.equal(setTimeBlock('09:00-09:30 Team sync', null, null), 'Team sync');
});

test('repeat rules find one next date after completion, skipping missed fixed days', () => {
  assert.equal(nextRecurrenceDate(parseRecurrence('weekly on mon'), '2026-10-14'), '2026-10-19');
  assert.equal(nextRecurrenceDate(parseRecurrence('weekdays'), '2026-10-16'), '2026-10-19');
  assert.equal(nextRecurrenceDate(parseRecurrence('monthly on 31'), '2026-01-31'), '2026-03-31');
  assert.equal(nextRecurrenceDate(parseRecurrence('yearly on 02-29'), '2026-10-13'), '2028-02-29');
  assert.equal(nextRecurrenceDate(parseRecurrence('every 1 months after completion'), '2026-01-31'), '2026-02-28');
  assert.equal(formatRecurrence(parseRecurrence('EVERY 3 DAYS AFTER COMPLETION')), 'every 3 days after completion');
  assert.equal(formatRecurrence(parseRecurrence('every 1 month after completion')), 'every 1 month after completion');
  assert.equal(parseRecurrence('every 0 days after completion'), null);
});

test('a completed occurrence creates one fresh copy and remains in the daily record', () => {
  const rule = parseRecurrence('every 3 days after completion');
  const before = { days: [{ date: '2026-10-13', items: [{ id: 'task', text: '09:00-09:30 Water plants', completed: false, repeat: rule, details: [{ text: 'check soil', completed: false }] }] }] };
  const after = structuredClone(before);
  after.days[0].items[0].completed = true;
  after.days[0].items[0].details[0].completed = true;
  advanceRecurrences(before, after, '2026-10-15');
  assert.equal(after.days[0].items[0].details[0].completed, true);
  assert.equal(after.days[1].date, '2026-10-18');
  assert.deepEqual(after.days[1].items[0].details, [{ text: 'check soil', completed: false }]);
  assert.equal(after.days[1].items[0].text, '09:00-09:30 Water plants');
  assert.deepEqual(after.days[1].items[0].repeat, rule);
  advanceRecurrences(after, after, '2026-10-15');
  assert.equal(after.days[1].items.length, 1);
  assert.deepEqual(parseTodoText(serializeTodoText(after), '2026-10-15').issues, []);
});

test('invalid metadata and impossible time ranges are reported instead of becoming tasks', () => {
  const parsed = parseTodoText('2026-10-13\n\nItem\n  @repeat: every 0 days after completion\n25:00-26:00 Invalid\n', '2026-10-13');
  assert.equal(parsed.issues.length, 2);
  assert.equal(parsed.document.days[0].items.length, 1);
});
