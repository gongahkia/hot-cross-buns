import assert from 'node:assert/strict';
import test from 'node:test';
import { markdownFragment, markdownLink, markdownNavigation, prepareMarkdownLinks, suggestMarkdownLinks } from '../src/markdownNavigation.ts';
import { journalModel, materializeJournal, readJournal } from '../src/journalDocument.ts';
import { replaceMarkdownBody } from '../src/outline.ts';
import { editMarkdownPassage } from '../src/markdownPassage.ts';

const source = `---\nhcb-format: 2\ndocument-id: navigation\n---\n\n# A\n\n# A\n\n# A-1\n\n[plant-ref]: #hcb-plants\n\n## Dated\n\n### 2026-11-18\n\n- [ ] Plants\n  \`\`\`hcb\n  id: plants\n  \`\`\`\n\n  ### Care 日本語\n\n  Read [the other entry](#hcb-other).\n\n- [ ] Other\n  \`\`\`hcb\n  id: other\n  \`\`\`\n\n  [Water][plant-ref] and [heading](#heading-care-%E6%97%A5%E6%9C%AC%E8%AA%9E).\n\n- [ ] No persisted identity\n\n## Undated\n\n### Inbox\n\n- Idea\n\n## Scratchpad\n[Capture](#hcb-plants)\n`;

test('targets resolve entries and Unicode headings with their owning journal locations', () => {
  const { model } = readJournal(source), navigation = markdownNavigation(model);
  assert.equal(markdownNavigation(model), navigation);
  const heading = navigation.byFragment.get('heading-care-日本語');
  assert.equal(heading.itemId, 'plants');
  assert.equal(heading.date, '2026-11-18');
  assert.equal(navigation.byFragment.get('hcb-other').label, 'Other');
  assert.deepEqual(model.markdown.headings.slice(0, 3).map(heading => heading.id), ['heading-a', 'heading-a-1', 'heading-a-1-1']);
  assert.equal(new Set(navigation.targets.flatMap(target => target.fragment ? [target.fragment] : [])).size, navigation.byFragment.size);
  assert.equal(markdownFragment('#heading-care-%E6%97%A5%E6%9C%AC%E8%AA%9E'), 'heading-care-日本語');
  assert.equal(markdownFragment('#%invalid'), undefined);
  assert.equal(markdownFragment('javascript:alert(1)'), undefined);
});

test('backlinks include actual inline/reference uses and retain prose or scratchpad source destinations', () => {
  const navigation = markdownNavigation(readJournal(source).model);
  const incoming = navigation.backlinks.get('hcb-plants');
  assert.equal(incoming.length, 2);
  assert.equal(incoming[0].target.itemId, 'other');
  assert.equal(incoming[1].target.itemId, undefined);
  assert.equal(source.slice(incoming[1].range.start, incoming[1].range.end), '[Capture](#hcb-plants)');
  assert.equal(navigation.backlinks.get('heading-care-日本語')[0].target.itemId, 'other');
});

test('suggestions include missing identities without inventing persistent links and escape labels safely', () => {
  const navigation = markdownNavigation(readJournal(source).model);
  const missing = suggestMarkdownLinks(navigation, 'persisted')[0];
  assert.equal(missing.fragment, undefined);
  assert.ok(missing.entryRef.startsWith('entry:source:'));
  assert.equal(suggestMarkdownLinks(navigation, '日本語')[0].label, 'Care 日本語');
  assert.equal(suggestMarkdownLinks(navigation, '', 2).length, 2);
  assert.equal(markdownLink('A [bracket] **bold** \\ slash', 'heading-日本語'), '[A \\[bracket\\] \\*\\*bold\\*\\* \\\\ slash](#heading-%E6%97%A5%E6%9C%AC%E8%AA%9E)');
});

test('missing target identities and the referring body commit atomically without disturbing unrelated source', () => {
  const { model, document } = readJournal(source), target = suggestMarkdownLinks(markdownNavigation(model), 'persisted')[0];
  const next = structuredClone(document);
  prepareMarkdownLinks(next, source, [{ entryRef: target.entryRef, id: 'new-target' }]);
  next.days[0].items[0].body = replaceMarkdownBody(next.days[0].items[0].body, '[New target](#hcb-new-target)', 1);
  const saved = materializeJournal(next), savedModel = journalModel(saved);
  assert.equal(savedModel.issues.filter(issue => issue.severity === 'error').length, 0);
  assert.ok(saved.source.includes('id: new-target'));
  assert.ok(saved.source.includes('[New target](#hcb-new-target)'));
  assert.ok(saved.source.includes('[Water][plant-ref] and [heading]'));
  assert.equal(document.source, source);
  assert.throws(() => prepareMarkdownLinks(structuredClone(document), source + 'changed', []), /document changed/);
  assert.throws(() => prepareMarkdownLinks(structuredClone(document), source, [{ entryRef: target.entryRef, id: 'plants' }]), /duplicated/);
});

test('prose and scratchpad edits insert link identities atomically on either side of a passage', () => {
  const before = readJournal(source), target = suggestMarkdownLinks(markdownNavigation(before.model), 'persisted')[0];
  for (const fragment of ['# A-1', '[Capture](#hcb-plants)']) {
    const start = source.indexOf(fragment), range = { start, end: start + fragment.length };
    const result = editMarkdownPassage(source, range, '[New](#hcb-new-target)', [{ entryRef: target.entryRef, id: 'new-target' }]);
    assert.equal(result.issues.filter(issue => issue.severity === 'error').length, 0);
    assert.ok(result.source.includes('id: new-target'));
    assert.ok(result.source.includes('[New](#hcb-new-target)'));
    assert.ok(result.source.includes('Read [the other entry](#hcb-other).'));
  }
});

test('a prose block cannot reinterpret scheduling outside its exact source range', () => {
  const text = source.replace('- [ ] Plants', 'Ordinary group context.\n\n- [ ] Plants');
  const start = text.indexOf('Ordinary group context.'), range = { start, end: start + 'Ordinary group context.'.length };
  assert.throws(() => editMarkdownPassage(text, range, '## Unrelated section'), /reinterpret entries/);
  assert.equal(editMarkdownPassage(text, range, 'Revised context.').source, text.replace('Ordinary group context.', 'Revised context.'));
});
