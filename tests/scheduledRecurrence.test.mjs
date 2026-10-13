import assert from 'node:assert/strict';
import test from 'node:test';
import { advanceRecurrences, formatRecurrence, parseRecurrence } from '../src/recurrence.ts';
import { nextScheduledDate } from '../src/scheduledRecurrence.ts';
import { parseTodoText, serializeTodoText } from '../src/todoText.ts';

function scheduled(text) {
  const rule = parseRecurrence(text);
  assert.equal(rule?.kind, 'scheduled');
  return rule;
}

test('new rules remain readable and round-trip with the original TODO.txt fields', () => {
  const line = '  @repeat: every 2 weeks on wed, fri; from 2026-10-14; series team-sync-20261014-a1b2c3; occurrence 2; ends after 13';
  const raw = '2026-10-28\n\n09:00-09:30 Team sync #work\n' + line + '\n- [ ] share update\n';
  const parsed = parseTodoText(raw, '2026-10-13');
  assert.deepEqual(parsed.issues, []);
  assert.equal(serializeTodoText(parsed.document), raw);
  assert.equal(parsed.document.days[0].items[0].repeat.occurrence, 2);
  assert.equal(formatRecurrence(parsed.document.days[0].items[0].repeat), line.slice('  @repeat: '.length));
  assert.deepEqual(parseRecurrence('every 2 weeks on wed; ends after 13; occurrence 2; series sync; from 2026-10-14'), scheduled('every 2 weeks on wed; from 2026-10-14; series sync; occurrence 2; ends after 13'));
});

test('anchored weekly intervals keep their phase after late completion', () => {
  const daily = scheduled('every 3 days; from 2026-10-13; series watering; occurrence 1');
  assert.equal(nextScheduledDate(daily, '2026-10-13'), '2026-10-16');
  assert.equal(nextScheduledDate(daily, '2026-10-17'), '2026-10-19');
  const rule = scheduled('every 2 weeks on wed, fri; from 2026-10-14; series sync; occurrence 1');
  assert.equal(nextScheduledDate(rule, '2026-10-14'), '2026-10-16');
  assert.equal(nextScheduledDate(rule, '2026-10-16'), '2026-10-28');
  assert.equal(nextScheduledDate(rule, '2026-10-30'), '2026-11-11');
  const weekdays = scheduled('every 1 week on mon, tue, wed, thu, fri; from 2026-10-13; series work; occurrence 1');
  assert.equal(nextScheduledDate(weekdays, '2026-10-16'), '2026-10-19');
});

test('monthly and yearly rules handle ordinal weekdays and missing dates', () => {
  assert.equal(nextScheduledDate(scheduled('every 1 month on second wed; from 2026-10-14; series meeting; occurrence 1'), '2026-10-14'), '2026-11-11');
  assert.equal(nextScheduledDate(scheduled('every 2 months on second wed; from 2026-10-14; series meeting; occurrence 1'), '2026-10-14'), '2026-12-09');
  assert.equal(nextScheduledDate(scheduled('every 1 month on fifth mon; from 2026-03-30; series fifth; occurrence 1'), '2026-03-30'), '2026-06-29');
  assert.equal(nextScheduledDate(scheduled('every 1 year on last fri of april; from 2026-04-24; series arbor; occurrence 1'), '2026-04-24'), '2027-04-30');
  assert.equal(nextScheduledDate(scheduled('every 1 year on 02-29; from 2024-02-29; series leap; occurrence 1'), '2024-02-29'), '2028-02-29');
  assert.equal(nextScheduledDate(scheduled('every 2 months on 31; from 2026-01-31; series month-end; occurrence 1'), '2026-01-31'), '2026-03-31');
});

test('end date is inclusive and count covers actual created items, not skipped slots', () => {
  const dated = scheduled('every 2 weeks on wed; from 2026-10-14; series dated; occurrence 1; ends on 2026-10-28');
  assert.equal(nextScheduledDate(dated, '2026-10-14'), '2026-10-28');
  assert.equal(nextScheduledDate(dated, '2026-10-28'), null);
  const lateRule = scheduled('every 2 weeks on wed; from 2026-10-14; series late; occurrence 1; ends after 2');
  const lateBefore = { days: [{ date: '2026-10-14', items: [{ id: 'late', text: 'Late task', completed: false, repeat: lateRule, details: [] }] }] };
  const lateAfter = structuredClone(lateBefore);
  lateAfter.days[0].items[0].completed = true;
  advanceRecurrences(lateBefore, lateAfter, '2026-10-30');
  assert.equal(lateAfter.days[1].date, '2026-11-11');
  assert.equal(lateAfter.days[1].items[0].repeat.occurrence, 2);
  const rule = scheduled('every 2 weeks on wed; from 2026-10-14; series counted; occurrence 1; ends after 3');
  let document = { days: [{ date: '2026-10-14', items: [{ id: 'first', text: '09:00-09:30 Check in', completed: false, repeat: rule, details: [{ text: 'prepare', completed: false }] }] }] };
  for (const [date, nextDate, number] of [['2026-10-14', '2026-10-28', 2], ['2026-10-28', '2026-11-11', 3]]) {
    const before = structuredClone(document);
    const item = document.days.find(day => day.date === date).items[0];
    item.completed = true;
    item.details[0].completed = true;
    advanceRecurrences(before, document, date);
    const next = document.days.find(day => day.date === nextDate).items[0];
    assert.equal(next.repeat.occurrence, number);
    assert.equal(next.completed, false);
    assert.deepEqual(next.details, [{ text: 'prepare', completed: false }]);
  }
  const before = structuredClone(document);
  document.days.find(day => day.date === '2026-11-11').items[0].completed = true;
  advanceRecurrences(before, document, '2026-11-25');
  assert.equal(document.days.length, 3);
});

test('series identity prevents duplicate successors after reopening an older item', () => {
  const rule = scheduled('every 1 week on wed; from 2026-10-14; series sync; occurrence 1');
  const successor = { ...rule, occurrence: 2 };
  const before = { days: [
    { date: '2026-10-14', items: [{ id: 'old', text: 'Sync', completed: false, repeat: rule, details: [] }] },
    { date: '2026-10-21', items: [{ id: 'next', text: 'Renamed sync', completed: false, repeat: successor, details: [] }] },
  ] };
  const after = structuredClone(before);
  after.days[0].items[0].completed = true;
  advanceRecurrences(before, after, '2026-10-14');
  assert.equal(after.days[1].items.length, 1);
});

test('malformed and repeated series metadata are reported on import', () => {
  assert.equal(parseRecurrence('every 2 weeks on wed; from 2026-10-14; occurrence 1'), null);
  assert.equal(parseRecurrence('every 2 weeks on wed; from 2026-10-14; series sync; occurrence 0'), null);
  assert.equal(parseRecurrence('every 1 year on 02-30; from 2026-10-14; series sync; occurrence 1'), null);
  const raw = '2026-10-14\n\nFirst\n  @repeat: every 1 week on wed; from 2026-10-14; series sync; occurrence 1\nSecond\n  @repeat: every 1 week on wed; from 2026-10-14; series sync; occurrence 1\n';
  assert.match(parseTodoText(raw, '2026-10-13').issues[0].message, /Repeated series occurrence/);
});
