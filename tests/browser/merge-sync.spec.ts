import { expect, test, type BrowserContext, type Page, type Route } from '@playwright/test';

type Kind = 'task' | 'event';
function gate() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}
async function invoke(page: Page, namespace: string, action: string, payload: any = {}) {
  const result = await page.evaluate(({ namespace, action, payload }) => (window.hcb as any)[namespace][action](payload), { namespace, action, payload });
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}
async function connect(page: Page, kind: Kind) {
  await page.goto('/'); await page.waitForFunction(() => window.hcb?.__testing);
  await invoke(page, 'settings', 'update', { onboardingStatus: 'completed', syncMode: 'manual', syncTasksEnabled: kind === 'task', syncCalendarEventsEnabled: kind === 'event' });
  await page.evaluate(() => window.hcb!.__testing.configureGoogleAuth('test-web.apps.googleusercontent.com'));
  await invoke(page, 'google', 'beginOAuth');
  await invoke(page, 'sync', 'runNow');
}
async function fixture(context: BrowserContext, kind: Kind) {
  await context.addInitScript(() => {
    (window as any).google = { accounts: { oauth2: { initTokenClient: (config: any) => ({
      requestAccessToken: () => queueMicrotask(() => config.callback({ access_token: 'merge-test-token', expires_in: 3600, scope: config.scope }))
    }) } } };
  });
  await context.route('https://openidconnect.googleapis.com/v1/userinfo', route => route.fulfill({ json: { sub: 'merge-subject', email: 'merge@example.test' } }));
  const item: any = kind === 'task' ? { id: 'item', title: 'Original', notes: 'Original notes', status: 'needsAction', position: '001', etag: 'v1' }
    : { id: 'item', summary: 'Original', description: 'Original notes', start: { dateTime: '2026-10-29T09:00:00Z' }, end: { dateTime: '2026-10-29T10:00:00Z' }, etag: 'v1' };
  let revision = 1;
  const state = { writes: [] as Array<{ body: any; etag: string | undefined; accepted: boolean }>,
    before: undefined as undefined | ((route: Route) => Promise<void>), after: undefined as undefined | ((route: Route) => Promise<void>) };
  await context.route(/https:\/\/(tasks|www)\.googleapis\.com\//, async route => {
    const request = route.request(), url = new URL(request.url()), method = request.method();
    if (method === 'GET') {
      if (url.pathname.endsWith('/lists')) return route.fulfill({ json: { items: [{ id: 'list', title: 'Tasks', etag: 'list-v1' }] } });
      if (url.pathname.endsWith('/calendarList')) return route.fulfill({ json: { items: [{ id: 'calendar', summary: 'Calendar', accessRole: 'owner' }] } });
      if (url.pathname.endsWith('/tasks') || url.pathname.endsWith('/events')) return route.fulfill({ json: { items: [item], nextSyncToken: 'token' } });
      return route.fulfill({ json: item });
    }
    if (method !== 'PATCH') throw new Error(`Unexpected ${method} ${url}`);
    await state.before?.(route);
    const write = { body: request.postDataJSON(), etag: request.headers()['if-match'], accepted: request.headers()['if-match'] === item.etag };
    state.writes.push(write);
    if (!write.accepted) return route.fulfill({ status: 412 });
    for (const [field, value] of Object.entries(write.body)) { if (value === null) delete item[field]; else item[field] = value; }
    item.etag = `v${++revision}`;
    // Capture the actual response before allowing a concurrent phone change.
    const response = JSON.stringify(item);
    await state.after?.(route);
    return route.fulfill({ contentType: 'application/json', body: response }).catch(() => {});
  });
  return { item, state, namespace: kind === 'task' ? 'tasks' : 'calendar', titleField: kind === 'task' ? 'title' : 'summary', notesField: kind === 'task' ? 'notes' : 'description' };
}
async function itemId(page: Page, kind: Kind) {
  const pageData = await invoke(page, kind === 'task' ? 'tasks' : 'calendar', kind === 'task' ? 'list' : 'listEvents');
  return pageData.items.find((item: any) => item.title === 'Original').id as string;
}
async function startSync(page: Page) {
  await page.evaluate(() => { (window as any).mergeSyncResult = undefined; void window.hcb!.sync.runNow({}).then(result => { (window as any).mergeSyncResult = result; }); });
}
async function finishSync(page: Page) {
  await page.waitForFunction(() => (window as any).mergeSyncResult);
  expect(await page.evaluate(() => (window as any).mergeSyncResult)).toMatchObject({ ok: true });
}

for (const kind of ['task', 'event'] as const) {
  test(`${kind}: merges phone content, batches queued titles, and keeps field-scoped undo after reload`, async ({ page, context }) => {
    const f = await fixture(context, kind); await connect(page, kind); const id = await itemId(page, kind);
    await invoke(page, f.namespace, 'update', { id, title: 'First title' });
    await invoke(page, f.namespace, 'update', { id, title: 'Latest title' });
    Object.assign(f.item, { [f.notesField]: 'Phone notes', etag: 'phone' });
    await invoke(page, 'sync', 'runNow');
    expect(f.state.writes).toEqual([{ body: { [f.titleField]: 'Latest title' }, etag: 'phone', accepted: true }]);
    await connect(page, kind);
    await invoke(page, 'undo', 'undo');
    expect(await invoke(page, f.namespace, 'get', { id })).toMatchObject({ title: 'First title', [f.notesField]: 'Phone notes' });
    await invoke(page, 'sync', 'runNow');
    expect(f.item).toMatchObject({ [f.titleField]: 'First title', [f.notesField]: 'Phone notes' });
    expect((await invoke(page, 'diagnostics', 'pendingMutations')).mutations).toEqual([]);
  });

  test(`${kind}: closing the HTTP owner preserves another tab's undo and a later phone edit`, async ({ page, context }) => {
    const f = await fixture(context, kind); await connect(page, kind); const id = await itemId(page, kind);
    const other = await context.newPage(); await connect(other, kind);
    await invoke(page, f.namespace, 'update', { id, title: 'Submitted' });
    const entered = gate(), release = gate();
    f.state.after = async () => { entered.release(); await release.promise; };
    await startSync(page); await entered.promise;
    try {
      await invoke(other, 'undo', 'undo');
      expect(await invoke(other, f.namespace, 'get', { id })).toMatchObject({ title: 'Original' });
      Object.assign(f.item, { [f.notesField]: 'Phone after acceptance', etag: 'phone-after' });
      await page.close();
    } finally { f.state.after = undefined; release.release(); }
    await invoke(other, 'sync', 'runNow');
    expect(f.item).toMatchObject({ [f.titleField]: 'Original', [f.notesField]: 'Phone after acceptance' });
    expect(f.state.writes.map(write => write.body)).toEqual([{ [f.titleField]: 'Submitted' }, { [f.titleField]: 'Original' }]);
    await connect(other, kind);
    expect(await invoke(other, f.namespace, 'get', { id })).toMatchObject({ title: 'Original', [f.notesField]: 'Phone after acceptance' });
    expect((await invoke(other, 'diagnostics', 'pendingMutations')).mutations).toEqual([]);
  });

  test(`${kind}: a 412 merges independent phone changes and sends a later local command separately`, async ({ page, context }) => {
    const f = await fixture(context, kind); await connect(page, kind); const id = await itemId(page, kind);
    const other = await context.newPage(); await connect(other, kind);
    await invoke(page, f.namespace, 'update', { id, title: 'Submitted' });
    const entered = gate(), release = gate();
    let first = true;
    f.state.before = async () => {
      if (!first) return; first = false;
      Object.assign(f.item, { [f.notesField]: 'Racing phone notes', etag: 'racing-phone' });
      entered.release(); await release.promise;
    };
    await startSync(page); await entered.promise;
    try { await invoke(other, f.namespace, 'update', { id, title: 'Later local title' }); }
    finally { release.release(); }
    await finishSync(page);
    await invoke(other, 'sync', 'runNow');
    expect(f.state.writes.map(write => [write.body, write.accepted])).toEqual([
      [{ [f.titleField]: 'Submitted' }, false], [{ [f.titleField]: 'Submitted' }, true], [{ [f.titleField]: 'Later local title' }, true]
    ]);
    expect(f.item).toMatchObject({ [f.titleField]: 'Later local title', [f.notesField]: 'Racing phone notes' });
    expect((await invoke(other, 'diagnostics', 'pendingMutations')).mutations).toEqual([]);
  });

  test(`${kind}: overlap survives reload, blocks quick retry and rejects a stale review`, async ({ page, context }) => {
    const f = await fixture(context, kind); await connect(page, kind); const id = await itemId(page, kind);
    await invoke(page, f.namespace, 'update', { id, title: 'Local title' });
    Object.assign(f.item, { [f.titleField]: 'Phone title', etag: 'phone' });
    await invoke(page, 'sync', 'runNow');
    await connect(page, kind);
    expect(f.state.writes).toEqual([]);
    expect(await invoke(page, f.namespace, 'get', { id })).toMatchObject({ title: 'Local title' });
    const pending = (await invoke(page, 'diagnostics', 'pendingMutations')).mutations[0];
    expect(pending.status).toBe('failed');
    expect(await page.evaluate(id => window.hcb!.diagnostics.retryPendingMutation({ id }), pending.id)).toMatchObject({ ok: false });
    const review = await invoke(page, 'diagnostics', 'previewMutationResolution', { id: pending.id });
    await invoke(page, f.namespace, 'update', { id, title: 'Newer reviewed title' });
    expect(await page.evaluate(input => window.hcb!.diagnostics.resolveMutation(input), { id: pending.id, reviewId: review.reviewId, strategy: 'local' as const })).toMatchObject({ ok: false });
    const fresh = await invoke(page, 'diagnostics', 'previewMutationResolution', { id: pending.id });
    await invoke(page, 'diagnostics', 'resolveMutation', { id: pending.id, reviewId: fresh.reviewId, strategy: 'local' });
    await invoke(page, 'sync', 'runNow');
    expect(f.item[f.titleField]).toBe('Newer reviewed title');
    expect(f.state.writes).toEqual([{ body: { [f.titleField]: 'Newer reviewed title' }, etag: 'phone', accepted: true }]);
  });
}
