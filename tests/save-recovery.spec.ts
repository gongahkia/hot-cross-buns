import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const pageErrors = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => {
  const errors: string[] = [];
  pageErrors.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
});
test.afterEach(({ page }) => {
  expect(pageErrors.get(page)).toEqual([]);
});

async function stored(page: Page, store = 'state') {
  return page.evaluate(store => new Promise<{ document?: { days: Array<{ items: Array<{ text: string }> }> }; text?: string }>((resolve, reject) => {
    const request = indexedDB.open('hot-cross-buns-v1');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const entry = db.transaction(store).objectStore(store).get('current');
      entry.onerror = () => { db.close(); reject(entry.error); };
      entry.onsuccess = () => { db.close(); resolve(entry.result); };
    };
  }), store);
}
const titles = async (page: Page) => (await stored(page))?.document?.days.flatMap(day => day.items.map(item => item.text)) ?? [];

async function initialJournal(page: Page) {
  await page.goto('/');
  const add = page.getByRole('textbox', { name: 'New daily item', exact: true });
  await add.fill('Original saved text');
  await add.press('Enter');
  await expect.poll(() => titles(page)).toContain('Original saved text');
}

async function failWrites(page: Page, count = 1) {
  await page.evaluate(count => {
    const control = Object.assign(window, { storageFailures: count });
    const original = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function(this: IDBDatabase, names: string | string[], mode?: IDBTransactionMode, options?: IDBTransactionOptions) {
      const tx = original.call(this, names, mode, options);
      if (this.name === 'hot-cross-buns-v1' && mode === 'readwrite' && control.storageFailures > 0) {
        control.storageFailures--;
        queueMicrotask(() => tx.abort());
      }
      return tx;
    };
  }, count);
}

async function failedEdit(page: Page, count = 1) {
  await failWrites(page, count);
  const editor = page.getByRole('textbox', { name: 'Edit Original saved text', exact: true });
  await editor.fill('Unsaved replacement text');
  await editor.press('Tab');
  const recovery = page.getByRole('dialog', { name: 'Unsaved journal', exact: true });
  await expect(recovery.getByRole('alert')).toContainText('Could not save');
  await expect(recovery.getByLabel('Unsaved journal text')).toHaveValue(/Unsaved replacement text/);
  expect(await titles(page)).toEqual(['Original saved text']);
  return recovery;
}

test('keeps an aborted journal edit through repeated failures and retries it durably', async ({ page }) => {
  await initialJournal(page);
  const recovery = await failedEdit(page, 2);
  await recovery.getByRole('button', { name: 'Retry saving' }).click();
  await expect.poll(() => page.evaluate(() => Reflect.get(window, 'storageFailures') as number)).toBe(0);
  await expect(recovery.getByLabel('Unsaved journal text')).toHaveValue(/Unsaved replacement text/);
  await recovery.getByRole('button', { name: 'Retry saving' }).click();
  await expect.poll(() => titles(page)).toEqual(['Unsaved replacement text']);
  await expect(recovery).toBeHidden();
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Edit Unsaved replacement text', exact: true })).toBeVisible();
});

test('clipboard refusal keeps the draft and offers a complete recovery download', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 700 });
  await initialJournal(page);
  const recovery = await failedEdit(page);
  expect(await recovery.evaluate(element => element.scrollWidth)).toBeLessThanOrEqual(375);
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('denied')) } }));
  await recovery.getByRole('button', { name: 'Copy unsaved text' }).click();
  await expect(recovery.getByRole('status')).toContainText('Clipboard access was denied');
  const pending = page.waitForEvent('download');
  await recovery.getByRole('button', { name: 'Download unsaved text' }).click();
  const downloaded = await pending;
  expect(downloaded.suggestedFilename()).toBe('TODO-unsaved.txt');
  expect(await readFile((await downloaded.path())!, 'utf8')).toContain('Unsaved replacement text');
  await recovery.getByRole('button', { name: 'Discard unsaved edits' }).click();
  await recovery.getByRole('button', { name: 'Keep unsaved edits' }).click();
  await expect(recovery.getByLabel('Unsaved journal text')).toHaveValue(/Unsaved replacement text/);
  await recovery.getByRole('button', { name: 'Discard unsaved edits' }).click();
  await recovery.getByRole('button', { name: 'Confirm discard' }).click();
  await expect(recovery).toBeHidden();
  expect(await titles(page)).toEqual(['Original saved text']);
  await expect(page.getByRole('textbox', { name: 'Edit Original saved text', exact: true })).toBeVisible();
});

test('retry preserves an independent edit made in another window', async ({ page, context }) => {
  await initialJournal(page);
  const recovery = await failedEdit(page);
  const other = await context.newPage();
  await other.goto('/');
  await other.getByRole('textbox', { name: 'Edit Original saved text', exact: true }).press('Enter');
  const add = other.getByRole('textbox', { name: 'New item after current item' });
  await add.fill('Independent addition'); await add.press('Enter');
  await expect.poll(() => titles(other)).toContain('Independent addition');
  await recovery.getByRole('button', { name: 'Retry saving' }).click();
  await expect.poll(() => titles(page)).toEqual(['Unsaved replacement text', 'Independent addition']);
  await expect(recovery).toBeHidden();
});

test('retry does not overwrite a conflicting edit from another window', async ({ page, context }) => {
  await initialJournal(page);
  const recovery = await failedEdit(page);
  const other = await context.newPage();
  await other.goto('/');
  const editor = other.getByRole('textbox', { name: 'Edit Original saved text', exact: true });
  await editor.fill('Other window edit'); await editor.press('Tab');
  await expect.poll(() => titles(other)).toEqual(['Other window edit']);
  await recovery.getByRole('button', { name: 'Retry saving' }).click();
  await expect(recovery.getByRole('alert')).toContainText('same item changed in another window');
  await expect(recovery.getByLabel('Unsaved journal text')).toHaveValue(/Unsaved replacement text/);
  expect(await titles(other)).toEqual(['Other window edit']);
  await recovery.getByRole('button', { name: 'Discard unsaved edits' }).click();
  await recovery.getByRole('button', { name: 'Confirm discard' }).click();
  await expect(page.getByRole('textbox', { name: 'Edit Other window edit', exact: true })).toBeVisible();
});

test('an import can be discarded after a failed write without reporting success', async ({ page }) => {
  await initialJournal(page);
  await failWrites(page);
  const today = await page.evaluate(() => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' }));
  await page.getByLabel('Import a TODO.txt file').setInputFiles({ name: 'TODO.txt', mimeType: 'text/plain', buffer: Buffer.from(today + '\n\nImported draft\n') });
  const review = page.getByRole('dialog', { name: 'Review TODO.txt import' });
  await review.getByRole('radio', { name: 'use file', exact: true }).check();
  await review.getByRole('button', { name: 'apply import', exact: true }).click();
  const recovery = page.getByRole('dialog', { name: 'Unsaved journal', exact: true });
  await expect(recovery.getByLabel('Unsaved journal text')).toHaveValue(/Imported draft/);
  await recovery.getByRole('button', { name: 'Discard unsaved edits' }).click();
  await recovery.getByRole('button', { name: 'Confirm discard' }).click();
  await expect(recovery).toBeHidden();
  await expect(page.getByText('TODO.txt imported.', { exact: true })).toHaveCount(0);
  expect(await titles(page)).toEqual(['Original saved text']);
});

test('keeps scratchpad text, copies it and retries without losing its saved predecessor', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  await page.getByRole('button', { name: 'Scratchpad', exact: true }).click();
  const editor = page.getByRole('textbox', { name: 'Scratchpad text', exact: true });
  await expect(editor).toBeEditable(); await editor.fill('Saved scratchpad');
  await expect.poll(async () => (await stored(page, 'scratchpad'))?.text).toBe('Saved scratchpad');
  await failWrites(page); await editor.fill('Unsaved scratchpad');
  const recovery = page.getByRole('dialog', { name: 'Unsaved scratchpad', exact: true });
  await expect(recovery.getByLabel('Unsaved scratchpad text')).toHaveValue('Unsaved scratchpad');
  expect((await stored(page, 'scratchpad'))?.text).toBe('Saved scratchpad');
  await recovery.getByRole('button', { name: 'Copy unsaved text' }).click();
  await expect(recovery.getByRole('status')).toContainText('Unsaved text copied');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('Unsaved scratchpad');
  await recovery.getByRole('button', { name: 'Retry saving' }).click();
  await expect.poll(async () => (await stored(page, 'scratchpad'))?.text).toBe('Unsaved scratchpad');
  await page.reload(); await page.getByRole('button', { name: 'Scratchpad', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Scratchpad text', exact: true })).toHaveValue('Unsaved scratchpad');
});

test('discarding an unsaved scratchpad returns to its durable contents', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Scratchpad', exact: true }).click();
  const editor = page.getByRole('textbox', { name: 'Scratchpad text', exact: true });
  await expect(editor).toBeEditable(); await editor.fill('Keep saved scratchpad');
  await expect.poll(async () => (await stored(page, 'scratchpad'))?.text).toBe('Keep saved scratchpad');
  await failWrites(page); await editor.fill('Discard this draft');
  const recovery = page.getByRole('dialog', { name: 'Unsaved scratchpad', exact: true });
  await expect(recovery.getByLabel('Unsaved scratchpad text')).toHaveValue('Discard this draft');
  await recovery.getByRole('button', { name: 'Discard unsaved edits' }).click();
  await recovery.getByRole('button', { name: 'Confirm discard' }).click();
  await expect(recovery).toBeHidden();
  await expect(editor).toHaveValue('Keep saved scratchpad');
  expect((await stored(page, 'scratchpad'))?.text).toBe('Keep saved scratchpad');
});

test('an aborted two-store capture keeps the scratchpad and journal unchanged', async ({ page }) => {
  await initialJournal(page);
  await page.getByRole('button', { name: 'Scratchpad', exact: true }).click();
  const editor = page.getByRole('textbox', { name: 'Scratchpad text', exact: true });
  await editor.fill('Keep this capture');
  await expect.poll(async () => (await stored(page, 'scratchpad')).text).toBe('Keep this capture');
  await editor.evaluate(element => {
    const field = element as HTMLTextAreaElement;
    field.focus(); field.setSelectionRange(0, field.value.length);
    field.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Shift' }));
  });
  await editor.press('Shift+F10');
  await page.getByRole('menuitem', { name: 'Move to dated', exact: true }).click();
  await failWrites(page);
  await page.getByRole('button', { name: 'Create item', exact: true }).click();
  await expect(page.getByText(/AbortError/)).toBeVisible();
  expect(await titles(page)).toEqual(['Original saved text']);
  expect((await stored(page, 'scratchpad')).text).toBe('Keep this capture');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(editor).toHaveValue('Keep this capture');
});
