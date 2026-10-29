import { expect, test, type BrowserContext, type Page } from '@playwright/test';

async function mockGoogle(context: BrowserContext) {
  const state = { pulls: 0, writes: 0, fail: false, tasks: [{ id: 'remote-task', title: 'Initial Google task', status: 'needsAction', etag: 'v1' }] };
  await context.addInitScript(() => {
    (window as any).google = { accounts: { oauth2: { initTokenClient: (config: any) => ({
      requestAccessToken: () => queueMicrotask(() => config.callback({ access_token: 'private-sync-test-token', expires_in: (window as any).__googleTokenLifetime ?? 3600, scope: config.scope }))
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
  const previousCompletion = await page.evaluate(async () => {
    await window.hcb!.settings.update({ onboardingStatus: 'completed', syncMode: 'balanced', syncCalendarEventsEnabled: false, diagnosticsIncludePerformance: true });
    await window.hcb!.__testing.configureGoogleAuth('test-web.apps.googleusercontent.com');
    const status = await window.hcb!.sync.status();
    if (!status.ok) throw new Error(status.error.message);
    const result = await window.hcb!.google.beginOAuth();
    if (!result.ok) throw new Error(result.error.message);
    return status.data.lastCompletedAt;
  });
  // beginOAuth attaches the session before its asynchronous connection pull.
  // Another tab's prior idle status must not count as that pull completing.
  await expect.poll(() => page.evaluate(async previous => {
    const result = await window.hcb!.sync.status();
    return result.ok && result.data.state === 'idle' && Boolean(result.data.lastCompletedAt) && result.data.lastCompletedAt !== previous;
  }, previousCompletion)).toBe(true);
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

async function createTask(page: Page, title: string) {
  await page.evaluate(async title => {
    const lists = await window.hcb!.tasks.listTaskLists();
    if (!lists.ok) throw new Error(lists.error.message);
    const list = lists.data.items.find((list: any) => list.title === 'Synced list');
    if (!list) throw new Error('Missing shared Google list');
    const result = await window.hcb!.tasks.create({ listId: list.id, title });
    if (!result.ok) throw new Error(result.error.message);
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
  // The operation lock lets either authorized tab lead the pull. Timings are
  // worker-local, so inspect both workers rather than assuming the first wins.
  const timings = (await Promise.all([page, other].map(tab => tab.evaluate(async () => {
    const result = await window.hcb!.diagnostics.summary();
    return result.ok ? (result.data as any).performance.timings : [];
  })))).flat();
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
  await createTask(other, 'Queued without a token');
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

test('expiry in one tab preserves another valid session and explicit disconnect fences both', async ({ page, context }) => {
  const google = await mockGoogle(context);
  await page.addInitScript(() => { (window as any).__googleTokenLifetime = 20; });
  await connect(page);
  const other = await context.newPage(); await connect(other);
  // Wait for the actual window expiry callback to remove the worker credential,
  // not just the ten-second pre-expiry guard in its status projection.
  await expect.poll(() => page.evaluate(async () => {
    const result = await window.hcb!.google.status();
    return result.ok && result.data.accounts[0].sessionExpiresAt;
  }), { timeout: 25_000 }).toBeNull();
  expect(await page.evaluate(async () => {
    const result = await window.hcb!.google.status(); return result.ok && result.data.accounts[0].connectionState;
  })).toBe('reauth_required');
  expect(await other.evaluate(async () => {
    const result = await window.hcb!.google.status(); return result.ok && result.data.accounts[0].connectionState;
  })).toBe('connected');
  await createTask(other, 'Still authorized after other tab expired');
  await expect.poll(() => google.writes).toBe(1);
  await other.evaluate(async () => {
    const status = await window.hcb!.google.status();
    if (!status.ok) throw new Error(status.error.message);
    await window.hcb!.google.disconnect({ accountId: status.data.accounts[0].accountId });
  });
  await expect.poll(() => page.evaluate(async () => {
    const result = await window.hcb!.google.status(); return result.ok && result.data.accounts[0].connectionState;
  })).toBe('disconnected');
});

test('offline local changes flush on reconnection without waiting for the interval', async ({ page, context }) => {
  const google = await mockGoogle(context); await connect(page);
  await context.setOffline(true);
  await createTask(page, 'Saved while offline');
  await page.waitForTimeout(700);
  expect(google.writes).toBe(0);
  expect(await hasTask(page, 'Saved while offline')).toBe(true);
  await context.setOffline(false);
  await expect.poll(() => google.writes).toBe(1);
  expect(google.tasks.some(task => task.title === 'Saved while offline')).toBe(true);
});

test('more than one hundred ready writes drain in bounded batches without another user action', async ({ page, context }) => {
  const google = await mockGoogle(context); await connect(page);
  await page.evaluate(async () => {
    await window.hcb!.settings.update({ syncMode: 'manual' });
    const lists = await window.hcb!.tasks.listTaskLists();
    if (!lists.ok) throw new Error(lists.error.message);
    const list = lists.data.items.find((list: any) => list.title === 'Synced list')!;
    for (let index = 0; index < 105; index++) {
      const result = await window.hcb!.tasks.create({ listId: list.id, title: `Queued task ${index}` });
      if (!result.ok) throw new Error(result.error.message);
    }
    await window.hcb!.settings.update({ syncMode: 'balanced' });
  });
  await expect.poll(() => google.writes, { timeout: 25_000 }).toBe(105);
  await expect.poll(() => page.evaluate(async () => {
    const result = await window.hcb!.sync.status(); return result.ok && result.data.pendingMutationCount;
  })).toBe(0);
  expect(new Set(google.tasks.map(task => task.id)).size).toBe(106);
});
