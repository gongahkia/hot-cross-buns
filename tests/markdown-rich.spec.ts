import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { runCommand } from './commands';

const date = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const planner = (body: string) => `---\nhcb-format: 2\ndocument-id: rich-browser\n---\n\n## Dated\n\n### ${date()}\n\n- [ ] Rich notes\n  \`\`\`hcb\n  id: rich-notes\n  \`\`\`\n\n  ${body.replaceAll('\n', '\n  ')}\n\n## Undated\n\n### Inbox\n\n## Scratchpad\n`;
async function load(page: Page, body: string) {
  await page.goto('/');
  await page.getByLabel('Import a Planner.md file').setInputFiles({ name: 'Planner.md', mimeType: 'text/markdown', buffer: Buffer.from(planner(body)) });
  const notes = page.getByRole('group', { name: 'Outline for Rich notes', exact: true }).locator('details').first();
  await expect(notes.locator('summary')).toBeVisible();
  return notes;
}
async function download(page: Page) {
  await runCommand(page, 'Download Planner.md'); const pending = page.waitForEvent('download');
  await page.getByRole('dialog', { name: 'Download Planner.md', exact: true }).getByRole('button', { name: 'download', exact: true }).click();
  return readFile((await (await pending).path())!, 'utf8');
}

test('rich dependencies load only for visible notes and render math, highlighting and folded callouts', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', request => { if (/richMarkdownWorker|katex-[^/]+\.js|mermaid\.min/.test(request.url())) requests.push(request.url()); });
  const body = '**Before $$x_i + \\frac{1}{2}$$ after**.\n\n~~~js\nconst value = "<script>literal</script>";\n~~~\n\n> [!note]- Context\n> Keep **details**.\n>\n> - A bullet\n\n~~~math\n\\sum_{i=1}^{3} i = 6\n~~~';
  const notes = await load(page, body);
  expect(requests).toEqual([]);
  await notes.locator('summary').click();
  await expect(notes.locator('.hljs-keyword')).toContainText('const');
  await notes.locator('[data-display=true]').scrollIntoViewIfNeeded();
  await expect(notes.getByRole('math')).toHaveCount(2);
  const callout = notes.locator('[data-callout=note]');
  await expect(callout.getByText('details', { exact: true })).not.toBeVisible();
  await callout.locator('summary').click();
  await expect(callout.locator('strong')).toHaveText('details');
  await expect(callout.locator('ul')).toHaveCSS('list-style-type', 'disc');
  await expect(notes.locator('script')).toHaveCount(0);
  expect(requests.some(url => /richMarkdownWorker/.test(url))).toBe(true);
  expect(await download(page)).toBe(planner(body));
});

test('Mermaid renders in an opaque sandbox while invalid diagrams retain source', async ({ page }) => {
  const body = '~~~mermaid\nflowchart TD\nA[Start] --> B[Finish]\n~~~\n\n~~~mermaid\nflowchart TD\nA --> [broken\n~~~';
  const notes = await load(page, body);
  await notes.locator('summary').click();
  const frames = notes.locator('iframe[title="Mermaid diagram"]');
  await expect(frames.first()).toHaveAttribute('sandbox', 'allow-scripts');
  await expect(frames.first().contentFrame().locator('svg')).toBeVisible({ timeout: 15000 });
  const access = await frames.first().contentFrame().locator('body').evaluate(() => { try { return !!window.parent.document.body; } catch { return false; } });
  expect(access).toBe(false);
  await expect(notes.getByText('Diagram source (preview unavailable)', { exact: true })).toBeVisible({ timeout: 15000 });
  await expect(notes).toContainText('A --> [broken');
  await expect(notes.locator('svg#hcb-diagram')).toHaveCount(0);
  expect(await download(page)).toBe(planner(body));
});

test('renderer failures and oversized content preserve source without changing the journal', async ({ page }) => {
  await page.route('**/*richMarkdownWorker*.js', route => route.abort('failed'));
  const body = 'Formula $$x_i$$.\n\n~~~js\nconst retained = 1;\n~~~\n\n~~~mermaid\n%%{init: {securityLevel: "loose"}}%%\ngraph TD;A-->B\n~~~';
  const notes = await load(page, body); await notes.locator('summary').click();
  await expect(notes).toContainText('$$x_i$$');
  await expect(notes).toContainText('const retained = 1;');
  await expect(notes.getByRole('math')).toHaveCount(0);
  await expect(notes.getByText('Diagram source (rendering limit)', { exact: true })).toBeVisible();
  await expect(notes.locator('iframe')).toHaveCount(0);
  expect(await download(page)).toBe(planner(body));
});

test('rich content stays within a phone viewport', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const notes = await load(page, '> [!info] A useful note\n> Read this **carefully**.\n\nFormula $$\\frac{1}{2} + x_i$$.\n\n~~~mermaid\ngraph TD;A[First]-->B[Second]\n~~~');
  await notes.locator('summary').click();
  await expect(notes.getByRole('math')).toBeVisible();
  await expect(notes.locator('iframe').contentFrame().locator('svg')).toBeVisible({ timeout: 15000 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
