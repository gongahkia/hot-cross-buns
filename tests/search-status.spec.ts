import { runCommand, selectSearchResult } from './commands';
import { expect, test, type Page } from '@playwright/test';

async function setup(page: Page) {
  const today = new Date().toLocaleDateString('en-CA');
  await page.goto('/');
  const raw = `2000-01-01\nArchive done #work\n\nOld open #work\n- [ ] Needle in a detail\n\n${today}\nToday done #home\n\nToday open #home\n\nUNDATED\n\nLIST: Inbox\nRead later #work\n`;
  await page.getByLabel('Import a TODO.txt file').setInputFiles({ name: 'TODO.txt', mimeType: 'text/plain', buffer: Buffer.from(raw) });
  await expect(page.getByRole('status').filter({ hasText: 'TODO.txt imported.' })).toBeVisible();
  await runCommand(page, 'Open search');
}
const entries = (page: Page) => page.getByRole('group', { name: 'Dated entries', exact: true });
const entry = (page: Page, title: string) => entries(page).getByRole('option').filter({ has: page.getByText(title, { exact: true }) });

test('palette completion search covers older dates and combines text, detail and hashtag filters', async ({ page }) => {
  await setup(page);
  const controls = page.getByRole('group', { name: 'Search completion', exact: true });
  await expect(entry(page, 'Archive done #work')).toBeVisible();
  await controls.getByRole('button', { name: 'Open items', exact: true }).click();
  await expect(entry(page, 'Archive done #work')).toHaveCount(0);
  await expect(entry(page, 'Old open #work')).toBeVisible();
  await expect(entry(page, 'Today open #home')).toBeVisible();
  await page.getByRole('combobox', { name: 'Search commands and journal' }).fill('needle');
  await page.getByRole('button', { name: '#work', exact: true }).click();
  await expect(entry(page, 'Old open #work')).toBeVisible();
  await expect(entry(page, 'Old open #work')).toContainText('Needle in a detail');
  await expect(entry(page, 'Today open #home')).toHaveCount(0);
  await controls.getByRole('button', { name: 'Done items', exact: true }).click();
  await expect(page.getByText('No matching entries or commands.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Clear search', exact: true }).click();
  await expect(controls.getByRole('button', { name: 'Done items', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(entry(page, 'Archive done #work')).toBeVisible();
});

test('closing the palette resets search and leaves normal completion visibility intact', async ({ page }) => {
  await setup(page);
  await page.getByRole('button', { name: 'Done items', exact: true }).click();
  await page.getByRole('combobox', { name: 'Search commands and journal' }).press('Escape');
  await expect(page.getByRole('dialog', { name: 'Command palette', exact: true })).toBeHidden();
  await expect(page.getByRole('group', { name: 'Search completion', exact: true })).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'Today done #home', exact: true })).toBeHidden();
  await runCommand(page, 'Open search');
  await expect(page.getByRole('button', { name: 'All statuses', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '#work', exact: true }).click();
  await runCommand(page, 'Close search');
  await runCommand(page, 'Open search');
  await expect(page.getByRole('button', { name: 'All tags', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('dated completion filters do not hide undated palette results', async ({ page }) => {
  await setup(page);
  await page.getByRole('button', { name: 'Done items', exact: true }).click();
  await runCommand(page, 'Close search');
  await page.getByRole('button', { name: 'Undated', exact: true }).click();
  await runCommand(page, 'Open search');
  await expect(page.getByRole('group', { name: 'Search completion', exact: true })).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'Undated entries', exact: true }).getByRole('option')).toContainText('Read later #work');
  await selectSearchResult(page, 'Read later #work');
  await expect(page.getByRole('textbox', { name: 'Edit Read later #work', exact: true })).toBeFocused();
});

test('palette search filters work by keyboard and fit a narrow phone', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await setup(page);
  const open = page.getByRole('button', { name: 'Open items', exact: true });
  await open.focus(); await page.keyboard.press('Enter');
  await expect(open).toHaveAttribute('aria-pressed', 'true');
  await expect(open).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(entry(page, 'Old open #work')).toBeVisible();
});

test('a result can be completed and undone, and export keeps entries outside the search', async ({ page }) => {
  await setup(page);
  await page.getByRole('button', { name: 'Open items', exact: true }).click();
  await selectSearchResult(page, 'Old open #work');
  await page.getByRole('button', { name: 'Complete Old open #work', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Expand done items for 2000-01-01', exact: true })).toContainText('2');
  await page.keyboard.press('Control+z');
  await expect(page.getByRole('group', { name: 'Old open #work', exact: true })).toBeVisible();
  await runCommand(page, 'Download TODO.txt');
  const preview = page.getByLabel('TODO.txt preview');
  for (const text of ['Archive done #work', 'Today done #home', 'Old open #work', 'Read later #work']) await expect(preview).toContainText(text);
});
