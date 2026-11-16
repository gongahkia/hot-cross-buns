import { plannerFixture } from './planner-fixture';
import { expect, test, type Page } from '@playwright/test';
import { openHistory, runCommand } from './commands';
import { holdSyncDelivery, syncState } from './sync-helpers';
import { createRevision, revisionText, sha256, type Revision } from '../src/revisionProtocol';
import { serializeJournal } from '../src/journalDocument';

const initial = plannerFixture('UNDATED\n\nLIST: Inbox\nOriginal\n');
async function setup(page: Page, provider?: string) {
  await page.addInitScript(() => {
    Object.assign(window, { showDirectoryPicker: () => navigator.storage.getDirectory() });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
  });
  await page.goto('/');
  await page.getByLabel('Import a Planner.md file').setInputFiles({ name: 'Planner.md', mimeType: 'text/plain', buffer: Buffer.from(plannerFixture(initial)) });
  await runCommand(page, 'Settings'); await page.getByRole('button', { name: provider ? `Link ${provider} folder` : 'Link sync folder', exact: true }).click();
  await expect.poll(async () => (await syncState(page, 'file-sync-ledger'))?.status.kind).toBe('saved');
  for (const label of ['Link sync folder', 'Link Nextcloud folder', 'Link Dropbox folder']) await expect(page.getByRole('button', { name: label, exact: true })).toBeDisabled();
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
  try { await deliver(to, Object.fromEntries(Object.entries(files).filter(([path]) => projection || path !== 'Planner.md'))); } finally { await release(); }
}
const records = async (page: Page): Promise<Revision[]> => Object.entries(await tree(page)).filter(([path]) => path.endsWith('.json')).map(([, raw]) => JSON.parse(raw));
const saved = (page: Page) => expect.poll(async () => (await syncState(page, 'file-sync-ledger')).status.kind, { timeout: 15_000 }).toBe('saved');
async function edit(page: Page, title: string, next: string) {
  const field = page.getByRole('textbox', { name: `Edit ${title}`, exact: true }); await field.fill(next); await field.press('Tab');
  await page.getByRole('button', { name: 'Undated', exact: true }).focus();
  await expect.poll(async () => (await records(page)).some(record => record.text.includes(next))).toBe(true);
  await expect.poll(async () => (await tree(page))['Planner.md']).toContain(next); await saved(page);
}
async function approve(page: Page) {
  await expect.poll(async () => (await syncState(page, 'linked-file')).needsReview, { timeout: 15_000 }).toBe(true);
  await page.getByRole('status', { name: 'File sync', exact: true }).getByRole('button', { name: 'Review linked file', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Review Planner.md import', exact: true });
  await expect.poll(async () => await review.isVisible() ? 'review' : (await syncState(page, 'linked-file')).needsReview ? 'loading' : 'done').not.toBe('loading');
  if (await review.isVisible()) {
    for (const choice of await review.getByRole('radio', { name: 'keep both', exact: true }).all()) await choice.check();
    await review.getByRole('button', { name: 'apply import', exact: true }).click(); await expect(review).toBeHidden();
  }
  await saved(page);
}

test('a temporary missing file during folder replacement catches up without manual resume', async ({ page }) => {
  await setup(page); const release = await holdSyncDelivery(page);
  await page.evaluate(async () => { await (await navigator.storage.getDirectory()).removeEntry('Planner.md'); });
  await release();
  await expect.poll(async () => (await syncState(page, 'file-sync-ledger')).status.kind).toBe('retrying');
  expect((await syncState(page, 'current')).document.undated[0].items[0].text).toBe('Original');
  await page.evaluate(async raw => {
    const handle = await (await navigator.storage.getDirectory()).getFileHandle('Planner.md', { create: true });
    const writer = await handle.createWritable(); await writer.write(raw); await writer.close();
  }, initial);
  await expect.poll(async () => (await syncState(page, 'file-sync-ledger')).status.kind, { timeout: 12_000 }).toBe('saved');
});

for (const profile of [
  { name: 'Nextcloud folder fault model', provider: 'Nextcloud', conflict: 'Planner (conflicted copy 2026-11-15 120000).md' },
  { name: 'Dropbox folder fault model', provider: 'Dropbox', conflict: "Planner (Kai's conflicted copy 2026-11-15).md" },
]) {
  test(`${profile.name}: isolated offline journals retain both concurrent versions and converge after review`, async ({ page, browser }) => {
    test.setTimeout(75_000);
    const context = await browser.newContext({ timezoneId: 'Asia/Singapore' }), other = await context.newPage();
    try {
      await setup(page, profile.provider); await setup(other, profile.provider);
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
      const merged = serializeJournal((await syncState(page, 'current')).document);
      await expect.poll(async () => (await syncState(other, 'linked-file')).needsReview ? 'review' : serializeJournal((await syncState(other, 'current')).document) === merged ? 'integrated' : 'waiting', { timeout: 15_000 }).not.toBe('waiting');
      if ((await syncState(other, 'linked-file')).needsReview) await approve(other);
      await expect.poll(async () => serializeJournal((await syncState(other, 'current')).document)).toBe(merged); await saved(other);
      await transfer(other, page);
      const finalFrontier = (await syncState(other, 'file-sync-ledger')).revisions.frontier;
      await expect.poll(async () => (await syncState(page, 'file-sync-ledger')).revisions.frontier, { timeout: 15_000 }).toEqual(finalFrontier); await saved(page);
      const first = (await tree(page))['Planner.md'], second = (await tree(other))['Planner.md'];
      expect(first).toBe(second); expect(first).toContain('First device branch'); expect(first).toContain('Offline branch');
      expect((await records(other)).some(record => record.parents.length === 2 && record.text.includes('First device branch') && record.text.includes('Offline branch'))).toBe(true);
      const prior = (await records(page)).find(record => record.text === initial)!;
      const history = await openHistory(page); await history.getByLabel('Saved version').selectOption(prior.id);
      await expect(history.getByLabel('Selected version comparison')).toContainText('Original');
      await history.getByRole('button', { name: 'Restore version', exact: true }).click();
      await history.getByRole('button', { name: 'Restore as new version', exact: true }).click(); await expect(history).toBeHidden(); await saved(page);
      expect((await tree(page))['Planner.md']).toBe(initial);
      expect((await records(page)).some(record => record.id === offlineId)).toBe(true);
    } finally { await context.close(); }
  });

  test(`${profile.name}: conflict copies are contextual and import through the existing review without deletion`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 }); await setup(page, profile.provider); await edit(page, 'Original', 'Local work');
    const copy = initial.replace('Original', 'Recovered work'); await deliver(page, { [profile.conflict]: copy });
    await expect(page.getByRole('status', { name: 'Journal sync', exact: true })).toContainText('provider conflict copy');
    await runCommand(page, 'Settings'); const region = page.getByRole('region', { name: 'Sync folder conflict copies', exact: true });
    await expect(region).toContainText(profile.conflict);
    const settings = page.getByRole('dialog', { name: 'Hot Cross Buns settings', exact: true });
    expect(await settings.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    const release = await holdSyncDelivery(page);
    try {
      const chooser = page.waitForEvent('filechooser'); await region.getByRole('button', { name: 'Import a conflict copy', exact: true }).click();
      await (await chooser).setFiles({ name: profile.conflict, mimeType: 'text/plain', buffer: Buffer.from(plannerFixture(copy)) });
      const review = page.getByRole('dialog', { name: 'Review Planner.md import', exact: true });
      await expect(review).toContainText('Local work'); await expect(review).toContainText('Recovered work');
      await review.getByRole('radio', { name: 'keep both', exact: true }).check(); await review.getByRole('button', { name: 'apply import', exact: true }).click();
      await expect(review).toBeHidden();
      const document = serializeJournal((await syncState(page, 'current')).document);
      expect(document).toContain('Local work'); expect(document).toContain('Recovered work');
      const pendingFile = await page.evaluate(async () => (await (await (await navigator.storage.getDirectory()).getFileHandle('Planner.md')).getFile()).text());
      expect(pendingFile).toContain('Local work'); expect(pendingFile).not.toContain('Recovered work');
    } finally { await release(); }
    await expect.poll(async () => (await records(page)).some(record => record.text.includes('Local work') && record.text.includes('Recovered work'))).toBe(true);
    await expect.poll(async () => (await tree(page))['Planner.md']).toContain('Recovered work'); await saved(page);
    const files = await tree(page); expect(files[profile.conflict]).toBe(copy);
    expect(files['Planner.md']).toContain('Recovered work'); expect(files['Planner.md']).toContain('Local work');
  });
}

test('partial history waits for completion; transfer order and duplicate conflict envelopes preserve the journal', async ({ page }) => {
  await setup(page); const original = (await records(page))[0], root = '.hot-cross-buns/' + await sha256('Planner.md') + '/';
  const incoming = await createRevision('file:Planner.md', crypto.randomUUID(), [original.id], initial.replace('Original', 'Transferred update'));
  const name = root + incoming.id + '.json';
  await deliver(page, { [name]: revisionText(incoming).slice(0, 30) });
  await expect.poll(async () => (await syncState(page, 'file-sync-ledger')).status.kind).toBe('retrying');
  expect((await syncState(page, 'current')).document.undated[0].items[0].text).toBe('Original');
  await deliver(page, { [name]: revisionText(incoming), [root + incoming.id + ' (conflicted copy).JSON']: revisionText(incoming) });
  await saved(page); await expect(page.getByRole('textbox', { name: 'Edit Transferred update', exact: true })).toBeVisible();
  expect((await tree(page))[name]).toBe(revisionText(incoming));
});

test('excluded known history pauses projection writing and catches up when the complete folder returns', async ({ page }) => {
  await setup(page); const original = (await records(page))[0], root = '.hot-cross-buns/' + await sha256('Planner.md');
  const release = await holdSyncDelivery(page);
  await page.evaluate(async path => {
    const [directory, namespace] = path.split('/'); const folder = await (await (await navigator.storage.getDirectory()).getDirectoryHandle(directory)).getDirectoryHandle(namespace);
    for await (const entry of (folder as FileSystemDirectoryHandle & { values(): AsyncIterableIterator<FileSystemHandle> }).values()) await folder.removeEntry(entry.name);
  }, root);
  const field = page.getByRole('textbox', { name: 'Edit Original', exact: true }); await field.fill('Keep local changes'); await field.press('Tab'); await release();
  await expect.poll(async () => (await syncState(page, 'file-sync-ledger')).status.kind).toBe('retrying');
  expect((await tree(page))['Planner.md']).toBe(initial);
  expect((await syncState(page, 'current')).document.undated[0].items[0].text).toBe('Keep local changes');
  await deliver(page, { [root + '/' + original.id + '.json']: revisionText(original) }); await saved(page);
  expect((await tree(page))['Planner.md']).toContain('Keep local changes');
});

test('a zero-byte projection is reviewed rather than silently clearing a nonempty journal', async ({ page }) => {
  await setup(page); await deliver(page, { 'Planner.md': '' });
  await expect.poll(async () => (await syncState(page, 'linked-file')).needsReview).toBe(true);
  expect((await syncState(page, 'current')).document.undated[0].items[0].text).toBe('Original');
  expect((await records(page)).some(record => record.origin === 'external' && record.text === '')).toBe(true);
});

test('a projection arriving before its authored history is retained and its later branch is explicitly acknowledged', async ({ page }) => {
  await setup(page); const original = (await records(page))[0], text = initial.replace('Original', 'Text arrived first');
  const authored = await createRevision('file:Planner.md', crypto.randomUUID(), [original.id], text);
  await deliver(page, { 'Planner.md': text });
  await expect.poll(async () => (await records(page)).some(record => record.origin === 'external' && record.text === text)).toBe(true);
  await expect.poll(async () => serializeJournal((await syncState(page, 'current')).document)).toBe(text); await saved(page);
  const observed = (await records(page)).find(record => record.origin === 'external' && record.text === text)!;
  const path = '.hot-cross-buns/' + await sha256('Planner.md') + '/' + authored.id + '.json';
  await deliver(page, { [path]: revisionText(authored) });
  await approve(page);
  const all = await records(page);
  expect(all.some(record => record.id === authored.id && record.digest === authored.digest)).toBe(true);
  expect(all.some(record => record.id === observed.id)).toBe(true);
  expect(all.some(record => record.parents.includes(authored.id) && record.parents.includes(observed.id) && record.text === text)).toBe(true);
  expect(serializeJournal((await syncState(page, 'current')).document)).toBe(text);
});

test('provider setup stays inside existing folder settings and makes no provider API requests', async ({ page }) => {
  const contacted: string[] = [];
  page.on('request', request => { if (/nextcloud|dropbox|onedrive|microsoftonline/.test(new URL(request.url()).hostname)) contacted.push(request.url()); });
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/'); await runCommand(page, 'Settings');
  const region = page.getByRole('region', { name: 'File sync', exact: true });
  for (const provider of ['Syncthing', 'Nextcloud', 'Dropbox']) {
    const section = region.getByRole('region', { name: provider, exact: true });
    await expect(section.getByRole('heading', { name: provider, exact: true })).toBeVisible();
    await expect(section.getByRole('img', { name: provider, exact: true })).toHaveJSProperty('complete', true);
    expect(await section.getByRole('img', { name: provider, exact: true }).evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
    await section.getByText(`${provider} setup`, { exact: true }).click();
    await expect(section).toContainText('.hot-cross-buns');
    await expect(section.getByRole('link', { name: `${provider} setup and recovery guide`, exact: true })).toHaveAttribute('href', /docs\/(FILE_SYNC|SYNC_FOLDERS)\.md/);
  }
  await expect(region.getByRole('region', { name: 'Nextcloud', exact: true })).toContainText('server address');
  await expect(region.getByRole('region', { name: 'Dropbox', exact: true })).toContainText('selective sync');
  expect(await region.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await expect(region.getByRole('textbox')).toHaveCount(0); expect(contacted).toEqual([]);
});
