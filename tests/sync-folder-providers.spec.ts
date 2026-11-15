import { expect, test, type Page } from '@playwright/test';
import { openHistory, runCommand } from './commands';
import { holdSyncDelivery, syncState } from './sync-helpers';
import { createRevision, revisionText, sha256, type Revision } from '../src/revisionProtocol';
import { serializeTodoText } from '../src/todoText';

const initial = 'UNDATED\n\nLIST: Inbox\nOriginal\n';
async function setup(page: Page) {
  await page.addInitScript(() => {
    Object.assign(window, { showDirectoryPicker: () => navigator.storage.getDirectory() });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
  });
  await page.goto('/');
  await page.getByLabel('Import a TODO.txt file').setInputFiles({ name: 'TODO.txt', mimeType: 'text/plain', buffer: Buffer.from(initial) });
  await runCommand(page, 'Settings'); await page.getByRole('button', { name: 'Link sync folder', exact: true }).click();
  await expect.poll(async () => (await syncState(page, 'file-sync-ledger'))?.status.kind).toBe('saved');
  const settings = page.getByRole('dialog', { name: 'Hot Cross Buns settings', exact: true });
  await settings.getByRole('button', { name: 'close', exact: true }).click(); await expect(settings).toBeHidden();
  await page.getByRole('button', { name: 'Undated', exact: true }).click();
}

async function tree(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() => navigator.locks.request('hot-cross-buns-sync-delivery', async () => {
    const result: Record<string, string> = {};
    const visit = async (folder: FileSystemDirectoryHandle, path: string) => {
      for await (const entry of (folder as FileSystemDirectoryHandle & { values(): AsyncIterableIterator<FileSystemHandle> }).values()) {
        if (entry.kind === 'directory') await visit(entry as FileSystemDirectoryHandle, path + entry.name + '/');
        else result[path + entry.name] = await (await (entry as FileSystemFileHandle).getFile()).text();
      }
    };
    await visit(await navigator.storage.getDirectory(), ''); return result;
  }));
}
async function deliver(page: Page, files: Record<string, string>) {
  await page.evaluate(async files => {
    for (const [path, text] of Object.entries(files)) {
      const parts = path.split('/'), name = parts.pop()!; let folder = await navigator.storage.getDirectory();
      for (const part of parts) folder = await folder.getDirectoryHandle(part, { create: true });
      const writer = await (await folder.getFileHandle(name, { create: true })).createWritable(); await writer.write(text); await writer.close();
    }
  }, files);
}
async function transfer(from: Page, to: Page, projection = true) {
  const files = await tree(from), release = await holdSyncDelivery(to);
  try { await deliver(to, Object.fromEntries(Object.entries(files).filter(([path]) => projection || path !== 'TODO.txt'))); } finally { await release(); }
}
const records = async (page: Page): Promise<Revision[]> => Object.entries(await tree(page)).filter(([path]) => path.endsWith('.json')).map(([, raw]) => JSON.parse(raw));
const saved = (page: Page) => expect.poll(async () => (await syncState(page, 'file-sync-ledger')).status.kind, { timeout: 15_000 }).toBe('saved');
async function edit(page: Page, title: string, next: string) {
  const field = page.getByRole('textbox', { name: `Edit ${title}`, exact: true }); await field.fill(next); await field.press('Tab');
  await page.getByRole('button', { name: 'Undated', exact: true }).focus();
  await expect.poll(async () => (await records(page)).some(record => record.text.includes(next))).toBe(true);
  await expect.poll(async () => (await tree(page))['TODO.txt']).toContain(next); await saved(page);
}
async function approve(page: Page) {
  await expect.poll(async () => (await syncState(page, 'linked-file')).needsReview, { timeout: 15_000 }).toBe(true);
  await page.getByRole('status', { name: 'File sync', exact: true }).getByRole('button', { name: 'Review linked file', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Review TODO.txt import', exact: true });
  await expect.poll(async () => await review.isVisible() ? 'review' : (await syncState(page, 'linked-file')).needsReview ? 'loading' : 'done').not.toBe('loading');
  if (await review.isVisible()) {
    for (const choice of await review.getByRole('radio', { name: 'keep both', exact: true }).all()) await choice.check();
    await review.getByRole('button', { name: 'apply import', exact: true }).click(); await expect(review).toBeHidden();
  }
  await saved(page);
}

test('a temporary missing file during folder replacement catches up without manual resume', async ({ page }) => {
  await setup(page); const release = await holdSyncDelivery(page);
  await page.evaluate(async () => { await (await navigator.storage.getDirectory()).removeEntry('TODO.txt'); });
  await release();
  await expect.poll(async () => (await syncState(page, 'file-sync-ledger')).status.kind).toBe('retrying');
  expect((await syncState(page, 'current')).document.undated[0].items[0].text).toBe('Original');
  await page.evaluate(async raw => {
    const handle = await (await navigator.storage.getDirectory()).getFileHandle('TODO.txt', { create: true });
    const writer = await handle.createWritable(); await writer.write(raw); await writer.close();
  }, initial);
  await expect.poll(async () => (await syncState(page, 'file-sync-ledger')).status.kind, { timeout: 12_000 }).toBe('saved');
});

for (const profile of [
  { name: 'Nextcloud folder fault model', conflict: 'TODO (conflicted copy 2026-11-15 120000).txt' },
  { name: 'Dropbox folder fault model', conflict: "TODO (Kai's conflicted copy 2026-11-15).txt" },
]) {
  test(`${profile.name}: isolated offline journals retain both concurrent versions and converge after review`, async ({ page, browser }) => {
    test.setTimeout(75_000);
    const context = await browser.newContext({ timezoneId: 'Asia/Singapore' }), other = await context.newPage();
    try {
      await setup(page); await setup(other);
      expect((await syncState(page, 'linked-file')).id).not.toBe((await syncState(other, 'linked-file')).id);
      await transfer(other, page, false); await approve(page); await transfer(page, other); await saved(other);
      const common = (await syncState(page, 'file-sync-ledger')).revisions.frontier;
      await expect.poll(async () => (await syncState(other, 'file-sync-ledger')).revisions.frontier, { timeout: 15_000 }).toEqual(common);
      await context.setOffline(true);
      await edit(other, 'Original', 'Offline branch'); await edit(page, 'Original', 'First device branch');
      const offlineId = (await records(other)).find(record => record.text.includes('Offline branch'))!.id;
      await context.setOffline(false); await transfer(other, page);
      const retained = await records(page);
      expect(retained.some(record => record.text.includes('First device branch'))).toBe(true);
      expect(retained.some(record => record.id === offlineId)).toBe(true);
      await approve(page); await transfer(page, other);
      const merged = serializeTodoText((await syncState(page, 'current')).document);
      await expect.poll(async () => (await syncState(other, 'linked-file')).needsReview ? 'review' : serializeTodoText((await syncState(other, 'current')).document) === merged ? 'integrated' : 'waiting', { timeout: 15_000 }).not.toBe('waiting');
      if ((await syncState(other, 'linked-file')).needsReview) await approve(other);
      await expect.poll(async () => serializeTodoText((await syncState(other, 'current')).document)).toBe(merged); await saved(other);
      await transfer(other, page);
      const finalFrontier = (await syncState(other, 'file-sync-ledger')).revisions.frontier;
      await expect.poll(async () => (await syncState(page, 'file-sync-ledger')).revisions.frontier, { timeout: 15_000 }).toEqual(finalFrontier); await saved(page);
      const first = (await tree(page))['TODO.txt'], second = (await tree(other))['TODO.txt'];
      expect(first).toBe(second); expect(first).toContain('First device branch'); expect(first).toContain('Offline branch');
      expect((await records(other)).some(record => record.parents.length === 2 && record.text.includes('First device branch') && record.text.includes('Offline branch'))).toBe(true);
      const prior = (await records(page)).find(record => record.text === initial)!;
      const history = await openHistory(page); await history.getByLabel('Saved version').selectOption(prior.id);
      await expect(history.getByLabel('Selected version comparison')).toContainText('Original');
      await history.getByRole('button', { name: 'Restore version', exact: true }).click();
      await history.getByRole('button', { name: 'Restore as new version', exact: true }).click(); await expect(history).toBeHidden(); await saved(page);
      expect((await tree(page))['TODO.txt']).toBe(initial);
      expect((await records(page)).some(record => record.id === offlineId)).toBe(true);
    } finally { await context.close(); }
  });

  test(`${profile.name}: conflict copies are contextual and import through the existing review without deletion`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 }); await setup(page); await edit(page, 'Original', 'Local work');
    const copy = initial.replace('Original', 'Recovered work'); await deliver(page, { [profile.conflict]: copy });
    await expect(page.getByRole('status', { name: 'Journal sync', exact: true })).toContainText('provider conflict copy');
    await runCommand(page, 'Settings'); const region = page.getByRole('region', { name: 'Sync folder conflict copies', exact: true });
    await expect(region).toContainText(profile.conflict);
    const settings = page.getByRole('dialog', { name: 'Hot Cross Buns settings', exact: true });
    expect(await settings.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    const chooser = page.waitForEvent('filechooser'); await region.getByRole('button', { name: 'Import a conflict copy', exact: true }).click();
    await (await chooser).setFiles({ name: profile.conflict, mimeType: 'text/plain', buffer: Buffer.from(copy) });
    const review = page.getByRole('dialog', { name: 'Review TODO.txt import', exact: true });
    await expect(review).toContainText('Local work'); await expect(review).toContainText('Recovered work');
    await review.getByRole('radio', { name: 'keep both', exact: true }).check(); await review.getByRole('button', { name: 'apply import', exact: true }).click();
    await expect(review).toBeHidden(); await saved(page);
    const files = await tree(page); expect(files[profile.conflict]).toBe(copy);
    expect(files['TODO.txt']).toContain('Recovered work'); expect(files['TODO.txt']).toContain('Local work');
  });
}

test('partial history waits for completion; transfer order and duplicate conflict envelopes preserve the journal', async ({ page }) => {
  await setup(page); const original = (await records(page))[0], root = '.hot-cross-buns/' + await sha256('TODO.txt') + '/';
  const incoming = await createRevision('file:TODO.txt', crypto.randomUUID(), [original.id], initial.replace('Original', 'Transferred update'));
  const name = root + incoming.id + '.json';
  await deliver(page, { [name]: revisionText(incoming).slice(0, 30) });
  await expect.poll(async () => (await syncState(page, 'file-sync-ledger')).status.kind).toBe('retrying');
  expect((await syncState(page, 'current')).document.undated[0].items[0].text).toBe('Original');
  await deliver(page, { [name]: revisionText(incoming), [root + incoming.id + ' (conflicted copy).JSON']: revisionText(incoming) });
  await saved(page); await expect(page.getByRole('textbox', { name: 'Edit Transferred update', exact: true })).toBeVisible();
  expect((await tree(page))[name]).toBe(revisionText(incoming));
});

test('excluded known history pauses projection writing and catches up when the complete folder returns', async ({ page }) => {
  await setup(page); const original = (await records(page))[0], root = '.hot-cross-buns/' + await sha256('TODO.txt');
  const release = await holdSyncDelivery(page);
  await page.evaluate(async path => {
    const [directory, namespace] = path.split('/'); const folder = await (await (await navigator.storage.getDirectory()).getDirectoryHandle(directory)).getDirectoryHandle(namespace);
    for await (const entry of (folder as FileSystemDirectoryHandle & { values(): AsyncIterableIterator<FileSystemHandle> }).values()) await folder.removeEntry(entry.name);
  }, root);
  const field = page.getByRole('textbox', { name: 'Edit Original', exact: true }); await field.fill('Keep local changes'); await field.press('Tab'); await release();
  await expect.poll(async () => (await syncState(page, 'file-sync-ledger')).status.kind).toBe('retrying');
  expect((await tree(page))['TODO.txt']).toBe(initial);
  expect((await syncState(page, 'current')).document.undated[0].items[0].text).toBe('Keep local changes');
  await deliver(page, { [root + '/' + original.id + '.json']: revisionText(original) }); await saved(page);
  expect((await tree(page))['TODO.txt']).toContain('Keep local changes');
});

test('a zero-byte projection is reviewed rather than silently clearing a nonempty journal', async ({ page }) => {
  await setup(page); await deliver(page, { 'TODO.txt': '' });
  await expect.poll(async () => (await syncState(page, 'linked-file')).needsReview).toBe(true);
  expect((await syncState(page, 'current')).document.undated[0].items[0].text).toBe('Original');
  expect((await records(page)).some(record => record.origin === 'external' && record.text === '')).toBe(true);
});

test('provider setup stays inside existing folder settings and makes no provider API requests', async ({ page }) => {
  const contacted: string[] = [];
  page.on('request', request => { if (/nextcloud|dropbox|onedrive|microsoftonline/.test(new URL(request.url()).hostname)) contacted.push(request.url()); });
  await page.goto('/'); await runCommand(page, 'Settings');
  const region = page.getByRole('region', { name: 'File sync', exact: true });
  await expect(region).toContainText('Nextcloud, Dropbox or Syncthing');
  await region.getByText('Nextcloud, Dropbox and Syncthing setup', { exact: true }).click();
  await expect(region).toContainText('Do not exclude history');
  await expect(region.getByRole('link', { name: 'Setup, verification and recovery guide', exact: true })).toHaveAttribute('href', /SYNC_FOLDERS.md$/);
  await expect(region.getByRole('textbox')).toHaveCount(0); expect(contacted).toEqual([]);
});
