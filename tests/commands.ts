import type { Page } from '@playwright/test';

export async function openCommands(page: Page) {
  await closeScratchpad(page);
  const palette = page.getByRole('dialog', { name: 'Command palette', exact: true });
  if (!(await palette.isVisible())) await page.getByRole('button', { name: 'Open command palette', exact: true }).click();
  return palette;
}

export async function closeScratchpad(page: Page) {
  const dialog = page.getByRole('dialog', { name: 'Scratchpad', exact: true });
  if (await dialog.isVisible()) {
    await dialog.getByRole('button', { name: 'Close Scratchpad', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
  }
}

/** exercise capture in this page through the real popup-blocked fallback. */
export async function openScratchpad(page: Page) {
  const original = await page.evaluateHandle(() => window.open);
  await page.evaluate(() => { window.open = () => null; });
  try { await runCommand(page, 'Open Scratchpad'); }
  finally { await page.evaluate(open => { window.open = open; }, original); await original.dispose(); }
  await page.getByRole('dialog', { name: 'Scratchpad', exact: true }).waitFor();
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

export async function openHistory(page: Page, query = 'history') {
  const palette = await openCommands(page);
  await palette.getByRole('combobox').fill(query);
  await palette.getByRole('option', { name: 'History and recovery', exact: true }).click();
  return page.getByRole('dialog', { name: 'History and recovery', exact: true });
}
