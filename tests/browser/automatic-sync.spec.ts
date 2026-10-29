import { expect, test, type BrowserContext, type Page } from '@playwright/test';

async function mockGoogle(context: BrowserContext) {
  const state = { pulls: 0, writes: 0, fail: false, tasks: [{ id: 'remote-task', title: 'Initial Google task', status: 'needsAction', etag: 'v1' }] };
  await context.addInitScript(() => {
    (window as any).google = { accounts: { oauth2: { initTokenClient: (config: any) => ({
      requestAccessToken: () => queueMicrotask(() => config.callback({ access_token: 'private-sync-test-token', expires_in: 3600, scope: config.scope }))
    }) } } };
  });
  await context.route('https://openidconnect.googleapis.com/v1/userinfo', route => route.fulfill({ json: { sub: 'automatic-sync-subject', email: 'sync@example.test' } }));
  await context.route(/https:\/\/(tasks|www)\.googleapis\.com\//, async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/users/@me/lists')) {
      state.pulls++;
      return state.fail ? route.fulfill({ status: 503, body: '' }) : route.fulfill({ json: { items: [{ id: 'remote-list', title: 'Synced list' }] } });
    }
    if (url.pathname.endsWith('/tasks')) {
      if (route.request().method() === 'POST') {
        state.writes++;
        const task = { ...route.request().postDataJSON(), id: `created-${state.writes}`, etag: `created-v${state.writes}` };
        state.tasks.push(task);
        return route.fulfill({ json: task });
      }
      return route.fulfill({ json: { items: state.tasks } });
    }
    return route.fulfill({ json: { items: [], nextSyncToken: 'calendar-token' } });
  });
  return state;
}

async function connect(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.hcb?.__testing));
  await page.evaluate(async () => {
    await window.hcb!.settings.update({ onboardingStatus: 'completed', syncMode: 'balanced', syncCalendarEventsEnabled: false, diagnosticsIncludePerformance: true });
    await window.hcb!.__testing.configureGoogleAuth('test-web.apps.googleusercontent.com');
    const result = await window.hcb!.google.beginOAuth();
    if (!result.ok) throw new Error(result.error.message);
  });
  await expect.poll(() => page.evaluate(async () => {
    const result = await window.hcb!.sync.status();
    return result.ok && result.data.state === 'idle' && Boolean(result.data.lastCompletedAt);
  })).toBe(true);
}

async function makeCatchUpDue(page: Page) {
  // Advance only the durable scheduler fixture; do not fake worker/network timers.
  await page.evaluate(async () => {
    const result = await window.hcb!.__testing.seedDatabase({ statements: [{
      sql: "UPDATE sync_meta SET value=json_set(value,'$.attemptedAt',0,'$.finishedAt',0,'$.failures',0,'$.retryAfter',0) WHERE key LIKE 'google-operation:%:browser-sync-schedule-v1'"
    }] });
    if (!result.ok) throw new Error(result.error.message);
  });
}

async function returnToApp(page: Page) {
  await page.evaluate(() => {
    // Two visible windows are possible even when the automation browser uses tabs.
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('pageshow'));
  });
}

async function hasTask(page: Page, title: string) {
  return page.evaluate(async title => {
    const result = await window.hcb!.tasks.list({ limit: 100 });
    return result.ok && result.data.items.some((task: any) => task.title === title);
  }, title);
}

test('foreground return fetches remote changes once across event bursts and authorized tabs', async ({ page, context }) => {
  const google = await mockGoogle(context);
  await connect(page);
  const other = await context.newPage(); await connect(other);
  const before = google.pulls;
  google.tasks.push({ id: 'phone-task', title: 'Added on the phone', status: 'needsAction', etag: 'phone-v1' });
  await makeCatchUpDue(page);
  await Promise.all([returnToApp(page), returnToApp(other)]);
  await expect.poll(() => hasTask(page, 'Added on the phone')).toBe(true);
  await expect.poll(() => hasTask(other, 'Added on the phone')).toBe(true);
  await page.waitForTimeout(700); // Both lifecycle debounce windows must finish.
  expect(google.pulls - before).toBe(1);
  const timings = await page.evaluate(async () => {
    const result = await window.hcb!.diagnostics.summary();
    return result.ok ? (result.data as any).performance.timings : [];
  });
  expect(timings.map((sample: any) => sample.name)).toEqual(expect.arrayContaining(['workspace.queue.wait', 'workspace.lock.wait', 'google.pull.tasks', 'google.http.read', 'workspace.snapshot.persist']));
  expect(JSON.stringify(timings)).not.toMatch(/private-sync-test-token|Added on the phone|sync@example.test/);

  await page.close();
  google.tasks.push({ id: 'takeover-task', title: 'Arrived after first tab closed', status: 'needsAction', etag: 'takeover-v1' });
  await makeCatchUpDue(other); await returnToApp(other);
  await expect.poll(() => hasTask(other, 'Arrived after first tab closed')).toBe(true);
});

test('an authorized background tab delivers an edit made in a tab without a session', async ({ page, context }) => {
  const google = await mockGoogle(context); await connect(page);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const other = await context.newPage(); await other.goto('/');
  await other.waitForFunction(() => Boolean(window.hcb?.__testing));
  await other.evaluate(async () => {
    const lists = await window.hcb!.tasks.listTaskLists();
    if (!lists.ok) throw new Error(lists.error.message);
    const list = lists.data.items.find((list: any) => list.title === 'Synced list');
    if (!list) throw new Error('Missing shared Google list');
    const result = await window.hcb!.tasks.create({ listId: list.id, title: 'Queued without a token' });
    if (!result.ok) throw new Error(result.error.message);
  });
  await expect.poll(() => google.writes).toBe(1);
  expect(google.tasks.some(task => task.title === 'Queued without a token')).toBe(true);
  await expect.poll(() => other.evaluate(async () => {
    const result = await window.hcb!.sync.status(); return result.ok && result.data.pendingMutationCount;
  })).toBe(0);
});

test('manual mode ignores lifecycle triggers while explicit refresh still works', async ({ page, context }) => {
  const google = await mockGoogle(context); await connect(page);
  await page.evaluate(() => window.hcb!.settings.update({ syncMode: 'manual' }));
  await makeCatchUpDue(page);
  const before = google.pulls;
  google.tasks.push({ id: 'manual-task', title: 'Waiting for explicit refresh', status: 'needsAction', etag: 'manual-v1' });
  await returnToApp(page);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.waitForTimeout(700);
  expect(google.pulls).toBe(before);
  expect(await hasTask(page, 'Waiting for explicit refresh')).toBe(false);
  await page.evaluate(() => window.hcb!.sync.runNow({}));
  await expect.poll(() => hasTask(page, 'Waiting for explicit refresh')).toBe(true);
});

test('failed foreground pulls enter a cooldown that explicit refresh can clear', async ({ page, context }) => {
  const google = await mockGoogle(context); await connect(page);
  await makeCatchUpDue(page); google.fail = true;
  const before = google.pulls;
  await returnToApp(page);
  await expect.poll(() => google.pulls).toBe(before + 1);
  await expect.poll(() => page.evaluate(async () => {
    const result = await window.hcb!.sync.status(); return result.ok && result.data.state;
  })).toBe('error');
  await returnToApp(page); await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.waitForTimeout(700);
  expect(google.pulls).toBe(before + 1);
  google.fail = false;
  await page.evaluate(() => window.hcb!.sync.runNow({}));
  await expect.poll(() => page.evaluate(async () => {
    const result = await window.hcb!.sync.status(); return result.ok && result.data.state;
  })).toBe('idle');
  expect(google.pulls).toBe(before + 2);
});
