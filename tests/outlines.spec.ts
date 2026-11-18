import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { parseJournal } from '../src/journalDocument';
import { openCommands, runCommand, selectSearchResult } from './commands';

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const source = (version = 2) => `---\nhcb-format: ${version}\ndocument-id: browser-outlines\n---\n\n## Dated\n\n### ${today()}\n\n- [ ] Project\n  \`\`\`hcb\n  id: project\n  \`\`\`\n  - [ ] First\n    - [ ] Deep #nested\n\n      A **rich** paragraph with [safe link](https://example.com) and [unsafe](javascript:alert(1)).\n\n      <img src=x onerror=alert(1)>\n\n  - [ ] Second\n\n## Undated\n\n### Inbox\n\n- Ideas\n  - Branch\n    - Leaf\n\n      Unscheduled **context**.\n\n## Scratchpad\nShared capture\n`;
async function load(page: Page, version = 2) {
  await page.goto('/');
  await page.getByLabel('Import a Planner.md file').setInputFiles({ name: 'Planner.md', mimeType: 'text/markdown', buffer: Buffer.from(source(version)) });
  await expect(page.getByRole('group', { name: 'Project', exact: true })).toBeVisible();
}
async function download(page: Page) {
  await runCommand(page, 'Download Planner.md');
  const pending = page.waitForEvent('download');
  await page.getByRole('dialog', { name: 'Download Planner.md', exact: true }).getByRole('button', { name: 'download', exact: true }).click();
  const raw = await readFile((await (await pending).path())!, 'utf8');
  await expect(page.getByRole('dialog', { name: 'Download Planner.md', exact: true })).not.toBeVisible();
  return raw;
}
async function action(page: Page, detail: string, label: string) {
  await page.getByRole('button', { name: `More actions for detail ${detail}`, exact: true }).click();
  await page.getByLabel(`Actions for detail ${detail}`, { exact: true }).getByRole('button', { name: label, exact: true }).click();
}

test('legacy outlines require a previewed upgrade and support undo back to their original format', async ({ page }) => {
  await load(page, 1);
  await expect(page.getByRole('textbox', { name: 'Edit detail Deep #nested', exact: true })).toHaveCount(0);
  const palette = await openCommands(page);
  await palette.getByRole('combobox').fill('deeper outlines');
  await palette.getByRole('option', { name: 'Enable deeper outlines', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Enable deeper outlines', exact: true });
  await expect(dialog.getByLabel('Outline upgrade preview')).toContainText('hcb-format: 2');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(await download(page)).toBe(source(1));
  await page.getByRole('button', { name: 'More actions for Project', exact: true }).click();
  await page.getByRole('button', { name: 'enable deeper outlines', exact: true }).click();
  await dialog.getByRole('button', { name: 'Enable deeper outlines', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Edit detail Deep #nested', exact: true })).toBeVisible();
  await page.keyboard.press('Control+z');
  expect(await download(page)).toBe(source(1));
});

test('nested completion, sibling creation, indentation and subtree promotion survive reload and export', async ({ page }) => {
  await load(page);
  await page.getByRole('button', { name: 'Complete detail Deep #nested', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Reopen detail First', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Complete Project', exact: true })).toBeVisible();
  await action(page, 'Deep #nested', 'add subtask');
  const draft = page.getByRole('textbox', { name: 'New outline item for Project', exact: true });
  await draft.fill('New child'); await draft.press('Enter');
  await expect(page.getByRole('button', { name: 'Complete detail Deep #nested', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Edit detail New child', exact: true })).toBeVisible();
  await action(page, 'Second', 'indent');
  let parsed = parseJournal(await download(page));
  expect(parsed.issues).toEqual([]);
  expect(parsed.document.days[0].items[0].details[0].children?.[1].text).toBe('Second');
  await page.reload();
  await action(page, 'Deep #nested', 'Make detail Deep #nested an item');
  await expect(page.getByRole('group', { name: 'Deep #nested', exact: true })).toBeVisible();
  parsed = parseJournal(await download(page));
  const promoted = parsed.document.days[0].items.find(item => item.text === 'Deep #nested');
  expect(promoted?.details[0].text).toBe('New child');
  expect(promoted?.body?.[0].markdown).toContain('A **rich** paragraph');
  await page.keyboard.press('Control+z');
  await expect(page.getByRole('textbox', { name: 'Edit detail Deep #nested', exact: true })).toBeVisible();
});

test('undated outlines keep whole branches during keyboard moves, promotion and undo', async ({ page }) => {
  await load(page);
  await page.getByRole('button', { name: 'Undated', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Edit detail Leaf', exact: true })).toBeVisible();
  await action(page, 'Leaf', 'outdent');
  let parsed = parseJournal(await download(page));
  expect(parsed.document.undated?.[0].items[0].details.map(node => node.text)).toEqual(['Branch', 'Leaf']);
  await page.getByRole('textbox', { name: 'Edit detail Leaf', exact: true }).press('Alt+ArrowRight');
  parsed = parseJournal(await download(page));
  expect(parsed.document.undated?.[0].items[0].details[0].children?.[0].text).toBe('Leaf');
  await action(page, 'Branch', 'Make detail Branch an item');
  await expect(page.getByRole('textbox', { name: 'Edit Branch', exact: true })).toBeVisible();
  parsed = parseJournal(await download(page));
  expect(parsed.document.undated?.[0].items[1].details[0].body?.[0].markdown).toBe('Unscheduled **context**.');
  await page.keyboard.press('Control+z');
  expect((await download(page)).includes('    - Leaf')).toBe(true);
});

test('search includes descendants and body text while body previews keep unsafe content inert', async ({ page }) => {
  await load(page);
  await runCommand(page, 'Open search');
  const palette = page.getByRole('dialog', { name: 'Command palette', exact: true });
  await palette.getByRole('combobox').fill('rich');
  await expect(palette.getByRole('option', { name: /Project/ })).toBeVisible();
  await selectSearchResult(page, 'Project');
  const body = page.getByRole('group', { name: 'Outline for Project', exact: true }).locator('details').first();
  await body.locator('summary').click();
  await expect(body.locator('strong')).toHaveText('rich');
  await expect(body.locator('a')).toHaveCount(1);
  await expect(body.locator('img')).toHaveCount(0);
  await expect(body).toContainText('<img src=x onerror=alert(1)>');
  await body.getByRole('button', { name: 'Edit notes', exact: true }).click();
  await page.getByRole('textbox', { name: 'Markdown notes for Deep #nested', exact: true }).fill('Revised **body**.');
  await body.getByRole('button', { name: 'Save notes', exact: true }).click();
  await expect(body.locator('strong')).toHaveText('body');
  const exported = await download(page);
  expect(exported).toContain('Revised **body**.');
  expect(exported).not.toContain('unsafe');
});

test('deep outline controls and menus fit a phone viewport', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await load(page);
  await action(page, 'Deep #nested', 'add nested note');
  const draft = page.getByRole('textbox', { name: 'New outline item for Project', exact: true });
  await draft.fill('Phone note'); await draft.press('Enter');
  await expect(page.getByRole('textbox', { name: 'Edit detail Phone note', exact: true })).toBeVisible();
  for (const name of ['Edit Project', 'Edit detail Deep #nested', 'Edit detail Phone note']) {
    const box = await page.getByRole('textbox', { name, exact: true }).boundingBox();
    expect(box!.width).toBeGreaterThan(100); expect(box!.height).toBeLessThan(120);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'More actions for detail Phone note', exact: true }).click();
  const rect = await page.getByLabel('Actions for detail Phone note', { exact: true }).boundingBox();
  expect(rect!.x).toBeGreaterThanOrEqual(0); expect(rect!.x + rect!.width).toBeLessThanOrEqual(375);
  expect(rect!.y).toBeGreaterThanOrEqual(0); expect(rect!.y + rect!.height).toBeLessThanOrEqual(812);
});

test('invalid new body drafts remain editable and recover across reload without changing the journal', async ({ page }) => {
  await load(page);
  await page.getByRole('button', { name: 'More actions for Project', exact: true }).click();
  await page.getByRole('button', { name: 'edit notes', exact: true }).click();
  const draft = page.getByRole('textbox', { name: 'Markdown notes for Project', exact: true });
  const invalid = '```hcb\nunknown: keep this draft\n```';
  await draft.fill(invalid);
  await page.getByRole('button', { name: 'Save notes', exact: true }).click();
  await expect(draft).toHaveValue(invalid);
  await page.reload();
  await expect(draft).toHaveValue(invalid);
  await expect(page.getByText('A previous notes draft was recovered. Review it before saving.', { exact: true })).toBeVisible();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download notes draft', exact: true }).click();
  expect(await readFile((await (await pending).path())!, 'utf8')).toBe(invalid);
  await page.getByRole('button', { name: 'Cancel notes edit', exact: true }).click();
  expect(await download(page)).toBe(source());
});

test('notes changed in another window leave the old body draft recoverable instead of overwriting newer source', async ({ page, context }) => {
  await load(page);
  const body = page.getByRole('group', { name: 'Outline for Project', exact: true }).locator('details').first();
  await body.locator('summary').click();
  await body.getByRole('button', { name: 'Edit notes', exact: true }).click();
  const draft = page.getByRole('textbox', { name: 'Markdown notes for Deep #nested', exact: true });
  await draft.fill('Unsubmitted local notes.');
  const other = await context.newPage();
  await other.goto('/');
  const palette = await openCommands(other);
  await palette.getByRole('combobox').fill('source');
  await palette.getByRole('option', { name: 'Edit Markdown source', exact: true }).click();
  const editor = other.getByRole('textbox', { name: 'Markdown source', exact: true });
  await editor.fill((await editor.inputValue()).replace('A **rich** paragraph', 'Remote body paragraph'));
  await other.getByRole('button', { name: 'Save Markdown', exact: true }).click();
  await expect.poll(() => page.evaluate(() => new Promise<string>(resolve => {
    const open = indexedDB.open('hot-cross-buns-v1');
    open.onsuccess = () => { const db = open.result, request = db.transaction('state').objectStore('state').get('current'); request.onsuccess = () => { resolve(request.result.document.source); db.close(); }; };
  }))).toContain('Remote body paragraph');
  await page.bringToFront();
  await body.getByRole('button', { name: 'Save notes', exact: true }).click();
  await expect(body.getByRole('status')).toContainText('changed while this draft was open');
  await expect(draft).toHaveValue('Unsubmitted local notes.');
  await body.getByRole('button', { name: 'Cancel notes edit', exact: true }).click();
  expect(await download(page)).toContain('Remote body paragraph');
});
