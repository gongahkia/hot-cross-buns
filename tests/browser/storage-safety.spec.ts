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

for (const oldVersion of [1, 2]) test(`the protocol upgrade fences v${oldVersion} writers and preserves their snapshot`, async ({ page }) => {
  await page.goto('/');
  const task = await page.evaluate(async () => {
    const result = await window.hcb!.tasks.create({ listId: 'inbox', title: 'Saved workspace survives upgrade' });
    if (!result.ok) throw new Error(result.error.message);
    return result.data;
  });
  const workerUrl = page.workers()[0].url();
  await stopApplication(page);
  const before = await snapshot(page);
  await page.evaluate(async ({ saved, oldVersion }) => {
    await new Promise<void>((resolve, reject) => {
      const remove = indexedDB.deleteDatabase('hot-cross-buns-workspace');
      remove.onsuccess = () => resolve(); remove.onerror = () => reject(remove.error);
    });
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('hot-cross-buns-workspace', oldVersion);
      open.onupgradeneeded = () => open.result.createObjectStore('workspace');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        (window as any).oldWriter = db;
        db.onversionchange = () => { (window as any).oldWriterClosed = true; db.close(); };
        const tx = db.transaction('workspace', 'readwrite');
        tx.objectStore('workspace').put({ format: 1, revision: saved.revision, bytes: new Uint8Array(saved.bytes), savedAt: new Date().toISOString() }, 'current');
        tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
      };
    });
  }, { saved: before, oldVersion });
  const read = await page.evaluate(({ url, id }) => new Promise<any>((resolve, reject) => {
    const worker = new Worker(url, { type: 'module' });
    worker.onerror = event => { worker.terminate(); reject(new Error(event.message)); };
    worker.onmessage = ({ data }) => {
      if (data.type === 'initialization-error') { worker.terminate(); reject(new Error(data.message)); }
      else if (data.type === 'ready') worker.postMessage({ id: 1, namespace: 'tasks', action: 'get', payload: { id } });
      else if (data.id === 1) { worker.terminate(); resolve(data.result); }
    };
  }), { url: workerUrl, id: task.id });
  expect(read.ok).toBe(true);
  expect(read.data.title).toBe('Saved workspace survives upgrade');
  expect(await snapshot(page)).toEqual(before);
  const fenced = await page.evaluate(async oldVersion => {
    let closed = false;
    try { (window as any).oldWriter.transaction('workspace', 'readwrite'); } catch { closed = true; }
    const versionError = await new Promise<string>(resolve => {
      const old = indexedDB.open('hot-cross-buns-workspace', oldVersion);
      old.onerror = () => resolve(old.error?.name ?? '');
      old.onsuccess = () => { old.result.close(); resolve(''); };
    });
    return { closed, notified: (window as any).oldWriterClosed, versionError };
  }, oldVersion);
  expect(fenced).toEqual({ closed: true, notified: true, versionError: 'VersionError' });
});

test('closing the writer after SQL commit but before durable save releases the lock without partial records', async ({ page }) => {
  await page.goto('/');
  const task = await page.evaluate(async () => {
    const result = await window.hcb!.tasks.create({ listId: 'inbox', title: 'Interrupted save sentinel' });
    if (!result.ok) throw new Error(result.error.message);
    return result.data;
  });
  const undoBefore = await page.evaluate(() => window.hcb!.undo.status());
  const workerUrl = page.workers()[0].url();
  await stopApplication(page);
  const before = await snapshot(page);
  await page.evaluate(({ url, taskId }) => new Promise<void>((resolve, reject) => {
    const worker = new Worker(url, { type: 'module' });
    worker.onerror = event => { worker.terminate(); reject(new Error(event.message)); };
    worker.onmessage = ({ data }) => {
      if (data.type === 'initialization-error' || data.result?.ok === false) { worker.terminate(); reject(new Error(JSON.stringify(data))); }
      else if (data.type === 'ready') worker.postMessage({ id: 1, namespace: '__test', action: 'pauseNextPersistence', payload: {} });
      else if (data.id === 1) worker.postMessage({ id: 2, namespace: 'calendar', action: 'scheduleTaskBlock', payload: { taskId, calendarId: 'primary', startsAt: '2027-01-12T09:00:00Z', durationMinutes: 45 } });
      else if (data.type === 'test:persistence-paused') { worker.terminate(); resolve(); }
      else if (data.id === 2) { worker.terminate(); reject(new Error('A save was acknowledged before its durable commit.')); }
    };
  }), { url: workerUrl, taskId: task.id });
  expect(await snapshot(page)).toEqual(before);
  await page.goto('/');
  const after = await page.evaluate(async id => ({
    task: await window.hcb!.tasks.get({ id }), undo: await window.hcb!.undo.status(),
    events: await window.hcb!.calendar.listEvents({ start: '2027-01-01T00:00:00Z', end: '2027-02-01T00:00:00Z' }),
  }), task.id);
  expect(after.task.ok).toBe(true);
  if (!after.events.ok) throw new Error(after.events.error.message);
  expect(after.events.data.items).toHaveLength(0);
  expect(after.undo).toEqual(undoBefore);
});
