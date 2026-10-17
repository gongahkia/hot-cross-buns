import { expect, test } from '@playwright/test';

async function selectText(page: import('@playwright/test').Page, start: number, end: number) {
  await page.getByRole('textbox', { name: 'Scratchpad text' }).evaluate((element, range) => {
    const editor = element as HTMLTextAreaElement;
    editor.focus();
    editor.setSelectionRange(range.start, range.end);
    editor.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Shift' }));
  }, { start, end });
}

async function openSelectionMenu(page: import('@playwright/test').Page, start: number, end: number) {
  await selectText(page, start, end);
  await page.getByRole('textbox', { name: 'Scratchpad text' }).dispatchEvent('contextmenu', { button: 2, clientX: 120, clientY: 160 });
  await expect(page.getByRole('menu', { name: 'Scratchpad selection actions' })).toBeVisible();
}

test('scratchpad starts ready to type and right click can copy selected text', async ({ page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  const tab = page.getByRole('button', { name: 'Scratchpad', exact: true });
  await tab.click();
  await expect(tab.locator('svg')).toHaveCount(0);
  const editor = page.getByRole('textbox', { name: 'Scratchpad text' });
  await expect(editor).toBeFocused();
  await expect(page.getByRole('button', { name: 'Move to dated' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Move to undated' })).toHaveCount(0);
  await expect(page.getByText(/\d+ characters/)).toHaveCount(0);
  await editor.fill('Copy this line');
  await selectText(page, 0, 9);
  await editor.click({ button: 'right', position: { x: 35, y: 15 } });
  const menu = page.getByRole('menu', { name: 'Scratchpad selection actions' });
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitem', { name: 'Copy selection' }).click();
  await expect(menu).toHaveCount(0);
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('Copy this');
  await expect(editor).toHaveValue('Copy this line');
});

test('moves selected plain text into a dated item and undo restores both sides', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Scratchpad' }).click();
  const editor = page.getByRole('textbox', { name: 'Scratchpad text' });
  await expect(editor).toBeEditable();
  await editor.fill('Keep this\nMeeting idea\nAsk Pat');
  await openSelectionMenu(page, 10, 30);
  await page.getByRole('menuitem', { name: 'Move to dated' }).click();
  await page.getByRole('button', { name: 'Create item' }).click();
  await expect(editor).toHaveValue('Keep this\n');
  await expect(page.getByRole('status', { name: 'Scratchpad conversion confirmation' })).toContainText('Added scratchpad text to journal');
  await expect(page.getByText('Scratchpad text became journal items.')).toHaveCount(0);
  await page.getByRole('button', { name: 'Dated', exact: true }).click();
  await expect(page.getByRole('group', { name: 'Meeting idea' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Edit detail Ask Pat' })).toBeVisible();
  await page.getByRole('button', { name: 'Download TODO.txt' }).click();
  await expect(page.getByLabel('TODO.txt preview')).not.toContainText('Keep this');
  await page.getByRole('button', { name: 'cancel' }).click();
  await page.getByRole('button', { name: 'Undo scratchpad conversion' }).click();
  await expect(page.getByRole('group', { name: 'Meeting idea' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Scratchpad', exact: true }).click();
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
  await openSelectionMenu(page, 0, 10);
  await page.getByRole('menuitem', { name: 'Move to undated' }).click();
  const dialog = page.getByRole('dialog', { name: 'Move text to an undated list' });
  await dialog.getByLabel('New destination list').fill('Ideas');
  await dialog.getByLabel('Keep source text').selectOption('copy');
  await dialog.getByRole('button', { name: 'Create item' }).click();
  await expect(editor).toHaveValue('Alpha\nBeta');
  await page.getByRole('button', { name: 'Undated', exact: true }).click();
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
  await expect(popup.getByText('Shio Pan · Dated')).toHaveCount(0);
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

test('scratchpad survives reload and stays out of TODO.txt import and export', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Scratchpad', exact: true }).click();
  const editor = page.getByRole('textbox', { name: 'Scratchpad text' });
  await editor.fill('Private capture that has not moved');
  await expect.poll(() => page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('shio-pan-v1');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const value = await new Promise<{ text: string }>(resolve => {
      const request = db.transaction('scratchpad', 'readonly').objectStore('scratchpad').get('current');
      request.onsuccess = () => resolve(request.result);
    });
    db.close();
    return value?.text;
  })).toBe('Private capture that has not moved');
  await page.reload();
  await page.getByRole('button', { name: 'Scratchpad', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Scratchpad text' })).toHaveValue('Private capture that has not moved');
  await page.getByRole('button', { name: 'Dated', exact: true }).click();
  const add = page.getByRole('textbox', { name: 'New daily item' });
  await add.fill('Portable journal line');
  await add.press('Enter');
  await page.getByRole('button', { name: 'Download TODO.txt' }).click();
  await expect(page.getByLabel('TODO.txt preview')).not.toContainText('Private capture');
  await page.getByRole('button', { name: 'cancel' }).click();
  await page.getByLabel('Import a TODO.txt file').setInputFiles({ name: 'TODO.txt', mimeType: 'text/plain', buffer: Buffer.from('2020-01-01\n\nImported item\n') });
  const review = page.getByRole('dialog', { name: 'Review TODO.txt import' });
  await review.getByRole('radio', { name: 'keep Shio Pan' }).check();
  await review.getByRole('button', { name: 'apply import' }).click();
  await page.getByRole('button', { name: 'Scratchpad', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Scratchpad text' })).toHaveValue('Private capture that has not moved');
});

test('one-title mapping joins selected lines into one portable item', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Shio Pan settings' }).click();
  await page.getByRole('dialog', { name: 'Shio Pan settings' }).getByLabel('Selected lines become').selectOption('single');
  await page.getByRole('dialog', { name: 'Shio Pan settings' }).getByRole('button', { name: 'close' }).click();
  await page.getByRole('button', { name: 'Scratchpad', exact: true }).click();
  await page.getByRole('textbox', { name: 'Scratchpad text' }).fill('First line\nSecond line');
  await openSelectionMenu(page, 0, 22);
  await page.getByRole('menuitem', { name: 'Move to undated' }).click();
  await page.getByRole('dialog', { name: 'Move text to an undated list' }).getByRole('button', { name: 'Create item' }).click();
  await page.getByRole('button', { name: 'Undated', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Edit First line Second line' })).toBeVisible();
  await page.getByRole('button', { name: 'Download TODO.txt' }).click();
  await expect(page.getByLabel('TODO.txt preview')).toContainText('First line Second line');
});

test('undated popout shows only chosen lists and edits synchronize', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Import a TODO.txt file').setInputFiles({
    name: 'TODO.txt', mimeType: 'text/plain',
    buffer: Buffer.from('UNDATED\n\nLIST: Ideas\nIdea one\n\nLIST: Inbox\nInbox one\n'),
  });
  await page.getByRole('button', { name: 'Undated', exact: true }).click();
  await page.getByRole('button', { name: 'Open view in browser window' }).click();
  const chooser = page.getByRole('dialog', { name: 'Open undated window' });
  await chooser.getByLabel('Inbox').uncheck();
  const popupEvent = page.waitForEvent('popup');
  await chooser.getByRole('button', { name: 'Open window' }).click();
  const popup = await popupEvent;
  await popup.waitForLoadState();
  await expect(popup.getByText('Shio Pan · Undated')).toHaveCount(0);
  await expect(popup.getByRole('textbox', { name: 'Edit Idea one' })).toBeVisible();
  await expect(popup.getByRole('textbox', { name: 'Edit Inbox one' })).toHaveCount(0);
  const edit = popup.getByRole('textbox', { name: 'Edit Idea one' });
  await edit.fill('Edited idea');
  await edit.press('Tab');
  await expect(page.getByRole('textbox', { name: 'Edit Edited idea' })).toBeVisible();
  await popup.close();
});

test('independent additions from two windows both survive', async ({ page }) => {
  await page.goto('/');
  const mainAdd = page.getByRole('textbox', { name: 'New daily item' }).first();
  await mainAdd.fill('Main window item');
  await mainAdd.press('Enter');
  await expect(page.getByRole('group', { name: 'Main window item' })).toBeVisible();
  await page.getByRole('button', { name: 'Open view in browser window' }).click();
  const popupEvent = page.waitForEvent('popup');
  await page.getByRole('dialog', { name: 'Open dated window' }).getByRole('button', { name: 'Open window' }).click();
  const popup = await popupEvent;
  await popup.waitForLoadState();
  await expect(popup.getByRole('group', { name: 'Main window item' })).toBeVisible();
  const popupAdd = popup.getByRole('textbox', { name: 'New daily item' }).first();
  await popupAdd.fill('Popout item');
  await popupAdd.press('Enter');
  await expect(page.getByRole('group', { name: 'Main window item' })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Popout item' })).toBeVisible();
  await expect(popup.getByRole('group', { name: 'Main window item' })).toBeVisible();
  await expect(popup.getByRole('group', { name: 'Popout item' })).toBeVisible();
  await popup.close();
});

test('scratchpad controls remain reachable on a narrow phone', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Scratchpad', exact: true }).click();
  const editor = page.getByRole('textbox', { name: 'Scratchpad text' });
  await expect(editor).toBeVisible();
  await expect(editor).toHaveCSS('border-top-width', '0px');
  await expect(editor).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  expect(await editor.getAttribute('placeholder')).toBeNull();
  await editor.fill('Phone capture');
  await openSelectionMenu(page, 0, 13);
  await expect(page.getByRole('menuitem', { name: 'Move to dated' })).toBeInViewport();
  await expect(page.getByRole('menuitem', { name: 'Move to undated' })).toBeInViewport();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});
