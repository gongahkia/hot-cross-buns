import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBrowserNotifications } from './notifications';

const shown: FakeNotification[] = [];
class FakeNotification {
  static permission = 'granted';
  static requestPermission = vi.fn(async () => 'granted');
  onclick?: () => void;
  close = vi.fn();
  constructor(readonly title: string, readonly options: NotificationOptions) { shown.push(this); }
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2027-01-12T09:00:00Z'));
  shown.length = 0; FakeNotification.permission = 'granted'; FakeNotification.requestPermission.mockClear();
  vi.stubGlobal('Notification', FakeNotification); vi.stubGlobal('BroadcastChannel', undefined);
  vi.spyOn(window, 'focus').mockImplementation(() => undefined);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function snapshot(enabled = true) {
  return { settings: { notificationsEnabled: enabled, notificationLeadMinutes: 10 }, planning: {
    notificationTasks: [], events: [{ id: 'event-1', title: 'Planning session', startsAt: '2027-01-12T09:10:02Z', completedAt: null }],
  } };
}
describe('tab-lifetime browser notifications', () => {
  it('never asks for permission from background scheduling', async () => {
    FakeNotification.permission = 'default';
    const request = vi.fn();
    const notifications = createBrowserNotifications(request, vi.fn());
    expect((await notifications.refresh()).scheduledCount).toBe(0);
    expect(request).not.toHaveBeenCalled();
    expect(FakeNotification.requestPermission).not.toHaveBeenCalled();
  });
  it('schedules a granted reminder, routes its click, and suppresses repeated delivery in this session', async () => {
    const request = vi.fn(async () => ({ ok: true as const, data: snapshot() }));
    const emit = vi.fn(); const notifications = createBrowserNotifications(request, emit);
    expect((await notifications.refresh()).scheduledCount).toBe(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(shown).toHaveLength(1);
    expect(shown[0].options.body).toBe('Planning session');
    shown[0].onclick?.();
    expect(emit).toHaveBeenCalledWith({ type: 'openRoute', route: { kind: 'event', id: 'event-1' } });
    expect(shown[0].close).toHaveBeenCalled();
    await notifications.refresh(); await vi.advanceTimersByTimeAsync(2000);
    expect(shown).toHaveLength(1);
  });
  it('disabling reminders cancels queued timers', async () => {
    const request = vi.fn(async () => ({ ok: true as const, data: snapshot() }));
    const notifications = createBrowserNotifications(request, vi.fn());
    await notifications.refresh();
    request.mockResolvedValueOnce({ ok: true, data: snapshot(false) });
    expect((await notifications.refresh()).scheduledCount).toBe(0);
    await vi.advanceTimersByTimeAsync(5000);
    expect(shown).toHaveLength(0);
  });
  it('bounds scheduled reminders and reports a display failure instead of pretending delivery', async () => {
    class RefusingNotification extends FakeNotification { constructor() { super('', {}); throw new Error('Unsupported'); } }
    vi.stubGlobal('Notification', RefusingNotification);
    const data = snapshot(); data.planning.events = Array.from({ length: 100 }, (_, index) => ({ ...data.planning.events[0], id: `event-${index}` }));
    const notifications = createBrowserNotifications(vi.fn(async () => ({ ok: true as const, data })), vi.fn());
    expect((await notifications.refresh()).scheduledCount).toBe(40);
    await vi.advanceTimersByTimeAsync(2000);
    expect(notifications.status()).toMatchObject({ state: 'error', scheduledCount: 0 });
  });
});
