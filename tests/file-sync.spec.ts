import { expect, test, type Page } from '@playwright/test';
import { runCommand } from './commands';

const initial = 'UNDATED\n\nLIST: Inbox\nOriginal\n- Keep detail\n';
async function setup(page: Page) {
  // use real, cloneable browser file handles; only the OS picker is replaced in headless tests.
  await page.addInitScript(() => {
    const pick = async () => (await navigator.storage.getDirectory()).getFileHandle('TODO.txt', { create: true });
    Object.assign(window, { showOpenFilePicker: async () => [await pick()], showSaveFilePicker: pick });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open command palette', exact: true }).waitFor();
}
async function disk(page: Page, synchronized = true): Promise<string> {
  return page.evaluate(async synchronized => {
    const read = async () => (await (await (await navigator.storage.getDirectory()).getFileHandle('TODO.txt', { create: true })).getFile()).text();
    // a File snapshot can become unreadable when an app save replaces it midway through a test read.
    return synchronized ? navigator.locks.request('hot-cross-buns-linked-file', read) : read();
  }, synchronized);
}
async function externalEdit(page: Page, text: string) {
  await page.evaluate(async text => {
    const handle = await (await navigator.storage.getDirectory()).getFileHandle('TODO.txt', { create: true });
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
  await page.getByRole('button', { name: 'Link existing TODO.txt', exact: true }).click();
  await expect.poll(() => linked(page)).toBe(true);
  await page.getByRole('button', { name: 'Undated', exact: true }).click();
}

test('creating a linked file saves the full journal and persists the handle after reload', async ({ page }) => {
  await setup(page);
  await page.getByLabel('Import a TODO.txt file').setInputFiles({ name: 'TODO.txt', mimeType: 'text/plain', buffer: Buffer.from(initial) });
  await runCommand(page, 'Settings');
  await page.getByRole('button', { name: 'Create linked TODO.txt', exact: true }).click();
  await expect.poll(() => disk(page)).toContain('Original\n- Keep detail');
  await expect(page.getByRole('region', { name: 'File sync', exact: true })).toContainText('Last written at');
  await page.reload();
  await page.getByRole('button', { name: 'Undated', exact: true }).click();
  await page.getByRole('textbox', { name: 'Edit Original', exact: true }).fill('After reload');
  await page.getByRole('textbox', { name: 'Edit Original', exact: true }).press('Tab');
  await expect.poll(() => disk(page)).toContain('After reload\n- Keep detail');
});

test('linking an existing file imports it and later browser edits save directly', async ({ page }) => {
  await setup(page); await externalEdit(page, initial); await linkExisting(page);
  await expect(page.getByRole('textbox', { name: 'Edit Original', exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Edit Original', exact: true }).fill('Saved directly');
  await page.getByRole('textbox', { name: 'Edit Original', exact: true }).press('Tab');
  await expect.poll(() => disk(page)).toContain('Saved directly\n- Keep detail');
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

test('an external change pauses saves across reload, and conflict review resumes them', async ({ page }) => {
  await setup(page); await externalEdit(page, initial); await linkExisting(page);
  await page.getByRole('textbox', { name: 'Edit Original', exact: true }).fill('Local title');
  await page.getByRole('textbox', { name: 'Edit Original', exact: true }).press('Tab');
  await expect.poll(() => disk(page)).toContain('Local title');
  await externalEdit(page, initial.replace('Original', 'Remote title'));
  const notice = page.getByRole('status', { name: 'File sync', exact: true });
  await expect(notice).toContainText('changed outside');
  await page.getByRole('textbox', { name: 'Edit Local title', exact: true }).fill('Local edit after remote change');
  await page.getByRole('textbox', { name: 'Edit Local title', exact: true }).press('Tab');
  await page.reload();
  await page.getByRole('button', { name: 'Undated', exact: true }).click();
  await expect(notice).toContainText('paused');
  expect(await disk(page)).toContain('Remote title');
  await notice.getByRole('button', { name: 'Review linked file', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Review TODO.txt import', exact: true });
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
  await page.getByLabel('Import a TODO.txt file').setInputFiles({ name: 'TODO.txt', mimeType: 'text/plain', buffer: Buffer.from(initial) });
  await page.getByRole('button', { name: 'Undated', exact: true }).click();
  await page.getByRole('textbox', { name: 'Edit Original', exact: true }).fill('Local title');
  await page.getByRole('textbox', { name: 'Edit Original', exact: true }).press('Tab');
  await externalEdit(page, initial.replace('Original', 'Remote title'));
  await runCommand(page, 'Settings');
  await page.getByRole('button', { name: 'Link existing TODO.txt', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Review TODO.txt import', exact: true });
  await expect(review).toBeVisible();
  await review.getByRole('button', { name: 'cancel', exact: true }).click();
  expect(await linked(page)).toBe(false); expect(await disk(page)).toContain('Remote title');
  await expect(page.getByRole('textbox', { name: 'Edit Local title', exact: true })).toBeVisible();
});

test('creating a link refuses to replace a file that already has content', async ({ page }) => {
  await setup(page); await externalEdit(page, initial);
  await runCommand(page, 'Settings');
  await page.getByRole('button', { name: 'Create linked TODO.txt', exact: true }).click();
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
  const malformed = '2026-11-16\nTask without divider\n';
  await externalEdit(page, malformed);
  await runCommand(page, 'Settings');
  await page.getByRole('button', { name: 'Link existing TODO.txt', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Review TODO.txt import', exact: true });
  await expect(review).toContainText('including any repairs');
  expect(await linked(page)).toBe(false); expect(await disk(page)).toBe(malformed);
  await review.getByRole('button', { name: 'mark this day upcoming', exact: true }).click();
  await review.getByRole('button', { name: 'apply import', exact: true }).click();
  await expect.poll(() => linked(page)).toBe(true);
  await expect.poll(() => disk(page)).toContain('2026-11-16\n\nTask without divider');
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
  await expect.poll(() => disk(page)).toContain('First window\n- Second window detail');
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
  await expect(page.getByRole('region', { name: 'File sync', exact: true })).toContainText('Saving TODO.txt');
  const settings = page.getByRole('dialog', { name: 'Hot Cross Buns settings', exact: true });
  await settings.getByRole('button', { name: 'close', exact: true }).click(); await expect(settings).toBeHidden();
  await runCommand(page, 'Download TODO.txt');
  const download = page.waitForEvent('download');
  await page.getByRole('dialog', { name: 'Download TODO.txt', exact: true }).getByRole('button', { name: 'download', exact: true }).click();
  await download;
  await externalEdit(page, initial.replace('Original', 'Remote title'));
  await page.evaluate(() => Reflect.get(window, 'releaseFileLock')());
  const notice = page.getByRole('status', { name: 'File sync', exact: true });
  await notice.getByRole('button', { name: 'Review linked file', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Review TODO.txt import', exact: true });
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
  await page.getByRole('button', { name: 'Create linked TODO.txt', exact: true }).click();
  const section = page.getByRole('region', { name: 'File sync', exact: true });
  await expect(section.getByRole('button', { name: 'Create linked TODO.txt', exact: true })).toBeEnabled();
  await expect(section.getByRole('alert')).toHaveCount(0); expect(await linked(page)).toBe(false);
});

test('an externally completed recurring item produces one portable successor', async ({ page }) => {
  await setup(page);
  const rule = '  @repeat: every 1 day after completion; series file-water; occurrence 1';
  const pending = `2026-11-16\n\nWater plants\n${rule}\n- [ ] Check soil\n`;
  await externalEdit(page, pending); await linkExisting(page);
  await externalEdit(page, `2026-11-16\nWater plants\n${rule}\n  @completed: 2026-11-16\n- [x] Check soil\n\n`);
  const notice = page.getByRole('status', { name: 'File sync', exact: true });
  await notice.getByRole('button', { name: 'Review linked file', exact: true }).click();
  await expect.poll(() => disk(page)).toContain('occurrence 2');
  const output = await disk(page);
  expect(output).toContain('2026-11-17');
  expect(output.match(/occurrence 2/g)).toHaveLength(1);
  expect(output).toContain('- [x] Check soil');
  expect(output).toContain('- [ ] Check soil');
});

test('a stale linked-file conflict review cannot overwrite a newer edit from another window', async ({ page, context }) => {
  await setup(page); await externalEdit(page, initial); await linkExisting(page);
  await externalEdit(page, initial.replace('Original', 'Remote title'));
  const notice = page.getByRole('status', { name: 'File sync', exact: true });
  await expect(notice).toContainText('changed outside');
  await page.getByRole('textbox', { name: 'Edit Original', exact: true }).fill('Local title');
  await page.getByRole('textbox', { name: 'Edit Original', exact: true }).press('Tab');
  await notice.getByRole('button', { name: 'Review linked file', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Review TODO.txt import', exact: true });
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
