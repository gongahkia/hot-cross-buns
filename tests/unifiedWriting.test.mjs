import assert from 'node:assert/strict';
import test from 'node:test';
import { createJournal, journalModel, materializeJournal, parseJournal, readJournal } from '../src/journalDocument.ts';
import { upgradeOutlineJournal, upgradeWritingJournal } from '../src/journalOutline.ts';
import { parseMarkdownPlanner, plannerWritable, setPlannerCompletion } from '../src/markdownPlanner.ts';
import { detailAt, refreshItemCompletion, setItemCompletion } from '../src/outline.ts';
import { runJournalWork } from '../src/journalWorker.ts';
import { mergeJournalSources } from '../src/journalMerge.ts';

const wrap = (dated, undated = '- Plain note', version = 3) => `---\nhcb-format: ${version}\ndocument-id: unified-writing\n---\n\n[global]: https://example.com\n\n## Dated\n\n### 2026-11-18\n\n${dated}\n\n## Undated\n\n### Inbox\n\n${undated}\n\n## Scratchpad\n# Captured heading\n- [x] Captured task\n`;
const parse = source => { const parsed = parseJournal(source); assert.deepEqual(parsed.issues, []); return parsed.document; };
const edit = (document, change) => { const next = structuredClone(document); change(next); return materializeJournal(next); };
const mixed = '- Meeting context\n  ```hcb\n  id: meeting\n  ```\n  - [x] Sent agenda\n  - [ ] Follow up\n\n    A **rich paragraph** with [global context][global].\n\n- [ ] An action\n  ```hcb\n  id: action\n  ```';

test('format 3 separates checkbox state from dated or undated placement', () => {
  const document = parse(wrap(mixed, '- [x] Finished\n  ```hcb\n  id: finished\n  completed: 2026-11-18\n  ```\n  - Context\n    - [x] Nested task\n\n- Plain note'));
  const [note, task] = document.days[0].items;
  assert.equal(note.kind, 'note');
  assert.equal(note.completed, false);
  assert.equal(task.kind, undefined);
  assert.equal(detailAt(note.details, [1]).body[0].markdown, 'A **rich paragraph** with [global context][global].');
  assert.equal(document.undated[0].items[0].completed, true);
  assert.equal(document.undated[0].items[0].completedOn, '2026-11-18');
  assert.equal(document.undated[0].items[1].kind, 'note');
  assert.equal(document.scratchpad, '# Captured heading\n- [x] Captured task\n');
  assert.equal(materializeJournal(structuredClone(document)), document);
});

test('ordinary headings and prose remain within format-3 date and list documents', () => {
  const document = parse(wrap('# Meeting\n\nOrdinary prose.\n\n- [ ] First\n\n## Background\n\n- [ ] Second\n\n### Discussion\n\n- Plain outline', '# Project\n\nA paragraph.\n\n#### Context\n\n- [ ] Next action'));
  const model = journalModel(document);
  assert.deepEqual(document.days[0].items.map(item => item.text), ['First', 'Second', 'Plain outline']);
  assert.equal(document.undated[0].items[0].text, 'Next action');
  assert.equal(document.source.slice(model.days[0].content.start, model.days[0].content.end).trimEnd().endsWith('- Plain outline'), true);
  assert.equal(document.source.slice(model.undated[0].content.start, model.undated[0].content.end).includes('#### Context'), true);
  assert.ok(journalModel(document).markdown.headings.some(heading => heading.text === 'Discussion'));
});

test('legacy documents retain their original interpretation until an explicit upgrade', () => {
  for (const version of [1, 2]) {
    const source = wrap('- [ ] Task\n\n- Plain outline\n  - Context', '- Plain note', version);
    const before = parse(source);
    assert.equal(before.days[0].items.length, 1);
    assert.equal(before.source, source);
    const upgraded = upgradeWritingJournal(before);
    assert.equal(upgraded.document.source, source.replace(`hcb-format: ${version}`, 'hcb-format: 3'));
    assert.equal(upgraded.document.days[0].items.length, 2);
    assert.equal(upgraded.document.days[0].items[1].kind, 'note');
    assert.equal(upgraded.document.undated[0].items[0].kind, 'note');
    assert.equal(upgradeWritingJournal(upgraded.document).document, upgraded.document);
    assert.equal(upgradeOutlineJournal(upgraded.document).document, upgraded.document);
    assert.equal(before.source, source);
  }
});

test('writing upgrades preserve BOM, every line ending and existing nested completion semantics', () => {
  for (const ending of ['\n', '\r\n', '\r']) {
    const source = '\uFEFF' + wrap('- [x] Parent\n  - [x] Child\n    - [ ] Grandchild', '- Plain note', 1).replaceAll('\n', ending);
    const before = parse(source), upgraded = upgradeWritingJournal(before);
    assert.equal(upgraded.checkboxChanges, 2);
    assert.equal(upgraded.document.source, source.replace('hcb-format: 1', 'hcb-format: 3').replace('[x] Parent', '[ ] Parent').replace('[x] Child', '[ ] Child'));
    assert.equal(journalModel(upgraded.document).documentId, journalModel(before).documentId);
  }
});

test('source operations complete undated tasks and preserve note ancestors and unrelated bytes', () => {
  const source = wrap(mixed, '- [ ] Parent\n  ```hcb\n  id: undated-parent\n  ```\n  - Context\n    - [ ] Child\n\n- Plain note');
  const before = parse(source);
  const next = edit(before, document => setItemCompletion(document.undated[0].items[0], true));
  assert.equal(next.source, source.replace('[ ] Parent', '[x] Parent').replace('[ ] Child', '[x] Child'));
  const reopened = edit(next, document => {
    const item = document.undated[0].items[0];
    detailAt(item.details, [0, 0]).completed = false;
    refreshItemCompletion(item);
  });
  assert.equal(reopened.source, source);
  const completedNotes = edit(before, document => {
    const note = document.days[0].items[0];
    note.details[1].completed = true;
    refreshItemCompletion(note);
  });
  assert.equal(completedNotes.days[0].items[0].kind, 'note');
  assert.equal(completedNotes.days[0].items[0].completed, false);
  assert.equal(completedNotes.source, source.replace('[ ] Follow up', '[x] Follow up'));
  const model = journalModel(before), entry = model.undated[0].entries[0];
  assert.equal(setPlannerCompletion(model, source, entry.range.start, true).source, next.source);
});

test('checkbox conversion preserves identities and body source in either location', () => {
  const before = parse(wrap(mixed, '- Plain note\n  ```hcb\n  id: plain-note\n  ```\n\n  > Preserve **this**.'));
  const next = edit(before, document => { delete document.days[0].items[0].kind; delete document.undated[0].items[0].kind; });
  assert.equal(next.source, before.source.replace('- Meeting context', '- [ ] Meeting context').replace('- Plain note', '- [ ] Plain note'));
  const restored = edit(next, document => { document.days[0].items[0].kind = 'note'; document.undated[0].items[0].kind = 'note'; });
  assert.equal(restored.source, before.source);
});

test('moving a completed unscheduled task between views retains its checkbox, details and completion date', () => {
  const before = parse(wrap('- [x] Finished\n  ```hcb\n  id: finished\n  completed: 2026-11-17\n  ```\n  - [x] Child'));
  const moved = edit(before, document => { document.undated[0].items.push(document.days[0].items.shift()); });
  const item = moved.undated[0].items[1];
  assert.equal(item.completed, true);
  assert.equal(item.completedOn, '2026-11-17');
  assert.equal(item.id, 'finished');
  assert.equal(item.details[0].completed, true);
  const returned = edit(moved, document => { document.days[0].items.push(document.undated[0].items.pop()); });
  assert.equal(returned.days[0].items[0].completedOn, '2026-11-17');
  assert.equal(journalModel(returned).days[0].entries[0].date, '2026-11-18');
});

test('structured conversions refuse to discard completion or scheduling fields', () => {
  const before = parse(wrap('- [x] Finished\n  ```hcb\n  id: finished\n  completed: 2026-11-17\n  ```\n\n- [ ] Scheduled\n  ```hcb\n  id: scheduled\n  span: all-day\n  ```'));
  assert.throws(() => edit(before, document => { document.days[0].items[0].kind = 'note'; }), /Reopen a completed task/);
  assert.throws(() => edit(before, document => { document.undated[0].items.push(document.days[0].items.pop()); }), /Scheduled content needs a date/);
  assert.ok(before.source.includes('completed: 2026-11-17'));
  assert.ok(before.source.includes('span: all-day'));
});

test('invalid completion, scheduling and unsupported versions still reject structured writing', () => {
  const cases = [
    wrap('- Plain\n  ```hcb\n  completed: 2026-11-18\n  ```'),
    wrap('- Plain\n  ```hcb\n  repeat: every 2 days after completion; series plain; occurrence 1\n  ```'),
    wrap('- [ ] Task', '- [ ] Undated\n  ```hcb\n  span: all-day\n  ```'),
    wrap('- [ ] Task', '- [x] Parent\n  - [ ] Child'),
    wrap('- [ ] Task', '- Plain', 999),
  ];
  for (const source of cases) assert.equal(plannerWritable(parseMarkdownPlanner(source)), false);
  const invalid = readJournal(cases[0]).document;
  assert.throws(() => upgradeWritingJournal(invalid), /Correct the Markdown source/);
});

test('worker upgrades and conservative merge preserve format boundaries', () => {
  const before = parse(wrap('- [ ] Task', '- Plain note', 2));
  const upgraded = upgradeWritingJournal(before).document;
  const work = runJournalWork({ id: 81, kind: 'upgrade-writing', document: before });
  assert.equal(work.ok, true);
  assert.equal(work.model.source, upgraded.source);
  const concurrent = edit(before, document => { document.scratchpad += 'Remote edit\n'; });
  assert.equal(mergeJournalSources(before, upgraded, concurrent), null);
  assert.equal(journalModel(createJournal('empty-writing', 3)).format, 3);
});
