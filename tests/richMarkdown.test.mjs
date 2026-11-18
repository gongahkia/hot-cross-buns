import assert from 'node:assert/strict';
import test from 'node:test';
import { RichMarkdown } from '../src/richMarkdown.ts';
import { runRichMarkdownWork, RICH_MARKDOWN_LIMITS } from '../src/richMarkdownWork.ts';
import { parseMarkdownPreview } from '../src/markdown.ts';
import { parseMarkdownPlanner } from '../src/markdownPlanner.ts';

const walk = nodes => nodes.flatMap(node => [node, ...walk(node.children ?? [])]);
const plain = node => node.type === 'text' ? node.value : (node.children ?? []).map(plain).join('');
const planner = body => `---\nhcb-format: 2\ndocument-id: rich-tests\n---\n\n[global]: https://example.com\n\n## Dated\n\n### 2026-11-18\n\n- [ ] Entry\n\n  ${body.replaceAll('\n', '\n  ')}\n\n## Undated\n\n### Inbox\n\n## Scratchpad\n`;

test('double-dollar mathematics retains LaTeX, formatting and document reference context', () => {
  const model = parseMarkdownPlanner(planner(String.raw`**Before $$x_i + y_j + \frac{1}{2}$$ after** [reference][global]`));
  const nodes = walk(Object.values(model.markdown.blocks));
  assert.ok(nodes.some(node => node.type === 'strong'));
  assert.ok(nodes.some(node => node.type === 'inlineMath' && node.value === String.raw`x_i + y_j + \frac{1}{2}`));
  assert.ok(nodes.some(node => node.type === 'linkReference' && node.identifier === 'global'));
  const draft = walk(parseMarkdownPreview('$$x_i$$ and [draft][global]', model.markdown).nodes);
  assert.ok(draft.some(node => node.type === 'linkReference'));
  assert.equal(model.source, planner(String.raw`**Before $$x_i + y_j + \frac{1}{2}$$ after** [reference][global]`));
});

test('currency, escapes and code remain literal while quoted display math keeps source coordinates', () => {
  for (const text of [String.raw`\$\$escaped$$`, '$5 and $10', '`$$code$$`', '```js\n$$code$$\n```']) assert.ok(walk(parseMarkdownPreview(text).nodes).every(node => !['math', 'inlineMath'].includes(node.type)));
  for (const ending of ['\n', '\r\n', '\r']) {
    const source = '\uFEFF' + planner('> $$\n> x_i + \\frac{1}{2}\n> $$').replaceAll('\n', ending);
    const model = parseMarkdownPlanner(source), math = walk(Object.values(model.markdown.blocks)).find(node => node.type === 'math');
    assert.ok(math);
    assert.ok(math.value.includes(String.raw`\frac{1}{2}`));
    assert.ok(!math.value.includes('>'));
    assert.ok(source.slice(math.range.start, math.range.end).startsWith('$$'));
    assert.ok(source.slice(math.range.start, math.range.end).endsWith('$$'));
  }
});

test('links inside mathematics do not become backlinks or broken entry-link warnings', () => {
  const model = parseMarkdownPlanner(planner('$$[literal](#hcb-missing)$$'));
  assert.equal(model.markdown.links.length, 0);
  assert.ok(model.issues.every(issue => issue.code !== 'broken-link'));
});

test('callouts preserve their body, nested Markdown and explicit folding state', () => {
  const root = parseMarkdownPreview('> [!warning]- **Heads up**\n> Keep **body**.\n>\n> - Item').nodes[0];
  assert.equal(root.type, 'callout');
  assert.deepEqual(root.callout, { kind: 'warning', title: 'Heads up', fold: 'closed' });
  assert.ok(walk(root.children).some(node => node.type === 'strong' && plain(node) === 'body'));
  assert.ok(walk(root.children).some(node => node.type === 'list'));
  assert.ok(!walk(root.children).some(node => node.type === 'text' && /warning|Heads up/.test(node.value)));
  assert.equal(parseMarkdownPreview('> \\[!note] is literal').nodes[0].type, 'blockquote');
});

test('math rendering produces accessible markup without enabling trusted HTML or URL commands', async () => {
  const result = await runRichMarkdownWork({ kind: 'math', source: String.raw`x_i + \frac{1}{2}`, display: true });
  assert.equal(result.kind, 'math');
  assert.ok(result.html.includes('<math'));
  const unsafe = await runRichMarkdownWork({ kind: 'math', source: String.raw`\href{javascript:alert(1)}{X}`, display: false }).catch(() => null);
  if (unsafe) assert.doesNotMatch(unsafe.html, /<(?:a|img|script)(?:\s|>)|(?:href|src)=["']javascript:/i);
  await assert.rejects(runRichMarkdownWork({ kind: 'math', source: String.raw`\def\repeat{\repeat}\repeat`, display: false }), /expand|expansion/i);
  await assert.rejects(runRichMarkdownWork({ kind: 'math', source: 'x'.repeat(RICH_MARKDOWN_LIMITS.math + 1), display: false }), /limit/);
});

test('highlighting retains exact text, uses safe token spans and bounds large inputs', async () => {
  const source = 'const x = "<img src=x onerror=alert(1)>"; // 👩🏽‍💻';
  const result = await runRichMarkdownWork({ kind: 'highlight', source, language: 'js' });
  assert.equal(plain(result.tree), source);
  assert.ok(walk([result.tree]).some(node => node.type === 'element' && node.tagName === 'span'));
  const unknown = await runRichMarkdownWork({ kind: 'highlight', source, language: 'unknown-language' });
  assert.equal(plain(unknown.tree), source);
  await assert.rejects(runRichMarkdownWork({ kind: 'highlight', source: 'x'.repeat(RICH_MARKDOWN_LIMITS.code + 1), language: 'js' }), /limit/);
});

class Port {
  messages = []; terminated = false;
  postMessage(message) { this.messages.push(message); }
  terminate() { this.terminated = true; }
  finish(index = 0) { const message = this.messages[index]; this.onmessage({ data: { id: message.id, result: { kind: 'math', html: '<math>x</math>' } } }); }
}
test('rich worker requests deduplicate and cache unchanged blocks across document revisions', async () => {
  const port = new Port(), client = new RichMarkdown(() => port);
  const work = { kind: 'math', source: 'x', display: false }, first = client.render(work), second = client.render(work);
  assert.equal(first, second); assert.equal(port.messages.length, 1);
  port.finish(); const result = await first;
  assert.equal(await client.render({ ...work }), result);
  assert.equal(port.messages.length, 1); client.dispose();
});

test('rich worker deadlines, outstanding work, failures and stale responses are bounded', async () => {
  const ports = [], client = new RichMarkdown(() => { const port = new Port(); ports.push(port); return port; }, 20);
  const requests = Array.from({ length: 8 }, (_, index) => client.render({ kind: 'math', source: `x_${index}`, display: false }));
  const settled = Promise.allSettled(requests);
  await assert.rejects(client.render({ kind: 'math', source: 'over-budget', display: false }), /busy/);
  const results = await settled;
  assert.ok(results.every(result => result.status === 'rejected' && /time budget/.test(result.reason.message)));
  assert.equal(ports[0].terminated, true);
  const retry = client.render({ kind: 'math', source: 'new', display: false });
  ports[0].finish(); ports[1].finish();
  assert.ok((await retry).html.includes('math')); client.dispose();
});
