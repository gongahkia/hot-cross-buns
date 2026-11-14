import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { MAX_IMPORT_BYTES, MAX_IMPORT_LINES } from '../src/importLimits';

async function savedTitles(page: Page) {
  return page.evaluate(() => new Promise<string[]>((resolve, reject) => {
    const request = indexedDB.open('hot-cross-buns-v1');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const entry = db.transaction('state').objectStore('state').get('current');
      entry.onsuccess = () => { db.close(); resolve(entry.result.document.days.flatMap((day: { items: Array<{ text: string }> }) => day.items.map(item => item.text))); };
    };
  }));
}

async function existingJournal(page: Page) {
  await page.goto('/');
  const add = page.getByRole('textbox', { name: 'New daily item', exact: true });
  await add.fill('Keep this journal'); await add.press('Enter');
  await expect.poll(() => savedTitles(page)).toEqual(['Keep this journal']);
}

async function seedLargeProjection(page: Page, span = true) {
  await page.route('**/limits-setup', route => route.fulfill({ contentType: 'text/html', body: '<title>Setup</title>' }));
  await page.goto('/limits-setup');
  await page.evaluate(span => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('hot-cross-buns-v1', 1);
    request.onupgradeneeded = () => { request.result.createObjectStore('state'); request.result.createObjectStore('scratchpad'); };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('state', 'readwrite');
      tx.objectStore('state').put({ document: { days: [{ date: span ? '2000-01-01' : '1900-01-01', items: [{
        id: 'old-series', text: 'Long recurring span', completed: false, details: [], repeat: { kind: 'daily', series: 'long-span' },
        ...(span ? { span: { kind: 'all-day', through: '2100-01-01' } } : {}),
      }] }] }, baseline: null, revision: 3 }, 'current');
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }), span);
}

test('oversized file and line-count imports leave the existing journal intact', async ({ page }) => {
  await existingJournal(page);
  await page.getByLabel('Import a TODO.txt file').setInputFiles({ name: 'TODO.txt', mimeType: 'text/plain', buffer: Buffer.alloc(MAX_IMPORT_BYTES + 1, 'a') });
  await expect(page.getByText(/imports are limited to 5 MiB/)).toBeVisible();
  expect(await savedTitles(page)).toEqual(['Keep this journal']);
  await page.getByLabel('Import a TODO.txt file').setInputFiles({ name: 'TODO.txt', mimeType: 'text/plain', buffer: Buffer.from(('a\n').repeat(MAX_IMPORT_LINES + 1)) });
  await expect(page.getByText(/imports are limited to 100,000 lines/)).toBeVisible();
  expect(await savedTitles(page)).toEqual(['Keep this journal']);
});

test('an expensive recurrence import is rejected before replacing saved data', async ({ page }) => {
  await existingJournal(page);
  const raw = '2000-01-01\n\nLong recurring span\n  @repeat: daily; series long-span\n  @span: all-day through 2100-01-01\n';
  await page.getByLabel('Import a TODO.txt file').setInputFiles({ name: 'TODO.txt', mimeType: 'text/plain', buffer: Buffer.from(raw) });
  const review = page.getByRole('dialog', { name: 'Review TODO.txt import', exact: true });
  await review.getByRole('radio', { name: 'use file', exact: true }).check();
  await review.getByRole('button', { name: 'apply import', exact: true }).click();
  await expect(page.getByText(/This view contains too many items/)).toBeVisible();
  await review.getByRole('button', { name: 'cancel', exact: true }).click();
  await expect(page.getByRole('group', { name: 'Keep this journal', exact: true })).toBeVisible();
  expect(await savedTitles(page)).toEqual(['Keep this journal']);
});

test('an older over-budget journal remains exportable and can be repaired through import', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await seedLargeProjection(page);
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('This view contains too many items');
  await page.getByRole('button', { name: 'Choose date', exact: true }).click();
  await expect(page.getByRole('button', { name: /unfinished status unavailable/ }).first()).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Download TODO.txt', exact: true }).click();
  const preview = page.getByRole('dialog', { name: 'Download TODO.txt', exact: true });
  await expect(preview.getByLabel('TODO.txt preview')).toContainText('@span: all-day through 2100-01-01');
  const pending = page.waitForEvent('download');
  await preview.getByRole('button', { name: 'download', exact: true }).click();
  const downloaded = await pending;
  const original = await readFile((await downloaded.path())!, 'utf8');
  expect(original).toContain('@repeat: daily; series long-span');
  expect(original).toContain('@span: all-day through 2100-01-01');
  await page.getByLabel('Import a TODO.txt file').setInputFiles({ name: 'TODO.txt', mimeType: 'text/plain', buffer: Buffer.from(original.replace('@span: all-day through 2100-01-01', '@span: all-day')) });
  await expect(page.getByRole('status').filter({ hasText: 'TODO.txt imported.' })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'Long recurring span', exact: true }).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('an expensive all-history review can return to the visible range without losing data', async ({ page }) => {
  await seedLargeProjection(page, false);
  await page.goto('/');
  await page.getByRole('button', { name: 'Hot Cross Buns settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Hot Cross Buns settings', exact: true });
  await settings.getByLabel('Earlier unfinished items').selectOption('all');
  await settings.getByRole('button', { name: 'close', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('This view contains too many items');
  await page.getByRole('button', { name: 'Hot Cross Buns settings', exact: true }).click();
  await settings.getByLabel('Earlier unfinished items').selectOption('visible');
  await settings.getByRole('button', { name: 'close', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(await savedTitles(page)).toEqual(['Long recurring span']);
});
