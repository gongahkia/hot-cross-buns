import assert from 'node:assert/strict';
import test from 'node:test';
import { parseTodoText, serializeTodoText } from '../src/todoText.ts';

test('canonical text round-trips dates, completion, details, tags, and reserved lines', () => {
  const source = {
    days: [
      { date: '2026-10-12', items: [
        { id: 'a', text: 'Meet Lee #work', details: ['- literal dash', '2026-12-25', '\\path'], completed: true },
        { id: 'b', text: '- literal item', details: ['follow up'], completed: false },
      ] },
      { date: '2026-10-13', items: [{ id: 'c', text: 'Next day', details: [], completed: false }] },
    ],
  };
  const parsed = parseTodoText(serializeTodoText(source), '2026-10-12');
  assert.deepEqual(parsed.issues, []);
  assert.deepEqual(parsed.document.days.map(day => ({ date: day.date, items: day.items.map(({ id, ...item }) => item) })), source.days.map(day => ({ date: day.date, items: day.items.map(({ id, ...item }) => item) })));
});

test('a single terminal newline does not mark a section complete', () => {
  const today = '2026-10-12';
  const parsed = parseTodoText(`${today}\nStill upcoming\n`, today);
  assert.deepEqual(parsed.issues, []);
  assert.equal(parsed.document.days[0].items[0].completed, false);
  assert.equal(parseTodoText('2026-10-11\r\nOld work\r\n', today).document.days[0].items[0].completed, true);
});

test('invalid dates and orphan details are reported', () => {
  const parsed = parseTodoText('2021-11-31\n- orphan\n');
  assert.equal(parsed.issues.length, 2);
  assert.match(parsed.issues[0].message, /Invalid date/);
  assert.match(parsed.issues[1].message, /valid date heading/);
});
