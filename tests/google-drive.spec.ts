import { plannerFixture } from './planner-fixture';
import { expect, test, type Page } from '@playwright/test';
import { openHistory, runCommand } from './commands';
import { holdSyncDelivery, syncState } from './sync-helpers';
import { createRevision, revisionText } from '../src/revisionProtocol';

const initial = plannerFixture('UNDATED\n\nLIST: Inbox\nOriginal\n- Keep detail\n');
const scope = 'https://www.googleapis.com/auth/drive.file';
const region = (page: Page) => page.getByRole('region', { name: 'Google Drive', exact: true });
const settings = (page: Page) => page.getByRole('dialog', { name: 'Hot Cross Buns settings', exact: true });
async function closeSettings(page: Page) { await settings(page).getByRole('button', { name: 'close', exact: true }).click(); await expect(settings(page)).toBeHidden(); }
async function savedLink(page: Page): Promise<Record<string, unknown> | null> {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open('hot-cross-buns-v1');
    open.onsuccess = () => {
      const db = open.result, request = db.transaction('state').objectStore('state').get('google-drive-link');
      request.onsuccess = () => { db.close(); resolve(request.result ?? null); }; request.onerror = () => reject(request.error);
    }; open.onerror = () => reject(open.error);
  }));
}
async function setup(page: Page, existing = false) {
  const revisionFiles = new Map<string, { id: string; name: string; mimeType: string; appProperties: Record<string, string>; version: string; size: string; raw: string }>();
  const remote = { text: initial, version: 1, exists: existing, writes: 0, creates: 0, failSave: 0, account: 'account-1', tokenCalls: 0, requests: 0, holdSave: false, saveEntered: false, releaseSave: () => {}, dropSaveReply: false, dropCreateReply: false, creationCheckpoint: false, expireOwner: false, otherRequests: 0, holdCreate: false, creationEntered: false, releaseCreate: () => {}, revisionFiles, reserved: 0, revisionCheckpoint: false, dropRevisionReply: false, revisionCreates: 0 };
  await page.context().addInitScript(({ scope }) => {
    const mock = { activeClick: false, scope: '', picker: {} as Record<string, string | boolean>, pickerCancel: false, deny: false, block: false };
    Reflect.set(window, 'mockGoogle', mock);
    class View { setMimeTypes(mime: string) { mock.picker.mime = mime; return this; } }
    class Builder {
      callback: (value: unknown) => void = () => {};
      setDeveloperKey(key: string) { mock.picker.key = key; return this; }
      setAppId(id: string) { mock.picker.appId = id; return this; }
      setOAuthToken(token: string) { mock.picker.token = token; return this; }
      setOrigin(origin: string) { mock.picker.origin = origin; return this; }
      addView() { return this; }
      setCallback(callback: (value: unknown) => void) { this.callback = callback; return this; }
      build() { return { dispose: () => {}, setVisible: () => {
        mock.picker.modalOpen = !!document.querySelector('dialog[open]');
        setTimeout(() => this.callback(mock.pickerCancel ? { action: 'cancel' } : { action: 'picked', docs: [{ id: 'file-1' }] }), 0);
      } }; }
    }
    Reflect.set(window, 'google', {
      accounts: { oauth2: { initTokenClient: (config: { scope: string; callback: (result: unknown) => void; error_callback: (error: unknown) => void }) => ({ requestAccessToken: () => {
        mock.activeClick = navigator.userActivation.isActive; mock.scope = config.scope;
        if (mock.block) { config.error_callback({ type: 'popup_failed_to_open' }); return; }
        config.callback(mock.deny ? { error: 'access_denied' } : { access_token: 'test-only-access-token', expires_in: 3600, scope: 'openid email ' + scope });
      } }) } },
      picker: { View, ViewId: { DOCS: 'docs' }, PickerBuilder: Builder, Action: { PICKED: 'picked', CANCEL: 'cancel' } },
    });
    const pick = async () => (await navigator.storage.getDirectory()).getFileHandle('Planner.md', { create: true });
    Object.assign(window, { showOpenFilePicker: async () => [await pick()], showSaveFilePicker: pick });
  }, { scope });
  await page.context().route('https://openidconnect.googleapis.com/v1/userinfo', async route => {
    remote.tokenCalls++;
    expect(route.request().headers().authorization).toBe('Bearer test-only-access-token');
    await route.fulfill({ json: { sub: remote.account, email: remote.account + '@example.com' } });
  });
  await page.context().route('https://www.googleapis.com/**', async route => {
    const request = route.request(), url = new URL(request.url()); remote.requests++; if (request.frame().page() !== page) remote.otherRequests++;
    expect(request.headers().authorization).toBe('Bearer test-only-access-token');
    expect(url.searchParams.has('access_token')).toBe(false);
    const metadata = () => ({ id: 'file-1', name: 'Planner.md', mimeType: 'text/plain', version: String(remote.version), size: String(Buffer.byteLength(remote.text)), capabilities: { canEdit: true } });
    if (url.pathname.endsWith('/generateIds')) { await route.fulfill({ json: { ids: ['revision-file-' + ++remote.reserved] } }); return; }
    if (request.method() === 'POST' && request.postData()?.includes('"hcbRevision"')) {
      const parts = request.postData()!.split('Content-Type: application/json; charset=UTF-8\r\n\r\n');
      const metadata = JSON.parse(parts[1].split('\r\n--hcb-')[0]), raw = parts[2].split('\r\n--hcb-')[0];
      const pending = (await syncState(request.frame().page(), 'drive-sync-ledger'))?.revisions?.pending;
      remote.revisionCheckpoint = pending?.record.id === metadata.appProperties.hcbRevision && pending?.transportId === metadata.id;
      if (revisionFiles.has(metadata.id)) { await route.fulfill({ status: 409, body: '{}' }); return; }
      revisionFiles.set(metadata.id, { ...metadata, raw, version: '1', size: String(Buffer.byteLength(raw)) }); remote.revisionCreates++;
      if (remote.dropRevisionReply) { remote.dropRevisionReply = false; await route.abort('failed'); return; }
      await route.fulfill({ json: { id: metadata.id } }); return;
    }
    if (request.method() === 'GET' && url.pathname.endsWith('/files') && url.searchParams.get('q')?.includes('hcbJournal')) {
      await route.fulfill({ json: { files: [...revisionFiles.values()].map(({ raw: _raw, ...file }) => file) } }); return;
    }
    const revision = revisionFiles.get(url.pathname.split('/').at(-1)!);
    if (revision && request.method() === 'GET') {
      await route.fulfill(url.searchParams.get('alt') === 'media' ? { contentType: 'application/json', body: revision.raw } : { json: revision }); return;
    }
    if (request.method() === 'POST') {
      remote.creationCheckpoint = !!await syncState(route.request().frame().page(), 'sync-file-creation');
      remote.creates++; remote.exists = true;
      const body = request.postData()!;
      remote.text = body.split('Content-Type: text/markdown; charset=UTF-8\r\n\r\n')[1].split('\r\n--hcb-')[0];
      const accepted = metadata();
      if (remote.holdCreate) { remote.holdCreate = false; remote.creationEntered = true; await new Promise<void>(resolve => remote.releaseCreate = resolve); }
      if (remote.dropCreateReply) { remote.dropCreateReply = false; await route.abort('failed'); return; }
      await route.fulfill({ json: accepted }); return;
    }
    if (request.method() === 'PATCH') {
      if (remote.expireOwner && request.frame().page() === page) { await route.fulfill({ status: 401, body: '{}' }); return; }
      if (remote.failSave) { await route.fulfill({ status: remote.failSave, body: '{}' }); return; }
      remote.text = request.postData()!; remote.version++; remote.writes++;
      const accepted = metadata();
      if (remote.holdSave) { remote.holdSave = false; remote.saveEntered = true; await new Promise<void>(resolve => remote.releaseSave = resolve); }
      if (remote.dropSaveReply) { remote.dropSaveReply = false; await route.abort('failed'); return; }
      try { await route.fulfill({ json: accepted }); } catch (error) { if (!request.frame().page().isClosed()) throw error; }
      return;
    }
    if (url.pathname.endsWith('/files')) { await route.fulfill({ json: { files: remote.exists ? [metadata()] : [] } }); return; }
    if (url.searchParams.get('alt') === 'media') { await route.fulfill({ contentType: 'text/plain', body: remote.text }); return; }
    await route.fulfill({ json: metadata(), headers: { ETag: '"revision-' + remote.version + '"' } });
  });
  await page.goto('/'); await runCommand(page, 'Settings');
  await region(page).getByRole('textbox', { name: 'Google Web OAuth client ID', exact: true }).fill('123-test.apps.googleusercontent.com');
  await region(page).getByLabel('Google Picker API key', { exact: true }).fill('test-key');
  await region(page).getByRole('textbox', { name: 'Google Cloud project number', exact: true }).fill('123');
  await region(page).getByRole('button', { name: 'Save Google configuration', exact: true }).click();
  await expect(region(page).getByRole('button', { name: 'Connect Google Drive', exact: true })).toBeEnabled();
  return remote;
}
async function connect(page: Page) {
  await region(page).getByRole('button', { name: 'Connect Google Drive', exact: true }).click();
  await expect(region(page).getByRole('button', { name: 'Sign out of this tab', exact: true })).toBeVisible();
}
async function importInitial(page: Page) {
  await closeSettings(page);
  await page.getByLabel('Import a Planner.md file').setInputFiles({ name: 'Planner.md', mimeType: 'text/plain', buffer: Buffer.from(plannerFixture(initial)) });
  await page.getByRole('button', { name: 'Undated', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Edit Original', exact: true })).toBeVisible();
  await runCommand(page, 'Settings');
}
async function createLinked(page: Page) {
  await connect(page); await region(page).getByRole('button', { name: 'Create Planner.md in Google Drive', exact: true }).click();
  await expect.poll(() => savedLink(page)).not.toBeNull();
  await expect.poll(async () => (await syncState(page, 'drive-sync-ledger'))?.status.kind).toBe('saved');
}
async function editOriginal(page: Page, text: string) {
  await closeSettings(page); await page.getByRole('button', { name: 'Undated', exact: true }).click();
  const input = page.getByRole('textbox', { name: 'Edit Original', exact: true }); await input.fill(text); await input.press('Tab');
}

test('Google Drive remains optional and does not contact Google without configuration', async ({ page }) => {
  const requests: string[] = []; page.on('request', request => { if (/google(apis)?\.com/.test(request.url())) requests.push(request.url()); });
  await page.goto('/'); await runCommand(page, 'Settings');
  await expect(region(page).getByRole('button', { name: 'Connect Google Drive', exact: true })).toBeDisabled();
  await expect(page.getByRole('img', { name: 'Syncthing', exact: true })).toBeVisible();
  expect(requests).toEqual([]);
});
test('creating a Drive file saves the whole journal and autosaves later persisted edits', async ({ page }) => {
  const remote = await setup(page); await importInitial(page); await createLinked(page);
  expect(remote.creates).toBe(1); expect(remote.text).toMatch(/Original[\s\S]*  - Keep\ detail/);
  const auth = await page.evaluate(() => Reflect.get(window, 'mockGoogle'));
  expect(auth.activeClick).toBe(true); expect(auth.scope).toBe('openid email ' + scope);
  await editOriginal(page, 'Saved directly');
  await expect.poll(() => remote.text).toMatch(/Saved\ directly[\s\S]*  - Keep\ detail/);
  const link = await savedLink(page); expect(link?.accountId).toBe('account-1');
  expect(JSON.stringify(link)).not.toContain('test-only-access-token');
  const storage = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
  expect(storage).not.toContain('test-only-access-token');
  await page.reload(); await runCommand(page, 'Settings');
  await expect(region(page)).toContainText('Reconnect the linked Google account');
  expect(remote.tokenCalls).toBe(1);
  await connect(page); await expect(region(page)).toContainText('up to date');
});
test('reconnect rejects a different account and popup failures use a toast', async ({ page }) => {
  const remote = await setup(page); await createLinked(page);
  await region(page).getByRole('button', { name: 'Sign out of this tab', exact: true }).click();
  remote.account = 'different-account';
  await region(page).getByRole('button', { name: 'Connect Google Drive', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Notification', exact: true })).toContainText('Choose account-1@example.com');
  await expect(region(page).getByRole('button', { name: 'Connect Google Drive', exact: true })).toBeVisible();
  await page.evaluate(() => Reflect.get(window, 'mockGoogle').block = true);
  await region(page).getByRole('button', { name: 'Connect Google Drive', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Notification', exact: true })).toContainText('Allow popups');
  expect((await savedLink(page))?.accountId).toBe('account-1');
});
test('opening an existing file uses Picker with narrow access and imports before linking', async ({ page }) => {
  const remote = await setup(page, true); await connect(page);
  await region(page).getByRole('button', { name: 'Choose from Google Drive', exact: true }).click();
  await expect.poll(() => savedLink(page)).not.toBeNull();
  await page.getByRole('button', { name: 'Undated', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Edit Original', exact: true })).toBeVisible();
  expect(remote.writes).toBe(0);
  const picker = await page.evaluate(() => Reflect.get(window, 'mockGoogle').picker);
  expect(picker).toMatchObject({ key: 'test-key', appId: '123', origin: new URL(page.url()).origin, mime: 'text/markdown,text/plain,application/octet-stream', modalOpen: false });
});
test('cancelling Picker preserves the journal without creating a link', async ({ page }) => {
  await setup(page, true); await connect(page);
  await page.evaluate(() => Reflect.get(window, 'mockGoogle').pickerCancel = true);
  await region(page).getByRole('button', { name: 'Choose from Google Drive', exact: true }).click();
  await expect(settings(page)).toBeVisible();
  await expect(region(page).getByRole('button', { name: 'Choose from Google Drive', exact: true })).toBeEnabled();
  expect(await savedLink(page)).toBeNull();
});
test('malformed Drive text is linked only after explicit doctor approval', async ({ page }) => {
  const remote = await setup(page, true);
  const corrected = plannerFixture('2026-11-16\n\nReviewed task\n');
  remote.text = corrected.replace('hcb-format: 1','hcb-format: 999'); await connect(page);
  await region(page).getByRole('button', { name: 'Planner.md', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Review Planner.md import', exact: true });
  await expect(review).toContainText('Only hcb-format: 1 is supported');
  expect(await savedLink(page)).toBeNull(); expect(remote.writes).toBe(0);
  await review.getByRole('textbox', { name: 'Edit imported Planner.md', exact: true }).fill(corrected);
  await review.getByRole('button', { name: 'check file', exact: true }).click();
  await expect(review.getByRole('button', { name: 'apply import', exact: true })).toBeEnabled();
  await review.getByRole('button', { name: 'apply import', exact: true }).click();
  await expect.poll(() => savedLink(page)).not.toBeNull();
  await expect.poll(() => remote.text).toBe(corrected);
});
test('overlapping Drive changes pause writes across reload and normal merge review resumes saving', async ({ page }) => {
  const remote = await setup(page); await importInitial(page); await createLinked(page);
  const release = await holdSyncDelivery(page);
  await editOriginal(page, 'Local title');
  remote.text = initial.replace('Original', 'Remote title'); remote.version++;
  await release();
  await expect(page.getByRole('status', { name: 'Notification', exact: true })).toContainText('Google Drive journal changed');
  expect(remote.text).toContain('Remote title');
  await page.reload(); await runCommand(page, 'Settings'); await connect(page);
  await expect(region(page)).toContainText('changed in Google Drive');
  await region(page).getByRole('button', { name: 'Review Google Drive file', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Review Planner.md import', exact: true });
  await expect(review).toContainText('Local title'); await expect(review).toContainText('Remote title');
  await review.getByRole('button', { name: 'cancel', exact: true }).click();
  await runCommand(page, 'Settings'); await expect(region(page)).toContainText('changed in Google Drive');
  await region(page).getByRole('button', { name: 'Review Google Drive file', exact: true }).click();
  await review.getByRole('radio', { name: 'keep both', exact: true }).check();
  await review.getByRole('button', { name: 'apply import', exact: true }).click();
  await expect.poll(() => remote.text).toContain('Local title'); expect(remote.text).toContain('Remote title');
});
test('a conditional upload failure pauses saving and keeps local edits for review', async ({ page }) => {
  const remote = await setup(page); await importInitial(page); await createLinked(page);
  remote.failSave = 412; await editOriginal(page, 'Retained locally');
  await expect(page.getByRole('status', { name: 'Notification', exact: true })).toContainText('Google Drive journal changed');
  expect(remote.writes).toBe(0); expect(remote.text).toContain('Original');
  await expect.poll(async () => (await savedLink(page))?.needsReview).toBe(true);
  remote.failSave = 0;
  await runCommand(page, 'Settings'); await region(page).getByRole('button', { name: 'Review Google Drive file', exact: true }).click();
  await expect.poll(() => remote.text).toContain('Retained locally');
});
test('a failed upload requires retry and unlinking keeps both copies', async ({ page }) => {
  const remote = await setup(page); await importInitial(page); await createLinked(page);
  remote.failSave = 503; await editOriginal(page, 'Retained locally');
  await expect(page.getByRole('status', { name: 'Notification', exact: true })).toContainText('Google Drive request failed (503)');
  const release = await holdSyncDelivery(page);
  await runCommand(page, 'Settings'); remote.failSave = 0;
  await region(page).getByRole('button', { name: 'Resume Google Drive saving', exact: true }).click();
  await release();
  await expect.poll(() => remote.text).toContain('Retained locally');
  await region(page).getByRole('button', { name: 'Unlink Google Drive file', exact: true }).click();
  await expect.poll(() => savedLink(page)).toBeNull(); expect(remote.exists).toBe(true);
  await closeSettings(page); await expect(page.getByRole('textbox', { name: 'Edit Retained locally', exact: true })).toBeVisible();
});
test('only one local or Google Drive target can be linked at a time', async ({ page }) => {
  await setup(page); await createLinked(page);
  const local = page.getByRole('region', { name: 'File sync', exact: true });
  await expect(local.getByRole('button', { name: 'Create linked Planner.md', exact: true })).toBeDisabled();
  await region(page).getByRole('button', { name: 'Unlink Google Drive file', exact: true }).click();
  await expect(local.getByRole('button', { name: 'Create linked Planner.md', exact: true })).toBeEnabled();
  await local.getByRole('button', { name: 'Create linked Planner.md', exact: true }).click();
  await expect(local).toContainText('up to date');
  await expect(region(page).getByRole('button', { name: 'Create Planner.md in Google Drive', exact: true })).toBeDisabled();
});

test('a stale Drive review cannot overwrite a newer edit from another app window', async ({ page, context }) => {
  const remote = await setup(page); await importInitial(page); await createLinked(page);
  const release = await holdSyncDelivery(page);
  await editOriginal(page, 'Local title');
  remote.text = initial.replace('Original', 'Remote title'); remote.version++;
  await release();
  await expect.poll(async () => (await savedLink(page))?.needsReview).toBe(true);
  await runCommand(page, 'Settings'); await region(page).getByRole('button', { name: 'Review Google Drive file', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Review Planner.md import', exact: true });
  await expect(review).toContainText('Local title');
  const other = await context.newPage();
  // the other window has no token; it still shares the local journal and Drive link.
  await other.route('https://accounts.google.com/gsi/client', route => route.abort());
  await other.goto('/'); await other.getByRole('button', { name: 'Undated', exact: true }).click();
  const input = other.getByRole('textbox', { name: 'Edit Local title', exact: true }); await input.fill('Newer window edit'); await input.press('Tab');
  await expect(page.locator('textarea[aria-label="Edit Newer window edit"]')).toHaveCount(1);
  await review.getByRole('radio', { name: 'keep both', exact: true }).check();
  await review.getByRole('button', { name: 'apply import', exact: true }).click();
  await expect(review.getByRole('alert')).toContainText('journal changed while this review was open');
  expect(remote.text).toContain('Remote title');
  await expect(other.getByRole('textbox', { name: 'Edit Newer window edit', exact: true })).toHaveValue('Newer window edit');
});

test('edits stay durable while a save response is stalled and its receipt leaves newer work queued', async ({ page }) => {
  const remote = await setup(page); await importInitial(page); await createLinked(page);
  remote.holdSave = true; await editOriginal(page, 'First submission');
  await expect.poll(() => remote.saveEntered).toBe(true);
  expect((await syncState(page, 'drive-sync-ledger')).checkpoint.text).toContain('First submission');
  const title = page.getByRole('textbox', { name: 'Edit First submission', exact: true }); await title.fill('Newer edit'); await title.press('Tab');
  await expect.poll(async () => (await syncState(page, 'current')).document.undated[0].items[0].text, { timeout: 2000 }).toBe('Newer edit');
  expect(remote.text).toContain('First submission');
  remote.releaseSave(); await expect.poll(() => remote.text).toContain('Newer edit');
  await expect.poll(async () => (await syncState(page, 'drive-sync-ledger')).checkpoint ?? null).toBeNull();
});

test('undo during a stalled accepted save survives its acknowledgement', async ({ page }) => {
  const remote = await setup(page); await importInitial(page); await createLinked(page);
  remote.holdSave = true; await editOriginal(page, 'Submitted title'); await expect.poll(() => remote.saveEntered).toBe(true);
  await page.getByRole('button', { name: 'Undated', exact: true }).focus(); await page.keyboard.press('Control+z');
  await expect.poll(async () => (await syncState(page, 'current')).document.undated[0].items[0].text, { timeout: 2000 }).toBe('Original');
  remote.releaseSave(); await expect.poll(() => remote.text).toMatch(/Original[\s\S]*  - Keep\ detail/);
  expect(remote.writes).toBe(2);
});

test('a lost save reply is verified after reload without repeating the accepted upload', async ({ page }) => {
  const remote = await setup(page); await importInitial(page); await createLinked(page);
  remote.dropSaveReply = true; await editOriginal(page, 'Accepted without reply');
  await expect.poll(async () => (await syncState(page, 'drive-sync-ledger')).status.kind).toBe('retrying');
  expect(remote.writes).toBe(1); await page.reload(); await runCommand(page, 'Settings');
  expect((await syncState(page, 'drive-sync-ledger')).checkpoint.text).toContain('Accepted without reply');
  await connect(page);
  await expect.poll(async () => (await syncState(page, 'drive-sync-ledger')).checkpoint ?? null).toBeNull();
  expect(remote.writes).toBe(1); await expect(region(page)).toContainText('up to date');
});

test('a different tab takes over a closed network owner and delivers only the remaining edit', async ({ page, context }) => {
  const remote = await setup(page); await importInitial(page); await createLinked(page);
  remote.holdSave = true; await editOriginal(page, 'Frozen submission'); await expect.poll(() => remote.saveEntered).toBe(true);
  const title = page.getByRole('textbox', { name: 'Edit Frozen submission', exact: true }); await title.fill('Remaining edit'); await title.press('Tab');
  await expect.poll(async () => (await syncState(page, 'current')).document.undated[0].items[0].text).toBe('Remaining edit');
  await page.close(); remote.releaseSave();
  const other = await context.newPage(); await other.goto('/'); await runCommand(other, 'Settings'); await connect(other);
  await expect.poll(() => remote.text).toContain('Remaining edit'); expect(remote.writes).toBe(2);
  await expect.poll(async () => (await syncState(other, 'drive-sync-ledger')).checkpoint ?? null).toBeNull();
});

test('a failed pre-send checkpoint stops the upload without losing the browser edit', async ({ page }) => {
  const remote = await setup(page); await importInitial(page); await createLinked(page);
  await page.evaluate(() => {
    Reflect.set(window, 'failSyncCheckpoint', true);
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(value, key) {
      if (key === 'drive-sync-ledger' && value.checkpoint && Reflect.get(window, 'failSyncCheckpoint')) throw new DOMException('Sync checkpoint is full', 'QuotaExceededError');
      return put.call(this, value, key);
    };
  });
  await editOriginal(page, 'Saved only in browser');
  await expect(page.getByRole('status', { name: 'Journal sync', exact: true })).toContainText('needs attention');
  expect(remote.writes).toBe(0); expect((await syncState(page, 'current')).document.undated[0].items[0].text).toBe('Saved only in browser');
  await page.evaluate(() => Reflect.set(window, 'failSyncCheckpoint', false)); await runCommand(page, 'Settings');
  await region(page).getByRole('button', { name: 'Resume Google Drive saving', exact: true }).click();
  await expect.poll(() => remote.text).toContain('Saved only in browser');
});

test('a failed receipt rolls back its baseline and acknowledges read-back without a second upload', async ({ page }) => {
  const remote = await setup(page); await importInitial(page); await createLinked(page);
  await page.evaluate(() => {
    Object.assign(window, { failSyncReceipt: true, syncHasCheckpoint: false });
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(value, key) {
      if (key === 'drive-sync-ledger') {
        if (value.checkpoint) Reflect.set(window, 'syncHasCheckpoint', true);
        else if (Reflect.get(window, 'syncHasCheckpoint') && Reflect.get(window, 'failSyncReceipt')) throw new DOMException('Sync receipt is full', 'QuotaExceededError');
      }
      return put.call(this, value, key);
    };
  });
  await editOriginal(page, 'Accepted before storage failure');
  await expect.poll(async () => (await syncState(page, 'drive-sync-ledger')).status.kind).toBe('error');
  expect(remote.writes).toBe(1); expect((await savedLink(page))?.baselineText).toContain('Original');
  expect((await syncState(page, 'drive-sync-ledger')).checkpoint.text).toContain('Accepted before storage failure');
  await page.evaluate(() => Reflect.set(window, 'failSyncReceipt', false)); await runCommand(page, 'Settings');
  await region(page).getByRole('button', { name: 'Resume Google Drive saving', exact: true }).click();
  await expect.poll(async () => (await syncState(page, 'drive-sync-ledger')).checkpoint ?? null).toBeNull();
  expect(remote.writes).toBe(1); expect((await savedLink(page))?.baselineText).toContain('Accepted before storage failure');
});

test('offline edits catch up automatically when the connection returns', async ({ page, context }) => {
  const remote = await setup(page); await importInitial(page); await createLinked(page);
  await context.setOffline(true); await editOriginal(page, 'Edited offline');
  await expect(page.getByRole('status', { name: 'Journal sync', exact: true })).toContainText('online');
  expect(remote.writes).toBe(0);
  await context.setOffline(false); await expect.poll(() => remote.text).toContain('Edited offline');
  await expect.poll(async () => (await syncState(page, 'drive-sync-ledger')).status.kind).toBe('saved');
});

test('temporary server failures retry automatically with a durable cooldown', async ({ page }) => {
  const remote = await setup(page); await importInitial(page); await createLinked(page);
  remote.failSave = 503; await editOriginal(page, 'Retry automatically');
  await expect.poll(async () => (await syncState(page, 'drive-sync-ledger')).status.kind).toBe('retrying');
  expect((await syncState(page, 'drive-sync-ledger')).retryAt).toBeGreaterThan(Date.now());
  remote.failSave = 0; await expect.poll(() => remote.text).toContain('Retry automatically');
});

test('unconfirmed creation survives reload and recovering its file does not create a duplicate', async ({ page }) => {
  const remote = await setup(page); await importInitial(page); await connect(page);
  remote.dropCreateReply = true;
  await region(page).getByRole('button', { name: 'Create Planner.md in Google Drive', exact: true }).click();
  const pending = region(page).getByRole('status', { name: 'Unconfirmed file creation', exact: true });
  await expect(pending).toBeVisible(); await expect(region(page).getByRole('button', { name: 'Create Planner.md in Google Drive', exact: true })).toBeDisabled();
  await expect.poll(() => remote.creationCheckpoint).toBe(true); expect(remote.creates).toBe(1);
  await page.reload(); await runCommand(page, 'Settings'); await expect(pending).toBeVisible();
  await connect(page); await region(page).getByRole('button', { name: 'Planner.md', exact: true }).click();
  await expect.poll(() => savedLink(page)).not.toBeNull();
  expect(await syncState(page, 'sync-file-creation')).toBeNull(); expect(remote.creates).toBe(1);
});

test('creation I/O leaves local editing responsive and links the frozen creation snapshot', async ({ page }) => {
  const remote = await setup(page); await importInitial(page); await connect(page);
  remote.holdCreate = true; await region(page).getByRole('button', { name: 'Create Planner.md in Google Drive', exact: true }).click();
  await expect.poll(() => remote.creationEntered).toBe(true);
  expect((await syncState(page, 'sync-file-creation')).text).toContain('Original');
  await editOriginal(page, 'Edited during creation');
  await expect.poll(async () => (await syncState(page, 'current')).document.undated[0].items[0].text, { timeout: 2000 }).toBe('Edited during creation');
  remote.releaseCreate(); await expect.poll(() => remote.text).toContain('Edited during creation');
  expect(remote.creates).toBe(1); expect(await syncState(page, 'sync-file-creation')).toBeNull();
});

test('creation checkpoint failure prevents the POST and leaves the journal available', async ({ page }) => {
  const remote = await setup(page); await importInitial(page); await connect(page);
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(value, key) {
      if (key === 'sync-file-creation') throw new DOMException('Creation checkpoint is full', 'QuotaExceededError');
      return put.call(this, value, key);
    };
  });
  await region(page).getByRole('button', { name: 'Create Planner.md in Google Drive', exact: true }).click();
  await expect(region(page).getByRole('alert')).toContainText('Creation checkpoint is full');
  expect(remote.creates).toBe(0); expect(await syncState(page, 'sync-file-creation')).toBeNull();
  expect((await syncState(page, 'current')).document.undated[0].items[0].text).toBe('Original');
});


test('an expired token stays scoped to its tab while another authorized window catches up', async ({ page, context }) => {
  const remote = await setup(page); await importInitial(page); await createLinked(page);
  const other = await context.newPage(); await other.goto('/'); await runCommand(other, 'Settings'); await connect(other);
  await expect.poll(() => remote.otherRequests).toBeGreaterThanOrEqual(2);
  await other.evaluate(() => navigator.locks.request('hot-cross-buns-sync-delivery', () => {}));
  // simulate a hidden second window until the first window receives its own rejection.
  await other.evaluate(() => Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }));
  remote.expireOwner = true; await editOriginal(page, 'Delivered by another window');
  await expect(page.getByRole('status', { name: 'Journal sync', exact: true })).toContainText('Reconnect this tab');
  await expect(region(other).getByRole('button', { name: 'Sign out of this tab', exact: true })).toBeVisible();
  await other.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); document.dispatchEvent(new Event('visibilitychange')); });
  await expect.poll(() => remote.text).toContain('Delivered by another window');
  await expect(region(other).getByRole('button', { name: 'Sign out of this tab', exact: true })).toBeVisible();
  await runCommand(page, 'Settings'); await expect(region(page).getByRole('button', { name: 'Connect Google Drive', exact: true })).toBeVisible();
});

test('a lost revision-creation reply reuses its reserved file identity after reload', async ({ page }) => {
  const remote = await setup(page); await importInitial(page); await createLinked(page);
  remote.dropRevisionReply = true; await editOriginal(page, 'Immutable pending edit');
  await expect.poll(() => remote.dropRevisionReply).toBe(false);
  const pending = (await syncState(page, 'drive-sync-ledger')).revisions.pending;
  expect(pending.record.text).toContain('Immutable pending edit'); expect(remote.revisionCheckpoint).toBe(true);
  await page.reload(); await runCommand(page, 'Settings'); await connect(page);
  await expect.poll(() => remote.text).toContain('Immutable pending edit');
  expect(remote.revisionFiles.size).toBe(2); expect(remote.revisionCreates).toBe(2);
  expect(remote.revisionFiles.has(pending.transportId)).toBe(true);
  expect((await syncState(page, 'drive-sync-ledger')).revisions.pending).toBeUndefined();
});

test('a concurrent Drive revision survives a lost projection and resolves through explicit review', async ({ page }) => {
  const remote = await setup(page); await importInitial(page); await createLinked(page);
  const root = JSON.parse([...remote.revisionFiles.values()][0].raw);
  await editOriginal(page, 'Local protected branch'); await expect.poll(() => remote.text).toContain('Local protected branch');
  await expect.poll(async () => (await syncState(page, 'drive-sync-ledger')).status.kind).toBe('saved');
  const release = await holdSyncDelivery(page);
  const record = await createRevision('drive:file-1', crypto.randomUUID(), [root.id], initial.replace('Original', 'Foreign protected branch'));
  const raw = revisionText(record);
  remote.revisionFiles.set('foreign-file', { id: 'foreign-file', name: 'HCB-foreign.json', mimeType: 'application/json', appProperties: { hcbJournal: 'file-1', hcbRevision: record.id, hcbDigest: record.digest }, raw, version: '1', size: String(Buffer.byteLength(raw)) });
  await runCommand(page, 'Settings'); await region(page).getByRole('button', { name: 'Check Google Drive now', exact: true }).click(); await release();
  await region(page).getByRole('button', { name: 'Review Google Drive file', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Review Planner.md import', exact: true });
  await expect(review).toContainText('Local protected branch'); await expect(review).toContainText('Foreign protected branch');
  await review.getByRole('radio', { name: 'keep both', exact: true }).check(); await review.getByRole('button', { name: 'apply import', exact: true }).click();
  await expect(review).toBeHidden(); await expect.poll(() => remote.text).toContain('Foreign protected branch');
  expect(remote.text).toContain('Local protected branch');
  expect([...remote.revisionFiles.values()].some(file => { const value = JSON.parse(file.raw); return value.parents.length === 2 && value.text.includes('Local protected branch') && value.text.includes('Foreign protected branch'); })).toBe(true);
  expect(remote.revisionFiles.get('foreign-file')!.raw).toBe(raw);
});

test('Drive history restores as a new revision and survives a lost publication reply and reload', async ({ page }) => {
  const remote = await setup(page); await importInitial(page); await createLinked(page);
  const root = JSON.parse([...remote.revisionFiles.values()][0].raw);
  await editOriginal(page, 'Later Drive version'); await expect.poll(() => remote.text).toContain('Later Drive version');
  await expect.poll(async () => (await syncState(page, 'drive-sync-ledger')).status.kind).toBe('saved');
  const view = await openHistory(page); await view.getByLabel('Saved version').selectOption(root.id);
  remote.dropRevisionReply = true;
  await view.getByRole('button', { name: 'Restore version', exact: true }).click(); await view.getByRole('button', { name: 'Restore as new version', exact: true }).click();
  await expect(view).toBeHidden(); await expect.poll(() => remote.dropRevisionReply).toBe(false);
  const pending = (await syncState(page, 'drive-sync-ledger')).revisions.pending;
  expect(pending.record.text).toBe(initial); expect(remote.revisionCheckpoint).toBe(true);
  await page.reload(); await runCommand(page, 'Settings'); await connect(page);
  await expect.poll(() => remote.text).toBe(initial);
  expect(remote.revisionFiles.size).toBe(3); expect(remote.revisionCreates).toBe(3);
  expect(remote.revisionFiles.has(pending.transportId)).toBe(true);
  expect([...remote.revisionFiles.values()].some(file => JSON.parse(file.raw).text.includes('Later Drive version'))).toBe(true);
});

test('Drive history after reload requires the linked account rather than showing cached versions', async ({ page }) => {
  const remote = await setup(page); await importInitial(page); await createLinked(page);
  const versions = [...remote.revisionFiles.values()]; await page.reload();
  const view = await openHistory(page);
  await expect(view.getByRole('alert')).toContainText('Reconnect the linked Google account');
  await expect(view.getByRole('combobox', { name: 'Saved version', exact: true })).toHaveCount(0);
  await expect(view.getByRole('button', { name: 'Sync settings', exact: true })).toBeVisible();
  expect([...remote.revisionFiles.values()]).toEqual(versions);
});
