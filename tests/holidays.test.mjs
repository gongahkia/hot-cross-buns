import assert from 'node:assert/strict';
import test from 'node:test';
import { addSavedHolidays, fetchHolidayYear, parseNagerHolidays, parseSingaporeHolidays } from '../src/holidays.ts';
import { parseTodoText, serializeTodoText, todayString } from '../src/todoText.ts';

test('Singapore official data retains observed public holidays and rejects malformed rows', () => {
  const rows = { result: { records: [
    { date: '2026-08-09', holiday: 'National Day' },
    { date: '2026-08-10', holiday: 'National Day (observed)' },
    { date: '2026-08-10', holiday: 'National Day (observed)' },
    { date: '2027-08-09', holiday: 'Other year' },
    { date: '2026-02-30', holiday: 'Invalid day' },
  ] } };
  assert.deepEqual(parseSingaporeHolidays(rows, 2026), [
    { date: '2026-08-09', name: 'National Day' },
    { date: '2026-08-10', name: 'National Day (observed)' },
  ]);
  assert.throws(() => parseSingaporeHolidays({}, 2026));
});

test('other countries include only countrywide public holidays', () => {
  assert.deepEqual(parseNagerHolidays([
    { date: '2026-01-01', name: 'New Year', nationalHoliday: true, holidayTypes: ['Public'] },
    { date: '2026-03-01', name: 'Regional', nationalHoliday: false, holidayTypes: ['Public'] },
    { date: '2026-04-01', name: 'Bank', nationalHoliday: true, holidayTypes: ['Bank'] },
  ], 2026), [{ date: '2026-01-01', name: 'New Year' }]);
  assert.deepEqual(parseNagerHolidays([{ date: '2026-01-01', name: 'New Year', countryCode: 'GB', nationalHoliday: false, subdivisionCodes: ['GB-ENG','GB-NIR','GB-SCT','GB-WLS'], holidayTypes: ['Public'] }], 2026), [{ date: '2026-01-01', name: 'New Year' }]);
});

test('the international loader calls the documented v4 endpoint', async () => {
  const original = globalThis.fetch;
  let requested;
  globalThis.fetch = async url => { requested = url; return { ok: true, json: async () => [{ date: '2026-01-01', name: 'New Year', nationalHoliday: true, holidayTypes: ['Public'] }] }; };
  try {
    assert.deepEqual((await fetchHolidayYear('AU', 2026)).holidays, [{ date: '2026-01-01', name: 'New Year' }]);
    assert.equal(requested, 'https://nagerholidays.com/api/v4/Holidays/AU/2026');
  } finally { globalThis.fetch = original; }
});

test('saved holidays are all-day Shio Pan items, deduplicated and preserved by TODO.txt', () => {
  const document = { days: [{ date: '2026-08-10', items: [{ id: 'existing', text: 'My plans', details: [], completed: false }] }] };
  const holidays = [{ date: '2026-08-09', name: 'National Day' }, { date: '2026-08-10', name: 'National Day (observed)' }];
  let next = 0;
  assert.equal(addSavedHolidays(document, holidays, '2026-08-10', () => String(++next)), 2);
  assert.equal(addSavedHolidays(document, holidays, '2026-08-10', () => String(++next)), 0);
  assert.equal(document.days[0].items[0].completed, true);
  const text = serializeTodoText(document);
  assert.match(text, /@span: all-day/);
  const parsed = parseTodoText(text, '2026-08-10');
  assert.deepEqual(parsed.issues, []);
  assert.deepEqual(parsed.document.days.map(day => [day.date, day.items.map(item => [item.text, item.completed, item.span])]),
    document.days.map(day => [day.date, day.items.map(item => [item.text, item.completed, item.span])]));
});

test('today uses the chosen IANA time zone at date boundaries', () => {
  const instant = new Date('2026-10-15T17:30:00Z');
  assert.equal(todayString(instant, 'Asia/Singapore'), '2026-10-16');
  assert.equal(todayString(instant, 'America/Los_Angeles'), '2026-10-15');
});
