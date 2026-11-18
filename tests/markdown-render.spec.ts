import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { runCommand } from './commands';

const date = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const planner = (body: string, definitions = '') => `---\nhcb-format: 2\ndocument-id: rendered-markdown\n---\n\n# Journal\n\n${definitions}\n\n## Dated\n\n### ${date()}\n\n- [ ] Markdown example\n  \`\`\`hcb\n  id: example\n  \`\`\`\n\n  ${body.replaceAll('\n', '\n  ')}\n\n## Undated\n\n### Inbox\n\n## Scratchpad\n`;
async function openNotes(page: Page, body: string, definitions = '') {
  await page.goto('/');
  await page.getByLabel('Import a Planner.md file').setInputFiles({ name: 'Planner.md', mimeType: 'text/markdown', buffer: Buffer.from(planner(body, definitions)) });
  const outline = page.getByRole('group', { name: 'Outline for Markdown example', exact: true });
  const notes = outline.locator('details').first();
  await notes.locator('summary').click();
  return notes;
}
async function exportSource(page: Page) {
  await runCommand(page, 'Download Planner.md');
  const pending = page.waitForEvent('download');
  await page.getByRole('dialog', { name: 'Download Planner.md', exact: true }).getByRole('button', { name: 'download', exact: true }).click();
  return readFile((await (await pending).path())!, 'utf8');
}

test('saved notes resolve references outside the body and preserve table alignment', async ({ page }) => {
  const notes = await openNotes(page, 'Read [shared reference][outside].\n\n| Left | Centre | Right |\n| :--- | :---: | ---: |\n| a | b | c |', '[outside]: https://example.com/shared "Shared title"');
  await expect(notes.getByRole('link', { name: 'shared reference' })).toHaveAttribute('href', 'https://example.com/shared');
  await expect(notes.getByRole('link', { name: 'shared reference' })).toHaveAttribute('title', 'Shared title');
  const headings = notes.getByRole('columnheader'), cells = notes.getByRole('cell');
  for (const [index, alignment] of ['left', 'center', 'right'].entries()) {
    await expect(headings.nth(index)).toHaveCSS('text-align', alignment);
    await expect(cells.nth(index)).toHaveCSS('text-align', alignment);
  }
  await page.reload();
  await page.getByRole('group', { name: 'Outline for Markdown example', exact: true }).locator('details').first().locator('summary').click();
  await expect(page.getByRole('link', { name: 'shared reference' })).toHaveAttribute('href', 'https://example.com/shared');
});

test('footnotes resolve at document scope with keyboard-accessible return navigation', async ({ page }) => {
  const notes = await openNotes(page, 'First[^shared], then again[^shared].', '[^shared]: A **document-wide** note.');
  const reference = notes.getByRole('link', { name: 'Footnote 1', exact: true });
  await expect(reference).toHaveCount(2);
  await reference.nth(1).click();
  const footnote = notes.getByRole('region', { name: 'Footnotes' }).getByRole('listitem');
  await expect(footnote).toBeFocused();
  await expect(footnote.locator('strong')).toHaveText('document-wide');
  await notes.getByRole('link', { name: 'Back to footnote 1 reference 2', exact: true }).click();
  await expect(reference.nth(1)).toBeFocused();
});

test('remote images load only on request and unsafe images and HTML remain inert', async ({ page }) => {
  let requests = 0;
  await page.route('https://images.example.test/**', async route => {
    requests++;
    await route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64') });
  });
  const notes = await openNotes(page, '![Remote picture][picture]\n\n![Unsafe](javascript:alert(1))\n\n<img src=x onerror=alert(1)>', '[picture]: https://images.example.test/image.png');
  await expect(notes.getByRole('button', { name: 'Load image: Remote picture', exact: true })).toBeVisible();
  expect(requests).toBe(0);
  await expect(notes.locator('img')).toHaveCount(0);
  await expect(notes).toContainText('[Image: Unsafe]');
  await expect(notes).toContainText('<img src=x onerror=alert(1)>');
  await notes.getByRole('button', { name: 'Load image: Remote picture', exact: true }).click();
  await expect(notes.getByRole('img', { name: 'Remote picture' })).toBeVisible();
  await expect.poll(() => requests).toBe(1);
  await expect(notes.locator('img')).toHaveCount(1);
});

test('document references, tables and footnotes fit a narrow phone without expanding the page', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const notes = await openNotes(page, 'Read [shared][outside] with note[^shared].\n\n| Long column one | Long column two | Long column three |\n| --- | --- | --- |\n| xxxxxxxxxxxxxxxxxxxxxxxxxxxx | yyyyyyyyyyyyyyyyyyyyyyy | zzzzzzzzzzzzzzzzzzzzzzzz |', '[outside]: https://example.com\n\n[^shared]: A readable note.');
  await expect(notes.getByRole('link', { name: 'shared', exact: true })).toBeVisible();
  await expect(notes.getByRole('region', { name: 'Footnotes' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('one active block previews locally while siblings stay rendered and save patches only that block', async ({ page }) => {
  const original = 'First **paragraph**.\n\n> Untouched **quote**.\n\n~~~js\nconst untouched = "👩🏽‍💻";\n~~~';
  const notes = await openNotes(page, original);
  await notes.getByRole('button', { name: 'Edit block 1 in Markdown example', exact: true }).click();
  const input = notes.getByRole('textbox', { name: 'Markdown notes for Markdown example', exact: true });
  await expect(input).toHaveValue('First **paragraph**.');
  await input.fill('Changed **block**.');
  await expect(notes.getByLabel('Live Markdown preview').locator('strong')).toHaveText('block');
  await expect(notes.locator('blockquote strong')).toHaveText('quote');
  await expect(notes.locator('code')).toContainText('const untouched');
  expect(await exportSource(page)).toBe(planner(original));
  await notes.getByRole('button', { name: 'Save notes', exact: true }).click();
  await expect(input).toHaveCount(0);
  expect(await exportSource(page)).toBe(planner(original).replace('First **paragraph**.', 'Changed **block**.'));
});

test('block drafts recover with their block identity and retain source staleness checks', async ({ page }) => {
  const notes = await openNotes(page, 'First block.\n\nSecond **block**.');
  await notes.getByRole('button', { name: 'Edit block 2 in Markdown example', exact: true }).click();
  const input = page.getByRole('textbox', { name: 'Markdown notes for Markdown example', exact: true });
  await input.fill('Recovered **second**.');
  await page.reload();
  await expect(input).toHaveValue('Recovered **second**.');
  await expect(page.getByText('A previous notes draft was recovered. Review it before saving.')).toBeVisible();
  await page.getByRole('button', { name: 'Save notes', exact: true }).click();
  await expect(input).toHaveCount(0);
  expect(await exportSource(page)).toBe(planner('First block.\n\nRecovered **second**.'));
});

test('block editing preserves the native input, composition and native undo without journal commits', async ({ page }) => {
  const original = 'First block.\n\nSecond block.';
  const notes = await openNotes(page, original);
  await notes.getByRole('button', { name: 'Edit block 1 in Markdown example', exact: true }).click();
  const input = notes.getByRole('textbox', { name: 'Markdown notes for Markdown example', exact: true });
  const nativeInput = await input.elementHandle();
  await input.evaluate(element => { const input = element as HTMLTextAreaElement; input.setSelectionRange(input.value.length, input.value.length); });
  await input.press('x');
  await expect(input).toHaveValue('First block.x');
  expect(await nativeInput!.evaluate(element => element.isConnected)).toBe(true);
  await input.press('ControlOrMeta+z');
  await expect(input).toHaveValue('First block.');
  await input.evaluate(element => { element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '日' })); element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, isComposing: true, bubbles: true })); });
  await expect(input).toBeFocused();
  await input.evaluate(element => element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '日' })));
  await input.evaluate(element => (element as HTMLTextAreaElement).setSelectionRange(1, 1));
  await input.pressSequentially('**new** ');
  expect(await input.evaluate(element => (element as HTMLTextAreaElement).selectionStart)).toBe(9);
  await notes.getByRole('button', { name: 'Cancel notes edit', exact: true }).click();
  expect(await exportSource(page)).toBe(planner(original));
});
