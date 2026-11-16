import { plannerFixture } from './planner-fixture';
import { expect, test, type Page } from '@playwright/test';
import { openCommands, runCommand, selectSearchResult } from './commands';

async function importText(page: Page, raw: string) {
  await page.goto('/');
  await page.getByLabel('Import a Planner.md file').setInputFiles({ name: 'Planner.md', mimeType: 'text/plain', buffer: Buffer.from(plannerFixture(raw)) });
  await expect(page.getByRole('status').filter({ hasText: 'Planner.md imported.' })).toBeVisible();
}
const input = (page: Page) => page.getByRole('combobox', { name: 'Search commands and journal', exact: true });
const results = (page: Page) => page.getByRole('group', { name: 'Dated entries', exact: true });

test('typing in the default palette searches entries alongside commands without an inline search bar', async ({ page }) => {
  await importText(page, plannerFixture('2000-01-01\n\nSettings for the garden\n- [ ] Bring a spade\n'));
  const datesBefore = await page.locator('[data-journal-date]').evaluateAll(elements => elements.map(element => element.getAttribute('data-journal-date')));
  const palette = await openCommands(page);
  await input(page).fill('settings');
  expect(await page.locator('[data-journal-date]').evaluateAll(elements => elements.map(element => element.getAttribute('data-journal-date')))).toEqual(datesBefore);
  await expect(palette.getByRole('option', { name: 'Settings', exact: true })).toBeVisible();
  await expect(results(page).getByRole('option')).toContainText('Settings for the garden');
  await expect(page.locator('header input, #journal-search, #journal-search-panel')).toHaveCount(0);
  await expect(page.locator('main > nav[aria-label="Tags"]')).toHaveCount(0);
  await selectSearchResult(page, 'Settings for the garden');
  await expect(page.getByRole('textbox', { name: 'Edit Settings for the garden', exact: true })).toBeFocused();
  await expect(page.getByRole('region', { name: 'Dated journal', exact: true }).locator('[data-journal-date]')).toHaveCount(1);
  await expect(page.locator('[data-journal-date]')).toHaveAttribute('data-journal-date', '2000-01-01');
});

test('a completed result opens its collapsed section and focuses the entry', async ({ page }) => {
  await importText(page, plannerFixture('2000-01-01\nArchived win\n- [x] Searchable context\n\nStill open\n'));
  await runCommand(page, 'Open search');
  await input(page).fill('searchable context');
  await page.getByRole('button', { name: 'Done items', exact: true }).click();
  await expect(results(page).getByRole('option')).toContainText('2000-01-01 · Done');
  await input(page).press('Enter');
  await expect(page.getByRole('textbox', { name: 'Edit Archived win', exact: true })).toBeFocused();
  await expect(page.getByRole('button', { name: 'Collapse done items for 2000-01-01', exact: true })).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('textbox', { name: 'Edit detail Searchable context', exact: true })).toBeVisible();
  await expect(page.locator('header input')).toHaveCount(0);
});

test('long result lists stay bounded, report their total, and can be refined before navigation', async ({ page }) => {
  const titles = Array.from({ length: 80 }, (_, index) => 'Entry ' + String(index).padStart(3, '0'));
  const today = new Date().toLocaleDateString('en-CA');
  await importText(page, plannerFixture(`${today}\n${titles.join('\n')}\n\n`));
  await runCommand(page, 'Open search');
  await expect(results(page).getByRole('option')).toHaveCount(50);
  await expect(results(page)).toContainText('80 entries · showing first 50');
  await input(page).fill('Entry 079');
  await expect(results(page).getByRole('option')).toHaveCount(1);
  await input(page).press('Enter');
  await expect(page.getByRole('textbox', { name: 'Edit Entry 079', exact: true })).toBeFocused();
  await expect(page.getByRole('textbox', { name: 'Edit Entry 079', exact: true })).toBeInViewport();
});

test('Ctrl F selects the current palette query, and closing clears every search filter', async ({ page }) => {
  await importText(page, plannerFixture('2000-01-01\nDone #work\n\nOpen #home\n'));
  await openCommands(page); await input(page).fill('#work');
  await page.keyboard.press('Control+f');
  await expect(page.getByRole('button', { name: 'Back to commands', exact: true })).toBeVisible();
  await expect.poll(() => input(page).evaluate(element => {
    const field = element as HTMLInputElement;
    return [field.selectionStart, field.selectionEnd];
  })).toEqual([0, 5]);
  await page.getByRole('button', { name: '#work', exact: true }).click();
  await page.getByRole('button', { name: 'Done items', exact: true }).click();
  await input(page).press('Escape');
  await expect(page.getByRole('dialog', { name: 'Command palette', exact: true })).toBeHidden();
  await runCommand(page, 'Open search');
  await expect(input(page)).toHaveValue('');
  await expect(page.getByRole('button', { name: 'All tags', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'All statuses', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(results(page).getByRole('option')).toHaveCount(2);
});

test('search results refresh after edits in another window without losing the query', async ({ page, context }) => {
  await page.goto('/');
  await runCommand(page, 'Open search');
  await input(page).fill('New shared entry');
  await expect(results(page).getByRole('option')).toHaveCount(0);
  const other = await context.newPage(); await other.goto('/');
  await other.getByRole('textbox', { name: 'New daily item', exact: true }).fill('New shared entry');
  await other.getByRole('textbox', { name: 'New daily item', exact: true }).press('Enter');
  await expect(results(page).getByRole('option')).toHaveCount(1);
  await expect(input(page)).toHaveValue('New shared entry');
});

test('filters and results can scroll while the input and close control fit a short viewport', async ({ page }) => {
  await importText(page, plannerFixture('2000-01-01\n\nTagged entry #one #two #three #four #five #six #seven #eight\n'));
  await page.setViewportSize({ width: 320, height: 700 });
  await runCommand(page, 'Open search');
  await page.setViewportSize({ width: 320, height: 220 });
  await expect(input(page)).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole('button', { name: 'Close command palette', exact: true })).toBeInViewport({ ratio: 1 });
  await input(page).fill('Tagged entry');
  await input(page).press('Enter');
  await expect(page.getByRole('textbox', { name: 'Edit Tagged entry #one #two #three #four #five #six #seven #eight', exact: true })).toBeFocused();
});
