import { expect, test, type Page } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

async function seedLegacyJournal(page: Page, existing = false) {
  await page.route('**/rename-setup', route => route.fulfill({ contentType: 'text/html', body: '<title>Setup</title>' }));
  await page.goto('/rename-setup');
  await page.evaluate(async existing => {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });
    const seed = async (name: string, title: string) => {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => { request.result.createObjectStore('state'); request.result.createObjectStore('scratchpad'); };
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(['state', 'scratchpad'], 'readwrite');
        tx.objectStore('state').put({
          document: { days: [{ date: today, items: [{ id: 'saved-item', text: title, completed: false, details: [] }] }], undated: [] },
          baseline: null, revision: 7,
        }, 'current');
        tx.objectStore('scratchpad').put({ text: `${title} scratchpad`, revision: 3 }, 'current');
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error);
      });
      db.close();
    };
    await seed('shio-pan-v1', 'Original journal');
    localStorage.setItem('shio-pan-theme', 'night');
    sessionStorage.setItem('shio-pan-raw-draft-v1', 'Recover this draft');
    if (existing) {
      await seed('hot-cross-buns-v1', 'Newer journal');
      localStorage.setItem('hot-cross-buns-theme', 'day');
    }
  }, existing);
}

test('renaming preserves the old journal, scratchpad, preferences and draft across reloads', async ({ page }) => {
  await seedLegacyJournal(page);
  await page.goto('/');
  await expect(page).toHaveTitle('Hot Cross Buns');
  await expect(page.getByRole('group', { name: 'Original journal', exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'night');
  expect(await page.evaluate(() => sessionStorage.getItem('hot-cross-buns-raw-draft-v1'))).toBe('Recover this draft');
  await page.getByRole('button', { name: 'Scratchpad', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Scratchpad text' })).toHaveValue('Original journal scratchpad');
  await page.getByRole('button', { name: 'Dated', exact: true }).click();
  await page.getByRole('textbox', { name: 'Edit Original journal', exact: true }).press('Enter');
  const add = page.getByRole('textbox', { name: 'New item after current item' });
  await add.fill('Added after rename');
  await add.press('Enter');
  await expect(page.getByRole('group', { name: 'Added after rename', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => new Promise<boolean>((resolve, reject) => {
    const request = indexedDB.open('hot-cross-buns-v1');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const entry = db.transaction('state').objectStore('state').get('current');
      entry.onsuccess = () => {
        db.close();
        resolve(entry.result.document.days.some((day: { items: Array<{ text: string }> }) => day.items.some(item => item.text === 'Added after rename')));
      };
    };
  }))).toBe(true);
  await page.reload();
  await expect(page.getByRole('group', { name: 'Added after rename', exact: true })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Original journal', exact: true })).toHaveCount(1);
  expect(await page.evaluate(() => new Promise<number>((resolve, reject) => {
    const request = indexedDB.open('shio-pan-v1');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const entry = db.transaction('state').objectStore('state').get('current');
      entry.onsuccess = () => { db.close(); resolve(entry.result.revision); };
    };
  }))).toBe(7);
});

test('an existing renamed journal and preferences take precedence over older data', async ({ page }) => {
  await seedLegacyJournal(page, true);
  await page.goto('/');
  await expect(page.getByRole('group', { name: 'Newer journal', exact: true })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Original journal', exact: true })).toHaveCount(0);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'day');
  await page.getByRole('button', { name: 'Scratchpad', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Scratchpad text' })).toHaveValue('Newer journal scratchpad');
});

test('a failed storage migration leaves the original data available for retry', async ({ page }) => {
  await seedLegacyJournal(page);
  await page.addInitScript(() => {
    const original = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function(this: IDBDatabase, names: string | string[], mode?: IDBTransactionMode, options?: IDBTransactionOptions) {
      const tx = original.call(this, names, mode, options);
      if (this.name === 'hot-cross-buns-v1' && mode === 'readwrite' && !sessionStorage.getItem('migration-failure-injected')) {
        sessionStorage.setItem('migration-failure-injected', 'true');
        queueMicrotask(() => tx.abort());
      }
      return tx;
    };
  });
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('The original data has been kept');
  expect(await page.evaluate(() => localStorage.getItem('hot-cross-buns-storage-renamed-v1'))).toBeNull();
  await page.reload();
  await expect(page.getByRole('group', { name: 'Original journal', exact: true })).toBeVisible();
});

test('retires the old cached planner without deleting other caches or saved storage', async ({ page }) => {
  const retirement = await readFile('public/service-worker.js', 'utf8');
  let retire = false;
  const server = createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    if (request.url === '/service-worker.js') {
      response.setHeader('Content-Type', 'application/javascript');
      response.end(retire ? retirement : `
        self.addEventListener('install', event => event.waitUntil((async () => {
          const cache = await caches.open('hcb-app-shell-previous');
          await cache.put('/', new Response('<title>Previous planner</title>', { headers: { 'Content-Type': 'text/html' } }));
          await self.skipWaiting();
        })()));
        self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
        self.addEventListener('fetch', event => {
          if (new URL(event.request.url).pathname === '/') event.respondWith(caches.open('hcb-app-shell-previous').then(cache => cache.match('/')));
        });
      `);
    } else {
      response.setHeader('Content-Type', 'text/html');
      response.end('<title>Hot Cross Buns</title>');
    }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Test server did not start.');
    const origin = `http://127.0.0.1:${address.port}`;
    await page.goto(origin);
    await page.evaluate(async () => {
      localStorage.setItem('saved-workspace-sentinel', 'keep');
      const unrelated = await caches.open('another-app-cache');
      await unrelated.put('/keep', new Response('keep'));
      await navigator.serviceWorker.register('/service-worker.js');
      await navigator.serviceWorker.ready;
    });
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
    await page.reload();
    await expect(page).toHaveTitle('Previous planner');
    retire = true;
    await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration())!.update(); });
    await page.waitForFunction(async () => navigator.serviceWorker.controller?.state === 'activated' && !(await navigator.serviceWorker.getRegistration()));
    await expect.poll(() => page.evaluate(() => caches.keys())).toEqual(['another-app-cache']);
    expect(await page.evaluate(() => localStorage.getItem('saved-workspace-sentinel'))).toBe('keep');
    await page.reload();
    await expect(page).toHaveTitle('Hot Cross Buns');
  } finally {
    await page.goto('about:blank');
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
