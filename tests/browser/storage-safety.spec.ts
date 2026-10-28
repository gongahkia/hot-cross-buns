import { expect, test } from '@playwright/test';

async function stopApplication(page: import('@playwright/test').Page) {
  await page.route('**/storage-maintenance', route => route.fulfill({ contentType: 'text/html', body: '<html><body>Storage test maintenance</body></html>' }));
  await page.goto('/storage-maintenance');
}


async function snapshot(page: import('@playwright/test').Page) {
  return page.evaluate(() => new Promise<{ revision: number; bytes: number[] }>((resolve, reject) => {
    const open = indexedDB.open('hot-cross-buns-workspace');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction('workspace', 'readonly');
      const get = tx.objectStore('workspace').get('current');
      tx.oncomplete = () => { resolve({ revision: get.result.revision, bytes: Array.from(get.result.bytes) }); db.close(); };
      tx.onabort = () => { reject(tx.error); db.close(); };
    };
  }));
}

test('an incompatible durable schema fails initialization without erasing or reseeding data', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.hcb?.__testing);
  const result = await page.evaluate(async () => {
    const task = await window.hcb!.tasks.create({ listId: 'inbox', title: 'Keep this durable record' });
    if (!task.ok) throw new Error(task.error.message);
    return (window.hcb as any).__testing.seedDatabase({ statements: [{ sql: 'INSERT INTO schema_migrations(version) VALUES(999)' }] });
  });
  expect(result.ok).toBe(true);
  await stopApplication(page);
  const before = await snapshot(page);
  await page.goto('/');
  const bootstrap = await page.evaluate(() => window.hcb!.bootstrap.get({}));
  expect(bootstrap.ok).toBe(false);
  expect(await snapshot(page)).toEqual(before);
});

test('a corrupt durable SQLite snapshot is preserved and reported instead of starting an empty workspace', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.hcb?.__testing);
  expect((await page.evaluate(() => window.hcb!.bootstrap.get({}))).ok).toBe(true);
  await stopApplication(page);
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const open = indexedDB.open('hot-cross-buns-workspace');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result, tx = db.transaction('workspace', 'readwrite');
      const get = tx.objectStore('workspace').get('current');
      get.onsuccess = () => tx.objectStore('workspace').put({ ...get.result, revision: get.result.revision + 1, bytes: new Uint8Array([1,2,3,4]) }, 'current');
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }));
  await stopApplication(page);
  const before = await snapshot(page);
  await page.goto('/');
  const bootstrap = await page.evaluate(() => window.hcb!.bootstrap.get({}));
  expect(bootstrap.ok).toBe(false);
  expect(await snapshot(page)).toEqual(before);
});

test('a second worker reopens and reads without manufacturing a durable revision', async ({ page }) => {
  await page.goto('/');
  expect((await page.evaluate(() => window.hcb!.tasks.create({ listId: 'inbox', title: 'Stable revision' }))).ok).toBe(true);
  const workerUrl = page.workers()[0].url();
  await stopApplication(page);
  const before = await snapshot(page);
  await page.evaluate(url => new Promise<void>((resolve, reject) => {
    const worker = new Worker(url, { type: 'module' });
    let remaining = 5;
    worker.onerror = event => { worker.terminate(); reject(new Error(event.message)); };
    worker.onmessage = ({ data }) => {
      if (data.type === 'initialization-error' || data.result?.ok === false) {
        worker.terminate(); reject(new Error(JSON.stringify(data))); return;
      }
      if (data.type === 'ready' || data.id) {
        if (remaining-- === 0) { worker.terminate(); resolve(); }
        else worker.postMessage({ id: remaining + 1, namespace: 'bootstrap', action: 'get', payload: {} });
      }
    };
  }), workerUrl);
  expect(await snapshot(page)).toEqual(before);
});
