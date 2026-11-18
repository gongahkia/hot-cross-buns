import assert from 'node:assert/strict';
import test from 'node:test';
import { headingSlug, indexMarkdown, markdownKey, markdownRange, parseMarkdownPreview, parseMarkdownTree, safeMarkdownUrl, MARKDOWN_RENDER_LIMITS } from '../src/markdown.ts';
import { applyPlannerEdits, parseMarkdownPlanner } from '../src/markdownPlanner.ts';
import { createJournal, journalBodyViews, materializeJournal, readJournal } from '../src/journalDocument.ts';
import { replaceMarkdownBody } from '../src/outline.ts';

const walk = nodes => nodes.flatMap(node => [node, ...walk(node.children ?? [])]);
const source = notes => `---\nhcb-format: 2\ndocument-id: markdown-corpus\n---\n\n# Journal\n\n[global]: https://example.com "Global title"\n\n[^global]: A document-wide footnote.\n\n## Dated\n\n### 2026-11-18\n\n- [ ] Entry\n  \`\`\`hcb\n  id: entry\n  \`\`\`\n\n  ${notes.replaceAll('\n', '\n  ')}\n\n## Undated\n\n### Inbox\n\n## Scratchpad\nExact **capture**.\n`;
const corpus = [
  ['ATX heading', '### A heading', ['heading', 'text']],
  ['setext heading', 'A heading\n---', ['heading', 'text']],
  ['inline formatting', '**bold** _italic_ ~~gone~~ `code`', ['strong', 'emphasis', 'delete', 'inlineCode']],
  ['escapes and entities', '\\*literal\\* &amp; &#x1F680;', ['paragraph', 'text']],
  ['hard break', 'first  \nsecond', ['break']],
  ['quote with nested list', '> Context\n>\n> - One\n>   - Two', ['blockquote', 'list', 'listItem']],
  ['ordered list with start', '3. One\n4. Two', ['list', 'listItem']],
  ['GFM tasks', '- [ ] Open\n- [x] Done', ['list', 'listItem']],
  ['table alignment', '| Left | Right |\n| :--- | ---: |\n| a | b |', ['table', 'tableRow', 'tableCell']],
  ['autolinks', 'Visit https://example.com and <person@example.com>.', ['link']],
  ['reference link', '[label][ref]\n\n[ref]: https://example.com "Title"', ['linkReference', 'definition']],
  ['reference image', '![description][pic]\n\n[pic]: https://example.com/a.png', ['imageReference', 'definition']],
  ['footnote', 'Text[^one].\n\n[^one]: Footnote **body**.', ['footnoteReference', 'footnoteDefinition', 'strong']],
  ['fenced code', '~~~js\nconst x = "```";\n~~~', ['code']],
  ['indented code', '    literal <script>not code execution</script>', ['code']],
  ['raw HTML', '<script>alert(1)</script>', ['html']],
  ['thematic break', '***', ['thematicBreak']],
  ['Unicode', '👩🏽‍💻 café e\u0301 日本語', ['paragraph', 'text']],
];

for (const [name, markdown, expected] of corpus) test(`Markdown corpus: ${name} retains source and exposes expected syntax`, () => {
  const root = parseMarkdownTree(markdown), preview = parseMarkdownPreview(markdown);
  const types = new Set(walk(preview.nodes).map(node => node.type));
  for (const type of expected) assert.ok(types.has(type), `${name}: missing ${type}`);
  for (const node of walk(preview.nodes)) {
    assert.ok(node.range.start >= 0 && node.range.end <= markdown.length);
    assert.ok(markdown.slice(node.range.start, node.range.end).length > 0);
  }
  assert.equal(markdown.slice(root.position.start.offset, root.position.end.offset), markdown);
});

test('saved body blocks share the planner parse and resolve document-wide references', () => {
  const text = source('Read [the target][global] and this footnote[^global].'), model = parseMarkdownPlanner(text);
  assert.equal(model.issues.filter(issue => issue.severity === 'error').length, 0);
  const body = model.days[0].entries[0].body[0], rendered = model.markdown.blocks[markdownKey(body.range)];
  assert.ok(walk([rendered]).some(node => node.type === 'linkReference'));
  assert.equal(model.markdown.definitions.global.url, 'https://example.com');
  assert.equal(model.markdown.links[0].url, 'https://example.com');
  assert.equal(model.markdown.footnotes.global.type, 'footnoteDefinition');
  const preview = parseMarkdownPreview('[draft][global] and a note[^global].', model.markdown);
  assert.ok(walk(preview.nodes).some(node => node.type === 'linkReference'));
  assert.ok(walk(preview.nodes).some(node => node.type === 'footnoteReference'));
  assert.equal(preview.nodes.length, 1, 'appended context must not appear in the draft preview');
});

test('projected body references reuse immutable render trees without reparsing note fragments', () => {
  const { model, document } = readJournal(source('Read [the target][global].'));
  const body = document.days[0].items[0].body[0], views = journalBodyViews(document);
  assert.equal(views[body.sourceRef], model.markdown.blocks[markdownKey(model.days[0].entries[0].body[0].range)]);
  assert.equal(journalBodyViews(document), views);
  assert.ok(Object.isFrozen(views));
  assert.equal(materializeJournal(structuredClone(document)), document, 'unchanged projections reuse the exact validated document and body trees');
});

test('validated storage references survive source-cache eviction without trusting mutable projections', () => {
  const { document } = readJournal(source('Preserved **body**.'));
  createJournal('eviction-one'); createJournal('eviction-two');
  assert.equal(materializeJournal(structuredClone(document), [document]), document);
  const changed = structuredClone(document); changed.days[0].items[0].text = 'Changed entry';
  assert.equal(materializeJournal(changed, [document]).days[0].items[0].text, 'Changed entry');
  const unvalidated = structuredClone(document); unvalidated.days[0].items[0].text = 'Untrusted projection';
  assert.notEqual(materializeJournal(structuredClone(document), [unvalidated]).days[0].items[0].text, 'Untrusted projection');
});

test('block edits retain sibling objects and source identities, including block deletion', () => {
  const { document } = readJournal(source('First paragraph.\n\n> A preserved **quote**.'));
  const body = document.days[0].items[0].body;
  const edited = replaceMarkdownBody(body, 'Updated **first**.', 0);
  assert.equal(edited[1], body[1]);
  assert.equal(edited[0].sourceRef, body[0].sourceRef);
  assert.equal(body[0].markdown, 'First paragraph.');
  assert.equal(replaceMarkdownBody(body, '', 0)[0], body[1]);
  assert.throws(() => replaceMarkdownBody(body, 'bad', 10), /block changed/);
  const changed = structuredClone(document);
  changed.days[0].items[0].body = replaceMarkdownBody(changed.days[0].items[0].body, '', 0);
  const firstRange = parseMarkdownPlanner(document.source).days[0].entries[0].body[0].range;
  assert.equal(materializeJournal(changed).source, document.source.slice(0, firstRange.start) + document.source.slice(firstRange.end));
});

test('external reference context never leaks into unfinished code or HTML', () => {
  const context = parseMarkdownPlanner(source('Read [global][global].')).markdown;
  for (const draft of ['```js\nunfinished', '<script>\nunfinished', '<!-- unfinished']) {
    assert.deepEqual(parseMarkdownPreview(draft, context).nodes, parseMarkdownPreview(draft).nodes);
  }
});

test('BOM and all supported line endings retain exact UTF-16 ranges', () => {
  for (const ending of ['\n', '\r\n', '\r']) {
    const text = '\uFEFF' + source('## Heading 👩🏽‍💻\n\n**body**').replaceAll('\n', ending);
    const model = parseMarkdownPlanner(text);
    for (const body of model.days[0].entries[0].body) assert.equal(text.slice(body.range.start, body.range.end), body.markdown);
    const heading = model.markdown.headings.find(heading => heading.text.includes('👩'));
    assert.equal(text.slice(heading.range.start, heading.range.end).trim(), '## Heading 👩🏽‍💻');
  }
});

test('heading anchors are deterministic, unique and separate from entry anchors', () => {
  const root = parseMarkdownTree('# Plants\n\n# Plants\n\n# hcb-plants\n\n# 日本語\n');
  assert.deepEqual(indexMarkdown(root).headings.map(heading => heading.id), ['heading-plants', 'heading-plants-1', 'heading-hcb-plants', 'heading-日本語']);
  assert.equal(headingSlug('é'), headingSlug('e\u0301'));
});

test('definition maps accept prototype-like labels without changing object prototypes', () => {
  const index = indexMarkdown(parseMarkdownTree('[x][constructor]\n\n[constructor]: https://example.com\n\n[__proto__]: https://example.org'));
  assert.equal(index.definitions.constructor.url, 'https://example.com');
  assert.equal(index.definitions.__proto__.url, 'https://example.org');
  assert.equal(Object.getPrototypeOf(index.definitions), null);
});

test('untrusted URL schemes and control characters are rejected', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,bad', 'file:///etc/passwd', '//example.com', 'https://example.com\u0000bad']) assert.equal(safeMarkdownUrl(url), undefined);
  for (const url of ['https://example.com', 'http://localhost', 'mailto:user@example.com', '#heading-日本語', '#hcb-entry']) assert.equal(safeMarkdownUrl(url), url);
});

test('large and deeply nested previews fall back to exact source within rendering budgets', () => {
  const long = 'x'.repeat(MARKDOWN_RENDER_LIMITS.characters + 1);
  assert.equal(parseMarkdownPreview(long).nodes[0].type, 'source');
  const nested = '> '.repeat(80) + 'deep';
  assert.ok(walk(parseMarkdownPreview(nested).nodes).some(node => node.type === 'source'));
  const wide = Array.from({ length: 4000 }, (_, i) => `- item ${i}`).join('\n');
  assert.ok(walk(parseMarkdownPreview(wide).nodes).some(node => node.type === 'source'));
  const many = Array.from({ length: 1800 }, (_, index) => `Paragraph ${index}.`).join('\n\n');
  const bounded = parseMarkdownPreview(many);
  assert.ok(walk(bounded.nodes).length <= MARKDOWN_RENDER_LIMITS.nodes);
  assert.equal(bounded.nodes[0].type, 'source');
  const notes = Array.from({ length: 120 }, (_, index) => `[^note-${index}]: Footnote ${index}.`).join('\n\n');
  const index = indexMarkdown(parseMarkdownTree(notes), [], notes);
  assert.equal(Object.keys(index.footnotes).length, MARKDOWN_RENDER_LIMITS.footnotes);
  assert.ok(index.truncated);
});

test('generated source edits preserve every untouched byte across syntax, nesting and Unicode', () => {
  let state = 0x51a7, pick = length => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) % length; };
  const fragments = ['**bold**', '`literal`', '日本語 👩🏽‍💻', '[link][global]', 'escaped \\*text\\*', 'e\u0301', '~~~not a fence~~~'];
  for (const ending of ['\n', '\r\n', '\r']) {
    let text = '\uFEFF' + source('Paragraph **original**.\n\n> Quote with `code`.\n\n- [ ] Child\n  - [ ] Grandchild\n\n    ~~~js\n    const retained = "original";\n    ~~~').replaceAll('\n', ending);
    for (let edit = 0; edit < 40; edit++) {
      const before = parseMarkdownPlanner(text), entry = before.days[0].entries[0];
      const target = [entry, entry.details[0], entry.details[0].children[0]][pick(3)];
      const next = `Entry ${edit} ${fragments[pick(fragments.length)]}`;
      const patch = { range: target.titleRange, expected: text.slice(target.titleRange.start, target.titleRange.end), text: next };
      const after = applyPlannerEdits(before, text, [patch]);
      assert.equal(after.source, text.slice(0, patch.range.start) + next + text.slice(patch.range.end));
      assert.deepEqual(after.issues.filter(issue => issue.severity === 'error'), []);
      assert.equal(before.source, text);
      for (const link of after.markdown.links) assert.ok(after.source.slice(link.range.start, link.range.end).includes('['));
      text = after.source;
    }
  }
});

 test('attached document blocks support appending without changing existing Markdown', () => {
  const body = [{markdown:'Keep **source**.',sourceRef:'body:0'}];
  const appended=replaceMarkdownBody(body,'Second paragraph.',1);
  assert.equal(appended[0],body[0]);
  assert.equal(appended[1].markdown,'Second paragraph.');
  assert.deepEqual(replaceMarkdownBody(undefined,'First paragraph.',0),[{markdown:'First paragraph.'}]);
  assert.equal(replaceMarkdownBody(undefined,'',0),undefined);
  assert.throws(()=>replaceMarkdownBody(undefined,'Bad index.',1),/block changed/);
});
