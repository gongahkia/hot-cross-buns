import assert from 'node:assert/strict';
import test from 'node:test';
import { journalModel, materializeJournal, parseJournal, readJournal } from '../src/journalDocument.ts';
import { upgradeOutlineJournal } from '../src/journalOutline.ts';
import { mergeJournalSources } from '../src/journalMerge.ts';
import { MAX_OUTLINE_DEPTH, detailAt, outlineText, refreshItemCompletion, resetDetails, setItemCompletion } from '../src/outline.ts';
import { advanceRecurrences } from '../src/recurrence.ts';
import { projectItemsForDate } from '../src/seriesView.ts';

const wrap = (dated, undated = '- Note', version = 2) => `---\nhcb-format: ${version}\ndocument-id: outline-tests\n---\n\n## Dated\n\n### 2026-11-18\n\n${dated}\n\n## Undated\n\n### Inbox\n\n${undated}\n\n## Scratchpad\nShared capture\n`;
const tree = '- [ ] Parent\n  ```hcb\n  id: parent\n  ```\n  - Context\n    - [ ] Action\n      - [x] Done\n      - [ ] Pending\n\n        > Keep **context**.\n\n  - [ ] Other';
const parse = source => { const parsed = parseJournal(source); assert.deepEqual(parsed.issues, []); return parsed.document; };
const edit = (document, change) => { const next = structuredClone(document); change(next); return materializeJournal(next); };

test('format 2 exposes recursive tasks, plain notes and source-preserved bodies', () => {
  const document = parse(wrap(tree, '- Note\n  - Child\n    - Grandchild'));
  const item = document.days[0].items[0];
  assert.equal(item.details[0].kind, 'note');
  assert.equal(detailAt(item.details, [0, 0, 1]).text, 'Pending');
  assert.equal(detailAt(item.details, [0, 0, 1]).body[0].markdown, '> Keep **context**.');
  assert.equal(detailAt(document.undated[0].items[0].details, [0, 0]).text, 'Grandchild');
  assert.ok(outlineText(item).join(' ').includes('Keep **context**.'));
  assert.ok(Object.isFrozen(item.details[0].children));
});

test('legacy sources keep direct-detail completion until an explicit upgrade', () => {
  const source = wrap('- [x] Parent\n  - [x] Child\n    - [ ] Grandchild', '- Note', 1);
  const legacy = parse(source);
  assert.equal(legacy.days[0].items[0].details[0].children, undefined);
  assert.equal(legacy.source, source);
  const upgraded = upgradeOutlineJournal(legacy);
  assert.equal(upgraded.checkboxChanges, 2);
  assert.equal(journalModel(upgraded.document).format, 2);
  assert.equal(upgraded.document.source, source.replace('hcb-format: 1', 'hcb-format: 2').replace('- [x] Parent', '- [ ] Parent').replace('- [x] Child', '- [ ] Child'));
  assert.equal(legacy.source, source);
  assert.equal(upgradeOutlineJournal(upgraded.document).document, upgraded.document);
});

test('explicit upgrades preserve BOM, line endings, identity and unrelated content', () => {
  const source = '\uFEFF' + wrap('- [ ] **Parent**\n  - [ ] Child\n    - [ ] Grandchild', '- Note', 1).replaceAll('\n', '\r\n');
  const next = upgradeOutlineJournal(parse(source));
  assert.equal(next.checkboxChanges, 0);
  assert.equal(next.document.source, source.replace('hcb-format: 1', 'hcb-format: 2'));
});

test('format 2 validates descendants while format 1 keeps them opaque', () => {
  const invalid = '- [x] Parent\n  - [x] Child\n    - [ ] Grandchild';
  assert.ok(parseJournal(wrap(invalid)).issues.some(issue => issue.message.includes('completion')));
  assert.deepEqual(parseJournal(wrap(invalid, '- Note', 1)).issues, []);
  assert.ok(parseJournal(wrap('- [ ] Task', '- Note\n  - Child\n    - [ ] Deep checkbox')).issues.length);
  assert.throws(() => upgradeOutlineJournal(parse(wrap('- [ ] Task', '- Note\n  - Child\n    - [ ] Deep checkbox', 1))), /plain bullets/);
});

test('recursive completion ignores notes, rolls up task branches and preserves body source', () => {
  const document = parse(wrap(tree));
  const completed = edit(document, next => setItemCompletion(next.days[0].items[0], true));
  assert.equal(completed.days[0].items[0].completed, true);
  assert.ok(completed.source.includes('  - Context\n    - [x] Action'));
  assert.ok(completed.source.includes('        > Keep **context**.'));
  const reopened = edit(completed, next => {
    detailAt(next.days[0].items[0].details, [0, 0, 1]).completed = false;
    refreshItemCompletion(next.days[0].items[0]);
  });
  assert.equal(reopened.days[0].items[0].completed, false);
  assert.equal(detailAt(reopened.days[0].items[0].details, [0, 0]).completed, false);
  assert.equal(detailAt(reopened.days[0].items[0].details, [0, 0, 0]).completed, true);
});

test('nested renames, reordering, reparenting and body edits preserve untouched source', () => {
  const document = parse(wrap(tree));
  const renamed = edit(document, next => { detailAt(next.days[0].items[0].details, [0, 0, 1]).text = 'Renamed'; });
  assert.equal(renamed.source, document.source.replace('Pending', 'Renamed'));
  const reordered = edit(renamed, next => { detailAt(next.days[0].items[0].details, [0, 0]).children.reverse(); });
  assert.ok(reordered.source.indexOf('Renamed') < reordered.source.indexOf('Done'));
  assert.equal((reordered.source.match(/Keep \*\*context\*\*/g) ?? []).length, 1);
  const reparented = edit(reordered, next => {
    const item = next.days[0].items[0];
    const moved = detailAt(item.details, [0, 0]).children.shift();
    (item.details[1].children ??= []).push(moved);
    refreshItemCompletion(item);
  });
  assert.equal(detailAt(reparented.days[0].items[0].details, [1, 0]).text, 'Renamed');
  assert.equal(detailAt(reparented.days[0].items[0].details, [1, 0]).body[0].markdown, '> Keep **context**.');
  const bodyEdit = edit(reparented, next => { detailAt(next.days[0].items[0].details, [1, 0]).body[0].markdown = '> Updated **context**.'; });
  assert.equal(bodyEdit.source, reparented.source.replace('Keep **context**.', 'Updated **context**.'));
});

test('adding a first child after an HTML body terminates the HTML block without hiding the new node', () => {
  const document = parse(wrap('- [ ] Parent\n  - [ ] Child\n\n    <img src=x onerror=alert(1)>'));
  const next = edit(document, next => { next.days[0].items[0].details[0].children = [{ text: 'New grandchild', completed: false }]; });
  assert.equal(detailAt(next.days[0].items[0].details, [0, 0]).text, 'New grandchild');
  assert.ok(next.source.includes('<img src=x onerror=alert(1)>\n\n'));
});

test('promotion and demotion retain an entire subtree and ordinary body content', () => {
  const document = parse(wrap(tree, '- Note\n  - Child\n    - Grandchild\n\n      Paragraph with `code`.'));
  const promoted = edit(document, next => {
    const node = next.undated[0].items[0].details.shift();
    const { children, ...rest } = node;
    next.undated[0].items.push({ ...rest, id: 'promoted', details: children ?? [] });
  });
  assert.equal(promoted.undated[0].items[1].details[0].text, 'Grandchild');
  const demoted = edit(promoted, next => {
    const item = next.undated[0].items.pop();
    const { details, id: _id, ...rest } = item;
    next.undated[0].items[0].details.push({ ...rest, children: details });
  });
  assert.equal(detailAt(demoted.undated[0].items[0].details, [0, 0]).text, 'Grandchild');
  assert.equal((demoted.source.match(/Paragraph with `code`/g) ?? []).length, 1);
  assert.ok(!demoted.source.includes('id: promoted'));
});

test('deep after-completion and scheduled recurrences reset every checkbox without sharing mutable descendants', () => {
  const source = wrap(tree.replace('id: parent', 'id: parent\n  repeat: every 1 day after completion; series recurring; occurrence 1'));
  const before = parse(source);
  const changed = structuredClone(before);
  setItemCompletion(changed.days[0].items[0], true);
  advanceRecurrences(before, changed, '2026-11-18');
  const next = materializeJournal(changed);
  const successor = next.days.find(day => day.date === '2026-11-19').items[0];
  assert.equal(detailAt(successor.details, [0, 0, 0]).completed, false);
  assert.equal(detailAt(successor.details, [0, 0, 1]).body[0].markdown, '> Keep **context**.');
  const scheduled = parse(wrap(tree.replace('id: parent', 'id: parent\n  repeat: daily; series recurring')));
  const projected = projectItemsForDate(scheduled, '2026-11-19')[0];
  assert.equal(detailAt(projected.details, [0, 0, 0]).completed, false);
  const reset = resetDetails(next.days[0].items[0].details);
  detailAt(reset, [0, 0, 0]).text = 'Changed copy';
  assert.notEqual(detailAt(next.days[0].items[0].details, [0, 0, 0]).text, 'Changed copy');
});

test('source merges treat nested titles, body blocks and progress as atomic values', () => {
  const base = parse(wrap(tree));
  const left = edit(base, next => { detailAt(next.days[0].items[0].details, [0, 0, 1]).text = 'Local title'; });
  const right = edit(base, next => { detailAt(next.days[0].items[0].details, [0, 0, 1]).text = 'Pending remote'; });
  assert.equal(mergeJournalSources(base, left, right), null);
  const body = edit(base, next => { detailAt(next.days[0].items[0].details, [0, 0, 1]).body[0].markdown = '> New context.'; });
  const merged = mergeJournalSources(base, left, body);
  assert.ok(merged.source.includes('Local title'));
  assert.ok(merged.source.includes('New context.'));
  const legacy = parse(wrap('- [ ] Parent\n  - [ ] Child', '- Note', 1));
  assert.equal(mergeJournalSources(legacy, upgradeOutlineJournal(legacy).document, edit(legacy, next => { next.scratchpad += 'Remote'; })), null);
});

test('outline depth is bounded and malformed paths fail at their boundary', () => {
  const nested = count => Array.from({ length: count }, (_, index) => '  '.repeat(index) + '- [ ] Level ' + index).join('\n');
  assert.deepEqual(parseJournal(wrap(nested(MAX_OUTLINE_DEPTH + 1))).issues, []);
  assert.ok(readJournal(wrap(nested(MAX_OUTLINE_DEPTH + 2))).model.issues.some(issue => issue.code === 'outline-depth'));
  assert.throws(() => detailAt([], [0]), /no longer/);
  assert.throws(() => detailAt([], []), /Choose/);
});
