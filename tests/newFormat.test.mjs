import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTodoText, serializeTodoText, validateDocument } from '../src/todoText.ts';
import { occursOn, projectItemsForDate, materializeOccurrence } from '../src/seriesView.ts';

test('undated lists, ordinary details, spans, skips and replacements round-trip', () => {
  const raw = [
    '2026-10-19', '', '09:00-09:30 Weekly standup',
    '  @repeat: weekly on mon; series weekly-standup',
    '  @skip: 2026-11-02',
    '- [ ] agenda',
    '',
    '2026-10-27', '', '10:00-10:30 Weekly standup',
    '  @replaces: weekly-standup on 2026-10-26',
    '',
    '2026-10-28', '', 'Conference',
    '  @span: all-day through 2026-10-30',
    '',
    'UNDATED', '', 'LIST: Ideas', 'Possible talk', '- location', '- guest list',
    '',
  ].join('\n');
  const parsed = parseTodoText(raw, '2026-10-15');
  assert.deepEqual(parsed.issues, []);
  validateDocument(parsed.document);
  assert.equal(serializeTodoText(parsed.document), raw);
  assert.equal(parsed.document.undated[0].items[0].completed, false);
  assert.equal(parsed.document.undated[0].items[0].details[0].completed, false);
});

test('scheduled occurrences are derived without writing future copies', () => {
  const raw = '2026-10-19\n\n09:00-09:30 Weekly standup\n  @repeat: weekly on mon; series weekly-standup\n  @skip: 2026-11-02\n';
  const document = parseTodoText(raw, '2026-10-15').document;
  const next = projectItemsForDate(document,'2026-10-26');
  assert.equal(next.length,1);
  assert.equal(next[0].projection?.originalDate,'2026-10-26');
  assert.equal(projectItemsForDate(document,'2026-11-02').length,0);
  const override = materializeOccurrence(next[0]);
  assert.deepEqual(override.replaces,{series:'weekly-standup',on:'2026-10-26'});
  assert.equal(override.repeat,undefined);
  document.days.push({date:'2026-10-27',items:[override]});
  assert.equal(projectItemsForDate(document,'2026-10-26').length,0);
  assert.equal(projectItemsForDate(document,'2026-10-27').length,1);
  assert.equal(serializeTodoText(document).includes('2026-11-09'),false);
});

test('count-limited series keeps its remaining count after an upcoming-only anchor', () => {
  const raw = '2026-10-15\n\nCheck in\n  @repeat: every 1 week on thu; from 2026-10-01; series check-in; occurrence 3; ends after 4\n';
  const document = parseTodoText(raw,'2026-10-15').document;
  assert.equal(projectItemsForDate(document,'2026-10-15').length,1);
  assert.equal(projectItemsForDate(document,'2026-10-22').length,1);
  assert.equal(projectItemsForDate(document,'2026-10-29').length,0);
});

test('span continuation and malformed hand edits are explicit', () => {
  const raw = '2026-10-15\n\nTrip\n  @span: all-day through 2026-10-17\n';
  const document = parseTodoText(raw,'2026-10-15').document;
  assert.equal(projectItemsForDate(document,'2026-10-16')[0].projection?.kind,'span');
  assert.equal(projectItemsForDate(document,'2026-10-18').length,0);
  for (const invalid of [
    '2026-10-15\n\nTrip\n  @span: all-day through 2026-10-14\n',
    '2026-10-15\n\nTrip\n  @span: 22:00 to 2026-10-15 06:00\n',
    'UNDATED\n\nLIST: Ideas\nItem\n- [ ] should not be checkable\n',
    '2026-10-15\n\nThing\n  @replaces: missing on 2026-10-14\n',
  ]) {
    const result = parseTodoText(invalid,'2026-10-15');
    let validationError = null;
    try { validateDocument(result.document); } catch (error) { validationError = error; }
    assert.ok(result.issues.length || validationError, 'invalid hand edit must be reported');
  }
});

test('monthly last day follows calendar months', () => {
  const parsed = parseTodoText('2026-10-31\n\nReview\n  @repeat: every 1 month on last day; from 2026-10-31; series review\n','2026-10-15');
  assert.deepEqual(parsed.issues,[]);
  const rule = parsed.document.days[0].items[0].repeat;
  assert.equal(occursOn(rule,'2026-10-31','2026-11-30'),true);
  assert.equal(occursOn(rule,'2026-10-31','2026-11-29'),false);
});

test('Sunday-start multiweek rules keep their calendar cycle through text and projection', () => {
  const raw = '2026-10-18\n\nWeekend review\n  @repeat: every 2 weeks on sun; from 2026-10-18; series weekend-review; week starts sun\n';
  const parsed = parseTodoText(raw,'2026-10-15');
  assert.deepEqual(parsed.issues,[]);
  validateDocument(parsed.document);
  assert.equal(serializeTodoText(parsed.document),raw);
  assert.equal(projectItemsForDate(parsed.document,'2026-10-25').length,0);
  assert.equal(projectItemsForDate(parsed.document,'2026-11-01').length,1);
  assert.equal(projectItemsForDate(parsed.document,'2026-11-08').length,0);
});

test('implicit series identity is stable and the parser names broken references', () => {
  const source = '2026-10-19\n\nWeekly standup\n  @repeat: weekly on mon\n';
  const first = parseTodoText(source,'2026-10-15');
  const second = parseTodoText(source,'2026-10-15');
  assert.equal(first.document.days[0].items[0].repeat.series,second.document.days[0].items[0].repeat.series);
  assert.ok(parseTodoText('2026-10-20\n\nMoved\n  @replaces: unknown on 2026-10-19\n','2026-10-15').issues.some(issue => issue.line === 4 && /missing scheduled series/.test(issue.message)));
});

test('a skipped spanning occurrence has no continuation', () => {
  const raw = '2026-10-19\n\nConference\n  @repeat: weekly on mon; series conference\n  @span: all-day through 2026-10-21\n  @skip: 2026-10-19\n';
  const document = parseTodoText(raw,'2026-10-15').document;
  assert.equal(projectItemsForDate(document,'2026-10-19').length,0);
  assert.equal(projectItemsForDate(document,'2026-10-20').length,0);
  assert.equal(projectItemsForDate(document,'2026-10-27').length,1);
});
