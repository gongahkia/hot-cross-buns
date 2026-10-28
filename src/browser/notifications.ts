import type { HcbResult } from '@shared/result';

/** Foreground application reminders, never a promise of closed-tab delivery. */
export function createBrowserNotifications(request: (namespace: string, action: string, payload?: Record<string, unknown>) => Promise<HcbResult<any>>, emit: (action: unknown) => void) {
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const delivered = new Set<string>();
  let generation = 0;
  let lastError: string | undefined;
  const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('hcb-browser-reminders') : undefined;
  channel?.addEventListener('message', ({ data }) => { if (typeof data === 'string') remember(data); });
  function remember(id: string) {
    delivered.add(id);
    while (delivered.size > 500) delivered.delete(delivered.values().next().value!);
  }
  function status() {
    const permission = typeof Notification === 'function' ? Notification.permission : 'unsupported';
    return { permission, state: lastError ? 'error' : permission === 'granted' ? 'ready' : 'unsupported', scheduledCount: timers.size,
      message: lastError ?? 'Reminders run while this tab is open. Browser suspension may delay delivery; closing the application stops reminders.' };
  }
  async function requestPermission() {
    if (typeof Notification !== 'function') return status();
    await Notification.requestPermission();
    return status();
  }
  async function refresh() {
    const current = ++generation;
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    if (typeof Notification !== 'function' || Notification.permission !== 'granted') return status();
    const result = await request('diagnostics', 'reminderSnapshot');
    if (!result.ok || current !== generation || !result.data.settings.notificationsEnabled) return status();
    const now = Date.now();
    const { planning, settings } = result.data;
    const reminders: Array<{ id: string; title: string; body: string; at: number; kind: string; itemId: string }> = [
      ...planning.notificationTasks.filter((task: any) => task.dueAt && task.status === 'active').map((task: any) => ({
        id: `task:${task.id}:${task.dueAt}`, title: 'Task due', body: task.title, at: new Date(`${task.dueAt.slice(0, 10)}T00:00:00`).getTime(), kind: 'task', itemId: task.id,
      })),
      ...planning.events.filter((event: any) => !event.completedAt && Date.parse(event.startsAt) >= now).map((event: any) => ({
        id: `event:${event.id}:${event.startsAt}`, title: 'Upcoming event', body: event.title,
        at: Date.parse(event.startsAt) - Math.max(0, settings.notificationLeadMinutes) * 60_000, kind: 'event', itemId: event.id,
      })),
    ];
    for (const reminder of reminders.filter(item => Number.isFinite(item.at) && item.at <= now + 86400_000 && !delivered.has(item.id)).sort((a, b) => a.at - b.at).slice(0, 40)) {
      const timer = setTimeout(() => {
        timers.delete(timer);
        if (delivered.has(reminder.id)) return;
        try {
          const notification = new Notification(reminder.title, { body: reminder.body, tag: reminder.id });
          notification.onclick = () => { window.focus(); emit({ type: 'openRoute', route: { kind: reminder.kind, id: reminder.itemId } }); notification.close(); };
          remember(reminder.id); channel?.postMessage(reminder.id); lastError = undefined;
        } catch { lastError = 'This browser cannot display tab reminders. Check notification permission or use Calendar in the application.'; }
      }, Math.max(1000, reminder.at - now));
      timers.add(timer);
    }
    return status();
  }
  return { status, requestPermission, refresh };
}
