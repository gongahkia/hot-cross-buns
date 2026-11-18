import assert from 'node:assert/strict';
import test from 'node:test';
import { createJournal, journalModel, readJournal } from '../src/journalDocument.ts';
import { appendWritingMarkdown, writingBlocks } from '../src/journalWriting.ts';
import { markdownKey } from '../src/markdown.ts';
import { writingPresentation, writingTarget } from '../src/writingPresentation.ts';

const location = { kind: 'dated', date: '2026-11-18' };
const source = '---\nhcb-format: 3\ndocument-id: presentation\n---\n\n[shared]: https://example.com\n\n## Dated\n\n### 2026-11-18\n\nA [global reference][shared].\n\n- Context\n  ```hcb\n  id: context\n  ```\n  - [ ] Child\n    - [ ] Grandchild\n\n  > Keep **context**.\n\n- [ ] Other\n\n## Undated\n\n### Inbox\n\n## Scratchpad\n- [ ] Captured\n';

test('writing presentation reuses saved trees and hides only real entry metadata', () => {
  const model = readJournal(source).model, blocks = writingBlocks(model, location), presentation = writingPresentation(model, location);
  assert.equal(presentation.total, 3);
  assert.equal(presentation.body[0].markdown, 'A [global reference][shared].');
  assert.equal(presentation.views[presentation.body[0].sourceRef], model.markdown.blocks[markdownKey(blocks[0].range)]);
  assert.deepEqual([...presentation.hiddenMetadata], [markdownKey(model.days[0].entries[0].metadata)]);
  assert.equal(presentation.entryIds[model.days[0].entries[0].range.start], 'context');
  const entry = model.days[0].entries[0];
  assert.equal(writingTarget(model, entry.range.start).entry, entry);
  assert.deepEqual(writingTarget(model, entry.details[0].children[0].range.start).path, [0, 0]);
  assert.equal(writingTarget(model, 0), undefined);
});

test('fallback trees are cached, retain document reference context and use global source coordinates', () => {
  const original = readJournal(source).model, model = { ...original, markdown: { ...original.markdown, blocks: {} } };
  const first = writingPresentation(model, location), second = writingPresentation(model, location);
  for (const body of first.body) {
    assert.equal(first.views[body.sourceRef], second.views[body.sourceRef]);
    const node = first.views[body.sourceRef], pending = [node];
    while (pending.length) {
      const current = pending.pop();
      assert.ok(current.range.start >= node.range.start);
      assert.ok(current.range.end <= node.range.end);
      pending.push(...current.children ?? []);
    }
  }
  assert.equal(first.views[first.body[0].sourceRef].children[0].children[1].type, 'linkReference');
  assert.equal(first.views[first.body[1].sourceRef].children[0].children[0].range.start, original.days[0].entries[0].range.start);
  assert.equal(original.source, source);
});

test('presentation bounds visible blocks and leaves scratchpad metadata as literal captured content', () => {
  const model = readJournal(source).model;
  const limited = writingPresentation(model, location, 1);
  assert.equal(limited.body.length, 1);
  assert.equal(limited.total, 3);
  const captured = appendWritingMarkdown(source, { kind: 'scratchpad' }, '```hcb\nid: captured-example\n```');
  const scratch = writingPresentation(captured, { kind: 'scratchpad' });
  assert.equal(scratch.hiddenMetadata.size, 0);
  assert.ok(scratch.body.some(body => body.markdown.includes('captured-example')));
  assert.ok(captured.source.startsWith(source));
  const empty = createJournal('empty-capture', 3);
  const appended = appendWritingMarkdown(empty.source, { kind: 'scratchpad' }, '# A capture\n\nA **paragraph**.');
  assert.equal(appended.source.slice(appended.scratchpad.start), '# A capture\n\nA **paragraph**.\n');
  assert.equal(journalModel(empty).format, 3);
});

test('new writing and missing link identities are committed together', () => {
  const before = readJournal(source), target = before.document.days[0].items[1];
  const after = appendWritingMarkdown(source, { kind: 'undated', list: 'Inbox' }, '[Other](#hcb-other)', [{ entryRef: target.sourceRef, id: 'other' }]);
  assert.equal(after.days[0].entries[1].id, 'other');
  assert.ok(after.source.includes('[Other](#hcb-other)'));
  assert.equal(after.issues.some(issue => issue.code === 'broken-link'), false);
  assert.equal(before.model.days[0].entries[1].id, undefined);
  assert.throws(() => appendWritingMarkdown(source, location, 'Content', [{ entryRef: target.sourceRef, id: 'context' }]), /identity changed or is duplicated/);
});
