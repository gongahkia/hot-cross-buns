import assert from 'node:assert/strict';
import test from 'node:test';
import { createJournal, journalModel, readJournal } from '../src/journalDocument.ts';
import { plannerWritable } from '../src/markdownPlanner.ts';
import { appendWritingMarkdown, editWritingFragment, toggleWritingCheckbox, transferWritingCapture, writingBlocks, writingLocationAt, writingRange } from '../src/journalWriting.ts';
import { runJournalWork } from '../src/journalWorker.ts';

const date = { kind: 'dated', date: '2026-11-18' };
const list = { kind: 'undated', list: 'Inbox' };
const wrap = (body = 'A **paragraph**.\n\n- [ ] First\n  ```hcb\n  id: first\n  ```\n\n- Plain outline\n\n# Context\n\n> A quote.', scratch = '# Captured meeting\n\nKeep **this paragraph**.\n\n- [x] Finished\n  - [x] Child\n\n~~~js\nconst saved = "日本語 🥐";\n~~~\n') => `---\nhcb-format: 3\ndocument-id: writing-operations\n---\n\n[global]: https://example.com\n\n## Dated\n\n### 2026-11-18\n\n${body}\n\n### 2026-11-19\n\n- [ ] Tomorrow\n  \`\`\`hcb\n  id: tomorrow\n  \`\`\`\n\n## Undated\n\n### Inbox\n\nExisting context.\n\n- Plain note\n\n## Scratchpad\n${scratch}`;
const valid = source => { const model = readJournal(source).model; assert.equal(plannerWritable(model), true, JSON.stringify(model.issues)); return model; };

test('document blocks interleave prose, outlines and headings in exact source order', () => {
  const model = valid(wrap());
  const blocks = writingBlocks(model, date);
  assert.deepEqual(blocks.map(block => block.type), ['markdown', 'entry', 'entry', 'markdown', 'markdown']);
  assert.deepEqual(blocks.map(block => model.source.slice(block.range.start, block.range.end)), [
    'A **paragraph**.', '- [ ] First\n  ```hcb\n  id: first\n  ```', '- Plain outline', '# Context', '> A quote.',
  ]);
  assert.equal(blocks[1].entryId, 'first');
  assert.ok(blocks[2].entryId.startsWith('source:'));
  const scratch = writingBlocks(model, { kind: 'scratchpad' });
  assert.equal(scratch.every(block => block.type === 'markdown'), true);
  assert.ok(scratch.some(block => model.source.slice(block.range.start, block.range.end).startsWith('~~~js')));
  assert.deepEqual(writingBlocks(model, { kind: 'dated', date: '2026-11-25' }), []);
});

test('a prose block edits directly without creating an item or changing surrounding source', () => {
  for (const ending of ['\n', '\r\n', '\r']) {
    const source = '\uFEFF' + wrap().replaceAll('\n', ending);
    const before = valid(source), range = writingBlocks(before, date)[0].range;
    const after = editWritingFragment(source, date, range, 'A changed **paragraph** with [context][global].');
    assert.equal(after.source, source.replace('A **paragraph**.', 'A changed **paragraph** with [context][global].'));
    assert.deepEqual(after.days[0].entries.map(entry => entry.id), before.days[0].entries.map(entry => entry.id));
    assert.ok(after.markdown.links.some(link => link.url === 'https://example.com'));
  }
});

test('direct block editing rejects document-boundary changes and foreign ranges', () => {
  const source = wrap(), model = valid(source), range = writingBlocks(model, date)[0].range;
  assert.throws(() => editWritingFragment(source, date, range, '### 2026-12-01\n\nMoved context.'), /document boundaries|outside/);
  assert.throws(() => editWritingFragment(source, list, range, 'Wrong document'), /outside the current document/);
  assert.throws(() => editWritingFragment(source, date, range, '~~~\nSwallowed source'), /invalid planner content/);
  assert.throws(() => editWritingFragment(source, date, { start: range.end, end: range.start }, 'Invalid'), /Invalid Markdown source range/);
  assert.equal(model.source, source);
});

test('appending rich content retains existing source and does not force it into a task', () => {
  const source = wrap(), model = valid(source), range = writingRange(model, date);
  const markdown = '## Meeting details\n\n| Person | Action |\n| --- | --- |\n| Sam | Review |\n\n$$x_i$$';
  const after = appendWritingMarkdown(source, date, markdown);
  assert.equal(after.source.slice(0, range.end), source.slice(0, range.end));
  assert.equal(after.source.slice(range.end + markdown.length + 2), source.slice(range.end));
  assert.equal(after.days[0].entries.length, model.days[0].entries.length);
  assert.ok(after.source.includes(markdown));
  assert.ok(after.markdown.headings.some(heading => heading.text === 'Meeting details'));
});

test('new date and named documents use structural headings without rewriting existing groups', () => {
  const source = wrap();
  const dated = appendWritingMarkdown(source, { kind: 'dated', date: '2026-12-01' }, 'A new daily paragraph.');
  assert.ok(dated.days.some(group => group.name === '2026-12-01' && group.entries.length === 0));
  const name = 'Research *notes* [2026] #ideas';
  const undated = appendWritingMarkdown(dated.source, { kind: 'undated', list: name }, '- [ ] An undated task');
  assert.equal(undated.undated.at(-1).name, name);
  assert.equal(undated.undated.at(-1).entries[0].completed, false);
  assert.equal(undated.undated.at(-1).entries[0].kind, undefined);
  assert.ok(undated.source.startsWith(source.slice(0, journalModel(readJournal(source).document).sectionEnds.Dated)));
  for (const destination of [{ kind: 'dated', date: '2026-02-30' }, { kind: 'undated', list: '' }, { kind: 'undated', list: 'A\nB' }]) assert.throws(() => appendWritingMarkdown(source, destination, 'Content'), /valid date|list name/);
});

test('capture transfer preserves paragraphs, nested checked tasks, fences and Unicode atomically', () => {
  for (const ending of ['\n', '\r\n', '\r']) for (const destination of [date, list, { kind: 'undated', list: 'Meeting notes' }]) {
    const source = '\uFEFF' + wrap().replaceAll('\n', ending), model = valid(source);
    const selected = source.slice(model.scratchpad.start);
    const after = transferWritingCapture(source, { start: 0, end: selected.length, selected, destination, cut: true });
    assert.equal(after.source.slice(after.scratchpad.start), '');
    const group = (destination.kind === 'dated' ? after.days : after.undated).find(group => group.name === (destination.date ?? destination.list));
    assert.ok(after.source.slice(group.content.start, group.content.end).includes(selected));
    assert.equal(group.entries.at(-1).completed, true);
    assert.equal(group.entries.at(-1).details[0].completed, true);
    assert.equal(after.days[1].entries[0].id, 'tomorrow');
    assert.equal(source.slice(model.scratchpad.start), selected);
  }
});

test('copying a capture retains the exact scratchpad and partial moves keep unselected bytes', () => {
  const source = wrap(undefined, 'Before\n\nSelected **paragraph** 🥐\n\nAfter\n'), before = valid(source);
  const scratch = source.slice(before.scratchpad.start), selected = 'Selected **paragraph** 🥐', start = scratch.indexOf(selected);
  const args = { start, end: start + selected.length, selected, destination: date, cut: false };
  const copied = transferWritingCapture(source, args);
  assert.equal(copied.source.slice(copied.scratchpad.start), scratch);
  const cut = transferWritingCapture(source, { ...args, cut: true });
  assert.equal(cut.source.slice(cut.scratchpad.start), scratch.replace(selected, ''));
  assert.ok(cut.source.includes(selected));
});

test('invalid selections, broken Markdown boundaries and duplicate identities retain the original', () => {
  const source = wrap(), model = valid(source), scratch = source.slice(model.scratchpad.start);
  for (const args of [
    { start: -1, end: 2, selected: 'x' }, { start: 0, end: 2, selected: 'stale' },
    { start: 0, end: scratch.length + 1, selected: scratch }, { start: 0, end: 0, selected: '' },
  ]) assert.throws(() => transferWritingCapture(source, { ...args, destination: date, cut: true }), /selection changed/);
  assert.throws(() => appendWritingMarkdown(source, date, '~~~js\nconst unfinished = 1;'), /invalid planner content/);
  assert.throws(() => appendWritingMarkdown(source, date, '- [ ] Duplicate\n  ```hcb\n  id: first\n  ```'), /ID appears more than once/);
  assert.throws(() => appendWritingMarkdown(wrap('- [ ] Existing task'), date, '  Attaches to the previous task'), /outside the selected block/);
  const emoji = scratch.indexOf('🥐');
  assert.throws(() => transferWritingCapture(source, { start: emoji, end: emoji + 1, selected: scratch.slice(emoji, emoji + 1), destination: date, cut: true }), /Unicode|source range/);
  assert.equal(model.source, source);
});

test('writing operations require explicit format upgrade and use the production worker contract', () => {
  const source = wrap(), before = valid(source), range = writingBlocks(before, date)[0].range;
  const operation = { kind: 'fragment', location: date, range, markdown: 'Worker **edit**.' };
  const result = runJournalWork({ id: 24, kind: 'writing', source, operation });
  assert.equal(result.ok, true);
  assert.deepEqual(result.model, editWritingFragment(source, date, range, operation.markdown));
  assert.throws(() => appendWritingMarkdown(createJournal('legacy-writing').source, date, 'Unapproved upgrade'), /Enable unified writing/);
  const failed = runJournalWork({ id: 25, kind: 'writing', source, operation: { kind: 'append', destination: date, markdown: '## Scratchpad' } });
  assert.equal(failed.ok, false);
  assert.ok(failed.error.includes('invalid planner content'));
});

test('ordered and captured Markdown checkboxes toggle while code examples remain literal', () => {
  const source = wrap('1. [ ] Ordered action\n\n~~~md\n- [ ] Literal example\n~~~', '- [ ] Captured task\n');
  const ordered = source.indexOf('1. [ ] Ordered action'), captured = source.indexOf('- [ ] Captured task'), literal = source.indexOf('- [ ] Literal example');
  const first = toggleWritingCheckbox(source, date, ordered);
  assert.equal(first.source, source.replace('1. [ ] Ordered action', '1. [x] Ordered action'));
  const second = toggleWritingCheckbox(first.source, { kind: 'scratchpad' }, captured);
  assert.equal(second.source, first.source.replace('- [ ] Captured task', '- [x] Captured task'));
  assert.throws(() => toggleWritingCheckbox(source, date, literal), /actual Markdown task checkbox/);
  assert.throws(() => toggleWritingCheckbox(source, list, ordered), /outside the current document/);
  assert.deepEqual(writingLocationAt(valid(source), captured), { kind: 'scratchpad' });
  assert.deepEqual(writingLocationAt(valid(source), ordered), date);
});
