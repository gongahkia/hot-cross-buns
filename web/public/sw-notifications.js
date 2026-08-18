/* The self-hosted backend sends only a title, optional time, and an in-app path. */
self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }
  const href = typeof payload.href === "string" && payload.href.startsWith("/") ? payload.href : "/";
  const title = typeof payload.title === "string" && payload.title ? payload.title : "Upcoming calendar item";
  const options = {
    body: typeof payload.body === "string" ? payload.body : "",
    data: { href },
    tag: typeof payload.tag === "string" ? payload.tag : undefined,
    renotify: false
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const href = typeof event.notification.data?.href === "string" && event.notification.data.href.startsWith("/")
    ? event.notification.data.href
    : "/";
  event.waitUntil((async () => {
    const target = new URL(href, self.location.origin).href;
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = windows.find((client) => "focus" in client);
    if (existing) {
      await existing.navigate(target);
      return existing.focus();
    }
    return self.clients.openWindow(target);
  })());
});
