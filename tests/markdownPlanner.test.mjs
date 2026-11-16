import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  applyPlannerEdits, ensurePlannerEntryId, parseMarkdownPlanner, plannerEntries,
  plannerWritable, renamePlannerEntry, replacePlannerScratchpad, setPlannerCompletion,
} from '../src/markdownPlanner.ts';
import { parseTodoText } from '../src/todoText.ts';
import { parseRecurrence } from '../src/recurrence.ts';
import { MAX_IMPORT_BYTES, MAX_IMPORT_LINES } from '../src/importLimits.ts';

const fixture = readFileSync(new URL('./fixtures/markdown-planner.md', import.meta.url), 'utf8');
const legacy = readFileSync(new URL('./fixtures/markdown-planner.todo.txt', import.meta.url), 'utf8');
const wrap = (dated = '- [ ] Capture', undated = '- Note', scratchpad = '') =>
  `---\nhcb-format: 1\ndocument-id: test-planner\n---\n\n# Hot Cross Buns\n\n## Dated\n\n### 2026-11-16\n\n${dated}\n\n## Undated\n\n### Inbox\n\n${undated}\n\n## Scratchpad\n${scratchpad}`;
const valid = source => {
  const model = parseMarkdownPlanner(source);
  assert.deepEqual(model.issues.filter(issue => issue.severity === 'error'), []);
  return model;
};
const semantics = item => ({ text: item.text, completed: item.completed,
  details: item.details.map(({ text, completed }) => ({ text, completed })),
  ...Object.fromEntries(['repeat', 'span', 'skips', 'replaces', 'completedOn'].filter(key => item[key] !== undefined).map(key => [key, item[key]])),
});
const patch = (model, start, end, text) => ({ range: { start, end }, expected: model.source.slice(start, end), text });

test('handwritten TXT/Markdown fixtures carry the same dated, undated and planning semantics', () => {
  const old = parseTodoText(legacy, '2026-11-16');
  assert.deepEqual(old.issues, []);
  const model = valid(fixture);
  assert.equal(model.source, fixture);
  assert.deepEqual(model.days.map(group => ({ date: group.name, items: group.entries.map(semantics) })),
    old.document.days.map(day => ({ date: day.date, items: day.items.map(semantics) })));
  assert.deepEqual(model.undated.map(group => ({ name: group.name, items: group.entries.map(semantics) })),
    old.document.undated.map(list => ({ name: list.name, items: list.items.map(semantics) })));
  assert.equal(model.days.at(-1).entries.length, 0, 'an empty date remains present');
  assert.match(model.source.slice(model.scratchpad.start), /2099-01-01/);
  assert.equal(model.days.some(group => group.name === '2099-01-01'), false);
});

test('all existing recurrence forms retain their rule fields without expanding occurrences', () => {
  const rules = [
    'daily; series daily', 'weekdays; series weekdays', 'weekly on mon, wed, fri; series weekly',
    'monthly on 31; series monthly', 'yearly on 02-29; series yearly',
    'every 2 weeks on wed; from 2026-10-14; series team-sync; ends after 13',
    'every 2 weeks on sun; from 2026-10-18; series sunday; week starts sun',
    'every 1 month on second wed; from 2026-10-14; series committee',
    'every 1 month on last day; from 2026-10-31; series month-end',
    'every 1 year on last fri of april; from 2026-04-24; series arbor; ends on 2030-04-30',
    'every 3 days after completion; series watering; occurrence 2',
  ];
  for (const rule of rules) {
    const model = valid(wrap(`- [ ] Recurring\n  \`\`\`hcb\n  repeat: ${rule}\n  \`\`\``));
    assert.deepEqual(model.days[0].entries[0].repeat, parseRecurrence(rule));
    assert.equal(model.days[0].entries.length, 1);
  }
});

test('floating time blocks come from a literal Markdown prefix, not code examples or formatted clocks', () => {
  const source = wrap('- [ ] 09:00-09:30 **Meeting**\n  continues here\n\n- [ ] `09:00-09:30` Example\n\n- [ ] **25:00-26:00** Example\n\n- [ ] `09:00-09:30` All day example\n  ```hcb\n  span: all-day\n  ```');
  const model = valid(source);
  assert.deepEqual(model.days[0].entries.map(entry => entry.timeBlock), [{ start: '09:00', end: '09:30' }, undefined, undefined, undefined]);
  assert.deepEqual(model.days[0].entries[3].span, { kind: 'all-day' });
  assert.equal(model.source, source);
});

test('ordinary Markdown and examples do not become planner data', () => {
  const prose = [
    '> ### 2099-01-01\n> - [ ] Quoted',
    '```md\n## Dated\n### 2099-02-02\n- [ ] Example\n```',
    '<!--\n### 2099-03-03\n- [ ] Comment\n-->',
    '| Heading | Value |\n| --- | --- |\n| - [ ] Literal | $5 |',
    '- Ordinary prose list\n  - [ ] Nested task is not a planner entry',
    '#### Research notes\n\n- [ ] Scoped under a nested heading, not the date',
  ].join('\n\n');
  const model = valid(wrap(`- [ ] **Actual** [task](https://example.com)\n\n${prose}`, '- Plain note\n  - Detail'));
  assert.equal(plannerEntries(model).length, 2);
  assert.equal(model.days[0].entries[0].text, 'Actual task');
  assert.equal(model.days[0].entries[0].markdown, '**Actual** [task](https://example.com)');
  assert.equal(model.source, wrap(`- [ ] **Actual** [task](https://example.com)\n\n${prose}`, '- Plain note\n  - Detail'));
});

test('direct metadata ownership excludes nested detail blocks and quoted examples', () => {
  const model = valid(wrap('- [ ] Parent\n  - [ ] Detail\n    ```hcb\n    id: example-only\n    ```\n\n  > ```hcb\n  > id: quoted\n  > ```'));
  assert.equal(model.days[0].entries[0].id, undefined);
  assert.equal(model.issues.filter(issue => issue.code === 'orphan-metadata').length, 2);
});

test('scratchpad is an exact terminal source slice, including reserved-looking syntax', () => {
  const text = '\n\n## Undated\n\n---\nhcb-format: 900\n---\n```hcb\nid: duplicate\n\n- [x] Paste\n';
  const model = valid(wrap(undefined, undefined, text));
  assert.equal(model.source.slice(model.scratchpad.start, model.scratchpad.end), text);
  const replacement = '### 2000-01-01\n- [ ] Still just capture\n\n';
  const next = replacePlannerScratchpad(model, model.source, replacement);
  assert.equal(next.source, model.source.slice(0, model.scratchpad.start) + replacement);
  assert.equal(next.days.length, 1);
});

test('CRLF, CR, BOM, emoji and trailing whitespace survive targeted edits byte for byte', () => {
  for (const ending of ['\n', '\r\n', '\r']) {
    const source = '\ufeff' + wrap('- [ ] Write 🥐 **notes**  \n  - [ ] detail\n\nUnrelated prose  ', undefined, '\nKeep 🥐\n\n').replaceAll('\n', ending);
    const model = valid(source);
    const entry = model.days[0].entries[0];
    const next = renamePlannerEntry(model, source, entry.range.start, 'Write 🥐 better notes');
    assert.equal(next.source, source.slice(0, entry.titleRange.start) + 'Write 🥐 better notes' + source.slice(entry.titleRange.end));
    assert.equal(next.source.charCodeAt(0), 0xfeff);
    const check = setPlannerCompletion(next, next.source, next.days[0].entries[0].range.start, true);
    assert.equal(check.days[0].entries[0].details[0].completed, true);
  }
});

test('wrapped titles remain one paragraph; a rename changes only that paragraph', () => {
  const model = valid(wrap('- [ ] First line\n  second line\n\n  A separate body paragraph.\n\n  ```mermaid\n  graph TD; A-->B\n  ```'));
  const entry = model.days[0].entries[0];
  assert.equal(entry.text, 'First line second line');
  const next = renamePlannerEntry(model, model.source, entry.range.start, 'Replacement');
  assert.match(next.source, /A separate body paragraph\./);
  assert.match(next.source, /graph TD; A-->B/);
});

test('escaped legacy-looking titles and detail text retain their literal meaning', () => {
  const pairs = [
    ['\\- literal dash', '- literal dash'], ['2026-12-25', '2026-12-25'],
    ['\\[x\\] literal marker', '[x] literal marker'], ['\\# heading-shaped', '# heading-shaped'],
    ['\\\\path', '\\path'], ['@repeat: ordinary text', '@repeat: ordinary text'],
    ['LIST: ordinary text', 'LIST: ordinary text'], ['UNDATED', 'UNDATED'],
    ['Price \\$20 and \\*stars\\*', 'Price $20 and *stars*'],
  ];
  for (const [markdown, text] of pairs) {
    const model = valid(wrap(`- [ ] ${markdown}\n  - [ ] ${markdown}`, `- ${markdown}\n  - ${markdown}`));
    for (const entry of plannerEntries(model)) {
      assert.equal(entry.text, text);
      assert.equal(entry.details[0].text, text);
      assert.equal(entry.markdown, markdown);
    }
  }
});

test('formatted-first titles retain the checkbox and planning body during rename', () => {
  for (const title of ['**Bold**', '*Emphasis*', '`Code`', '[Link](https://example.com)', '![Image](image.png)']) {
    const model = valid(wrap(`- [ ] ${title}\n  - [ ] Detail`));
    const entry = model.days[0].entries[0];
    assert.equal(entry.markdown, title);
    const next = renamePlannerEntry(model, model.source, entry.range.start, '**Changed**');
    assert.equal(next.days[0].entries[0].markdown, '**Changed**');
    assert.equal(next.days[0].entries[0].completed, false);
    assert.equal(next.days[0].entries[0].details[0].text, 'Detail');
    assert.match(next.source, /- \[ \] \*\*Changed\*\*/);
  }
});

test('comment-looking title text remains literal and retains the planning body', () => {
  const model = valid(wrap('- [ ] Task\n  ```hcb\n  span: all-day\n  ```\n\n  <!-- body comment -->'));
  const entry = model.days[0].entries[0];
  const next = renamePlannerEntry(model, model.source, entry.range.start, 'Task <!--');
  assert.deepEqual(next.days[0].entries[0].span, { kind: 'all-day' });
  assert.equal(next.days[0].entries[0].text, 'Task <!--');
  assert.match(next.source, /<!-- body comment -->/);
});

test('checkbox edits apply the existing parent/detail completion rules atomically', () => {
  const model = valid(wrap('- [ ] Parent\n  - [x] one\n  - [ ] two'));
  const start = model.days[0].entries[0].range.start;
  const completed = setPlannerCompletion(model, model.source, start, true, 1);
  assert.equal(completed.days[0].entries[0].completed, true);
  const reopenedDetail = setPlannerCompletion(completed, completed.source, start, false, 0);
  assert.equal(reopenedDetail.days[0].entries[0].completed, false);
  assert.deepEqual(reopenedDetail.days[0].entries[0].details.map(detail => detail.completed), [false, true]);
  const reopenedParent = setPlannerCompletion(completed, completed.source, start, false);
  assert.deepEqual(reopenedParent.days[0].entries[0].details.map(detail => detail.completed), [false, false]);
  assert.equal(model.source, wrap('- [ ] Parent\n  - [x] one\n  - [ ] two'), 'input model is unchanged');
});

test('entry IDs are lazy, unique, persisted and stable across a rename', () => {
  const model = valid(wrap());
  const entry = model.days[0].entries[0];
  const result = ensurePlannerEntryId(model, model.source, entry.range.start, () => 'stable-id');
  assert.equal(result.id, 'stable-id');
  assert.equal(result.model.days[0].entries[0].id, 'stable-id');
  assert.equal(result.model.days[0].entries[0].text, entry.text);
  const renamed = renamePlannerEntry(result.model, result.model.source, entry.range.start, 'New title');
  assert.equal(renamed.days[0].entries[0].id, 'stable-id');
  assert.equal(ensurePlannerEntryId(renamed, renamed.source, entry.range.start, () => { throw Error('not called'); }).model, renamed);
  assert.throws(() => ensurePlannerEntryId(model, model.source, entry.range.start, () => 'UPPER'), /unique planner entry ID/);
});

test('adding identity to existing metadata retains its spelling, delimiter and planning fields', () => {
  const source = wrap('- [ ] Trip\n  ~~~~hcb\n  span: all-day through 2026-11-18\n  ~~~~');
  const model = valid(source);
  const entry = model.days[0].entries[0];
  const { model: next } = ensurePlannerEntryId(model, source, entry.range.start, () => 'trip-id');
  assert.equal(next.source, source.replace('~~~~hcb\n', '~~~~hcb\n  id: trip-id\n'));
  assert.deepEqual(next.days[0].entries[0].span, entry.span);
});

test('identity insertion respects marker width, indentation, nested details and line endings', () => {
  for (const bullet of ['- ', '*   ', '+\t', '  - ']) {
    for (const nl of ['\n', '\r\n']) {
      const source = wrap(`${bullet}[ ] Title`).replaceAll('\n', nl);
      const model = valid(source);
      const entry = model.days[0].entries[0];
      const { model: next } = ensurePlannerEntryId(model, source, entry.range.start, () => 'new-id');
      assert.equal(next.days[0].entries[0].id, 'new-id', JSON.stringify([bullet, nl]));
      assert.equal(next.days[0].entries[0].text, 'Title');
    }
  }
  const model = valid(wrap('- [ ] Parent\n  - [ ] Detail'));
  const { model: next } = ensurePlannerEntryId(model, model.source, model.days[0].entries[0].range.start, () => 'parent');
  assert.equal(next.days[0].entries[0].details[0].text, 'Detail');
});

test('links use explicit stable identities and unresolved targets are non-destructive diagnostics', () => {
  const model = valid(wrap('- [ ] [Capture](#hcb-capture)\n  ```hcb\n  id: capture\n  ```\n\n[Missing](#hcb-missing)\n\n[reference]: #hcb-also-missing'));
  assert.equal(model.issues.filter(issue => issue.code === 'broken-link').length, 2);
  assert.equal(model.source.includes('#hcb-capture'), true);
});

test('same-baseline patches are atomic, order independent and retain rich content during a move', () => {
  const source = wrap('- [ ] Move me\n  ```hcb\n  id: move-me\n  ```\n\n  > Context\n\n### 2026-11-17\n\nProse stays put.');
  const model = valid(source);
  const entry = model.days[0].entries[0];
  const target = model.days[1].range.end;
  const patches = [patch(model, entry.range.start, entry.range.end, ''), patch(model, target, target, '\n\n' + source.slice(entry.range.start, entry.range.end))];
  const next = applyPlannerEdits(model, source, patches.reverse());
  assert.equal(next.days[0].entries.length, 0);
  assert.equal(next.days[1].entries[0].id, 'move-me');
  assert.match(next.source, /> Context/);
  assert.match(next.source, /Prose stays put\./);
});

test('stale document versions, stale fragments, overlapping edits and invalid ranges fail closed', () => {
  const model = valid(wrap('- [ ] Write 🥐'));
  const entry = model.days[0].entries[0];
  assert.throws(() => renamePlannerEntry(model, model.source + 'external edit', entry.range.start, 'New'), /source changed/);
  assert.throws(() => applyPlannerEdits(model, model.source, [{ range: entry.titleRange, expected: 'wrong', text: 'New' }]), /fragment changed/);
  assert.throws(() => applyPlannerEdits(model, model.source, [patch(model, 0, 2, ''), patch(model, 1, 3, '')]), /overlap/);
  assert.throws(() => applyPlannerEdits(model, model.source, [patch(model, 0, 0, ''), patch(model, 0, 0, '')]), /overlap/);
  for (const range of [{ start: -1, end: 0 }, { start: 2, end: 1 }, { start: 0.5, end: 2 }, { start: 0, end: Infinity }, { start: 0, end: model.source.length + 1 }]) {
    assert.throws(() => applyPlannerEdits(model, model.source, [{ range, expected: '', text: '' }]), /Invalid Markdown source range/);
  }
  const emoji = model.source.indexOf('🥐');
  assert.throws(() => applyPlannerEdits(model, model.source, [patch(model, emoji + 1, emoji + 2, '')]), /Invalid Markdown source range/);
});

test('edits cannot silently damage structure, change document identity or use invalid titles', () => {
  const model = valid(wrap());
  const entry = model.days[0].entries[0];
  for (const title of ['', '   ', '# Heading', '- [ ] Nested', '```hcb', 'a\nb']) assert.throws(() => renamePlannerEntry(model, model.source, entry.range.start, title), /title|structure/);
  const offset = model.source.indexOf('test-planner');
  assert.throws(() => applyPlannerEdits(model, model.source, [patch(model, offset, offset + 12, 'new-planner')]), /document identity/);
  const section = model.source.indexOf('## Undated');
  assert.throws(() => applyPlannerEdits(model, model.source, [patch(model, section, section + 10, '## Removed')]), /invalid planner content/);
});

test('newer local edits and undo snapshots stay separate from a previous parsed model', () => {
  const saved = valid(wrap());
  const draft = renamePlannerEntry(saved, saved.source, saved.days[0].entries[0].range.start, 'Local draft');
  assert.throws(() => replacePlannerScratchpad(saved, draft.source, 'Provider result'), /source changed/);
  assert.equal(draft.days[0].entries[0].text, 'Local draft');
  assert.equal(saved.days[0].entries[0].text, 'Capture');
  assert.equal(parseMarkdownPlanner(saved.source).source, saved.source, 'exact previous source is a complete undo snapshot');
});

test('recurring completion is not exposed as a naive checkbox edit', () => {
  const model = valid(fixture);
  const repeating = model.days[0].entries[0];
  assert.throws(() => setPlannerCompletion(model, fixture, repeating.range.start, false), /occurrence-aware/);
  const replacement = model.days[1].entries[0];
  assert.throws(() => setPlannerCompletion(model, fixture, replacement.range.start, true), /occurrence-aware/);
  const note = model.undated[0].entries[0];
  assert.throws(() => setPlannerCompletion(model, fixture, note.range.start, true), /Undated/);
});

test('invalid or unknown metadata stays recoverable and blocks structured writes', () => {
  const cases = [
    ['id: a\n  id: b', 'duplicate-field'], ['id: Upper', 'entry-id'], ['future-rule: unknown', 'unknown-field'],
    ['id: !!js/function run', 'entry-id'], ['repeat: daily', 'repeat'], ['span: all-day through 2026-11-15', 'span'],
    ['completed: 2026-11-16', 'completed'], ['skip: 2026-11-17', 'skip'], ['replaces: absent on 2026-11-17', 'missing-series'],
    ['repeat: daily; series a\n  replaces: a on 2026-11-17', 'replaces'],
    ['repeat: daily; series a\n  skip: 2026-11-17, 2026-11-17', 'skip'],
    ['id: a\n  invalid-line', 'metadata-syntax'],
  ];
  for (const [fields, code] of cases) {
    const source = wrap(`- [ ] Test\n  \`\`\`hcb\n  ${fields}\n  \`\`\``);
    const model = parseMarkdownPlanner(source);
    assert.equal(model.issues.some(issue => issue.code === code), true, fields);
    assert.equal(model.source, source);
    assert.throws(() => replacePlannerScratchpad(model, source, 'new'), /diagnostics/);
  }
});

test('incomplete fences, duplicate blocks and conflicting title times are explicit errors', () => {
  for (const [dated, code] of [
    ['- [ ] Task\n  ```hcb\n  id: task', 'metadata-fence'],
    ['- [ ] Task\n  ```hcb options\n  id: task\n  ```', 'metadata-fence'],
    ['- [ ] Task\n  ```hcb\n  id: task\n  ```\n  ```hcb\n  id: second\n  ```', 'duplicate-metadata'],
    ['- [ ] 09:00-10:00 Task\n  ```hcb\n  span: all-day\n  ```', 'span'],
    ['- [ ] 25:00-26:00 Task', 'time'],
    ['- [x] Parent\n  - [ ] Open child', 'completion-state'],
    ['- [x] Repeater\n  ```hcb\n  repeat: every 3 days after completion; series a; occurrence 1\n  ```', 'completion-date'],
  ]) {
    const model = parseMarkdownPlanner(wrap(dated));
    assert.equal(model.issues.some(issue => issue.code === code), true, dated);
    assert.equal(plannerWritable(model), false);
  }
});

test('duplicate identities, series, occurrences and replacements are errors', () => {
  for (const [field, code] of [
    ['id: duplicate', 'duplicate-id'], ['repeat: daily; series same', 'duplicate-series'],
    ['repeat: every 2 days after completion; series same; occurrence 1', 'duplicate-series'],
    ['replaces: same on 2026-11-16', 'duplicate-replacement'],
  ]) {
    const item = `- [ ] Task\n  \`\`\`hcb\n  ${field}\n  \`\`\``;
    const model = parseMarkdownPlanner(wrap(item + '\n\n' + item));
    assert.equal(model.issues.some(issue => issue.code === code), true, field);
  }
  const model = valid(wrap('- [ ] A\n  ```hcb\n  id: taken\n  ```\n\n- [ ] B'));
  assert.throws(() => ensurePlannerEntryId(model, model.source, model.days[0].entries[1].range.start, () => 'taken'), /unique/);
});

test('unsupported versions, malformed structure and undated scheduling are read-only', () => {
  const cases = [
    [wrap().replace('hcb-format: 1', 'hcb-format: 2'), 'format-version'],
    [wrap().replace('document-id: test-planner', 'document-id: ../outside'), 'document-id'],
    [wrap().replace('## Dated', '## Unknown'), 'sections'],
    [wrap().replace('2026-11-16', '2026-02-30'), 'date'],
    [wrap('- [ ] A\n\n### 2026-11-16\n\n- [ ] B'), 'duplicate-group'],
    [wrap(undefined, '- [ ] Note'), 'undated-checkbox'],
    [wrap(undefined, '- Note\n  ```hcb\n  span: all-day\n  ```'), 'undated-metadata'],
    [wrap().replace(/^---[\s\S]*?---\n/, ''), 'missing-header'],
  ];
  for (const [source, code] of cases) {
    const model = parseMarkdownPlanner(source);
    assert.equal(model.issues.some(issue => issue.code === code), true, code);
    assert.equal(model.source, source);
    assert.equal(plannerWritable(model), false);
  }
});

test('Markdown resource limits count UTF-8 bytes and logical lines before parsing', () => {
  assert.throws(() => parseMarkdownPlanner('a'.repeat(MAX_IMPORT_BYTES + 1)), /5 MiB/);
  assert.throws(() => parseMarkdownPlanner('🥐'.repeat(MAX_IMPORT_BYTES / 4 + 1)), /5 MiB/);
  assert.throws(() => parseMarkdownPlanner('a\r\n'.repeat(MAX_IMPORT_LINES + 1)), /100,000 lines/);
});

test('invalid Unicode is rejected instead of being changed by UTF-8 encoding', () => {
  for (const invalid of ['\ud83e', '\udd50', 'A\ud83eB']) assert.throws(() => parseMarkdownPlanner(wrap(invalid)), /valid Unicode/);
  const model = valid(wrap());
  assert.throws(() => replacePlannerScratchpad(model, model.source, '\ud83e'), /valid Unicode/);
});
