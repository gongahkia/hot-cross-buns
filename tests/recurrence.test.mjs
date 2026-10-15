import assert from 'node:assert/strict';
import test from 'node:test';
import { advanceRecurrences, formatRecurrence, nextRecurrenceDate, parseRecurrence, reconcileRecurrences } from '../src/recurrence.ts';
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
  assert.equal(after.days[0].items[0].completedOn, '2026-10-15');
  assert.equal(after.days[0].items[0].repeat.occurrence, 1);
  assert.equal(after.days[1].items[0].repeat.occurrence, 2);
  assert.equal(after.days[1].items[0].repeat.series, after.days[0].items[0].repeat.series);
  assert.equal(after.days[1].items[0].completedOn, undefined);
  advanceRecurrences(after, after, '2026-10-15');
  assert.equal(after.days[1].items.length, 1);
  assert.deepEqual(parseTodoText(serializeTodoText(after), '2026-10-15').issues, []);
});

test('invalid metadata and impossible time ranges are reported instead of becoming tasks', () => {
  const parsed = parseTodoText('2026-10-13\n\nItem\n  @repeat: every 0 days after completion\n25:00-26:00 Invalid\n', '2026-10-13');
  assert.equal(parsed.issues.length, 2);
  assert.equal(parsed.document.days[0].items.length, 1);
});

test('identified simple recurrence and completion date round-trip in readable text', () => {
  const raw = '2026-10-13\nWater plants\n  @repeat: every 3 days after completion; series water-plants-a1; occurrence 2\n  @completed: 2026-10-15\n- [x] check soil\n\n';
  const parsed = parseTodoText(raw, '2026-10-15');
  assert.deepEqual(parsed.issues, []);
  assert.equal(serializeTodoText(parsed.document), raw);
  assert.equal(parsed.document.days[0].items[0].completedOn, '2026-10-15');
  assert.equal(parsed.document.days[0].items[0].repeat.occurrence, 2);
  assert.equal(formatRecurrence(parseRecurrence('DAILY; SERIES Morning-A; OCCURRENCE 1')), 'daily; series morning-a; occurrence 1');
  assert.equal(parseRecurrence('daily; series a'), null);
  assert.equal(parseRecurrence('daily; occurrence 1'), null);
});

test('first import reconstructs one missing successor from a dated completion and is idempotent', () => {
  const raw = '2026-10-13\nWater plants\n  @repeat: every 3 days after completion; series water-plants-a1; occurrence 1\n  @completed: 2026-10-15\n\n';
  const document = parseTodoText(raw, '2026-10-20').document;
  reconcileRecurrences(document);
  assert.deepEqual(document.days.map(day => day.date), ['2026-10-13', '2026-10-18']);
  assert.equal(document.days[1].items[0].repeat.occurrence, 2);
  reconcileRecurrences(document);
  assert.equal(document.days[1].items.length, 1);
  const reopened = parseTodoText(serializeTodoText(document), '2026-10-20').document;
  reconcileRecurrences(reopened);
  assert.equal(reopened.days[1].items.length, 1);
});

test('existing successor prevents duplication even when renamed or moved', () => {
  const raw = '2026-10-13\nWater plants\n  @repeat: daily; series watering-a1; occurrence 1\n  @completed: 2026-10-13\n\n2026-10-20\n\nRenamed plants\n  @repeat: daily; series watering-a1; occurrence 2\n';
  const document = parseTodoText(raw, '2026-10-20').document;
  reconcileRecurrences(document);
  assert.equal(document.days.length, 2);
  assert.equal(document.days[1].items.length, 1);
});

test('reopening clears the completion date without removing an existing successor', () => {
  const rule = parseRecurrence('daily; series watering-a1; occurrence 1');
  const before = { days: [
    { date: '2026-10-13', items: [{ id: 'first', text: 'Water plants', completed: true, completedOn: '2026-10-13', repeat: rule, details: [] }] },
    { date: '2026-10-14', items: [{ id: 'second', text: 'Water plants', completed: false, repeat: { ...rule, occurrence: 2 }, details: [] }] },
  ] };
  const after = structuredClone(before);
  after.days[0].items[0].completed = false;
  advanceRecurrences(before, after, '2026-10-15');
  assert.equal(after.days[0].items[0].completedOn, undefined);
  assert.equal(after.days[1].items.length, 1);
});

test('a series at the largest supported occurrence remains valid', () => {
  const raw = '2026-10-13\nFinal indexed task\n  @repeat: daily; series long-running-series; occurrence 9999\n  @completed: 2026-10-13\n\n';
  const document = parseTodoText(raw, '2026-10-15').document;
  reconcileRecurrences(document);
  assert.equal(serializeTodoText(document), raw);
});

test('deleting a generated successor locally does not immediately recreate it', () => {
  const completed = { id: 'first', text: 'Water plants', completed: true, completedOn: '2026-10-13', repeat: parseRecurrence('daily; series watering-a1; occurrence 1'), details: [] };
  const successor = { id: 'second', text: 'Water plants', completed: false, repeat: parseRecurrence('daily; series watering-a1; occurrence 2'), details: [] };
  const before = { days: [
    { date: '2026-10-13', items: [completed] },
    { date: '2026-10-14', items: [successor] },
  ] };
  const after = structuredClone(before);
  after.days[1].items = [];
  advanceRecurrences(before, after, '2026-10-15');
  assert.equal(after.days[1].items.length, 0);
});

test('an imported deletion of a previously seen successor stays deleted', () => {
  const baseline = { days: [
    { date: '2026-10-13', items: [{ id: 'first', text: 'Water plants', completed: true, completedOn: '2026-10-13', repeat: parseRecurrence('daily; series watering-a1; occurrence 1'), details: [] }] },
    { date: '2026-10-14', items: [{ id: 'second', text: 'Water plants', completed: false, repeat: parseRecurrence('daily; series watering-a1; occurrence 2'), details: [] }] },
  ] };
  const imported = { days: [structuredClone(baseline.days[0])] };
  advanceRecurrences(baseline, imported, '2026-10-15', true, baseline);
  assert.equal(imported.days.length, 1);
});
