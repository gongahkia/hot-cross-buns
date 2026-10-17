import { expect, test } from '@playwright/test';

async function selectText(page: import('@playwright/test').Page, start: number, end: number) {
  await page.getByRole('textbox', { name: 'Scratchpad text' }).evaluate((element, range) => {
    const editor = element as HTMLTextAreaElement;
    editor.focus();
    editor.setSelectionRange(range.start, range.end);
    editor.dispatchEvent(new Event('select', { bubbles: true }));
  }, { start, end });
}

test('moves selected plain text into a dated item and undo restores both sides', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Scratchpad' }).click();
  const editor = page.getByRole('textbox', { name: 'Scratchpad text' });
  await expect(editor).toBeEditable();
  await editor.fill('Keep this\nMeeting idea\nAsk Pat');
  await selectText(page, 10, 30);
  await page.getByRole('button', { name: 'Move to dated' }).click();
  await page.getByRole('button', { name: 'Create item' }).click();
  await expect(editor).toHaveValue('Keep this\n');
  await page.getByRole('button', { name: 'Dated' }).click();
  await expect(page.getByRole('group', { name: 'Meeting idea' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Edit detail Ask Pat' })).toBeVisible();
  await page.getByRole('button', { name: 'Download TODO.txt' }).click();
  await expect(page.getByLabel('TODO.txt preview')).not.toContainText('Keep this');
  await page.getByRole('button', { name: 'cancel' }).click();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByRole('group', { name: 'Meeting idea' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Scratchpad' }).click();
  await expect(page.getByRole('textbox', { name: 'Scratchpad text' })).toHaveValue('Keep this\nMeeting idea\nAsk Pat');
});

test('settings can copy one selected line into an undated list', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Shio Pan settings' }).click();
  const settings = page.getByRole('dialog', { name: 'Shio Pan settings' });
  await settings.getByLabel('Selected lines become').selectOption('items');
  await settings.getByLabel('After creating an item').selectOption('ask');
  await settings.getByRole('button', { name: 'close' }).click();
  await page.getByRole('button', { name: 'Scratchpad' }).click();
  const editor = page.getByRole('textbox', { name: 'Scratchpad text' });
  await editor.fill('Alpha\nBeta');
  await selectText(page, 0, 10);
  await page.getByRole('button', { name: 'Move to undated' }).click();
  const dialog = page.getByRole('dialog', { name: 'Move text to an undated list' });
  await dialog.getByLabel('New destination list').fill('Ideas');
  await dialog.getByLabel('Keep source text').selectOption('copy');
  await dialog.getByRole('button', { name: 'Create item' }).click();
  await expect(editor).toHaveValue('Alpha\nBeta');
  await page.getByRole('button', { name: 'Undated' }).click();
  await expect(page.getByRole('textbox', { name: 'Edit Alpha' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Edit Beta' })).toBeVisible();
});

test('dated popout edits synchronize with the main window', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open view in browser window' }).click();
  const chooser = page.getByRole('dialog', { name: 'Open dated window' });
  await chooser.getByLabel('Popout start date').fill('2026-10-17');
  await chooser.getByLabel('Popout end date').fill('2026-10-17');
  const popupEvent = page.waitForEvent('popup');
  await chooser.getByRole('button', { name: 'Open window' }).click();
  const popup = await popupEvent;
  await popup.waitForLoadState();
  const add = popup.getByRole('textbox', { name: 'New daily item' });
  await add.fill('Written in popout');
  await add.press('Enter');
  await expect(popup.getByRole('group', { name: 'Written in popout' })).toBeVisible();
  await page.getByRole('button', { name: 'Open search' }).click();
  await page.getByRole('searchbox', { name: 'Search journal' }).fill('Written in popout');
  await expect(page.getByRole('group', { name: 'Written in popout' })).toBeVisible();
  await popup.close();
});

test('scratchpad popout takes over editing and updates the main view', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Scratchpad' }).click();
  await expect(page.getByRole('textbox', { name: 'Scratchpad text' })).toBeEditable();
  const popupEvent = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Open view in browser window' }).click();
  const popup = await popupEvent;
  await popup.waitForLoadState();
  await expect(popup.getByRole('textbox', { name: 'Scratchpad text' })).toHaveAttribute('readonly');
  await popup.getByRole('button', { name: 'Take over editing' }).click();
  await expect(popup.getByRole('textbox', { name: 'Scratchpad text' })).toBeEditable();
  await expect(page.getByRole('textbox', { name: 'Scratchpad text' })).toHaveAttribute('readonly');
  await popup.getByRole('textbox', { name: 'Scratchpad text' }).fill('Shared scratch');
  await expect(page.getByRole('textbox', { name: 'Scratchpad text' })).toHaveValue('Shared scratch');
  await popup.close();
});
