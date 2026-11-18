import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { runCommand } from './commands';

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const source = () => `---\nhcb-format: 3\ndocument-id: unified-browser\n---\n\n[shared]: https://example.com\n\n## Dated\n\n### ${today()}\n\nDaily **writing** with [context][shared].\n\n- Plain outline\n  \`\`\`hcb\n  id: plain-outline\n  \`\`\`\n  - [ ] Nested action\n\n  > Attached **context** stays visible.\n\n## Undated\n\n### Inbox\n\nPersistent **writing**.\n\n- [ ] Undated action\n  \`\`\`hcb\n  id: undated-action\n  \`\`\`\n  - Plain context\n    - [ ] Undated child\n\n## Scratchpad\nShared capture.\n`;
async function load(page: Page) {
  await page.goto('/');
  await page.getByLabel('Import a Planner.md file').setInputFiles({ name: 'Planner.md', mimeType: 'text/markdown', buffer: Buffer.from(source()) });
  return page.getByRole('region', { name: `Document for ${today()}`, exact: true });
}
async function download(page: Page) {
  await runCommand(page, 'Download Planner.md');
  const pending = page.waitForEvent('download');
  await page.getByRole('dialog', { name: 'Download Planner.md', exact: true }).getByRole('button', { name: 'download', exact: true }).click();
  return readFile((await (await pending).path())!, 'utf8');
}

test('dates and undated documents render writing directly and preserve attached content without Notes containers', async ({ page }) => {
  const day = await load(page);
  await expect(day.locator('strong').filter({ hasText: 'writing' })).toBeVisible();
  await expect(day.getByRole('link', { name: 'context', exact: true })).toHaveAttribute('href', 'https://example.com');
  await expect(day.locator('blockquote')).toContainText('Attached context stays visible.');
  await expect(day.getByText('id: plain-outline', { exact: true })).toHaveCount(0);
  await expect(day.getByText('Notes', { exact: true })).toHaveCount(0);
  await day.getByRole('button', { name: `Edit block 1 in ${today()}`, exact: true }).click();
  await day.getByRole('textbox', { name: `Markdown for ${today()}`, exact: true }).fill('Daily **updated writing** with [context][shared].');
  await day.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(day.locator('strong').filter({ hasText: 'updated writing' })).toBeVisible();
  await page.getByRole('button', { name: 'Undated', exact: true }).click();
  const inbox = page.getByRole('region', { name: 'Document for Inbox', exact: true });
  await expect(inbox.locator('strong')).toHaveText('writing');
  await inbox.getByRole('button', { name: 'Edit block 1 in Inbox', exact: true }).click();
  await inbox.getByRole('textbox', { name: 'Markdown for Inbox', exact: true }).fill('Persistent **updated writing**.');
  await inbox.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(inbox.locator('strong')).toHaveText('updated writing');
  expect(await download(page)).toBe(source().replace('Daily **writing**', 'Daily **updated writing**').replace('Persistent **writing**', 'Persistent **updated writing**'));
});

test('task completion works inside plain dated outlines and undated task outlines', async ({ page }) => {
  const day = await load(page);
  await day.getByRole('checkbox', { name: 'Complete Nested action', exact: true }).click();
  await expect(day.getByRole('checkbox', { name: 'Reopen Nested action', exact: true })).toBeChecked();
  await page.getByRole('button', { name: 'Undated', exact: true }).click();
  const inbox = page.getByRole('region', { name: 'Document for Inbox', exact: true });
  await inbox.getByRole('checkbox', { name: 'Complete Undated child', exact: true }).click();
  await expect(inbox.getByRole('checkbox', { name: 'Reopen Undated action', exact: true })).toBeChecked();
  const exported = await download(page);
  expect(exported).toBe(source().replace('[ ] Nested action', '[x] Nested action').replace('[ ] Undated action', '[x] Undated action').replace('[ ] Undated child', '[x] Undated child'));
});

test('new writing can be a paragraph, table or mixed outline without a task wrapper', async ({ page }) => {
  const day = await load(page);
  await day.getByRole('button', { name: 'Add writing', exact: true }).click();
  const field = day.getByRole('textbox', { name: `Markdown for ${today()}`, exact: true });
  await field.fill('## Meeting\n\nA **direct paragraph**.\n\n| Person | Action |\n| --- | --- |\n| Sam | Review |\n\n- Context\n  - [ ] Follow up\n\n1. [ ] Ordered followup');
  await day.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(day.getByRole('heading', { name: 'Meeting', exact: true })).toBeVisible();
  await expect(day.getByRole('cell', { name: 'Sam', exact: true })).toBeVisible();
  await expect(day.getByRole('checkbox', { name: 'Complete Follow up', exact: true })).toBeVisible();
  await expect(field).toHaveCount(0);
  await day.getByRole('checkbox', { name: 'Complete Ordered followup', exact: true }).click();
  await expect(day.getByRole('checkbox', { name: 'Reopen Ordered followup', exact: true })).toBeChecked();
  const exported = await download(page);
  expect(exported).toContain('## Meeting\n\nA **direct paragraph**.\n\n| Person | Action |');
  expect(exported).toContain('1. [x] Ordered followup');
});

test('direct writing retains invalid drafts across reload and keeps native input undo', async ({ page }) => {
  const day = await load(page);
  await day.getByRole('button', { name: `Edit block 1 in ${today()}`, exact: true }).click();
  const field = day.getByRole('textbox', { name: `Markdown for ${today()}`, exact: true });
  await field.fill('Recoverable draft');
  await field.press('End'); await field.press('x');
  await expect(field).toHaveValue('Recoverable draftx');
  await field.press('ControlOrMeta+z');
  await expect(field).toHaveValue('Recoverable draft');
  await field.fill('~~~js\nUnfinished fence');
  await day.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(day.getByRole('status')).toContainText('invalid planner content');
  await expect(field).toHaveValue('~~~js\nUnfinished fence');
  await page.reload();
  await expect(field).toHaveValue('~~~js\nUnfinished fence');
  await field.fill('Recovered **writing**.');
  await day.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(field).toHaveCount(0);
  expect(await download(page)).toBe(source().replace('Daily **writing** with [context][shared].', 'Recovered **writing**.'));
});

test('legacy writing upgrades are previewable, downloadable and undoable without changing content', async ({ page }) => {
  const original = source().replace('hcb-format: 3', 'hcb-format: 2').replace('- [ ] Undated action', '- Undated action').replace('- [ ] Undated child', '- Undated child');
  await page.goto('/');
  await page.getByLabel('Import a Planner.md file').setInputFiles({ name: 'Planner.md', mimeType: 'text/markdown', buffer: Buffer.from(original) });
  await page.getByRole('button', { name: 'Enable unified writing', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Enable unified writing', exact: true });
  await expect(dialog.getByLabel('Unified writing upgrade preview')).toHaveText(original.replace('hcb-format: 2', 'hcb-format: 3'));
  const pending = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download original', exact: true }).click();
  expect(await readFile((await (await pending).path())!, 'utf8')).toBe(original);
  await dialog.getByRole('button', { name: 'Enable unified writing', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('region', { name: `Document for ${today()}`, exact: true }).getByText('Plain outline', { exact: true })).toBeVisible();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.getByRole('button', { name: 'Enable unified writing', exact: true })).toBeVisible();
  expect(await download(page)).toBe(original);
});

test('the shared document surface fits a phone and supports dark appearance and rich content', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const day = await load(page);
  await day.getByRole('button', { name: 'Add writing', exact: true }).click();
  await day.getByRole('textbox', { name: `Markdown for ${today()}`, exact: true }).fill('> [!note] Context\n> A **useful** note.\n\nFormula $$\\frac{1}{2} + x_i$$.');
  await day.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(day.getByRole('math')).toBeVisible();
  await expect(day.locator('[data-callout=note]')).toContainText('A useful note.');
  await runCommand(page, 'Settings');
  await page.getByRole('button', { name: 'Dark mode', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Hot Cross Buns settings', exact: true })).not.toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'night');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(day.getByRole('checkbox', { name: 'Complete Nested action', exact: true })).toBeVisible();
});
