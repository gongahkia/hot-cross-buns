import { expect, test, type Page } from '@playwright/test';
import { runCommand } from './commands';

const initial = 'UNDATED\n\nLIST: Inbox\nOriginal\n- Keep detail\n';
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
  const remote = { text: initial, version: 1, exists: existing, writes: 0, creates: 0, failSave: 0, account: 'account-1', tokenCalls: 0, requests: 0 };
  await page.addInitScript(({ scope }) => {
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
    const pick = async () => (await navigator.storage.getDirectory()).getFileHandle('TODO.txt', { create: true });
    Object.assign(window, { showOpenFilePicker: async () => [await pick()], showSaveFilePicker: pick });
  }, { scope });
  await page.route('https://openidconnect.googleapis.com/v1/userinfo', async route => {
    remote.tokenCalls++;
    expect(route.request().headers().authorization).toBe('Bearer test-only-access-token');
    await route.fulfill({ json: { sub: remote.account, email: remote.account + '@example.com' } });
  });
  await page.route('https://www.googleapis.com/**', async route => {
    const request = route.request(), url = new URL(request.url()); remote.requests++;
    expect(request.headers().authorization).toBe('Bearer test-only-access-token');
    expect(url.searchParams.has('access_token')).toBe(false);
    const metadata = () => ({ id: 'file-1', name: 'TODO.txt', mimeType: 'text/plain', version: String(remote.version), size: String(Buffer.byteLength(remote.text)), capabilities: { canEdit: true } });
    if (request.method() === 'POST') {
      remote.creates++; remote.exists = true;
      const body = request.postData()!;
      remote.text = body.split('Content-Type: text/plain; charset=UTF-8\r\n\r\n')[1].split('\r\n--hcb-')[0];
      await route.fulfill({ json: metadata() }); return;
    }
    if (request.method() === 'PATCH') {
      if (remote.failSave) { await route.fulfill({ status: remote.failSave, body: '{}' }); return; }
      remote.text = request.postData()!; remote.version++; remote.writes++;
      await route.fulfill({ json: metadata() }); return;
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
  await page.getByLabel('Import a TODO.txt file').setInputFiles({ name: 'TODO.txt', mimeType: 'text/plain', buffer: Buffer.from(initial) });
  await page.getByRole('button', { name: 'Undated', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Edit Original', exact: true })).toBeVisible();
  await runCommand(page, 'Settings');
}
async function createLinked(page: Page) {
  await connect(page); await region(page).getByRole('button', { name: 'Create TODO.txt in Google Drive', exact: true }).click();
  await expect.poll(() => savedLink(page)).not.toBeNull();
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
  expect(remote.creates).toBe(1); expect(remote.text).toContain('Original\n- Keep detail');
  const auth = await page.evaluate(() => Reflect.get(window, 'mockGoogle'));
  expect(auth.activeClick).toBe(true); expect(auth.scope).toBe('openid email ' + scope);
  await editOriginal(page, 'Saved directly');
  await expect.poll(() => remote.text).toContain('Saved directly\n- Keep detail');
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
  expect(picker).toMatchObject({ key: 'test-key', appId: '123', origin: new URL(page.url()).origin, mime: 'text/plain', modalOpen: false });
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
  const remote = await setup(page, true); remote.text = '2026-11-16\nTask without divider\n'; await connect(page);
  await region(page).getByRole('button', { name: 'TODO.txt', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Review TODO.txt import', exact: true });
  await expect(review).toContainText('including any repairs');
  expect(await savedLink(page)).toBeNull(); expect(remote.writes).toBe(0);
  await review.getByRole('button', { name: 'mark this day upcoming', exact: true }).click();
  await review.getByRole('button', { name: 'apply import', exact: true }).click();
  await expect.poll(() => savedLink(page)).not.toBeNull();
  await expect.poll(() => remote.text).toContain('2026-11-16\n\nTask without divider');
});
test('external Drive changes pause writes across reload and normal merge review resumes saving', async ({ page }) => {
  const remote = await setup(page); await importInitial(page); await createLinked(page);
  remote.text = initial.replace('Original', 'Remote title'); remote.version++;
  await editOriginal(page, 'Local title');
  await expect(page.getByRole('status', { name: 'Notification', exact: true })).toContainText('Google Drive journal changed');
  expect(remote.text).toContain('Remote title');
  await page.reload(); await runCommand(page, 'Settings'); await connect(page);
  await expect(region(page)).toContainText('changed in Google Drive');
  await region(page).getByRole('button', { name: 'Review Google Drive file', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Review TODO.txt import', exact: true });
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
  remote.failSave = 0; await runCommand(page, 'Settings');
  await region(page).getByRole('button', { name: 'Resume Google Drive saving', exact: true }).click();
  await expect.poll(() => remote.text).toContain('Retained locally');
  await region(page).getByRole('button', { name: 'Unlink Google Drive file', exact: true }).click();
  await expect.poll(() => savedLink(page)).toBeNull(); expect(remote.exists).toBe(true);
  await closeSettings(page); await expect(page.getByRole('textbox', { name: 'Edit Retained locally', exact: true })).toBeVisible();
});
test('only one local or Google Drive target can be linked at a time', async ({ page }) => {
  await setup(page); await createLinked(page);
  const local = page.getByRole('region', { name: 'File sync', exact: true });
  await expect(local.getByRole('button', { name: 'Create linked TODO.txt', exact: true })).toBeDisabled();
  await region(page).getByRole('button', { name: 'Unlink Google Drive file', exact: true }).click();
  await expect(local.getByRole('button', { name: 'Create linked TODO.txt', exact: true })).toBeEnabled();
  await local.getByRole('button', { name: 'Create linked TODO.txt', exact: true }).click();
  await expect(local).toContainText('up to date');
  await expect(region(page).getByRole('button', { name: 'Create TODO.txt in Google Drive', exact: true })).toBeDisabled();
});

test('a stale Drive review cannot overwrite a newer edit from another app window', async ({ page, context }) => {
  const remote = await setup(page); await importInitial(page); await createLinked(page);
  remote.text = initial.replace('Original', 'Remote title'); remote.version++;
  await editOriginal(page, 'Local title');
  await expect.poll(async () => (await savedLink(page))?.needsReview).toBe(true);
  await runCommand(page, 'Settings'); await region(page).getByRole('button', { name: 'Review Google Drive file', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Review TODO.txt import', exact: true });
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
