import type { Page } from '@playwright/test';

export async function openCommands(page: Page) {
  await page.getByRole('button', { name: 'Open command palette', exact: true }).click();
  return page.getByRole('dialog', { name: 'Command palette', exact: true });
}

export async function runCommand(page: Page, name: string) {
  const label = name === 'Open search' ? 'Search journal' : name === 'Hot Cross Buns settings' ? 'Settings' : name;
  const palette = await openCommands(page);
  await palette.getByRole('option', { name: label, exact: true }).click();
}
