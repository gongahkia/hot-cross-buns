import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeDocument, parseTodoText, serializeTodoText } from '../src/todoText.ts';

test('canonical text round-trips dates, completion, details, tags, and reserved lines', () => {
  const source = {
    days: [
      { date: '2026-10-12', items: [
        { id: 'a', text: 'Meet Lee #work', details: [
          { text: '- literal dash', completed: true },
          { text: '2026-12-25', completed: true },
          { text: '\\path', completed: true },
          { text: '[x] literal marker', completed: true },
        ], completed: true },
        { id: 'b', text: '- literal item', details: [{ text: 'follow up', completed: false }], completed: false },
      ] },
      { date: '2026-10-13', items: [{ id: 'c', text: 'Next day', details: [], completed: false }] },
    ],
  };
  const parsed = parseTodoText(serializeTodoText(source), '2026-10-12');
  assert.deepEqual(parsed.issues, []);
  assert.deepEqual(parsed.document.days.map(day => ({ date: day.date, items: day.items.map(({ id, ...item }) => item) })), source.days.map(day => ({ date: day.date, items: day.items.map(({ id, ...item }) => item) })));
});

test('plain legacy details inherit parent state and old browser records migrate', () => {
  const parsed = parseTodoText('2026-10-12\nFinished\n- plain detail\n\nUpcoming\n- another detail\n', '2026-10-12');
  assert.equal(parsed.document.days[0].items[0].details[0].completed, true);
  assert.equal(parsed.document.days[0].items[1].details[0].completed, false);
  const old = { days: [{ date: '2026-10-12', items: [{ id: 'a', text: 'Old', details: ['legacy'], completed: true }] }] };
  assert.deepEqual(normalizeDocument(old).days[0].items[0].details, [{ text: 'legacy', completed: true }]);
  const checked = parseTodoText('2026-10-12\n\nFinished by details\n- [x] one\n', '2026-10-12');
  assert.equal(checked.document.days[0].items[0].completed, true);
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
