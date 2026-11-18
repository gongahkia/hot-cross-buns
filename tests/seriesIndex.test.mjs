import assert from 'node:assert/strict';
import test from 'node:test';
import { readJournal } from '../src/journalDocument.ts';
import { projectItemsForDate } from '../src/seriesView.ts';
import { createProjectionBudget, ProjectionLimitError } from '../src/projectionBudget.ts';
import { benchmarkPlanner } from '../scripts/markdown-benchmark-fixture.mjs';

test('a week with 10,000 stored entries and 20 visible rows stays within the unchanged work limit', () => {
  const { document } = readJournal(benchmarkPlanner(10000, '2026-11-18'));
  const source = document.source, budget = createProjectionBudget();
  const counts = ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22'].map(date => projectItemsForDate(document, date, budget).length);
  assert.deepEqual(counts, [0, 0, 20, 0, 0, 0, 0]);
  assert.equal(document.source, source);
  assert.throws(() => projectItemsForDate(document, '2000-01-01'), ProjectionLimitError, 'the 5,000-visible-row ceiling still applies');
});

test('mutable documents and mutable skip arrays never reuse a stale projection index', () => {
  const item = { id: 'span', text: 'Span', completed: false, details: [] };
  const document = { days: [{ date: '2026-11-18', items: [item] }] };
  assert.equal(projectItemsForDate(document, '2026-11-19').length, 0);
  item.span = { kind: 'all-day', through: '2026-11-20' };
  assert.equal(projectItemsForDate(document, '2026-11-19').length, 1);
  const skipped = Object.freeze({ id: 'skipped', text: 'Skipped', completed: false, details: [], skips: [], repeat: { kind: 'daily', series: 'daily' } });
  const partlyFrozen = Object.freeze({ days: Object.freeze([Object.freeze({ date: '2026-11-18', items: Object.freeze([skipped]) })]) });
  assert.equal(projectItemsForDate(partlyFrozen, '2026-11-19').length, 1);
  skipped.skips.push('2026-11-19');
  assert.equal(projectItemsForDate(partlyFrozen, '2026-11-19').length, 0);
});

test('indexed and uncached projections agree on source ordering, spans, recurrence and replacements', () => {
  const source = '---\nhcb-format: 2\ndocument-id: series-index\n---\n\n## Dated\n\n### 2026-11-18\n\n- [ ] Recurring\n  ```hcb\n  id: recurring\n  repeat: daily; series daily\n  skip: 2026-11-20\n  ```\n  - [ ] Child\n\n- [ ] Span\n  ```hcb\n  id: span\n  span: all-day through 2026-11-21\n  ```\n\n### 2026-11-19\n\n- [ ] Replacement\n  ```hcb\n  id: replacement\n  replaces: daily on 2026-11-19\n  ```\n\n## Undated\n\n### Inbox\n\n## Scratchpad\n';
  const { model, document } = readJournal(source);
  assert.deepEqual(model.issues.filter(issue => issue.severity === 'error'), []);
  const mutable = structuredClone(document);
  for (const date of ['2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22']) assert.deepEqual(projectItemsForDate(document, date), projectItemsForDate(mutable, date));
});
