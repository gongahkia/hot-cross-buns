/* Static PWA helper: notification data contains only an in-app HTTPS path. */
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
