import { plannerFixture } from './planner-fixture';
import { expect, test, type Page } from '@playwright/test';
import { createRevision, parseRevision, revisionText, sha256, type Revision } from '../src/revisionProtocol';
import { openCommands, openHistory, runCommand } from './commands';
import { holdSyncDelivery, syncState } from './sync-helpers';

const initial = plannerFixture('UNDATED\n\nLIST: Inbox\nOriginal\n');
const historyName = await sha256('Planner.md');
async function setup(page: Page) {
  await page.addInitScript(() => {
    const folder = () => navigator.storage.getDirectory();
    const pick = async () => (await folder()).getFileHandle('Planner.md', { create: true });
    Object.assign(window, { showDirectoryPicker: folder, showOpenFilePicker: async () => [await pick()], showSaveFilePicker: pick });
  });
  await page.goto('/');
  await page.getByLabel('Import a Planner.md file').setInputFiles({ name: 'Planner.md', mimeType: 'text/plain', buffer: Buffer.from(plannerFixture(initial)) });
  await runCommand(page, 'Settings'); await page.getByRole('button', { name: 'Link sync folder', exact: true }).click();
  await expect.poll(() => disk(page)).toBe(initial);
  const settings = page.getByRole('dialog', { name: 'Hot Cross Buns settings', exact: true });
  await settings.getByRole('button', { name: 'close', exact: true }).click(); await expect(settings).toBeHidden();
  await page.getByRole('button', { name: 'Undated', exact: true }).click();
}
async function disk(page: Page) {
  return page.evaluate(() => navigator.locks.request('hot-cross-buns-sync-delivery', async () => {
    const file = await (await (await navigator.storage.getDirectory()).getFileHandle('Planner.md', { create: true })).getFile(); return file.text();
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

test('folder links retain plain Planner.md and verified immutable revisions across reload', async ({ page }) => {
  await setup(page);
  const first = await history(page); expect(first).toHaveLength(1);
  expect((await parseRevision(revisionText(first[0]), 'file:Planner.md')).text).toBe(initial);
  await page.reload(); await page.getByRole('button', { name: 'Undated', exact: true }).click();
  const field = page.getByRole('textbox', { name: 'Edit Original', exact: true }); await field.fill('After reload'); await field.press('Tab');
  await expect.poll(() => disk(page)).toContain('After reload');
  expect((await history(page)).some(record => record.text === initial)).toBe(true);
  await runCommand(page, 'Settings');
  await expect(page.getByRole('region', { name: 'File sync', exact: true })).toContainText('Revision history is enabled');
});

test('a concurrent revision remains reviewable after its Planner.md projection was overwritten', async ({ page }) => {
  await setup(page); const root = (await history(page))[0];
  const field = page.getByRole('textbox', { name: 'Edit Original', exact: true }); await field.fill('Local branch'); await field.press('Tab');
  await expect.poll(() => disk(page)).toContain('Local branch');
  const remote = await createRevision('file:Planner.md', crypto.randomUUID(), [root.id], initial.replace('Original', 'Other device branch'));
  await put(page, remote);
  const notice = page.getByRole('status', { name: 'File sync', exact: true });
  await notice.getByRole('button', { name: 'Review linked file', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Review Planner.md import', exact: true });
  await expect(review).toContainText('Local branch'); await expect(review).toContainText('Other device branch');
  await review.getByRole('radio', { name: 'keep both', exact: true }).check(); await review.getByRole('button', { name: 'apply import', exact: true }).click();
  await expect(review).toBeHidden(); await expect.poll(() => disk(page)).toContain('Other device branch');
  const all = await history(page); expect(all.some(record => record.id === remote.id)).toBe(true);
  expect(all.some(record => record.parents.length === 2 && record.text.includes('Local branch') && record.text.includes('Other device branch'))).toBe(true);
});

test('an incoming linear revision waits for a draft, then overlapping saved intent is preserved', async ({ page }) => {
  await setup(page); const root = (await history(page))[0];
  const draft = page.getByRole('textbox', { name: 'Edit Original', exact: true }); await draft.fill('Uncommitted local draft');
  await put(page, await createRevision('file:Planner.md', crypto.randomUUID(), [root.id], initial.replace('Original', 'Remote')));
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
    const folder = () => navigator.storage.getDirectory(), file = async () => (await folder()).getFileHandle('Planner.md', { create: true });
    Object.assign(window, { showDirectoryPicker: folder, showOpenFilePicker: async () => [await file()], showSaveFilePicker: file });
  });
  await page.goto('/'); await page.getByLabel('Import a Planner.md file').setInputFiles({ name: 'Planner.md', mimeType: 'text/plain', buffer: Buffer.from(plannerFixture(initial)) });
  await runCommand(page, 'Settings'); await page.getByRole('button', { name: 'Create linked Planner.md', exact: true }).click();
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
  const incoming = await createRevision('file:Planner.md', crypto.randomUUID(), link.frontier, plannerFixture('UNDATED\n\nLIST: Inbox\nLocal title\n- Incoming detail\n'));
  await put(page, incoming);
  await expect(page.getByRole('textbox', { name: 'Edit detail Incoming detail', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Undated', exact: true }).focus(); await page.keyboard.press('Control+z');
  await expect.poll(() => disk(page)).toMatch(/- Original[\s\S]*  - Incoming detail/);
  await page.keyboard.press('Control+Shift+z'); await expect.poll(() => disk(page)).toMatch(/- Local title[\s\S]*  - Incoming detail/);
});

test('an empty revision file waits for transfer and resumes when its complete envelope arrives', async ({ page }) => {
  await setup(page); const root = (await history(page))[0];
  const incoming = await createRevision('file:Planner.md', crypto.randomUUID(), [root.id], initial.replace('Original', 'Transferred'));
  await page.evaluate(async ({ name, id }) => {
    const folder = await (await (await navigator.storage.getDirectory()).getDirectoryHandle('.hot-cross-buns')).getDirectoryHandle(name);
    await folder.getFileHandle(id + '.json', { create: true });
  }, { name: historyName, id: incoming.id });
  await expect.poll(async () => (await syncState(page, 'file-sync-ledger')).status.kind).toBe('retrying');
  expect(await disk(page)).toBe(initial); await put(page, incoming);
  await expect(page.getByRole('textbox', { name: 'Edit Transferred', exact: true })).toBeVisible();
});

test('history stays behind palette queries and explains browser-only journals without adding chrome', async ({ page }) => {
  await page.goto('/'); const palette = await openCommands(page);
  await expect(palette.getByRole('option')).toHaveCount(5);
  await expect(palette.getByRole('option', { name: 'History and recovery', exact: true })).toHaveCount(0);
  for (const query of ['recovery', 'versions', 'restore']) {
    await palette.getByRole('combobox').fill(query);
    await expect(palette.getByRole('option', { name: 'History and recovery', exact: true })).toBeVisible();
  }
  const view = await openHistory(page);
  await expect(view).toContainText('Browser-only journals');
  await expect(view.getByRole('button', { name: 'Restore version', exact: true })).toHaveCount(0);
  await view.press('Escape'); await expect(view).toBeHidden();
  await expect(page.getByRole('button', { name: 'Open command palette', exact: true })).toBeFocused();
});

test('history preview and download are read-only; a confirmed restoration retains later versions and undo', async ({ page }) => {
  await setup(page); const root = (await history(page))[0];
  const field = page.getByRole('textbox', { name: 'Edit Original', exact: true }); await field.fill('Latest version'); await field.press('Tab');
  await expect.poll(() => disk(page)).toContain('Latest version');
  await expect.poll(async () => (await syncState(page, 'file-sync-ledger')).status.kind).toBe('saved');
  const before = await syncState(page, 'current'), linkBefore = await syncState(page, 'linked-file');
  const view = await openHistory(page, 'versions'); await view.getByLabel('Saved version').selectOption(root.id);
  await expect(view.getByLabel('Current journal comparison')).toContainText('Latest version');
  await expect(view.getByLabel('Selected version comparison')).toContainText('Original');
  const download = page.waitForEvent('download'); await view.getByRole('button', { name: 'Download version', exact: true }).click();
  const stream = await (await download).createReadStream(); const chunks = []; for await (const chunk of stream!) chunks.push(chunk);
  expect(Buffer.concat(chunks).toString()).toBe(initial);
  expect(await syncState(page, 'current')).toEqual(before); expect(await syncState(page, 'linked-file')).toEqual(linkBefore);
  await view.getByRole('button', { name: 'Restore version', exact: true }).click();
  await view.getByRole('button', { name: 'Cancel restoration', exact: true }).click(); expect(await disk(page)).toContain('Latest version');
  await view.getByRole('button', { name: 'Restore version', exact: true }).click();
  await view.getByRole('button', { name: 'Restore as new version', exact: true }).click(); await expect(view).toBeHidden();
  await expect.poll(() => disk(page)).toBe(initial);
  const all = await history(page); expect(all).toHaveLength(3);
  const latest = all.find(record => record.text.includes('Latest version'))!;
  expect(all.some(record => record.id !== root.id && record.text === initial && record.parents.includes(latest.id))).toBe(true);
  await page.getByRole('button', { name: 'Undated', exact: true }).focus(); await page.keyboard.press('Control+z');
  await expect.poll(() => disk(page)).toContain('Latest version');
});

test('history notices a journal edit in another window and rejects the stale restoration', async ({ page, context }) => {
  await setup(page); const root = (await history(page))[0];
  const field = page.getByRole('textbox', { name: 'Edit Original', exact: true }); await field.fill('Current'); await field.press('Tab');
  await expect.poll(() => disk(page)).toContain('Current');
  const other = await context.newPage(); await other.goto('/?popout=undated&list=Inbox');
  const view = await openHistory(page); await view.getByLabel('Saved version').selectOption(root.id);
  await other.bringToFront(); const edit = other.getByRole('textbox', { name: 'Edit Current', exact: true }); await edit.fill('From another window'); await edit.press('Tab');
  await expect.poll(async () => (await syncState(other, 'current')).document.undated[0].items[0].text).toBe('From another window');
  await page.bringToFront(); await expect(view).toContainText('The journal changed.');
  await expect(view.getByRole('button', { name: 'Restore version', exact: true })).toBeDisabled();
  await view.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Edit From another window', exact: true })).toBeVisible(); await other.close();
});

test('a failed recovery transaction keeps the journal and every immutable version', async ({ page }) => {
  await setup(page); const root = (await history(page))[0];
  const field = page.getByRole('textbox', { name: 'Edit Original', exact: true }); await field.fill('Keep this version'); await field.press('Tab');
  await expect.poll(() => disk(page)).toContain('Keep this version');
  const view = await openHistory(page); await view.getByLabel('Saved version').selectOption(root.id);
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(value, key) { if (key === 'file-sync-ledger' && value.revisions?.pending?.record.text.includes('Original')) throw new DOMException('Recovery storage is full', 'QuotaExceededError'); return put.call(this, value, key); };
  });
  await view.getByRole('button', { name: 'Restore version', exact: true }).click(); await view.getByRole('button', { name: 'Restore as new version', exact: true }).click();
  await expect(view.getByRole('alert')).toContainText('Recovery storage is full');
  expect((await syncState(page, 'current')).document.undated[0].items[0].text).toBe('Keep this version');
  expect(await disk(page)).toContain('Keep this version'); expect(await history(page)).toHaveLength(2);
});

test('history cannot replace a journal while another window holds an unfinished draft', async ({ page, context }) => {
  await setup(page); const root = (await history(page))[0];
  const field = page.getByRole('textbox', { name: 'Edit Original', exact: true }); await field.fill('Current'); await field.press('Tab');
  await expect.poll(() => disk(page)).toContain('Current');
  const other = await context.newPage(); await other.goto('/?popout=undated&list=Inbox');
  const draft = other.getByRole('textbox', { name: 'Edit Current', exact: true }); await draft.fill('Unfinished draft');
  const view = await openHistory(page); await view.getByLabel('Saved version').selectOption(root.id);
  await view.getByRole('button', { name: 'Restore version', exact: true }).click(); await view.getByRole('button', { name: 'Restore as new version', exact: true }).click();
  await expect(view.getByRole('alert')).toContainText('Finish editing journal fields');
  await expect(draft).toHaveValue('Unfinished draft');
  expect((await syncState(page, 'current')).document.undated[0].items[0].text).toBe('Current');
  expect(await history(page)).toHaveLength(2); await other.close();
});

test('an incoming branch opens the existing review from history on a narrow screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ reducedMotion: 'reduce' });
  await setup(page); const root = (await history(page))[0];
  const field = page.getByRole('textbox', { name: 'Edit Original', exact: true }); await field.fill('Local branch'); await field.press('Tab');
  await expect.poll(() => disk(page)).toContain('Local branch');
  const view = await openHistory(page);
  const branch = await createRevision('file:Planner.md', crypto.randomUUID(), [root.id], initial.replace('Original', 'Recovered branch'));
  await put(page, branch); await view.getByRole('button', { name: 'Refresh history', exact: true }).click();
  await view.getByLabel('Saved version').selectOption(branch.id);
  await expect(view.getByRole('button', { name: 'Restore version', exact: true })).toBeDisabled();
  expect(await view.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await view.getByRole('button', { name: 'Review this branch', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Review Planner.md import', exact: true });
  await expect(view).toBeHidden(); await expect(review).toContainText('Recovered branch'); await expect(review).toContainText('Local branch');
  await review.getByRole('radio', { name: 'keep both', exact: true }).check(); await review.getByRole('button', { name: 'apply import', exact: true }).click();
  await expect.poll(() => disk(page)).toContain('Recovered branch');
});

test('corrupt history is reported in recovery instead of exposing a restore action', async ({ page }) => {
  await setup(page); const root = (await history(page))[0]; const view = await openHistory(page);
  await page.evaluate(async ({ name, id }) => {
    const folder = await (await (await navigator.storage.getDirectory()).getDirectoryHandle('.hot-cross-buns')).getDirectoryHandle(name);
    const handle = await folder.getFileHandle(id + '.json'), writer = await handle.createWritable(); await writer.write('{}'); await writer.close();
  }, { name: historyName, id: root.id });
  await view.getByRole('button', { name: 'Refresh history', exact: true }).click(); await expect(view.getByRole('alert')).toBeVisible();
  await expect(view.getByRole('button', { name: 'Restore version', exact: true })).toHaveCount(0);
  expect(await disk(page)).toBe(initial);
});
