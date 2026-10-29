import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

// Real production service worker, HTTP requests, Cache Storage, IndexedDB and offline Chromium.
const root = resolve('dist');
const originalWorker = await readFile(resolve(root, 'service-worker.js'), 'utf8');
let variant = 'original';
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname === '/missing-offline-asset.js') { response.writeHead(503); response.end('Injected asset download failure'); return; }
    const file = resolve(root, '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)));
    if (!file.startsWith(root + sep)) { response.writeHead(403); response.end(); return; }
    let body = await readFile(file);
    if (url.pathname === '/service-worker.js' && variant !== 'original') {
      let source = originalWorker.replace(/CACHE_PREFIX \+ '([^']+)'/, `CACHE_PREFIX + '$1-${variant}'`);
      if (variant === 'broken') source = source.replace(/const ASSETS = (\[[^\n]*\]);/, (_, value) => `const ASSETS = ${JSON.stringify([...JSON.parse(value), 'missing-offline-asset.js'])};`);
      body = Buffer.from(source);
    }
    response.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    response.end(body);
  } catch { response.writeHead(404); response.end('Not found'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const results = [];
const deadline = setTimeout(() => { console.error('Offline validation exceeded three minutes'); process.exit(1); }, 180_000);
const record = value => { results.push(value); console.log(JSON.stringify(value)); };

const invoke = (page, namespace, action, payload = {}) => page.evaluate(async ({namespace, action, payload}) => {
  const result = await window.hcb[namespace][action](payload);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}, {namespace, action, payload});
async function controlled(page) {
  try { await page.waitForFunction(() => window.hcbOffline?.state === 'ready' && navigator.serviceWorker.controller, undefined, {timeout: 15_000}); }
  catch (error) {
    console.error(await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); return {offline: window.hcbOffline, active: r?.active?.state, waiting: r?.waiting?.state, installing: r?.installing?.state, controlled: Boolean(navigator.serviceWorker.controller), caches: await caches.keys()}; }));
    throw error;
  }
}
async function workerStatus(page) {
  return page.evaluate(() => new Promise(resolve => {
    const channel = new MessageChannel();
    channel.port1.onmessage = event => { channel.port1.close(); resolve(event.data); };
    navigator.serviceWorker.controller.postMessage({ type: 'HCB_OFFLINE_STATUS' }, [channel.port2]);
  }));
}
try {
  const context = await browser.newContext();
  let page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin);
  await controlled(page);
  console.log('Initial offline shell ready');
  assert.equal(await page.evaluate(() => typeof window.hcb.__testing), 'undefined');
  await invoke(page, 'settings', 'update', { onboardingStatus: 'completed', syncMode: 'manual' });
  const task = await invoke(page, 'tasks', 'create', {listId: 'inbox', title: 'Offline task sentinel'});
  const note = await invoke(page, 'notes', 'create', {title: 'Offline note sentinel', body: 'Cinnamon offline full text'});
  const event = await invoke(page, 'calendar', 'create', {calendarId: 'primary', title: 'Offline event sentinel', startsAt: '2030-01-02T09:00:00Z', endsAt: '2030-01-02T10:00:00Z'});
  const original = await workerStatus(page);
  await page.evaluate(async () => { const unrelated = await caches.open('another-app-cache'); await unrelated.put('/unrelated-marker', new Response('keep')); });
  assert.ok(original.assets.some(name => /workspace\.worker-.*\.js$/.test(name)), 'Worker must be precached');
  assert.ok(original.assets.some(name => name.endsWith('.wasm')), 'SQLite WASM must be precached');
  assert.ok(original.assets.includes('index.html'), 'HTML shell must be precached');
  const inventory = await page.evaluate(async cacheName => {
    const cache = await caches.open(cacheName);
    return (await cache.keys()).map(request => request.url);
  }, original.cacheName);
  assert.equal(inventory.length, original.assets.length, 'All app shell dependencies must download before ready');

  // Reopen a completely new tab offline, not just a page whose imports are still in memory.
  await context.setOffline(true);
  await page.close();
  page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin);
  await page.getByTestId('app-shell').waitFor();
  assert.equal((await invoke(page, 'tasks', 'get', {id: task.id})).title, task.title);
  await invoke(page, 'tasks', 'update', {id: task.id, title: 'Edited while fully offline'});
  await invoke(page, 'notes', 'update', {id: note.id, body: 'Kumquat edited offline'});
  await invoke(page, 'calendar', 'update', {id: event.id, title: 'Offline event edited'});
  // A legacy local-only workspace must not bypass the account requirement offline.
  // Linked-account offline UI is covered by tests/browser/account-required.spec.ts.
  await page.getByRole('dialog', {name: 'Hot Cross Buns', exact: true}).waitFor();
  assert.equal(await page.getByTestId('app-shell').getAttribute('inert'), '');
  await page.reload();
  assert.equal((await invoke(page, 'tasks', 'get', {id: task.id})).title, 'Edited while fully offline');
  assert.equal((await invoke(page, 'calendar', 'get', {id: event.id})).title, 'Offline event edited');
  assert.ok((await invoke(page, 'search', 'query', {query: 'kumquat'})).items.some(item => item.id === note.id));
  record({case: 'production offline cold tab, required account gate, durable task/note/event edits and FTS reopen', passed: true, cachedAssets: inventory.length});

  // Failed update installation must not delete the previous usable app or workspace.
  await context.setOffline(false);
  variant = 'broken';
  const state = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    const settled = new Promise(resolve => registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      worker.addEventListener('statechange', () => { if (['installed', 'redundant'].includes(worker.state)) resolve(worker.state); });
    }, {once: true}));
    await registration.update();
    return settled;
  });
  assert.equal(state, 'redundant');
  assert.equal((await workerStatus(page)).cacheName, original.cacheName);
  assert.ok(!(await page.evaluate(() => caches.keys())).some(name => name.endsWith('-broken')));
  await context.setOffline(true);
  await page.reload();
  assert.equal((await invoke(page, 'tasks', 'get', {id: task.id})).title, 'Edited while fully offline');
  record({case: 'failed update preserves active shell and durable workspace', passed: true});

  await context.setOffline(false);
  variant = 'updated';
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    await registration.update();
  });
  await page.waitForFunction(async () => Boolean((await navigator.serviceWorker.getRegistration()).waiting));
  assert.equal((await workerStatus(page)).cacheName, original.cacheName, 'No update may replace an active editor');
  // Observe activation without opening a replacement client that would keep
  // the old worker alive. Closing all tabs is the update boundary.
  const workers = await Promise.all(context.serviceWorkers().map(async worker => ({worker, name: await worker.evaluate(() => CACHE_NAME).catch(() => '')})));
  const updatingWorker = workers.find(entry => entry.name.endsWith('-updated'))?.worker;
  assert.ok(updatingWorker, 'Installed update worker must exist');
  await updatingWorker.evaluate(() => {
    self.__activationObserved = new Promise(resolve => self.addEventListener('activate', () => resolve(), {once: true}));
  });
  await page.close();
  await updatingWorker.evaluate(() => self.__activationObserved);
  page = await context.newPage();
  await page.goto(origin);
  await controlled(page);
  assert.ok((await workerStatus(page)).cacheName.endsWith('-updated'));
  assert.deepEqual((await page.evaluate(() => caches.keys())).sort(), ['another-app-cache', (await workerStatus(page)).cacheName].sort());
  assert.equal(await page.evaluate(async () => (await (await caches.open('another-app-cache')).match('/unrelated-marker')).text()), 'keep');
  assert.equal((await invoke(page, 'tasks', 'get', {id: task.id})).title, 'Edited while fully offline');
  assert.deepEqual(errors, []);
  record({case: 'update waits for clients to close, then replaces only owned app cache', passed: true});
  await context.close();

  // Failure on a first-ever installation must be explicit, and retry must work.
  variant = 'broken';
  const fresh = await browser.newContext();
  const first = await fresh.newPage();
  await first.goto(origin);
  await first.waitForFunction(() => window.hcbOffline?.state === 'unavailable');
  const saved = await invoke(first, 'notes', 'create', {title: 'Keep first-install note', body: 'Saved despite missing offline assets'});
  variant = 'original';
  await first.reload();
  await controlled(first);
  await fresh.setOffline(true);
  await first.reload();
  assert.equal((await invoke(first, 'notes', 'get', {id: saved.id})).title, saved.title);
  await fresh.close();
  record({case: 'failed first install reports unavailable and retry preserves workspace', passed: true});
  await mkdir('output', {recursive: true});
  const report = {browser: browser.version(), timestamp: new Date().toISOString(), results};
  await writeFile('output/offline-validation.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally {
  clearTimeout(deadline);
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
