import { plannerFixture } from './planner-fixture';
import { expect, test, type Page } from '@playwright/test';
import { runCommand } from './commands';
import { holdSyncDelivery, syncState } from './sync-helpers';

const initial = plannerFixture('UNDATED\n\nLIST: Inbox\nOriginal\n- Keep detail\n');
async function setup(page: Page, transition = false) {
  // use real, cloneable browser file handles; only the OS picker is replaced in headless tests.
  await page.addInitScript(() => {
    const pick = async () => (await navigator.storage.getDirectory()).getFileHandle('Planner.md', { create: true });
    Object.assign(window, { showOpenFilePicker: async () => [await pick()], showSaveFilePicker: pick });
  });
  await page.goto('/');
  if (transition) await page.getByRole('button', { name: 'Convert saved workspace', exact: true }).click();
  await page.getByRole('button', { name: 'Open command palette', exact: true }).waitFor();
}
async function disk(page: Page, synchronized = true): Promise<string> {
  return page.evaluate(async synchronized => {
    const read = async () => (await (await (await navigator.storage.getDirectory()).getFileHandle('Planner.md', { create: true })).getFile()).text();
    // a File snapshot can become unreadable when an app save replaces it midway through a test read.
    return synchronized ? navigator.locks.request('hot-cross-buns-sync-delivery', read) : read();
  }, synchronized);
}
async function externalEdit(page: Page, text: string) {
  await page.evaluate(async text => {
    const handle = await (await navigator.storage.getDirectory()).getFileHandle('Planner.md', { create: true });
    const writer = await handle.createWritable(); await writer.write(text); await writer.close();
  }, text);
}
async function linked(page: Page): Promise<boolean> {
  return page.evaluate(() => new Promise<boolean>((resolve, reject) => {
    const open = indexedDB.open('hot-cross-buns-v1');
    open.onsuccess = () => {
      const db = open.result;
      const read = db.transaction('state').objectStore('state').get('linked-file');
      read.onsuccess = () => { db.close(); resolve(!!read.result); }; read.onerror = () => { db.close(); reject(read.error); };
    }; open.onerror = () => reject(open.error);
  }));
}
async function linkExisting(page: Page) {
  await runCommand(page, 'Settings');
  await page.getByRole('button', { name: 'Link existing Planner.md', exact: true }).click();
  await expect.poll(() => linked(page)).toBe(true);
  await page.getByRole('button', { name: 'Undated', exact: true }).click();
}

test('creating a linked file saves the full journal and persists the handle after reload', async ({ page }) => {
  await setup(page);
  await page.getByLabel('Import a Planner.md file').setInputFiles({ name: 'Planner.md', mimeType: 'text/plain', buffer: Buffer.from(plannerFixture(initial)) });
  await runCommand(page, 'Settings');
  await page.getByRole('button', { name: 'Create linked Planner.md', exact: true }).click();
  await expect.poll(() => disk(page)).toMatch(/Original[\s\S]*  - Keep\ detail/);
  await expect(page.getByRole('region', { name: 'File sync', exact: true })).toContainText('Last written at');
  await page.reload();
  await page.getByRole('button', { name: 'Undated', exact: true }).click();
  await page.getByRole('textbox', { name: 'Edit Original', exact: true }).fill('After reload');
  await page.getByRole('textbox', { name: 'Edit Original', exact: true }).press('Tab');
  await expect.poll(() => disk(page)).toMatch(/After\ reload[\s\S]*  - Keep\ detail/);
});

test('linking an existing file imports it and later browser edits save directly', async ({ page }) => {
  await setup(page); await externalEdit(page, initial); await linkExisting(page);
  await expect(page.getByRole('textbox', { name: 'Edit Original', exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Edit Original', exact: true }).fill('Saved directly');
  await page.getByRole('textbox', { name: 'Edit Original', exact: true }).press('Tab');
  await expect.poll(() => disk(page)).toMatch(/Saved\ directly[\s\S]*  - Keep\ detail/);
  await runCommand(page, 'Settings');
  await page.getByRole('button', { name: 'Unlink file', exact: true }).click();
  await expect.poll(() => linked(page)).toBe(false);
  await page.getByRole('dialog', { name: 'Hot Cross Buns settings', exact: true }).getByRole('button', { name: 'close', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Hot Cross Buns settings', exact: true })).toBeHidden();
  await page.getByRole('textbox', { name: 'Edit Saved directly', exact: true }).fill('Only in browser');
  await page.getByRole('textbox', { name: 'Edit Saved directly', exact: true }).press('Tab');
  await page.waitForTimeout(1700);
  expect(await disk(page)).toContain('Saved directly');
  await expect(page.getByRole('textbox', { name: 'Edit Only in browser', exact: true })).toBeVisible();
});

test('overlapping file changes pause saves across reload, and conflict review resumes them', async ({ page }) => {
  await setup(page); await externalEdit(page, initial); await linkExisting(page);
  await page.getByRole('textbox', { name: 'Edit Original', exact: true }).fill('Local title');
  await page.getByRole('textbox', { name: 'Edit Original', exact: true }).press('Tab');
  await expect.poll(() => disk(page)).toContain('Local title');
  const release = await holdSyncDelivery(page);
  await page.getByRole('textbox', { name: 'Edit Local title', exact: true }).fill('Local edit after remote change');
  await page.getByRole('textbox', { name: 'Edit Local title', exact: true }).press('Tab');
  await externalEdit(page, initial.replace('Original', 'Remote title'));
  await release();
  const notice = page.getByRole('status', { name: 'File sync', exact: true });
  await expect(notice).toContainText('changed outside');
  await page.reload();
  await page.getByRole('button', { name: 'Undated', exact: true }).click();
  await expect(notice).toContainText('paused');
  expect(await disk(page)).toContain('Remote title');
  await notice.getByRole('button', { name: 'Review linked file', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Review Planner.md import', exact: true });
  await expect(review).toContainText('Local edit after remote change');
  await expect(review).toContainText('Remote title');
  await review.getByRole('button', { name: 'cancel', exact: true }).click();
  await expect(notice).toContainText('paused');
  await notice.getByRole('button', { name: 'Review linked file', exact: true }).click();
  await review.getByRole('radio', { name: 'keep both', exact: true }).check();
  await review.getByRole('button', { name: 'apply import', exact: true }).click();
  await expect.poll(() => disk(page)).toContain('Local edit after remote change');
  expect(await disk(page)).toContain('Remote title');
  await expect(notice).toHaveCount(0);
});

test('cancelling an initial link review leaves the file unlinked and unchanged', async ({ page }) => {
  await setup(page);
  await page.getByLabel('Import a Planner.md file').setInputFiles({ name: 'Planner.md', mimeType: 'text/plain', buffer: Buffer.from(plannerFixture(initial)) });
  await page.getByRole('button', { name: 'Undated', exact: true }).click();
  await page.getByRole('textbox', { name: 'Edit Original', exact: true }).fill('Local title');
  await page.getByRole('textbox', { name: 'Edit Original', exact: true }).press('Tab');
  await externalEdit(page, initial.replace('Original', 'Remote title'));
  await runCommand(page, 'Settings');
  await page.getByRole('button', { name: 'Link existing Planner.md', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Review Planner.md import', exact: true });
  await expect(review).toBeVisible();
  await review.getByRole('button', { name: 'cancel', exact: true }).click();
  expect(await linked(page)).toBe(false); expect(await disk(page)).toContain('Remote title');
  await expect(page.getByRole('textbox', { name: 'Edit Local title', exact: true })).toBeVisible();
});

test('creating a link refuses to replace a file that already has content', async ({ page }) => {
  await setup(page); await externalEdit(page, initial);
  await runCommand(page, 'Settings');
  await page.getByRole('button', { name: 'Create linked Planner.md', exact: true }).click();
  expect(await linked(page)).toBe(false); expect(await disk(page)).toBe(initial);
  await expect(page.getByRole('region', { name: 'File sync', exact: true }).getByRole('alert')).toContainText('This file already contains text');
});

test('a failed file write keeps browser edits and resumes only after retry', async ({ page }) => {
  await setup(page); await externalEdit(page, initial); await linkExisting(page);
  await page.evaluate(() => {
    const fs = FileSystemFileHandle.prototype;
    const native = fs.createWritable;
    Object.assign(window, { failFileWrite: true });
    fs.createWritable = function(options) {
      if (Reflect.get(window, 'failFileWrite')) return Promise.reject(new DOMException('Disk full', 'QuotaExceededError'));
      return native.call(this, options);
    };
  });
  await page.getByRole('textbox', { name: 'Edit Original', exact: true }).fill('Saved in browser');
  await page.getByRole('textbox', { name: 'Edit Original', exact: true }).press('Tab');
  const notice = page.getByRole('status', { name: 'File sync', exact: true });
  await expect(notice).toContainText('Disk full');
  expect(await disk(page)).toContain('Original');
  await page.evaluate(() => Reflect.set(window, 'failFileWrite', false));
  await notice.getByRole('button', { name: 'Resume file saving', exact: true }).click();
  await expect.poll(() => disk(page)).toContain('Saved in browser');
  await expect(notice).toHaveCount(0);
});

test('unsupported browsers retain import and download without a dead link button', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, 'showOpenFilePicker', { value: undefined }));
  await page.goto('/'); await runCommand(page, 'Settings');
  const section = page.getByRole('region', { name: 'File sync', exact: true });
  await expect(section).toContainText('This browser cannot link local files');
  await expect(section.getByRole('button')).toHaveCount(0);
});

test('linked-file repairs are written only after explicit doctor approval', async ({ page }) => {
  await setup(page);
  const corrected = plannerFixture('2026-11-16\n\nReviewed task\n');
  const malformed = corrected.replace('hcb-format: 1','hcb-format: 999');
  await externalEdit(page, malformed);
  await runCommand(page, 'Settings');
  await page.getByRole('button', { name: 'Link existing Planner.md', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Review Planner.md import', exact: true });
  await expect(review).toContainText('Only hcb-format: 1 is supported');
  expect(await linked(page)).toBe(false); expect(await disk(page)).toBe(malformed);
  await review.getByRole('textbox', { name: 'Edit imported Planner.md', exact: true }).fill(corrected);
  await review.getByRole('button', { name: 'check file', exact: true }).click();
  await expect(review.getByRole('button', { name: 'apply import', exact: true })).toBeEnabled();
  await review.getByRole('button', { name: 'apply import', exact: true }).click();
  await expect.poll(() => linked(page)).toBe(true);
  await expect.poll(() => disk(page)).toBe(corrected);
});

test('a shared write lock serializes saves from two browser windows', async ({ page, context }) => {
  await setup(page); await externalEdit(page, initial); await linkExisting(page);
  const second = await context.newPage(); await second.goto('/');
  await second.getByRole('button', { name: 'Undated', exact: true }).click();
  await page.evaluate(() => {
    void navigator.locks.request('hot-cross-buns-linked-file', () => new Promise<void>(resolve => Reflect.set(window, 'releaseFileLock', resolve)));
  });
  await expect.poll(() => page.evaluate(() => typeof Reflect.get(window, 'releaseFileLock'))).toBe('function');
  await page.getByRole('textbox', { name: 'Edit Original', exact: true }).fill('First window');
  await page.getByRole('textbox', { name: 'Edit Original', exact: true }).press('Tab');
  await expect(second.getByRole('textbox', { name: 'Edit First window', exact: true })).toBeVisible();
  await second.getByRole('textbox', { name: 'Edit detail Keep detail', exact: true }).fill('Second window detail');
  await second.getByRole('textbox', { name: 'Edit detail Keep detail', exact: true }).press('Tab');
  expect(await disk(page, false)).toContain('Original');
  await page.evaluate(() => Reflect.get(window, 'releaseFileLock')());
  await expect.poll(() => disk(page)).toMatch(/First\ window[\s\S]*  - Second\ window\ detail/);
  await expect(page.getByRole('status', { name: 'File sync', exact: true })).toHaveCount(0);
  await expect(second.getByRole('status', { name: 'File sync', exact: true })).toHaveCount(0);
});

test('permission renewal resumes saving without relinking', async ({ page }) => {
  await setup(page); await externalEdit(page, initial); await linkExisting(page);
  await page.evaluate(() => {
    const fs = FileSystemHandle.prototype;
    Reflect.set(window, 'filePermission', 'prompt');
    Reflect.set(fs, 'queryPermission', async () => Reflect.get(window, 'filePermission'));
    Reflect.set(fs, 'requestPermission', async () => { Reflect.set(window, 'filePermission', 'granted'); return 'granted'; });
  });
  await page.getByRole('textbox', { name: 'Edit Original', exact: true }).fill('After permission renewal');
  await page.getByRole('textbox', { name: 'Edit Original', exact: true }).press('Tab');
  const notice = page.getByRole('status', { name: 'File sync', exact: true });
  await expect(notice).toContainText('Allow access');
  expect(await disk(page)).toContain('Original');
  await notice.getByRole('button', { name: 'Resume file saving', exact: true }).click();
  await expect.poll(() => disk(page)).toContain('After permission renewal');
  await expect(notice).toHaveCount(0); expect(await linked(page)).toBe(true);
});

test('manual downloads cannot replace the linked-file merge baseline', async ({ page }) => {
  await setup(page); await externalEdit(page, initial); await linkExisting(page);
  await page.evaluate(() => {
    void navigator.locks.request('hot-cross-buns-linked-file', () => new Promise<void>(resolve => Reflect.set(window, 'releaseFileLock', resolve)));
  });
  await expect.poll(() => page.evaluate(() => typeof Reflect.get(window, 'releaseFileLock'))).toBe('function');
  await page.getByRole('textbox', { name: 'Edit Original', exact: true }).fill('Local title');
  await page.getByRole('textbox', { name: 'Edit Original', exact: true }).press('Tab');
  await runCommand(page, 'Settings');
  await expect(page.getByRole('region', { name: 'File sync', exact: true })).toContainText('Saving Planner.md');
  const settings = page.getByRole('dialog', { name: 'Hot Cross Buns settings', exact: true });
  await settings.getByRole('button', { name: 'close', exact: true }).click(); await expect(settings).toBeHidden();
  await runCommand(page, 'Download Planner.md');
  const download = page.waitForEvent('download');
  await page.getByRole('dialog', { name: 'Download Planner.md', exact: true }).getByRole('button', { name: 'download', exact: true }).click();
  await download;
  await externalEdit(page, initial.replace('Original', 'Remote title'));
  await page.evaluate(() => Reflect.get(window, 'releaseFileLock')());
  const notice = page.getByRole('status', { name: 'File sync', exact: true });
  await notice.getByRole('button', { name: 'Review linked file', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Review Planner.md import', exact: true });
  await expect(review).toContainText('Local title'); await expect(review).toContainText('Remote title');
  await review.getByRole('radio', { name: 'keep both', exact: true }).check();
  await review.getByRole('button', { name: 'apply import', exact: true }).click();
  await expect.poll(() => disk(page)).toContain('Local title');
  expect(await disk(page)).toContain('Remote title');
});

test('cancelling the native picker leaves the journal unlinked without an error', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => Reflect.set(window, 'showSaveFilePicker', async () => { throw new DOMException('Cancelled', 'AbortError'); }));
  await runCommand(page, 'Settings');
  await page.getByRole('button', { name: 'Create linked Planner.md', exact: true }).click();
  const section = page.getByRole('region', { name: 'File sync', exact: true });
  await expect(section.getByRole('button', { name: 'Create linked Planner.md', exact: true })).toBeEnabled();
  await expect(section.getByRole('alert')).toHaveCount(0); expect(await linked(page)).toBe(false);
});

test('an externally completed recurring item produces one portable successor', async ({ page }) => {
  await setup(page);
  const rule = '  @repeat: every 1 day after completion; series file-water; occurrence 1';
  const pending = plannerFixture(`2026-11-16\n\nWater plants\n${rule}\n- [ ] Check soil\n`);
  await externalEdit(page, pending); await linkExisting(page);
  await externalEdit(page, plannerFixture(`2026-11-16\nWater plants\n${rule}\n  @completed: 2026-11-16\n- [x] Check soil\n\n`));
  await expect.poll(() => disk(page)).toContain('occurrence 2');
  const output = await disk(page);
  expect(output).toContain('2026-11-17');
  expect(output.match(/occurrence 2/g)).toHaveLength(1);
  expect(output).toContain('- [x] Check soil');
  expect(output).toContain('- [ ] Check soil');
});

test('a stale linked-file conflict review cannot overwrite a newer edit from another window', async ({ page, context }) => {
  await setup(page); await externalEdit(page, initial); await linkExisting(page);
  const release = await holdSyncDelivery(page);
  await page.getByRole('textbox', { name: 'Edit Original', exact: true }).fill('Local title');
  await page.getByRole('textbox', { name: 'Edit Original', exact: true }).press('Tab');
  await externalEdit(page, initial.replace('Original', 'Remote title'));
  await release();
  const notice = page.getByRole('status', { name: 'File sync', exact: true });
  await expect(notice).toContainText('changed outside');
  await notice.getByRole('button', { name: 'Review linked file', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Review Planner.md import', exact: true });
  await expect(review).toContainText('Local title');
  const other = await context.newPage(); await other.goto('/');
  await other.getByRole('button', { name: 'Undated', exact: true }).click();
  await other.getByRole('textbox', { name: 'Edit Local title', exact: true }).fill('Newer window edit');
  await other.getByRole('textbox', { name: 'Edit Local title', exact: true }).press('Tab');
  await expect(page.locator('textarea[aria-label="Edit Newer window edit"]')).toHaveCount(1);
  await review.getByRole('radio', { name: 'keep both', exact: true }).check();
  await review.getByRole('button', { name: 'apply import', exact: true }).click();
  await expect(review.getByRole('alert')).toContainText('journal changed while this review was open');
  expect(await disk(page)).toContain('Remote title');
  await expect(other.getByRole('textbox', { name: 'Edit Newer window edit', exact: true })).toHaveValue('Newer window edit');
});

test('an incoming file edit merges automatically and survives reload', async ({ page }) => {
  await setup(page); await externalEdit(page, initial); await linkExisting(page);
  await externalEdit(page, initial.replace('Original', 'From phone'));
  await expect(page.getByRole('textbox', { name: 'Edit From phone', exact: true })).toBeVisible();
  await expect(page.getByRole('status', { name: 'File sync', exact: true })).toHaveCount(0);
  await page.reload(); await page.getByRole('button', { name: 'Undated', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Edit From phone', exact: true })).toBeVisible();
});

test('another tab cannot integrate an external edit over an active journal draft', async ({ page, context }) => {
  await setup(page); await externalEdit(page, initial); await linkExisting(page);
  const draft = page.getByRole('textbox', { name: 'Edit Original', exact: true }); await draft.fill('Uncommitted draft');
  const other = await context.newPage(); await other.goto('/'); await other.getByRole('button', { name: 'Undated', exact: true }).click();
  await externalEdit(page, initial.replace('Original', 'From phone'));
  await expect(other.getByRole('status', { name: 'Journal sync', exact: true })).toContainText('Finish editing');
  await expect(draft).toHaveValue('Uncommitted draft');
  expect((await syncState(page, 'current')).document.undated[0].items[0].text).toBe('Original');
  await draft.press('Tab');
  await expect(page.getByRole('status', { name: 'File sync', exact: true })).toContainText('review');
  expect(await disk(page)).toContain('From phone');
  await expect(other.getByRole('textbox', { name: 'Edit Uncommitted draft', exact: true })).toBeVisible();
});

test('incoming detail changes preserve local undo and recoverable comparison copies', async ({ page }) => {
  await setup(page); await externalEdit(page, initial); await linkExisting(page);
  const title = page.getByRole('textbox', { name: 'Edit Original', exact: true }); await title.fill('Local title'); await title.press('Tab');
  await expect.poll(() => disk(page)).toContain('Local title');
  await externalEdit(page, (await disk(page)).replace('Keep detail', 'Phone detail'));
  await expect(page.getByRole('textbox', { name: 'Edit detail Phone detail', exact: true })).toBeVisible();
  await runCommand(page, 'Settings');
  const copies = page.getByRole('region', { name: 'Sync recovery copies', exact: true });
  await expect(copies).toBeVisible();
  const before = (await syncState(page, 'linked-file')).baselineText;
  const download = page.waitForEvent('download'); await copies.getByRole('button', { name: 'Download browser copy', exact: true }).click();
  expect((await download).suggestedFilename()).toBe('Planner-browser-before-sync.md');
  expect((await syncState(page, 'linked-file')).baselineText).toBe(before);
  const settings = page.getByRole('dialog', { name: 'Hot Cross Buns settings', exact: true }); await settings.getByRole('button', { name: 'close', exact: true }).click(); await expect(settings).toBeHidden();
  await page.getByRole('button', { name: 'Undated', exact: true }).focus(); await page.keyboard.press('Control+z');
  await expect.poll(() => disk(page)).toMatch(/Original[\s\S]*  - Phone\ detail/);
  await page.keyboard.press('Control+Shift+z'); await expect.poll(() => disk(page)).toMatch(/Local\ title[\s\S]*  - Phone\ detail/);
});

for (const storageVersion of [1, 2]) test(`the Markdown transition archives v${storageVersion} data and file handles while fencing old writers`, async ({ page }) => {
  let seeded = false;
  await page.route('**/assets/index-*.js', async route => {
    if (!seeded) {
      seeded = true;
      await page.evaluate(async ({ initial, storageVersion }) => {
        const handle = await (await navigator.storage.getDirectory()).getFileHandle('TODO.txt', { create: true });
        const writer = await handle.createWritable(); await writer.write(initial); await writer.close();
        const document = { days: [], undated: [{ name: 'Inbox', items: [{ id: 'legacy-item', text: 'Original', completed: false, details: [{ text: 'Keep detail', completed: false }] }] }] };
        await new Promise<void>((resolve, reject) => {
          const open = indexedDB.open('hot-cross-buns-v1', storageVersion);
          open.onupgradeneeded = () => { open.result.createObjectStore('state'); open.result.createObjectStore('scratchpad'); };
          open.onsuccess = () => {
            const db = open.result, tx = db.transaction('state', 'readwrite'), store = tx.objectStore('state');
            store.put({ document, baseline: document, revision: 7 }, 'current');
            store.put({ id: 'legacy-link', handle, baselineText: initial, baselineDocument: document, needsReview: false, lastSavedAt: null }, 'linked-file');
            tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error);
          }; open.onerror = () => reject(open.error);
        });
      }, { initial, storageVersion });
    }
    await route.continue();
  });
  await setup(page,true); await page.getByRole('button', { name: 'Undated', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Edit Original', exact: true })).toBeVisible();
  expect((await syncState(page, 'current')).document.undated[0].items[0].id).toBe('legacy-item');
  expect(await linked(page)).toBe(false);
  expect((await syncState(page,'legacy-txt:linked-file')).handle.name).toBe('TODO.txt');
  const version = await page.evaluate(storageVersion => new Promise((resolve, reject) => {
    const old = indexedDB.open('hot-cross-buns-v1', storageVersion);
    old.onsuccess = () => { old.result.close(); reject(new Error('Old writer was admitted')); };
    old.onerror = () => resolve(old.error?.name);
  }), storageVersion);
  expect(version).toBe('VersionError');
  const title = page.getByRole('textbox', { name: 'Edit Original', exact: true }); await title.fill('After upgrade'); await title.press('Tab');
  await expect.poll(async()=> (await syncState(page,'current')).document.source).toContain('After upgrade');
  expect(await page.evaluate(async()=> (await (await (await navigator.storage.getDirectory()).getFileHandle('TODO.txt')).getFile()).text())).toBe(initial);
});

async function openConflictingFileReview(page: Page) {
  await setup(page); await externalEdit(page, initial); await linkExisting(page);
  const release = await holdSyncDelivery(page);
  const title = page.getByRole('textbox', { name: 'Edit Original', exact: true }); await title.fill('Local title'); await title.press('Tab');
  await externalEdit(page, initial.replace('Original', 'Remote title')); await release();
  const notice = page.getByRole('status', { name: 'File sync', exact: true });
  await notice.getByRole('button', { name: 'Review linked file', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Review Planner.md import', exact: true });
  await expect(review).toContainText('Local title'); await expect(review).toContainText('Remote title'); return review;
}

test('review refuses a file that changed again before approval', async ({ page }) => {
  const review = await openConflictingFileReview(page);
  await externalEdit(page, initial.replace('Original', 'Newer phone edit'));
  await review.getByRole('radio', { name: 'keep both', exact: true }).check();
  await review.getByRole('button', { name: 'apply import', exact: true }).click();
  await expect(review.getByRole('alert')).toContainText('file changed while this review was open');
  expect((await syncState(page, 'current')).document.undated[0].items.map((item: { text: string }) => item.text)).toEqual(['Local title']);
  expect(await disk(page)).toContain('Newer phone edit');
});

test('unlinking in another tab invalidates review before any journal changes commit', async ({ page, context }) => {
  const review = await openConflictingFileReview(page);
  const other = await context.newPage(); await other.goto('/'); await runCommand(other, 'Settings');
  await other.getByRole('region', { name: 'File sync', exact: true }).getByRole('button', { name: 'Unlink file', exact: true }).click();
  await expect.poll(() => linked(other)).toBe(false);
  await review.getByRole('radio', { name: 'keep both', exact: true }).check(); await review.getByRole('button', { name: 'apply import', exact: true }).click();
  await expect(review.getByRole('alert')).toContainText('file link changed');
  expect((await syncState(page, 'current')).document.undated[0].items.map((item: { text: string }) => item.text)).toEqual(['Local title']);
  expect(await linked(page)).toBe(false); expect(await disk(page)).toContain('Remote title');
});

test('a failed reviewed-link transaction rolls back the journal and baseline together', async ({ page }) => {
  const review = await openConflictingFileReview(page);
  const generation = (await syncState(page, 'file-sync-ledger')).generation;
  await page.evaluate(generation => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(value, key) {
      if (key === 'file-sync-ledger' && value.generation !== generation) throw new DOMException('Review checkpoint is full', 'QuotaExceededError');
      return put.call(this, value, key);
    };
  }, generation);
  await review.getByRole('radio', { name: 'keep both', exact: true }).check(); await review.getByRole('button', { name: 'apply import', exact: true }).click();
  await expect(review.getByRole('alert')).toContainText('Review checkpoint is full');
  expect((await syncState(page, 'current')).document.undated[0].items.map((item: { text: string }) => item.text)).toEqual(['Local title']);
  const link = await syncState(page, 'linked-file'); expect(link.needsReview).toBe(true); expect(link.baselineText).toContain('Original');
  expect(await disk(page)).toContain('Remote title');
});
