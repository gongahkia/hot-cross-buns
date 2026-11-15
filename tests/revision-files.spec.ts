import { expect, test, type Page } from '@playwright/test';
import { createRevision, parseRevision, revisionText, sha256, type Revision } from '../src/revisionProtocol';
import { runCommand } from './commands';
import { holdSyncDelivery, syncState } from './sync-helpers';

const initial = 'UNDATED\n\nLIST: Inbox\nOriginal\n';
const historyName = await sha256('TODO.txt');
async function setup(page: Page) {
  await page.addInitScript(() => {
    const folder = () => navigator.storage.getDirectory();
    const pick = async () => (await folder()).getFileHandle('TODO.txt', { create: true });
    Object.assign(window, { showDirectoryPicker: folder, showOpenFilePicker: async () => [await pick()], showSaveFilePicker: pick });
  });
  await page.goto('/');
  await page.getByLabel('Import a TODO.txt file').setInputFiles({ name: 'TODO.txt', mimeType: 'text/plain', buffer: Buffer.from(initial) });
  await runCommand(page, 'Settings'); await page.getByRole('button', { name: 'Link sync folder', exact: true }).click();
  await expect.poll(() => disk(page)).toBe(initial);
  const settings = page.getByRole('dialog', { name: 'Hot Cross Buns settings', exact: true });
  await settings.getByRole('button', { name: 'close', exact: true }).click(); await expect(settings).toBeHidden();
  await page.getByRole('button', { name: 'Undated', exact: true }).click();
}
async function disk(page: Page) {
  return page.evaluate(() => navigator.locks.request('hot-cross-buns-sync-delivery', async () => {
    const file = await (await (await navigator.storage.getDirectory()).getFileHandle('TODO.txt', { create: true })).getFile(); return file.text();
  }));
}
async function history(page: Page): Promise<Revision[]> {
  return page.evaluate(name => navigator.locks.request('hot-cross-buns-sync-delivery', async () => {
    const folder = await (await (await navigator.storage.getDirectory()).getDirectoryHandle('.hot-cross-buns')).getDirectoryHandle(name) as FileSystemDirectoryHandle & { values(): AsyncIterableIterator<FileSystemHandle> };
    const records = [];
    for await (const entry of folder.values()) if (entry.kind === 'file') records.push(JSON.parse(await (await (entry as FileSystemFileHandle).getFile()).text()));
    return records;
  }), historyName);
}
async function put(page: Page, record: Revision) {
  await page.evaluate(async ({ name, id, raw }) => {
    const folder = await (await (await navigator.storage.getDirectory()).getDirectoryHandle('.hot-cross-buns')).getDirectoryHandle(name);
    const writer = await (await folder.getFileHandle(id + '.json', { create: true })).createWritable(); await writer.write(raw); await writer.close();
  }, { name: historyName, id: record.id, raw: revisionText(record) });
}

test('folder links retain plain TODO.txt and verified immutable revisions across reload', async ({ page }) => {
  await setup(page);
  const first = await history(page); expect(first).toHaveLength(1);
  expect((await parseRevision(revisionText(first[0]), 'file:TODO.txt')).text).toBe(initial);
  await page.reload(); await page.getByRole('button', { name: 'Undated', exact: true }).click();
  const field = page.getByRole('textbox', { name: 'Edit Original', exact: true }); await field.fill('After reload'); await field.press('Tab');
  await expect.poll(() => disk(page)).toContain('After reload');
  expect((await history(page)).some(record => record.text === initial)).toBe(true);
  await runCommand(page, 'Settings');
  await expect(page.getByRole('region', { name: 'File sync', exact: true })).toContainText('Revision history is enabled');
});

test('a concurrent revision remains reviewable after its TODO.txt projection was overwritten', async ({ page }) => {
  await setup(page); const root = (await history(page))[0];
  const field = page.getByRole('textbox', { name: 'Edit Original', exact: true }); await field.fill('Local branch'); await field.press('Tab');
  await expect.poll(() => disk(page)).toContain('Local branch');
  const remote = await createRevision('file:TODO.txt', crypto.randomUUID(), [root.id], initial.replace('Original', 'Other device branch'));
  await put(page, remote);
  const notice = page.getByRole('status', { name: 'File sync', exact: true });
  await notice.getByRole('button', { name: 'Review linked file', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Review TODO.txt import', exact: true });
  await expect(review).toContainText('Local branch'); await expect(review).toContainText('Other device branch');
  await review.getByRole('radio', { name: 'keep both', exact: true }).check(); await review.getByRole('button', { name: 'apply import', exact: true }).click();
  await expect(review).toBeHidden(); await expect.poll(() => disk(page)).toContain('Other device branch');
  const all = await history(page); expect(all.some(record => record.id === remote.id)).toBe(true);
  expect(all.some(record => record.parents.length === 2 && record.text.includes('Local branch') && record.text.includes('Other device branch'))).toBe(true);
});

test('an incoming linear revision waits for a draft, then overlapping saved intent is preserved', async ({ page }) => {
  await setup(page); const root = (await history(page))[0];
  const draft = page.getByRole('textbox', { name: 'Edit Original', exact: true }); await draft.fill('Uncommitted local draft');
  await put(page, await createRevision('file:TODO.txt', crypto.randomUUID(), [root.id], initial.replace('Original', 'Remote')));
  await expect(page.getByRole('status', { name: 'Journal sync', exact: true })).toContainText('Finish editing');
  await expect(draft).toHaveValue('Uncommitted local draft');
  await draft.press('Tab'); await expect(page.getByRole('status', { name: 'File sync', exact: true })).toContainText('review');
  expect((await history(page)).some(record => record.text.includes('Uncommitted local draft'))).toBe(true);
  expect((await syncState(page, 'current')).document.undated[0].items[0].text).toBe('Uncommitted local draft');
});

test('corrupted history pauses saving and keeps the existing journal and all files', async ({ page }) => {
  await setup(page); const root = (await history(page))[0];
  await page.evaluate(async ({ name, id }) => {
    const folder = await (await (await navigator.storage.getDirectory()).getDirectoryHandle('.hot-cross-buns')).getDirectoryHandle(name);
    const handle = await folder.getFileHandle(id + '.json'), raw = await (await handle.getFile()).text(), writer = await handle.createWritable();
    await writer.write(raw.replace('Original', 'Corrupted')); await writer.close();
  }, { name: historyName, id: root.id });
  await expect(page.getByRole('status', { name: 'File sync', exact: true })).toContainText('integrity');
  expect(await disk(page)).toBe(initial); await expect(page.getByRole('textbox', { name: 'Edit Original', exact: true })).toHaveValue('Original');
});

test('a failed revision checkpoint blocks history publication and projection writing', async ({ page }) => {
  await setup(page); const release = await holdSyncDelivery(page);
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(value, key) { if (key === 'file-sync-ledger' && value.revisions?.pending) throw new DOMException('History checkpoint is full', 'QuotaExceededError'); return put.call(this, value, key); };
  });
  const field = page.getByRole('textbox', { name: 'Edit Original', exact: true }); await field.fill('Saved only in browser'); await field.press('Tab'); await release();
  await expect(page.getByRole('status', { name: 'File sync', exact: true })).toContainText('History checkpoint is full');
  expect(await disk(page)).toBe(initial); expect(await history(page)).toHaveLength(1);
  expect((await syncState(page, 'current')).document.undated[0].items[0].text).toBe('Saved only in browser');
});

test('an existing single-file link upgrades only after the matching folder is selected', async ({ page }) => {
  await page.addInitScript(() => {
    const folder = () => navigator.storage.getDirectory(), file = async () => (await folder()).getFileHandle('TODO.txt', { create: true });
    Object.assign(window, { showDirectoryPicker: folder, showOpenFilePicker: async () => [await file()], showSaveFilePicker: file });
  });
  await page.goto('/'); await page.getByLabel('Import a TODO.txt file').setInputFiles({ name: 'TODO.txt', mimeType: 'text/plain', buffer: Buffer.from(initial) });
  await runCommand(page, 'Settings'); await page.getByRole('button', { name: 'Create linked TODO.txt', exact: true }).click();
  await expect.poll(() => disk(page)).toBe(initial);
  await page.getByRole('button', { name: 'Enable folder revision history', exact: true }).click();
  await expect.poll(async () => (await syncState(page, 'file-sync-ledger'))?.revisions?.recordedText).toBe(initial);
  expect((await history(page))[0].text).toBe(initial);
  await page.getByRole('button', { name: 'Unlink file', exact: true }).click();
  expect(await disk(page)).toBe(initial); expect(await history(page)).toHaveLength(1);
});

test('a linear detail update preserves local title undo and redo in protected mode', async ({ page }) => {
  await setup(page);
  const title = page.getByRole('textbox', { name: 'Edit Original', exact: true }); await title.fill('Local title'); await title.press('Tab');
  await expect.poll(() => disk(page)).toContain('Local title');
  const link = (await syncState(page, 'file-sync-ledger')).revisions;
  const incoming = await createRevision('file:TODO.txt', crypto.randomUUID(), link.frontier, 'UNDATED\n\nLIST: Inbox\nLocal title\n- Incoming detail\n');
  await put(page, incoming);
  await expect(page.getByRole('textbox', { name: 'Edit detail Incoming detail', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Undated', exact: true }).focus(); await page.keyboard.press('Control+z');
  await expect.poll(() => disk(page)).toContain('Original\n- Incoming detail');
  await page.keyboard.press('Control+Shift+z'); await expect.poll(() => disk(page)).toContain('Local title\n- Incoming detail');
});

test('an empty revision file waits for transfer and resumes when its complete envelope arrives', async ({ page }) => {
  await setup(page); const root = (await history(page))[0];
  const incoming = await createRevision('file:TODO.txt', crypto.randomUUID(), [root.id], initial.replace('Original', 'Transferred'));
  await page.evaluate(async ({ name, id }) => {
    const folder = await (await (await navigator.storage.getDirectory()).getDirectoryHandle('.hot-cross-buns')).getDirectoryHandle(name);
    await folder.getFileHandle(id + '.json', { create: true });
  }, { name: historyName, id: incoming.id });
  await expect.poll(async () => (await syncState(page, 'file-sync-ledger')).status.kind).toBe('retrying');
  expect(await disk(page)).toBe(initial); await put(page, incoming);
  await expect(page.getByRole('textbox', { name: 'Edit Transferred', exact: true })).toBeVisible();
});
