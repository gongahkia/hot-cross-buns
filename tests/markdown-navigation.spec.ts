import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { parseJournal } from '../src/journalDocument';
import { runCommand } from './commands';

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const source = () => `---\nhcb-format: 2\ndocument-id: navigation-browser\n---\n\n# Overview\n\nAn ordinary **document passage**.\n\n## Dated\n\n### ${today()}\n\n- [ ] Source\n  \`\`\`hcb\n  id: source\n  \`\`\`\n\n  Read [Target](#hcb-target), [details](#heading-details), or [overview](#heading-overview).\n\n## Undated\n\n### Inbox\n\n- Target\n  \`\`\`hcb\n  id: target\n  \`\`\`\n\n  #### Details\n\n  Target **context**.\n\n- Missing identity\n\n## Scratchpad\nCapture.\n`;
async function load(page: Page) {
  await page.goto('/');
  await page.getByLabel('Import a Planner.md file').setInputFiles({ name: 'Planner.md', mimeType: 'text/markdown', buffer: Buffer.from(source()) });
  const notes = page.getByRole('group', { name: 'Outline for Source', exact: true }).locator('details').first();
  await notes.locator('summary').click();
  return notes;
}
async function download(page: Page) {
  await runCommand(page, 'Download Planner.md'); const pending = page.waitForEvent('download');
  await page.getByRole('dialog', { name: 'Download Planner.md', exact: true }).getByRole('button', { name: 'download', exact: true }).click();
  return readFile((await (await pending).path())!, 'utf8');
}

test('entry links cross views and collapsed backlinks return to the referring passage', async ({ page }) => {
  const notes = await load(page);
  await notes.getByRole('link', { name: 'Target', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Edit Target', exact: true })).toBeFocused();
  const outline = page.getByRole('group', { name: 'Outline for Target', exact: true });
  await outline.getByText('Linked mentions (2)', { exact: true }).click();
  await outline.getByRole('button', { name: `Source · ${today()}`, exact: true }).first().click();
  await expect(notes.getByRole('link', { name: 'Target', exact: true })).toBeVisible();
  await expect(notes.locator('[data-markdown-start]').first()).toBeFocused();
});

test('heading links reveal notes, work after reload and root headings open editable prose', async ({ page }) => {
  const notes = await load(page);
  await notes.getByRole('link', { name: 'details', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Details', exact: true })).toBeFocused();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Details', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Dated', exact: true }).click();
  await notes.locator('summary').first().click();
  await notes.getByRole('link', { name: 'overview', exact: true }).click();
  const passage = page.getByRole('dialog', { name: 'Overview', exact: true });
  await expect(passage.locator('strong')).toHaveText('document passage');
  await passage.getByRole('button', { name: 'Edit block 2 in Overview', exact: true }).click();
  await passage.getByRole('textbox', { name: 'Markdown notes for Overview', exact: true }).fill('Revised **prose**.');
  await passage.getByRole('button', { name: 'Save notes', exact: true }).click();
  await expect(passage.getByRole('textbox', { name: 'Markdown notes for Overview', exact: true })).toHaveCount(0);
  await passage.getByRole('button', { name: 'Close', exact: true }).click();
  expect(await download(page)).toBe(source().replace('An ordinary **document passage**.', 'Revised **prose**.'));
});

test('link suggestions preserve native undo and recover missing target IDs in one journal transaction', async ({ page }) => {
  const notes = await load(page);
  await notes.getByRole('button', { name: 'Edit block 1 in Source', exact: true }).click();
  const input = notes.getByRole('textbox', { name: 'Markdown notes for Source', exact: true });
  const original = await input.inputValue();
  await input.evaluate(element => (element as HTMLTextAreaElement).setSelectionRange(0, 0));
  await input.press('ControlOrMeta+k');
  await notes.getByRole('combobox', { name: 'Find an entry or heading' }).fill('Missing identity');
  await notes.getByRole('option', { name: /Missing identity/ }).click();
  await expect(input).toHaveValue(/^\[Missing identity\]\(#hcb-[a-f0-9-]+\)/);
  await input.press('ControlOrMeta+z');
  await expect(input).toHaveValue(original);
  await input.press('ControlOrMeta+k');
  await notes.getByRole('combobox', { name: 'Find an entry or heading' }).fill('Missing identity');
  await notes.getByRole('combobox', { name: 'Find an entry or heading' }).press('Enter');
  const draft = await input.inputValue();
  await page.reload();
  await expect(input).toHaveValue(draft);
  await notes.getByRole('button', { name: 'Save notes', exact: true }).click();
  await expect(input).toHaveCount(0);
  const saved = await download(page), parsed = parseJournal(saved), target = parsed.document.undated![0].items[1];
  expect(parsed.issues).toEqual([]);
  expect(saved).toContain(`id: ${target.id}`);
  expect(saved).toContain(`(#hcb-${target.id})`);
  await page.keyboard.press('Control+z');
  expect(await download(page)).toBe(source());
});
