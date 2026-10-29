import { expect, test, type BrowserContext, type Page, type Route } from '@playwright/test';

function gate() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}

async function googleFixture(context: BrowserContext) {
  const tasks = new Map<string, any>();
  const events = new Map<string, any>();
  const state = { taskCreates: 0, eventCreates: 0, pulls: 0, writes: [] as string[], hold: undefined as undefined | ((route: Route) => Promise<void>) };
  await context.addInitScript(() => {
    (window as any).google = { accounts: { oauth2: { initTokenClient: (config: any) => ({
      requestAccessToken: () => queueMicrotask(() => config.callback({ access_token: 'responsive-test-token', expires_in: 3600, scope: config.scope }))
    }) } } };
  });
  await context.route('https://openidconnect.googleapis.com/v1/userinfo', route => route.fulfill({ json: { sub: 'responsive-subject', email: 'sync@example.test' } }));
  await context.route(/https:\/\/(tasks|www)\.googleapis\.com\//, async route => {
    const url = new URL(route.request().url()), method = route.request().method();
    if (method === 'GET') {
      if (url.pathname.endsWith('/users/@me/lists')) {
        state.pulls++;
        await state.hold?.(route);
        return route.fulfill({ json: { items: [{ id: 'list', title: 'Synced list' }] } }).catch(() => {});
      }
      if (url.pathname.endsWith('/tasks')) return route.fulfill({ json: { items: [...tasks.values()] } });
      if (url.pathname.endsWith('/calendarList')) return route.fulfill({ json: { items: [{ id: 'calendar', summary: 'Synced calendar', accessRole: 'owner' }] } });
      if (url.pathname.endsWith('/events')) return route.fulfill({ json: { items: [...events.values()], nextSyncToken: 'token' } });
    }
    const collection = url.hostname.startsWith('tasks.') ? tasks : events;
    if (method === 'POST') {
      const body = route.request().postDataJSON();
      const id = collection === tasks ? `task-${++state.taskCreates}` : (state.eventCreates++, body.id);
      const item = { ...body, id, etag: `${id}-v1` };
      collection.set(id, item); state.writes.push(`POST ${id}`);
      await state.hold?.(route);
      return route.fulfill({ json: item }).catch(() => {});
    }
    const id = url.pathname.split('/').at(-1)!;
    const previous = collection.get(id);
    if (method === 'PATCH') {
      expect(route.request().headers()['if-match']).toBe(previous?.etag);
      const item = { ...previous, ...route.request().postDataJSON(), etag: `${id}-v${state.writes.length + 1}` };
      collection.set(id, item); state.writes.push(`PATCH ${id}`);
      await state.hold?.(route);
      return route.fulfill({ json: item }).catch(() => {});
    }
    if (method === 'DELETE') {
      expect(route.request().headers()['if-match']).toBe(previous?.etag);
      if (collection === tasks) collection.set(id, { ...previous, deleted: true }); else collection.delete(id);
      state.writes.push(`DELETE ${id}`);
      await state.hold?.(route);
      return route.fulfill({ status: 204 }).catch(() => {});
    }
    throw new Error(`Unexpected ${method} ${url}`);
  });
  return { state, tasks, events };
}

async function connect(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => window.hcb?.__testing);
  await page.evaluate(async () => {
    await window.hcb!.settings.update({ onboardingStatus: 'completed', syncMode: 'manual' });
    await window.hcb!.__testing.configureGoogleAuth('test-web.apps.googleusercontent.com');
    const result = await window.hcb!.google.beginOAuth();
    if (!result.ok) throw new Error(result.error.message);
  });
  expect(await page.evaluate(() => window.hcb!.sync.runNow({}))).toMatchObject({ ok: true });
}
async function createTask(page: Page, title = 'Before request') {
  return page.evaluate(async title => {
    const lists = await window.hcb!.tasks.listTaskLists();
    if (!lists.ok) throw new Error(lists.error.message);
    const result = await window.hcb!.tasks.create({ listId: lists.data.items.find((item: any) => item.title === 'Synced list')!.id, title });
    if (!result.ok) throw new Error(result.error.message);
    return result.data;
  }, title);
}
async function startSync(page: Page) {
  await page.evaluate(() => { (window as any).syncResult = undefined; void window.hcb!.sync.runNow({}).then(result => { (window as any).syncResult = result; }); });
}
async function finishSync(page: Page) {
  await page.waitForFunction(() => (window as any).syncResult);
  return page.evaluate(() => (window as any).syncResult);
}
async function promptly<T>(work: Promise<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout>;
  try { return await Promise.race([work, new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('Local request waited behind HTTP for over 2 seconds')), 2000); })]); }
  finally { clearTimeout(timeout!); }
}

test('same-tab and cross-tab edits, undo, reads and settings finish before a held pull', async ({ page, context }) => {
  const f = await googleFixture(context); await connect(page);
  const other = await context.newPage(); await connect(other);
  const held = gate(), entered = gate();
  f.state.hold = async route => { if (route.request().method() === 'GET') { entered.release(); await held.promise; } };
  await startSync(page); await entered.promise;
  await startSync(other); // Queued Google work must not occupy its local queue.
  try {
    const first = await promptly(createTask(page, 'First tab'));
    const second = await promptly(createTask(other, 'Second tab'));
    const results = await promptly(page.evaluate(async id => [
      await window.hcb!.tasks.update({ id, title: 'Edited while downloading' }),
      await window.hcb!.undo.undo(),
      await window.hcb!.tasks.get({ id }),
      await window.hcb!.settings.update({ diagnosticsIncludePerformance: true }),
      await window.hcb!.sync.status(),
    ], first.id));
    expect(results.every(result => result.ok)).toBe(true);
    expect((results[2] as any).data.title).toBe('First tab');
    expect((results[4] as any).data.state).toBe('syncing');
    expect(await promptly(page.evaluate(id => window.hcb!.tasks.get({ id }), second.id))).toMatchObject({ ok: true });
  } finally { f.state.hold = undefined; held.release(); }
  expect((await finishSync(page)).ok).toBe(true);
  expect((await finishSync(other)).ok).toBe(true);
  expect(f.state.taskCreates).toBe(2);
});

test('a late creation receipt preserves edits across a second worker reopening the live intent', async ({ page, context }) => {
  const f = await googleFixture(context); await connect(page);
  const task = await createTask(page);
  const held = gate(), entered = gate();
  f.state.hold = async route => { if (route.request().method() === 'POST') { entered.release(); await held.promise; } };
  await startSync(page); await entered.promise;
  const other = await context.newPage();
  try {
    await promptly(other.goto('/')); await promptly(other.waitForFunction(() => window.hcb?.__testing));
    expect(await promptly(other.evaluate(id => window.hcb!.tasks.update({ id, title: 'Latest local edit' }), task.id))).toMatchObject({ ok: true });
    expect(await promptly(page.evaluate(id => window.hcb!.tasks.get({ id }), task.id))).toMatchObject({ ok: true, data: { title: 'Latest local edit' } });
  } finally { f.state.hold = undefined; held.release(); }
  expect((await finishSync(page)).ok).toBe(true);
  expect(await page.evaluate(() => window.hcb!.sync.runNow({}))).toMatchObject({ ok: true });
  expect(f.state.taskCreates).toBe(1);
  expect([...f.tasks.values()]).toMatchObject([{ title: 'Latest local edit' }]);
  expect(await other.evaluate(id => window.hcb!.tasks.get({ id }), task.id)).toMatchObject({ ok: true, data: { title: 'Latest local edit' } });
});

test('undoing a task creation during HTTP queues its deletion without another create', async ({ page, context }) => {
  const f = await googleFixture(context); await connect(page); await createTask(page);
  const held = gate(), entered = gate();
  f.state.hold = async route => { if (route.request().method() === 'POST') { entered.release(); await held.promise; } };
  await startSync(page); await entered.promise;
  try { expect(await promptly(page.evaluate(() => window.hcb!.undo.undo()))).toMatchObject({ ok: true }); }
  finally { f.state.hold = undefined; held.release(); }
  expect((await finishSync(page)).ok).toBe(true);
  expect(await page.evaluate(() => window.hcb!.sync.runNow({}))).toMatchObject({ ok: true });
  expect(f.state.writes).toEqual(['POST task-1', 'DELETE task-1']);
});

test('closing the creator quarantines the abandoned intent while another tab keeps editing', async ({ page, context }) => {
  const f = await googleFixture(context); await connect(page); const task = await createTask(page);
  const other = await context.newPage(); await other.goto('/'); await other.waitForFunction(() => window.hcb?.__testing);
  const held = gate(), entered = gate();
  f.state.hold = async route => { if (route.request().method() === 'POST') { entered.release(); await held.promise; } };
  await startSync(page); await entered.promise;
  await promptly(other.evaluate(id => window.hcb!.tasks.update({ id, title: 'Saved during creation' }), task.id));
  await page.close(); f.state.hold = undefined; held.release();
  expect(await promptly(other.evaluate(id => window.hcb!.tasks.get({ id }), task.id))).toMatchObject({ ok: true, data: { title: 'Saved during creation' } });
  await connect(other);
  const pending = await other.evaluate(() => window.hcb!.diagnostics.pendingMutations({}));
  expect(pending.ok).toBe(true);
  expect(JSON.stringify(pending)).toContain('stopped during a Google creation');
  expect(f.state.taskCreates).toBe(1);
});

test('a failed local save during HTTP rolls back only that command and preserves the later receipt', async ({ page, context }) => {
  const f = await googleFixture(context); await connect(page); const task = await createTask(page);
  const held = gate(), entered = gate();
  f.state.hold = async route => { if (route.request().method() === 'POST') { entered.release(); await held.promise; } };
  await startSync(page); await entered.promise;
  try {
    await promptly(page.evaluate(() => window.hcb!.__testing.failNextPersistence()));
    expect(await promptly(page.evaluate(id => window.hcb!.tasks.update({ id, title: 'Must roll back' }), task.id))).toMatchObject({ ok: false });
    expect(await promptly(page.evaluate(id => window.hcb!.tasks.get({ id }), task.id))).toMatchObject({ ok: true, data: { title: 'Before request' } });
    expect(await promptly(page.evaluate(id => window.hcb!.tasks.update({ id, title: 'Durable follow-up' }), task.id))).toMatchObject({ ok: true });
  } finally { f.state.hold = undefined; held.release(); }
  expect((await finishSync(page)).ok).toBe(true);
  expect(await page.evaluate(() => window.hcb!.sync.runNow({}))).toMatchObject({ ok: true });
  expect(f.state.taskCreates).toBe(1);
  expect([...f.tasks.values()]).toMatchObject([{ title: 'Durable follow-up' }]);
});

test('deleting an event during creation sends the accepted identity and newest ETag to Google', async ({ page, context }) => {
  const f = await googleFixture(context); await connect(page);
  const event = await page.evaluate(async () => {
    const calendars = await window.hcb!.calendar.listCalendars();
    if (!calendars.ok) throw new Error(calendars.error.message);
    const result = await window.hcb!.calendar.create({ calendarId: calendars.data.items.find((item: any) => item.title === 'Synced calendar')!.id, title: 'Delete during send', startsAt: '2026-10-29T08:00:00Z', endsAt: '2026-10-29T09:00:00Z' });
    if (!result.ok) throw new Error(result.error.message);
    return result.data;
  });
  const held = gate(), entered = gate();
  f.state.hold = async route => { if (route.request().method() === 'POST') { entered.release(); await held.promise; } };
  await startSync(page); await entered.promise;
  try { expect(await promptly(page.evaluate(id => window.hcb!.calendar.delete({ id }), event.id))).toMatchObject({ ok: true }); }
  finally { f.state.hold = undefined; held.release(); }
  expect((await finishSync(page)).ok).toBe(true);
  expect(await page.evaluate(() => window.hcb!.sync.runNow({}))).toMatchObject({ ok: true });
  expect(f.state.eventCreates).toBe(1); expect(f.events.size).toBe(0);
});

for (const kind of ['task', 'event'] as const) {
  test(`undo during a ${kind} delete recreates the restored item with a fresh remote identity`, async ({ page, context }) => {
    const f = await googleFixture(context); await connect(page);
    const item = kind === 'task' ? await createTask(page, 'Restore me') : await page.evaluate(async () => {
      const calendars = await window.hcb!.calendar.listCalendars();
      if (!calendars.ok) throw new Error(calendars.error.message);
      const result = await window.hcb!.calendar.create({ calendarId: calendars.data.items.find((item: any) => item.title === 'Synced calendar')!.id, title: 'Restore me', startsAt: '2026-10-29T08:00:00Z', endsAt: '2026-10-29T09:00:00Z' });
      if (!result.ok) throw new Error(result.error.message);
      return result.data;
    });
    expect(await page.evaluate(() => window.hcb!.sync.runNow({}))).toMatchObject({ ok: true });
    expect(await page.evaluate(({ kind, id }) => kind === 'task' ? window.hcb!.tasks.delete({ id }) : window.hcb!.calendar.delete({ id }), { kind, id: item.id })).toMatchObject({ ok: true });
    const held = gate(), entered = gate();
    f.state.hold = async route => { if (route.request().method() === 'DELETE') { entered.release(); await held.promise; } };
    await startSync(page); await entered.promise;
    try { expect(await promptly(page.evaluate(() => window.hcb!.undo.undo()))).toMatchObject({ ok: true }); }
    finally { f.state.hold = undefined; held.release(); }
    expect((await finishSync(page)).ok).toBe(true);
    expect(await page.evaluate(() => window.hcb!.sync.runNow({}))).toMatchObject({ ok: true });
    const createdIds = f.state.writes.filter(write => write.startsWith('POST '));
    const pending = await page.evaluate(() => window.hcb!.diagnostics.pendingMutations({}));
    expect(createdIds, JSON.stringify(pending)).toHaveLength(2); expect(createdIds[0]).not.toBe(createdIds[1]);
    const live = [...(kind === 'task' ? f.tasks : f.events).values()].filter(item => !item.deleted);
    expect(live).toHaveLength(1);
    expect(live[0][kind === 'task' ? 'title' : 'summary']).toBe('Restore me');
  });
}

test('disconnect finishes during a held write, saves its receipt, and prevents further sends', async ({ page, context }) => {
  const f = await googleFixture(context); await connect(page);
  await createTask(page, 'Already sending'); await createTask(page, 'Keep queued');
  const held = gate(), entered = gate();
  f.state.hold = async route => { if (route.request().method() === 'POST') { entered.release(); await held.promise; } };
  await startSync(page); await entered.promise;
  try {
    const result = await promptly(page.evaluate(async () => {
      const status = await window.hcb!.google.status();
      if (!status.ok) throw new Error(status.error.message);
      return window.hcb!.google.disconnect({ accountId: status.data.accounts[0].accountId });
    }));
    expect(result).toMatchObject({ ok: true });
    expect(await promptly(createTask(page, 'Saved after disconnect'))).toHaveProperty('id');
  } finally { f.state.hold = undefined; held.release(); }
  await finishSync(page);
  expect(f.state.taskCreates).toBe(1);
  // Reconnect should bind the accepted creation, not submit it again.
  await connect(page);
  expect(f.state.taskCreates).toBe(3);
  expect([...f.tasks.values()].map(task => task.title).sort()).toEqual(['Already sending', 'Keep queued', 'Saved after disconnect']);
});

test('the task inspector saves and closes while a Google pull is still stalled', async ({ page, context }) => {
  const f = await googleFixture(context); await connect(page);
  const task = await createTask(page, 'Open this task');
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Tasks', exact: true }).click();
  await page.getByRole('button', { name: 'Open this task', exact: true }).click();
  const held = gate(), entered = gate();
  f.state.hold = async route => { if (route.request().method() === 'GET') { entered.release(); await held.promise; } };
  await startSync(page); await entered.promise;
  try {
    await page.getByRole('textbox', { name: 'Task title', exact: true }).fill('Saved through the inspector');
    await page.getByRole('button', { name: 'Close inspector', exact: true }).click();
    await expect(page.getByTestId('inspector-shell')).toHaveCount(0, { timeout: 2000 });
    await expect(page.getByRole('button', { name: 'Saved through the inspector', exact: true })).toBeVisible({ timeout: 2000 });
    expect(await promptly(page.evaluate(id => window.hcb!.tasks.get({ id }), task.id))).toMatchObject({ ok: true, data: { title: 'Saved through the inspector' } });
  } finally { f.state.hold = undefined; held.release(); }
  expect((await finishSync(page)).ok).toBe(true);
  expect([...f.tasks.values()]).toMatchObject([{ title: 'Saved through the inspector' }]);
});

test('replacement waits for Google ownership without blocking edits and rejects a stale review', async ({ page, context }) => {
  const f = await googleFixture(context); await connect(page);
  const held = gate(), entered = gate();
  f.state.hold = async route => { if (route.request().method() === 'GET') { entered.release(); await held.promise; } };
  await startSync(page); await entered.promise;
  try {
    await promptly(page.evaluate(async () => {
      const exported = await window.hcb!.__testing.exportArchive();
      if (!exported.ok) throw new Error(exported.error.message);
      const review = await window.hcb!.__testing.stageImport(exported.data.bytes);
      if (!review.ok) throw new Error(review.error.message);
      (window as any).importResult = undefined;
      void window.hcb!.workspace.confirmImport({ reviewId: review.data.reviewId, confirmation: 'REPLACE_WORKSPACE' }).then(result => { (window as any).importResult = result; });
    }));
    await promptly(createTask(page, 'Saved while replacement waits'));
    expect(await page.evaluate(() => (window as any).importResult)).toBeUndefined();
  } finally { f.state.hold = undefined; held.release(); }
  expect((await finishSync(page)).ok).toBe(true);
  await page.waitForFunction(() => (window as any).importResult);
  expect(await page.evaluate(() => (window as any).importResult)).toMatchObject({ ok: false, error: { message: expect.stringContaining('changed') } });
  expect([...f.tasks.values()]).toMatchObject([{ title: 'Saved while replacement waits' }]);
});
