import { createHash } from 'node:crypto';
import type { Plugin } from 'vite';

/** Cache only immutable build artifacts. Workspace data remains exclusively in IndexedDB. */
export function offlineShell(): Plugin {
  let enabled = false;
  let base = './';
  return {
    name: 'hcb-offline-app-shell',
    enforce: 'post',
    apply: 'build',
    configResolved(config) { enabled = config.mode === 'production'; base = config.base; },
    transformIndexHtml() {
      if (!enabled) return;
      return [{ tag: 'script', attrs: { type: 'module', src: `${base}offline-register.js` }, injectTo: 'body' }];
    },
    generateBundle: {
      order: 'post',
      handler(_options, bundle) {
        if (!enabled) return;
        const registration = `
const status = (state, message) => {
  window.hcbOffline = { state, ...(message ? { message } : {}) };
  window.dispatchEvent(new CustomEvent('hcb:offline-status', { detail: window.hcbOffline }));
};
if ('serviceWorker' in navigator && window.isSecureContext) {
  status('preparing');
  navigator.serviceWorker.register(new URL('./service-worker.js', import.meta.url), { type: 'classic', updateViaCache: 'none' })
    .then(async registration => {
      const watch = worker => worker?.addEventListener('statechange', () => {
        if (worker.state === 'activated') status('ready');
        if (worker.state === 'installed' && navigator.serviceWorker.controller) status('update-ready', 'Close all planner tabs to use the downloaded update.');
        if (worker.state === 'redundant' && !registration.active) status('unavailable', 'Offline files could not be downloaded. Keep this tab online and reopen it to retry.');
      });
      watch(registration.installing);
      watch(registration.waiting);
      if (registration.waiting) status('update-ready', 'Close all planner tabs to use the downloaded update.');
      navigator.serviceWorker.addEventListener('controllerchange', () => status('ready'));
      registration.addEventListener('updatefound', () => watch(registration.installing));
      await navigator.serviceWorker.ready;
      if (!registration.waiting) status('ready');
    })
    .catch(() => status('unavailable', 'Offline files could not be downloaded. Keep this tab online and reopen it to retry.'));
} else status('unavailable', 'Offline startup requires HTTPS and service worker support.');
`;
        this.emitFile({ type: 'asset', fileName: 'offline-register.js', source: registration });
        const names = [...new Set([...Object.keys(bundle).filter(name => !name.endsWith('.map')), 'offline-register.js'])].sort();
        const hash = createHash('sha256');
        for (const name of names) {
          const file = bundle[name];
          hash.update(name).update(file ? (file.type === 'chunk' ? file.code : file.source) : registration);
        }
        const revision = hash.digest('hex').slice(0, 20);
        const source = `/* Hot Cross Buns offline shell ${revision}. No workspace data is stored here. */
const CACHE_PREFIX = 'hcb-app-shell-';
const CACHE_NAME = CACHE_PREFIX + '${revision}';
const ASSETS = ${JSON.stringify(names)};
const assetUrls = new Set(ASSETS.map(path => new URL(path, self.registration.scope).href));
const shellUrl = new URL('index.html', self.registration.scope).href;
self.addEventListener('install', event => event.waitUntil((async () => {
  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll([...assetUrls].map(url => new Request(url, { cache: 'reload', credentials: 'same-origin' })));
  } catch (error) {
    await caches.delete(CACHE_NAME);
    throw error;
  }
})()));
// Deliberately no skipWaiting: a new bundle never replaces an active editor's dependencies.
self.addEventListener('activate', event => event.waitUntil((async () => {
  await Promise.all((await caches.keys()).filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map(key => caches.delete(key)));
  await self.clients.claim();
})()));
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  // API/OAuth routes and all third-party traffic are never cached.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) return;
  const navigation = request.mode === 'navigate';
  if (!navigation && !assetUrls.has(url.href)) return;
  event.respondWith((async () => {
    const cached = await (await caches.open(CACHE_NAME)).match(navigation ? shellUrl : request);
    return cached || fetch(request);
  })());
});
self.addEventListener('message', event => {
  if (event.data?.type === 'HCB_OFFLINE_STATUS') event.ports[0]?.postMessage({ cacheName: CACHE_NAME, assets: ASSETS });
});
`;
        this.emitFile({ type: 'asset', fileName: 'service-worker.js', source });
      }
    }
  };
}
