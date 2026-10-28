import { expect, test, type Page } from '@playwright/test';

async function ready(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.hcb));
  await page.evaluate(async () => {
    const r = await window.hcb!.settings.update({ onboardingStatus: 'completed' });
    if (!r.ok) throw new Error(r.error.message);
  });
  await expect(page.getByRole('dialog', { name: 'Hot Cross Buns', exact: true })).toBeHidden();
}
async function invoke(page: Page, ns: string, action: string, payload = {}) {
  return page.evaluate(async ({ ns, action, payload }) => {
    const result = await (window.hcb as any)[ns][action](payload);
    if (!result.ok) throw new Error(result.error.message);
    return result.data;
  }, { ns, action, payload });
}
async function saveArchive(page: Page) {
  await page.evaluate(async () => {
    const result = await (window.hcb as any).__testing.exportArchive();
    if (!result.ok) throw new Error(result.error.message);
    (window as any).archiveBytes = result.data.bytes;
  });
}
async function stage(page: Page) {
  return page.evaluate(async () => {
    const result = await (window.hcb as any).__testing.stageImport((window as any).archiveBytes);
    if (!result.ok) throw new Error(result.error.message);
    return result.data;
  });
}

test('workspace replacement round trips relationships, preferences, FTS and undo', async ({ page }) => {
  await ready(page);
  const parent = await invoke(page, 'tasks', 'create', { title: 'Archive kumquat', listId: 'inbox' });
  const child = await invoke(page, 'tasks', 'create', { title: 'Child archived', listId: 'inbox', parentId: parent.id });
  const note = await invoke(page, 'notes', 'create', { title: 'Archive note', body: 'Kumquat relationship' });
  await invoke(page, 'calendar', 'scheduleTaskBlock', { taskId: parent.id, calendarId: 'primary', startsAt: '2027-01-12T09:00:00Z', durationMinutes: 30 });
  await invoke(page, 'settings', 'update', { theme: 'dark', defaultTimeZone: 'Asia/Singapore' });
  await invoke(page, 'tasks', 'complete', { id: parent.id });
  await saveArchive(page);
  await invoke(page, 'tasks', 'update', { id: parent.id, title: 'Discard this later edit' });
  const review = await stage(page);
  expect(review.summary).toMatchObject({ tasks: 2, notes: 1, events: 1 });
  expect(await invoke(page, 'workspace', 'confirmImport', { reviewId: review.reviewId, confirmation: 'REPLACE_WORKSPACE' })).toEqual({ replaced: true });
  await page.reload();
  expect(await invoke(page, 'tasks', 'get', { id: parent.id })).toMatchObject({ title: 'Archive kumquat', status: 'completed' });
  expect(await invoke(page, 'tasks', 'get', { id: child.id })).toMatchObject({ parentId: parent.id });
  expect(await invoke(page, 'settings', 'get')).toMatchObject({ theme: 'dark', defaultTimeZone: 'Asia/Singapore' });
  expect((await invoke(page, 'search', 'query', { query: 'kumquat' })).items.map((x: any) => x.id)).toContain(note.id);
  await invoke(page, 'undo', 'undo');
  expect(await invoke(page, 'tasks', 'get', { id: parent.id })).toMatchObject({ status: 'active' });
});

test('deleted note lists round trip without restoring tombstones or accepting broken live relationships', async ({ page }) => {
  await ready(page);
  const kept = await invoke(page, 'notes', 'create', { title: 'Kept document', body: 'Cinnamon' });
  const removedList = await invoke(page, 'notes', 'createNoteList', { title: 'Removed list' });
  const removed = await invoke(page, 'notes', 'create', { title: 'Discarded document', listId: removedList.id });
  await invoke(page, 'notes', 'deleteNoteList', { id: removedList.id });
  await saveArchive(page);
  const review = await stage(page);
  expect(review.summary.notes).toBe(1);
  await invoke(page, 'workspace', 'confirmImport', { reviewId: review.reviewId, confirmation: 'REPLACE_WORKSPACE' });
  await page.reload();
  const notes = await invoke(page, 'notes', 'list');
  expect(notes.items.map((note: any) => note.id)).toEqual([kept.id]);
  expect(notes.lists.some((list: any) => list.id === removedList.id)).toBe(false);
  expect((await page.evaluate(id => window.hcb!.notes.get({ id }), removed.id)).ok).toBe(false);
  await invoke(page, '__testing', 'seedDatabase', { statements: [{ sql: 'UPDATE notes SET list_id=? WHERE id=?', values: ['missing-list', kept.id] }] });
  await saveArchive(page);
  await invoke(page, '__testing', 'seedDatabase', { statements: [{ sql: 'UPDATE notes SET list_id=? WHERE id=?', values: [kept.listId, kept.id] }] });
  const invalid = await page.evaluate(() => (window.hcb as any).__testing.stageImport((window as any).archiveBytes));
  expect(invalid).toMatchObject({ ok: false, error: { message: expect.stringContaining('broken task or note relationships') } });
  expect(await invoke(page, 'notes', 'get', { id: kept.id })).toMatchObject({ listId: kept.listId });
});

test('invalid imports, future schemas and WAL files never replace the current workspace', async ({ page }) => {
  await ready(page);
  const task = await invoke(page, 'tasks', 'create', { title: 'Preserved sentinel', listId: 'inbox' });
  const failures = await page.evaluate(async () => {
    const testing = (window.hcb as any).__testing;
    const exported = await testing.exportArchive();
    const future = exported.data.bytes.slice();
    const wal = exported.data.bytes.slice(); wal[18] = 2; wal[19] = 2;
    return [await testing.stageImport(new Uint8Array([1, 2, 3])), await testing.stageImport(wal), await testing.stageImport(future.slice(0, 100))];
  });
  for (const result of failures) expect(result.ok).toBe(false);
  expect(failures[1].error.message).toMatch(/WAL/);
  // Create a future-schema candidate using real SQLite, then restore the source schema.
  await invoke(page, '__testing', 'seedDatabase', { statements: [{ sql: 'INSERT INTO schema_migrations VALUES(999)' }] });
  await saveArchive(page);
  await invoke(page, '__testing', 'seedDatabase', { statements: [{ sql: 'DELETE FROM schema_migrations WHERE version=999' }] });
  const futureResult = await page.evaluate(() => (window.hcb as any).__testing.stageImport((window as any).archiveBytes));
  expect(futureResult.ok).toBe(false);
  expect(futureResult.error.message).toMatch(/999.*unsupported/);
  expect(await invoke(page, 'tasks', 'get', { id: task.id })).toMatchObject({ title: 'Preserved sentinel' });
  await page.reload();
  expect(await invoke(page, 'tasks', 'get', { id: task.id })).toMatchObject({ title: 'Preserved sentinel' });
});

test('failed replacement preserves active caches and durable data, then a reviewed retry works', async ({ page }) => {
  await ready(page);
  const task = await invoke(page, 'tasks', 'create', { title: 'Backup title', listId: 'inbox' });
  await saveArchive(page);
  await invoke(page, 'tasks', 'update', { id: task.id, title: 'Current title' });
  const review = await stage(page);
  await invoke(page, '__testing', 'failNextPersistence');
  const result = await page.evaluate(reviewId => window.hcb!.workspace.confirmImport({ reviewId, confirmation: 'REPLACE_WORKSPACE' }), review.reviewId);
  expect(result.ok).toBe(false);
  expect(await invoke(page, 'tasks', 'get', { id: task.id })).toMatchObject({ title: 'Current title' });
  await invoke(page, 'workspace', 'confirmImport', { reviewId: review.reviewId, confirmation: 'REPLACE_WORKSPACE' });
  expect(await invoke(page, 'tasks', 'get', { id: task.id })).toMatchObject({ title: 'Backup title' });
  await invoke(page, 'tasks', 'update', { id: task.id, title: 'Cache remains usable' });
  await page.reload();
  expect(await invoke(page, 'tasks', 'get', { id: task.id })).toMatchObject({ title: 'Cache remains usable' });
});

test('a staged review cannot overwrite another tab and the writer lock transfers on closure', async ({ page, context }) => {
  await ready(page);
  await saveArchive(page);
  const review = await stage(page);
  const second = await context.newPage();
  await ready(second);
  const task = await invoke(second, 'tasks', 'create', { title: 'Other tab sentinel', listId: 'inbox' });
  const stale = await page.evaluate(reviewId => window.hcb!.workspace.confirmImport({ reviewId, confirmation: 'REPLACE_WORKSPACE' }), review.reviewId);
  expect(stale.ok).toBe(false);
  expect(stale.error.message).toMatch(/changed/);
  await second.close();
  await invoke(page, 'tasks', 'update', { id: task.id, title: 'Writer takeover succeeds' });
  await page.reload();
  expect(await invoke(page, 'tasks', 'get', { id: task.id })).toMatchObject({ title: 'Writer takeover succeeds' });
});

test('imported Google changes are quarantined, not automatically replayed', async ({ page }) => {
  await ready(page);
  const now = new Date().toISOString();
  await invoke(page, '__testing', 'seedDatabase', { statements: [
    { sql: "INSERT INTO google_accounts(id,google_account_id,email,display_name,connection_state,created_at,updated_at) VALUES('imported-account','verified-sub','test@example.invalid','Test','connected',?,?)", values: [now, now] },
    { sql: "INSERT INTO outbox(id,account_id,kind,entity_id,payload_json,state,next_attempt_at,created_at,updated_at) VALUES('imported-write','imported-account','task.create','missing','{}','pending',?,?,?)", values: [now, now, now] },
  ] });
  await saveArchive(page);
  const review = await stage(page);
  expect(review.summary.pendingMutations).toBe(1);
  await invoke(page, 'workspace', 'confirmImport', { reviewId: review.reviewId, confirmation: 'REPLACE_WORKSPACE' });
  expect((await invoke(page, 'google', 'status')).accounts[0].connectionState).toBe('disconnected');
  const diagnostics = await invoke(page, 'diagnostics', 'pendingMutations');
  expect(diagnostics.mutations[0]).toMatchObject({ status: 'failed' });
  expect(JSON.stringify(diagnostics)).toMatch(/Imported change/);
});

test('workspace export is a real browser download and picker imports require explicit review', async ({ page }) => {
  await ready(page);
  const task = await invoke(page, 'tasks', 'create', { title: 'Download roundtrip', listId: 'inbox' });
  const downloadPromise = page.waitForEvent('download');
  await invoke(page, 'workspace', 'exportArchive');
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/hot-cross-buns-.*\.sqlite$/);
  const path = await download.path();
  expect(path).toBeTruthy();
  const picker = page.waitForEvent('filechooser');
  const pending = page.evaluate(() => window.hcb!.workspace.stageImport());
  await (await picker).setFiles(path!);
  const result = await pending;
  expect(result.ok).toBe(true);
  expect(result.data.summary.tasks).toBe(1);
  const rejected = await page.evaluate(reviewId => window.hcb!.workspace.confirmImport({ reviewId }), result.data.reviewId);
  expect(rejected.ok).toBe(false);
  expect(await invoke(page, 'tasks', 'get', { id: task.id })).toMatchObject({ title: 'Download roundtrip' });
});

test('a failed initialization can export its untouched bytes and restore a reviewed valid backup', async ({ page }) => {
  await ready(page);
  const task = await invoke(page, 'tasks', 'create', { title: 'Recoverable backup sentinel', listId: 'inbox' });
  const bytes = await page.evaluate(async () => Array.from((await (window.hcb as any).__testing.exportArchive()).data.bytes) as number[]);
  await invoke(page, '__testing', 'seedDatabase', { statements: [{ sql: 'INSERT INTO schema_migrations VALUES(999)' }] });
  await page.reload();
  const broken = await page.evaluate(() => window.hcb!.bootstrap.get({}));
  expect(broken.ok).toBe(false);
  const exportResult = await page.evaluate(() => (window.hcb as any).__testing.exportArchive());
  expect(exportResult.ok).toBe(true);
  const reviewed = await page.evaluate(bytes => (window.hcb as any).__testing.stageImport(new Uint8Array(bytes)), bytes);
  expect(reviewed.ok).toBe(true);
  const replaced = await page.evaluate(reviewId => window.hcb!.workspace.confirmImport({ reviewId, confirmation: 'REPLACE_WORKSPACE' }), reviewed.data.reviewId);
  expect(replaced.ok).toBe(true);
  await page.reload();
  expect(await invoke(page, 'tasks', 'get', { id: task.id })).toMatchObject({ title: 'Recoverable backup sentinel' });
});

test('a stale worker does not advance its active revision when a replacement fails', async ({ page, context }) => {
  await ready(page);
  const archive = await page.evaluate(async () => Array.from((await (window.hcb as any).__testing.exportArchive()).data.bytes) as number[]);
  const second = await context.newPage();
  await ready(second);
  const workerUrl = page.workers()[0].url();
  // An independent worker deliberately stays stale, without renderer refresh events.
  await page.evaluate(url => new Promise<void>((resolve, reject) => {
    const worker = new Worker(url, { type: 'module' });
    (window as any).staleWorker = worker;
    worker.onmessage = ({ data }) => data.type === 'ready' ? resolve() : data.type === 'initialization-error' ? reject(new Error(data.message)) : undefined;
    worker.onerror = event => reject(new Error(event.message));
  }), workerUrl);
  const other = await invoke(second, 'tasks', 'create', { title: 'Other tab must survive failed replacement', listId: 'inbox' });
  const results = await page.evaluate(async ({ archive, id }) => {
    const worker = (window as any).staleWorker as Worker;
    let sequence = 0;
    const call = (namespace: string, action: string, payload = {}) => new Promise<any>(resolve => {
      const requestId = ++sequence;
      const listen = ({ data }: MessageEvent) => { if (data.id === requestId) { worker.removeEventListener('message', listen); resolve(data.result); } };
      worker.addEventListener('message', listen); worker.postMessage({ id: requestId, namespace, action, payload });
    });
    const review = await call('workspace', 'stageImport', { bytes: new Uint8Array(archive) });
    await call('__test', 'failNextPersistence');
    const failed = await call('workspace', 'confirmImport', { reviewId: review.data.reviewId, confirmation: 'REPLACE_WORKSPACE' });
    const read = await call('tasks', 'get', { id });
    const edit = await call('tasks', 'update', { id, title: 'Survived stale import failure' });
    worker.terminate();
    return { failed, read, edit };
  }, { archive, id: other.id });
  expect(results.failed.ok).toBe(false);
  expect(results.read.ok).toBe(true);
  expect(results.edit.ok).toBe(true);
  await page.reload();
  expect(await invoke(page, 'tasks', 'get', { id: other.id })).toMatchObject({ title: 'Survived stale import failure' });
});

test('a desktop workspace with retired local fallback gains real local resources when imported', async ({ page }) => {
  await ready(page);
  const now = new Date().toISOString();
  await invoke(page, '__testing', 'seedDatabase', { statements: [
    { sql: "INSERT INTO sync_meta(key,value) VALUES('local-fallback-retired','true')" },
    { sql: "DELETE FROM task_lists; DELETE FROM calendars; DELETE FROM google_accounts;" },
    { sql: "INSERT INTO google_accounts(id,google_account_id,display_name,connection_state,created_at,updated_at) VALUES('desktop','subject','Desktop Google','connected',?,?)", values: [now, now] },
    { sql: "INSERT INTO task_lists(id,account_id,title,created_at,updated_at) VALUES('desktop-list','desktop','Google list',?,?)", values: [now, now] },
    { sql: "INSERT INTO calendars(id,account_id,title,created_at,updated_at) VALUES('desktop-calendar','desktop','Google calendar',?,?)", values: [now, now] },
  ] });
  await saveArchive(page);
  const review = await stage(page);
  await invoke(page, 'workspace', 'confirmImport', { reviewId: review.reviewId, confirmation: 'REPLACE_WORKSPACE' });
  const lists = await invoke(page, 'tasks', 'listTaskLists');
  const calendars = await invoke(page, 'calendar', 'listCalendars');
  expect(lists.items.some((list: any) => list.accountId === 'local')).toBe(true);
  expect(calendars.items.some((calendar: any) => calendar.accountId === 'local')).toBe(true);
  const local = lists.items.find((list: any) => list.accountId === 'local');
  const task = await invoke(page, 'tasks', 'create', { listId: local.id, title: 'Local planning after desktop migration' });
  await page.reload();
  expect(await invoke(page, 'tasks', 'get', { id: task.id })).toMatchObject({ title: 'Local planning after desktop migration' });
});
