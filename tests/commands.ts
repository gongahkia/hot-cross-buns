import type { Page } from '@playwright/test';

export async function openCommands(page: Page) {
  const palette = page.getByRole('dialog', { name: 'Command palette', exact: true });
  if (!(await palette.isVisible())) await page.getByRole('button', { name: 'Open command palette', exact: true }).click();
  return palette;
}

export async function runCommand(page: Page, name: string) {
  const palette = await openCommands(page);
  if (name === 'Close search') { await palette.press('Escape'); await palette.waitFor({ state: 'hidden' }); return; }
  const back = palette.getByRole('button', { name: 'Back to commands', exact: true });
  if (await back.isVisible()) await back.click();
  await palette.getByRole('combobox', { name: 'Search commands and journal', exact: true }).fill('');
  const label = name === 'Open search' ? 'Search journal' : name === 'Hot Cross Buns settings' ? 'Settings' : name;
  await palette.getByRole('option', { name: label, exact: true }).click();
}

export async function selectSearchResult(page: Page, title: string) {
  const palette = page.getByRole('dialog', { name: 'Command palette', exact: true });
  await palette.getByRole('option').filter({ has: page.locator('strong', { hasText: title }) }).first().click();
  await palette.waitFor({ state: 'hidden' });
}
