import assert from 'node:assert/strict';
import test from 'node:test';
import { calendarClock, calendarDates, navigateCalendar, projectCalendarDays } from '../src/calendar.ts';
import { parseJournal } from '../src/journalDocument.ts';
import { createProjectionBudget, ProjectionLimitError } from '../src/projectionBudget.ts';

const source = `---\nhcb-format: 3\ndocument-id: calendar-tests\n---\n\n## Dated\n\n### 2026-11-18\n\nDaily **prose**.\n\n- [ ] 09:00-10:00 **First**\n  \`\`\`hcb\n  id: first\n  \`\`\`\n\n- [ ] 09:30-10:30 Second\n  \`\`\`hcb\n  id: second\n  \`\`\`\n\n- 11:00-12:00 A meeting\n  \`\`\`hcb\n  id: meeting\n  \`\`\`\n\n- Plain context\n\n- [ ] Untimed task\n\n- [ ] All day\n  \`\`\`hcb\n  id: all-day\n  span: all-day through 2026-11-20\n  \`\`\`\n\n- Travel\n  \`\`\`hcb\n  id: travel\n  span: 22:00 to 2026-11-19 06:00\n  \`\`\`\n\n- [ ] 08:00-08:30 Daily\n  \`\`\`hcb\n  id: daily\n  repeat: daily; series daily\n  skip: 2026-11-20\n  \`\`\`\n\n### 2026-11-19\n\n- [ ] 13:00-13:30 Replacement\n  \`\`\`hcb\n  id: replacement\n  replaces: daily on 2026-11-19\n  \`\`\`\n\n## Undated\n\n### Inbox\n\n## Scratchpad\nCapture.\n`;
const parse = value => { const parsed = parseJournal(value); assert.deepEqual(parsed.issues, []); return parsed.document; };

test('day, week and month periods use the chosen first weekday and fixed calendar cells', () => {
  assert.deepEqual(calendarDates('2026-11-18', 'day'), ['2026-11-18']);
  assert.deepEqual(calendarDates('2026-11-18', 'week'), ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22']);
  assert.equal(calendarDates('2026-11-18', 'week', 0)[0], '2026-11-15');
  const month = calendarDates('2024-02-29', 'month');
  assert.equal(month.length, 42);
  assert.equal(month[0], '2024-01-29');
  assert.equal(month.at(-1), '2024-03-10');
  assert.ok(month.includes('2024-02-29'));
});

test('period navigation clamps month days and handles the full supported year spelling', () => {
  assert.equal(navigateCalendar('2024-01-31', 'month', 1), '2024-02-29');
  assert.equal(navigateCalendar('2026-01-31', 'month', 1), '2026-02-28');
  assert.equal(navigateCalendar('2026-03-31', 'month', -1), '2026-02-28');
  assert.equal(navigateCalendar('2026-12-18', 'month', 1), '2027-01-18');
  assert.equal(navigateCalendar('2026-11-18', 'week', 1), '2026-11-25');
  assert.equal(navigateCalendar('0099-12-31', 'day', 1), '0100-01-01');
  assert.equal(navigateCalendar('9999-12-31', 'day', 1), null);
  assert.equal(navigateCalendar('0000-01-01', 'month', -1), null);
  for (const date of calendarDates('0000-01-01', 'month')) assert.match(date, /^\d{4}-\d{2}-\d{2}$/);
  for (const date of calendarDates('9999-12-31', 'month')) assert.match(date, /^\d{4}-\d{2}-\d{2}$/);
  assert.throws(() => calendarDates('2026-02-30', 'month'), /valid calendar date/);
  assert.throws(() => calendarDates('2026-11-18', 'month', 7), /first weekday/);
});

test('calendar projections distinguish untimed, all-day and timed content without changing source', () => {
  const document = parse(source), [first, next, third, fourth] = projectCalendarDays(document, ['2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21']);
  assert.deepEqual(first.untimed.map(entry => entry.title), ['Plain context', 'Untimed task']);
  assert.equal(first.untimed[0].item.kind, 'note');
  assert.equal(first.allDay[0].title, 'All day');
  assert.equal(first.allDay[0].continues, true);
  assert.equal(first.entries.find(entry => entry.item.id === 'first').title, 'First');
  assert.equal(first.entries.find(entry => entry.item.id === 'meeting').item.kind, 'note');
  assert.equal(next.allDay[0].continuation, true);
  assert.equal(third.allDay[0].continues, false);
  assert.deepEqual(next.entries.filter(entry => entry.title === 'Daily'), []);
  assert.ok(next.entries.some(entry => entry.title === 'Replacement'));
  assert.deepEqual(third.entries.filter(entry => entry.title === 'Daily'), []);
  assert.ok(fourth.entries.some(entry => entry.title === 'Daily'));
  assert.equal(document.source, source);
});

test('timed spans clip at day boundaries and exclude zero-duration midnight continuations', () => {
  const document = parse(source), [first, next] = projectCalendarDays(document, ['2026-11-18', '2026-11-19']);
  const start = first.entries.find(entry => entry.title === 'Travel'), end = next.entries.find(entry => entry.title === 'Travel');
  assert.equal(start.start, 22 * 60); assert.equal(start.end, 1440); assert.equal(start.continues, true);
  assert.equal(end.start, 0); assert.equal(end.end, 6 * 60); assert.equal(end.continuation, true);
  assert.equal(calendarClock(start.end), '24:00');
  const midnight = parse(source.replace('2026-11-19 06:00', '2026-11-19 00:00'));
  assert.equal(projectCalendarDays(midnight, ['2026-11-19'])[0].entries.some(entry => entry.title === 'Travel'), false);
});

test('overlap groups preserve every entry and keep source order for identical starts', () => {
  const [day] = projectCalendarDays(parse(source), ['2026-11-18']);
  assert.deepEqual(day.timed.map(group => group.entries.map(entry => entry.title)), [['Daily'], ['First', 'Second'], ['A meeting'], ['Travel']]);
  const duplicate = parse(source.replace('09:30-10:30 Second', '09:00-09:15 Second'));
  assert.deepEqual(projectCalendarDays(duplicate, ['2026-11-18'])[0].timed[1].entries.map(entry => entry.title), ['First', 'Second']);
});

test('literal formatted clocks remain untimed while soft-wrapped clock titles retain their meaning', () => {
  const document = parse(source.replace('09:00-10:00 **First**', '09:00-10:00\n  **First**').replace('11:00-12:00 A meeting', '**11:00-12:00 A meeting**'));
  const [day] = projectCalendarDays(document, ['2026-11-18']);
  assert.equal(day.entries.find(entry => entry.item.id === 'first').start, 540);
  assert.equal(day.entries.find(entry => entry.item.id === 'meeting').kind, 'untimed');
  assert.equal(day.entries.find(entry => entry.item.id === 'meeting').title, '11:00-12:00 A meeting');
});

test('calendar projections retain the existing work and visible-row ceilings', () => {
  const document = parse(source);
  assert.throws(() => projectCalendarDays(document, ['2026-11-18'], createProjectionBudget({ maxRows: 1 })), ProjectionLimitError);
  assert.throws(() => projectCalendarDays(document, ['2026-11-18'], createProjectionBudget({ maxWork: 1 })), ProjectionLimitError);
  assert.throws(() => projectCalendarDays(document, Array(43).fill('2026-11-18')), /six distinct weeks/);
});

test('early-year recurring projections retain a valid four-digit occurrence date', () => {
  const document = parse('---\nhcb-format: 3\ndocument-id: early-calendar\n---\n\n## Dated\n\n### 0099-12-30\n\n- [ ] 08:00-08:30 Daily\n  ```hcb\n  id: daily\n  repeat: daily; series daily\n  ```\n\n## Undated\n\n### Inbox\n\n## Scratchpad\n');
  const [day] = projectCalendarDays(document, ['0099-12-31']);
  assert.equal(day.entries[0].item.projection.originalDate, '0099-12-31');
});
