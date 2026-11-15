import { runCommand } from './commands';
import { expect, test, type Page } from '@playwright/test';

async function setup(page: Page) {
  const today = new Date().toLocaleDateString('en-CA');
  await page.goto('/');
  const raw = `2000-01-01\nArchive done #work\n\nOld open #work\n- [ ] Needle in a detail\n\n${today}\nToday done #home\n\nToday open #home\n\nUNDATED\n\nLIST: Inbox\nRead later #work\n`;
  await page.getByLabel('Import a TODO.txt file').setInputFiles({ name: 'TODO.txt', mimeType: 'text/plain', buffer: Buffer.from(raw) });
  await expect(page.getByRole('status').filter({ hasText: 'TODO.txt imported.' })).toBeVisible();
  await runCommand(page, 'Open search');
}

test('completion search covers older dates and combines text, detail and hashtag filters', async ({ page }) => {
  await setup(page);
  const controls = page.getByRole('group', { name: 'Search completion', exact: true });
  await expect(page.getByRole('group', { name: 'Archive done #work', exact: true })).toBeVisible();
  await controls.getByRole('button', { name: 'Open items', exact: true }).click();
  await expect(page.getByRole('group', { name: 'Archive done #work', exact: true })).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'Old open #work', exact: true })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Today open #home', exact: true })).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search journal' }).fill('needle');
  await page.getByRole('button', { name: '#work', exact: true }).click();
  await expect(page.getByRole('group', { name: 'Old open #work', exact: true })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Today open #home', exact: true })).toHaveCount(0);
  await controls.getByRole('button', { name: 'Done items', exact: true }).click();
  await expect(page.getByText('No lines match this search', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Clear search', exact: true }).click();
  await expect(controls.getByRole('button', { name: 'Done items', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('group', { name: 'Archive done #work', exact: true })).toBeVisible();
});

test('closing search resets the status and leaves normal completion visibility intact', async ({ page }) => {
  await setup(page);
  await page.getByRole('button', { name: 'Done items', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Search journal' }).press('Escape');
  await expect(page.getByRole('group', { name: 'Search completion', exact: true })).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'Today done #home', exact: true })).toBeHidden();
  await runCommand(page, 'Open search');
  await expect(page.getByRole('button', { name: 'All statuses', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Done items', exact: true }).click();
  await runCommand(page, 'Close search');
  await runCommand(page, 'Open search');
  await expect(page.getByRole('button', { name: 'All statuses', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('dated completion filters do not hide undated items', async ({ page }) => {
  await setup(page);
  await page.getByRole('button', { name: 'Done items', exact: true }).click();
  await page.getByRole('button', { name: 'Undated', exact: true }).click();
  await expect(page.getByRole('group', { name: 'Search completion', exact: true })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Edit Read later #work', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Dated', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Done items', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('search filters work by keyboard and fit a narrow phone', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await setup(page);
  const open = page.getByRole('button', { name: 'Open items', exact: true });
  await open.focus(); await page.keyboard.press('Enter');
  await expect(open).toHaveAttribute('aria-pressed', 'true');
  await expect(open).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByRole('group', { name: 'Old open #work', exact: true })).toBeVisible();
});

test('filtered completion can be undone and export keeps entries outside the filter', async ({ page }) => {
  await setup(page);
  await page.getByRole('button', { name: 'Open items', exact: true }).click();
  await page.getByRole('button', { name: 'Complete Old open #work', exact: true }).click();
  await expect(page.getByRole('group', { name: 'Old open #work', exact: true })).toHaveCount(0);
  await page.keyboard.press('Control+z');
  await expect(page.getByRole('group', { name: 'Old open #work', exact: true })).toBeVisible();
  await runCommand(page, 'Download TODO.txt');
  const preview = page.getByLabel('TODO.txt preview');
  for (const text of ['Archive done #work', 'Today done #home', 'Old open #work', 'Read later #work']) {
    await expect(preview).toContainText(text);
  }
});
