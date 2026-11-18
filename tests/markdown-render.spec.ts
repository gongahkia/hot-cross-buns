import { expect, test, type Page } from '@playwright/test';

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
