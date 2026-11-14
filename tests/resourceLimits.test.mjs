import test from 'node:test';
import assert from 'node:assert/strict';
import { assertImportText, MAX_IMPORT_BYTES, MAX_IMPORT_LINES } from '../src/importLimits.ts';
import { createProjectionBudget, ProjectionLimitError, readProjection } from '../src/projectionBudget.ts';
import { parseTodoText, serializeTodoText } from '../src/todoText.ts';
import { occursOn, projectItemsForDate } from '../src/seriesView.ts';
import { earlierUnfinishedDays } from '../src/earlierUnfinished.ts';
import { parseRecurrence } from '../src/recurrence.ts';

test('import limits count UTF-8 bytes rather than only JavaScript string length', () => {
  assert.doesNotThrow(() => assertImportText('a'.repeat(MAX_IMPORT_BYTES)));
  assert.throws(() => assertImportText('a'.repeat(MAX_IMPORT_BYTES + 1)), /5 MiB/);
  assert.throws(() => assertImportText('é'.repeat(MAX_IMPORT_BYTES / 2 + 1)), /5 MiB/);
});

test('line limits handle LF, CRLF and CR without counting a terminal newline twice', () => {
  for (const ending of ['\n', '\r\n', '\r']) {
    const raw = ('a' + ending).repeat(MAX_IMPORT_LINES);
    assert.doesNotThrow(() => assertImportText(raw));
    assert.throws(() => assertImportText(raw + 'last line'), /100,000 lines/);
  }
});

test('a century-long daily span is bounded without changing its portable meaning', () => {
  const raw = '2000-01-01\n\nLong span\n  @repeat: daily; series long-span\n  @span: all-day through 2100-01-01\n';
  const parsed = parseTodoText(raw, '2026-11-15');
  assert.deepEqual(parsed.issues, []);
  assert.equal(serializeTodoText(parsed.document), raw);
  assert.throws(() => projectItemsForDate(parsed.document, '2026-11-15'), ProjectionLimitError);
  assert.equal(serializeTodoText(parsed.document), raw);
});

test('a long nonrecurring span remains one item per displayed day', () => {
  const parsed = parseTodoText('2000-01-01\n\nLong span\n  @span: all-day through 2100-01-01\n', '2026-11-15');
  const projected = projectItemsForDate(parsed.document, '2026-11-15');
  assert.equal(projected.length, 1);
  assert.equal(projected[0].projection.continuation, true);
});

test('a shared range budget counts details and returns no partial view on overflow', () => {
  const document = parseTodoText('2026-11-15\n\nFirst\n- [ ] detail\n\n2026-11-16\n\nSecond\n- [ ] detail\n', '2026-11-15').document;
  const budget = createProjectionBudget({ maxRows: 3 });
  const result = readProjection(() => ['2026-11-15', '2026-11-16'].map(date => projectItemsForDate(document, date, budget)), []);
  assert.deepEqual(result.value, []);
  assert.match(result.error, /Choose fewer dates/);
});

test('projection work includes recurrence counting and impossible monthly searches', () => {
  const count = parseRecurrence('every 1 day; from 1900-01-01; series counted; ends after 9999');
  assert.ok(count);
  assert.throws(() => occursOn(count, '1900-01-01', '2026-11-15', createProjectionBudget({ maxWork: 20 })), ProjectionLimitError);
  const impossible = parseRecurrence('every 12 months on 31; from 2026-02-01; series impossible');
  assert.ok(impossible);
  assert.throws(() => occursOn(impossible, '2026-02-01', '2027-02-01', createProjectionBudget({ maxWork: 20 })), ProjectionLimitError);
});

test('all-history unfinished projection has a work budget too', () => {
  const document = parseTodoText('1900-01-01\n\nDaily\n  @repeat: daily; series old-daily\n', '2026-11-15').document;
  assert.throws(() => earlierUnfinishedDays(document, '2026-11-15'), ProjectionLimitError);
});

test('the projection error boundary does not suppress programming errors', () => {
  assert.throws(() => readProjection(() => { throw new TypeError('unexpected'); }, []), /unexpected/);
});
