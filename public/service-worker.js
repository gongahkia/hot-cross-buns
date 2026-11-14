// retire the previous planner's cached shell without touching saved workspaces.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil((async () => {
  await self.clients.claim();
  const names = await caches.keys();
  await Promise.all(names.filter(name => name.startsWith('hcb-app-shell-')).map(name => caches.delete(name)));
  await self.registration.unregister();
})()));
