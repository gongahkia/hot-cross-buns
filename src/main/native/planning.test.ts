import { describe, expect, it, vi } from "vitest";
import { buildNativeMenuBarSnapshot } from "./menuBarSnapshot";
import { buildNativeNotificationRequests } from "./notificationScheduling";
import { createNoopNativeAdapter } from "./noopAdapter";
import { NativeShellService } from "./service";
import type { NativeNotificationRequest, NativePlannerSnapshotSource, ScheduledNativeNotification } from "./types";

const now = new Date("2026-10-18T10:00:00Z");
function planner(): NativePlannerSnapshotSource {
  return { listTasks: () => ({ items: [] }), listCalendarEvents: () => ({ items: [] }) };
}
const settings = { notificationsEnabled: true, notificationLeadMinutes: 10, showTrayIcon: false, menuBarPanelStyle: "calendar", showMenuBarBadge: true, showDockBadge: true, menuBarCalendarDoneMode: "tasksOnly", pinnedSavedSearchViewIds: [], savedSearchViews: [], keybindings: {} } as any;

describe("native planning summaries", () => {
  it("uses complete counts instead of inferring them from preview rows", () => {
    const source = planner();
    const start = new Date(now); start.setHours(0, 0, 0, 0);
    source.planningCounts = () => ({ dayStart: start.toISOString(), overdueTasks: 750, todayTasks: 310, tomorrowTasks: 100, todayEvents: 1200, tomorrowEvents: 400, todayEventsComplete: true });
    const result = buildNativeMenuBarSnapshot({ planner: source, settings, account: null, now });
    expect(result.badgeLabel).toBe("99+");
    expect(result.calendarDone).toBe(false);
    expect(result.calendar?.selectedMeta).toBe("1200 events - 310 tasks");
  });

  it("treats a Google task due date as a local calendar day", () => {
    const source = planner();
    source.listTasks = () => ({ items: [{ id: "today", listId: "inbox", title: "Today", dueAt: "2026-10-18T00:00:00Z" }] });
    const result = buildNativeMenuBarSnapshot({ planner: source, settings, account: null, now: new Date(2026, 9, 18, 12) });
    expect(result.badgeLabel).toBeUndefined();
    expect(result.calendar?.selectedMeta).toBe("0 events - 1 task");
  });

  it("keeps upcoming event reminders in the bounded queue beside overdue tasks", () => {
    const source = planner();
    source.listTasks = () => ({ items: Array.from({ length: 100 }, (_, index) => ({ id: `task-${index}`, listId: "inbox", title: "Overdue", dueAt: "2026-10-01T00:00:00Z" })) });
    source.listCalendarEvents = () => ({ items: [{ id: "upcoming", title: "Meeting", startsAt: "2026-10-18T10:05:00Z" }, { id: "done", title: "Finished", startsAt: "2026-10-18T10:04:00Z", completedAt: "2026-10-18T10:00:00Z" }] });
    const requests = buildNativeNotificationRequests({ planner: source, now, leadMinutes: 10 });
    expect(requests).toHaveLength(40);
    expect(requests[0].id).toContain("event:upcoming:");
    expect(requests.some((request) => request.id.startsWith("event:done:"))).toBe(false);
    const next = buildNativeNotificationRequests({ planner: source, now, leadMinutes: 10, excludeIds: new Set(requests.map((request) => request.id)) });
    expect(next).toHaveLength(40);
    expect(next.some((request) => requests.some((previous) => previous.id === request.id))).toBe(false);
  });

  it("honors zero Calendar lead time as a reminder at the event start", () => {
    const source = planner();
    source.listCalendarEvents = () => ({ items: [{ id: "at-start", title: "Meeting", startsAt: "2026-10-18T11:00:00Z" }] });
    const requests = buildNativeNotificationRequests({ planner: source, now, leadMinutes: 0 });
    expect(requests[0].deliveryDate.toISOString()).toBe("2026-10-18T11:00:00.000Z");
  });

  it("leaves native resources alone when only workspace preferences change", () => {
    const adapter = createNoopNativeAdapter();
    adapter.destroyTray = vi.fn(); adapter.clearScheduledNotifications = vi.fn(); adapter.setAutostart = vi.fn();
    const service = new NativeShellService({ adapter, planner: planner(), settings: { get: () => settings }, now: () => now, windows: {} as never, sync: {} as never });
    service.applySettings(settings);
    service.applySettings({ ...settings, paneWorkspace: { focusedPaneId: "other-pane" } });
    expect(adapter.destroyTray).toHaveBeenCalledOnce();
    expect(adapter.clearScheduledNotifications).not.toHaveBeenCalled();
    expect(adapter.setAutostart).not.toHaveBeenCalled();
  });

  it("retains unchanged schedules and cancels only removed reminders", () => {
    const adapter = createNoopNativeAdapter();
    const capabilities = adapter.capabilities();
    adapter.capabilities = () => ({ ...capabilities, notifications: true });
    const handles: ScheduledNativeNotification[] = [];
    adapter.scheduleNotification = vi.fn((request: NativeNotificationRequest) => {
      const handle: ScheduledNativeNotification = { id: request.id, state: "pending", cancel: vi.fn() };
      handles.push(handle); return handle;
    });
    adapter.clearScheduledNotifications = vi.fn();
    const source = planner();
    let items = [{ id: "task-one", listId: "inbox", title: "Task", dueAt: "2026-10-18T10:30:00Z" }];
    source.listTasks = () => ({ items });
    const service = new NativeShellService({ adapter, planner: source, settings: { get: () => settings }, now: () => now, windows: {} as never, sync: {} as never });
    service.rescheduleNotificationsForDiagnostics();
    service.rescheduleNotificationsForDiagnostics();
    expect(adapter.scheduleNotification).toHaveBeenCalledOnce();
    expect(adapter.clearScheduledNotifications).not.toHaveBeenCalled();
    handles[0].state = "delivered";
    expect(service.rescheduleNotificationsForDiagnostics().scheduledCount).toBe(0);
    items = [];
    service.rescheduleNotificationsForDiagnostics();
    expect(handles[0].cancel).not.toHaveBeenCalled();
  });
});
