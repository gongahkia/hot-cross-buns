import { nativeActionSchema } from "@shared/ipc/contracts";
import type {
  CalendarEventSummary,
  NativeAction,
  NativeCapabilityKey,
  NativeCapabilityReport,
  NativeCapabilitiesResponse,
  NativeFeatureState,
  NativeNotificationPermissionResponse,
  NativeRoute,
  TaskSummary,
  SettingsSnapshot
} from "@shared/ipc/contracts";
import { redactDiagnosticText } from "@shared/redaction";
import type { NativeDomainService } from "../services/domainInterfaces";
import {
  HCB_DEEP_LINK_SCHEME,
  type NativeMenuBarSnapshot,
  type NativeOperationResult,
  type NativePlannerSnapshotSource,
  type NativePlatformAdapter,
  type NativePlatformCapabilities,
  type NativeSettingsSource,
  type NativeShellSyncActions,
  type NativeShellWindowActions
} from "./types";

const notificationHorizonMs = 24 * 60 * 60 * 1000;
const defaultEventReminderMs = 10 * 60 * 1000;
const immediateNotificationDelayMs = 1_000;
const maxScheduledNotifications = 40;

export interface NativeShellServiceOptions {
  adapter: NativePlatformAdapter;
  planner: NativePlannerSnapshotSource;
  settings: NativeSettingsSource;
  windows: NativeShellWindowActions;
  sync: NativeShellSyncActions;
  now?: () => Date;
}

export class NativeShellService implements NativeDomainService {
  private readonly now: () => Date;
  private status: NativeCapabilitiesResponse;
  private currentShortcut: string | null = null;
  private deferredStarted = false;

  constructor(private readonly options: NativeShellServiceOptions) {
    this.now = options.now ?? (() => new Date());
    this.status = initialStatus(options.adapter.capabilities(), options.settings.get());
  }

  installAppMenu(): void {
    this.options.adapter.installAppMenu(this.actions());
  }

  startDeferredStartup(): void {
    if (this.deferredStarted) {
      return;
    }

    this.deferredStarted = true;
    this.status = {
      ...this.status,
      deferredStartup: {
        state: "running",
        startedAt: this.now().toISOString()
      }
    };

    setTimeout(() => {
      void this.runDeferredStartup();
    }, 0);
  }

  applySettings(snapshot: SettingsSnapshot): void {
    this.status = {
      ...this.status,
      mcpStatus: snapshot.mcpEnabled
        ? featureStatus("pending", "MCP listener startup is deferred until secure token storage is wired.")
        : featureStatus("disabled", "MCP local agent access is disabled.")
    };

    if (!snapshot.showTrayIcon) {
      this.options.adapter.destroyTray();
      this.status = {
        ...this.status,
        trayStatus: featureStatus("disabled", "Menu bar icon is disabled in Settings.")
      };
    } else if (this.deferredStarted && this.status.trayStatus.state === "disabled") {
      this.setupTray();
    } else if (this.deferredStarted && this.status.trayStatus.state === "ready") {
      this.setupTray();
    }

    if (!snapshot.notificationsEnabled) {
      this.options.adapter.clearScheduledNotifications();
      this.status = {
        ...this.status,
        notificationsStatus: {
          ...this.status.notificationsStatus,
          scheduledCount: 0,
          state: "disabled",
          message: "Local notifications are disabled in Settings."
        }
      };
    } else if (this.deferredStarted) {
      this.scheduleNotificationsFromCache();
    }

    if (this.deferredStarted) {
      this.applyAutostartSetting(snapshot.startOnLogin);
    }

    if (!this.deferredStarted) {
      this.status = {
        ...this.status,
        quickCaptureShortcut: {
          ...this.status.quickCaptureShortcut,
          accelerator: snapshot.quickCaptureShortcut,
          state: snapshot.quickCaptureShortcut ? "pending" : "disabled",
          registered: false,
          ...(snapshot.quickCaptureShortcut ? {} : { message: "Quick capture shortcut is not configured." })
        }
      };
      return;
    }

    this.registerQuickCaptureShortcut(snapshot.quickCaptureShortcut);
  }

  capabilities(): NativeCapabilitiesResponse {
    return structuredClone(this.status);
  }

  requestNotificationPermission(): NativeNotificationPermissionResponse {
    const permission = this.options.adapter.requestNotificationPermission();

    this.status = {
      ...this.status,
      notificationsStatus: {
        ...this.status.notificationsStatus,
        permission: permission.state,
        state: permission.state === "unsupported" ? "unsupported" : "ready",
        message:
          permission.state === "unsupported"
            ? "Local notifications are not supported by this platform adapter."
            : "Notification permission request was handed to the operating system."
      }
    };

    return permission;
  }

  handleDeepLink(rawUrl: string): boolean {
    const action = parseHotCrossBunsDeepLink(rawUrl);

    if (!action) {
      this.status = {
        ...this.status,
        deepLinkStatus: {
          ...this.status.deepLinkStatus,
          state: "error",
          message: "Ignored malformed hotcrossbuns deep link."
        }
      };
      return false;
    }

    this.options.windows.showMainWindow();
    this.options.windows.dispatchAction(action);
    this.status = {
      ...this.status,
      deepLinkStatus: {
        ...this.status.deepLinkStatus,
        state: this.status.deepLinkStatus.registered ? "ready" : this.status.deepLinkStatus.state,
        message: "Last deep link was routed to the renderer through preload."
      }
    };

    return true;
  }

  dispose(): void {
    this.options.adapter.dispose();
  }

  private async runDeferredStartup(): Promise<void> {
    try {
      this.setupTray();
      this.registerQuickCaptureShortcut(this.options.settings.get().quickCaptureShortcut);
      this.registerProtocolClient();
      this.scheduleNotificationsFromCache();
      await this.checkForUpdates();
      this.applyAutostartSetting(this.options.settings.get().startOnLogin);
      this.updateMcpDeferredStatus(this.options.settings.get());
      this.status = {
        ...this.status,
        deferredStartup: {
          ...this.status.deferredStartup,
          state: "complete",
          completedAt: this.now().toISOString()
        }
      };
    } catch (error) {
      this.status = {
        ...this.status,
        deferredStartup: {
          ...this.status.deferredStartup,
          state: "error",
          message: messageFromError(error, "Deferred native startup failed.")
        }
      };
    }
  }

  private actions() {
    return {
      primaryClick: () => this.handleTrayPrimaryAction(),
      openMainWindow: this.options.windows.showMainWindow,
      showOrHideMainWindow: this.options.windows.showOrHideMainWindow,
      quickCapture: () => {
        this.options.windows.showMainWindow();
        this.options.windows.dispatchAction({ type: "quickCapture" });
      },
      refresh: () => {
        this.options.windows.showMainWindow();
        this.options.windows.dispatchAction({ type: "refresh" });
        void this.options.sync.runNow({
          resources: ["tasks", "calendar"],
          full: false,
          dryRun: false
        });
      },
      openSettings: () => {
        this.options.windows.showMainWindow();
        this.options.windows.dispatchAction({ type: "openSettings" });
      },
      openRoute: (route: NativeRoute) => {
        this.options.windows.showMainWindow();
        this.options.windows.dispatchAction({ type: "openRoute", route });
      },
      snapshot: () => this.menuBarSnapshot(),
      quit: this.options.windows.quit
    };
  }

  private setupTray(): void {
    if (!this.status.tray) {
      this.status = {
        ...this.status,
        trayStatus: featureStatus("unsupported", "Tray/menu bar adapter is unavailable.")
      };
      return;
    }

    if (!this.options.settings.get().showTrayIcon) {
      this.status = {
        ...this.status,
        trayStatus: featureStatus("disabled", "Menu bar icon is disabled in Settings.")
      };
      return;
    }

    const result = this.options.adapter.createTray(this.actions());
    this.status = {
      ...this.status,
      trayStatus: statusFromResult(result, "ready", "Menu bar item is ready.")
    };
  }

  private registerQuickCaptureShortcut(accelerator: string | null): void {
    if (this.currentShortcut) {
      this.options.adapter.unregisterGlobalShortcut(this.currentShortcut);
      this.currentShortcut = null;
    }

    if (!accelerator) {
      this.status = {
        ...this.status,
        quickCaptureShortcut: {
          accelerator,
          registered: false,
          state: "disabled",
          message: "Quick capture shortcut is not configured."
        }
      };
      return;
    }

    if (!this.status.globalShortcuts) {
      this.status = {
        ...this.status,
        quickCaptureShortcut: {
          accelerator,
          registered: false,
          state: "unsupported",
          message: "Global shortcuts are not supported by this platform adapter."
        }
      };
      return;
    }

    const result = this.options.adapter.registerGlobalShortcut(accelerator, () => {
      this.options.windows.showMainWindow();
      this.options.windows.dispatchAction({ type: "quickCapture" });
    });

    if (result.ok) {
      this.currentShortcut = accelerator;
    }

    this.status = {
      ...this.status,
      quickCaptureShortcut: {
        accelerator,
        registered: result.ok,
        state: result.ok ? "ready" : result.state ?? "conflict",
        message: sanitizedNativeMessage(
          result.message ??
            (result.ok ? "Quick capture shortcut is registered." : "Shortcut registration failed.")
        )
      }
    };
  }

  private registerProtocolClient(): void {
    if (!this.status.deepLinks) {
      this.status = {
        ...this.status,
        deepLinkStatus: {
          scheme: HCB_DEEP_LINK_SCHEME,
          registered: false,
          state: "unsupported",
          message: "Deep links are not supported by this platform adapter."
        }
      };
      return;
    }

    const result = this.options.adapter.registerProtocolClient(HCB_DEEP_LINK_SCHEME);
    this.status = {
      ...this.status,
      deepLinkStatus: {
        scheme: HCB_DEEP_LINK_SCHEME,
        registered: result.ok,
        state: result.ok ? "ready" : result.state ?? "error",
        message: sanitizedNativeMessage(
          result.message ??
            (result.ok ? "Protocol handler is registered." : "Protocol handler registration failed.")
        )
      }
    };
  }

  private scheduleNotificationsFromCache(): void {
    if (!this.status.notifications) {
      this.status = {
        ...this.status,
        notificationsStatus: {
          permission: "unsupported",
          scheduledCount: 0,
          state: "unsupported",
          message: "Local notifications are not supported by this platform adapter."
        }
      };
      return;
    }

    const settings = this.options.settings.get();

    if (!settings.notificationsEnabled) {
      this.options.adapter.clearScheduledNotifications();
      this.status = {
        ...this.status,
        notificationsStatus: {
          ...this.status.notificationsStatus,
          scheduledCount: 0,
          state: "disabled",
          message: "Local notifications are disabled in Settings."
        }
      };
      return;
    }

    this.options.adapter.clearScheduledNotifications();

    const now = this.now();
    const horizon = new Date(now.getTime() + notificationHorizonMs);
    const requests = [
      ...this.taskNotificationRequests(now, horizon),
      ...this.eventNotificationRequests(now, horizon, settings.notificationLeadMinutes)
    ].slice(0, maxScheduledNotifications);
    let scheduledCount = 0;

    for (const request of requests) {
      const scheduled = this.options.adapter.scheduleNotification(request, () => {
        if (request.action) {
          this.options.windows.showMainWindow();
          this.options.windows.dispatchAction(request.action);
        }
      });

      if (scheduled) {
        scheduledCount += 1;
      }
    }

    this.status = {
      ...this.status,
      notificationsStatus: {
        ...this.status.notificationsStatus,
        scheduledCount,
        state: "ready",
        message:
          scheduledCount === 0
            ? "No due tasks or upcoming events are in the next 24 hours."
            : `${scheduledCount} local notification${scheduledCount === 1 ? "" : "s"} scheduled.`
      }
    };
  }

  private taskNotificationRequests(now: Date, horizon: Date) {
    try {
      return this.options.planner
        .listTasks({ status: "active", limit: 100 })
        .items.flatMap((task) => {
          if (!task.dueAt) {
            return [];
          }

          const dueAt = dateFromIso(task.dueAt);

          if (!dueAt || dueAt.getTime() > horizon.getTime()) {
            return [];
          }

          const deliveryDate =
            dueAt.getTime() <= now.getTime()
              ? new Date(now.getTime() + immediateNotificationDelayMs)
              : dueAt;

          return [
            {
              id: `task:${task.id}`,
              title: "Task due",
              body: task.title,
              deliveryDate,
              action: {
                type: "openRoute",
                route: {
                  kind: "task",
                  id: task.id
                }
              } satisfies NativeAction
            }
          ];
        });
    } catch {
      return [];
    }
  }

  private eventNotificationRequests(now: Date, horizon: Date, leadMinutes: number) {
    try {
      return this.options.planner
        .listCalendarEvents({
          start: now.toISOString(),
          end: horizon.toISOString(),
          limit: 100
        })
        .items.flatMap((event) => {
          const startsAt = dateFromIso(event.startsAt);

          if (!startsAt || startsAt.getTime() < now.getTime()) {
            return [];
          }

          const reminderMs =
            leadMinutes > 0 ? leadMinutes * 60_000 : defaultEventReminderMs;
          const reminderAt = new Date(startsAt.getTime() - reminderMs);
          const deliveryDate =
            reminderAt.getTime() <= now.getTime()
              ? new Date(now.getTime() + immediateNotificationDelayMs)
              : reminderAt;

          if (deliveryDate.getTime() > horizon.getTime()) {
            return [];
          }

          return [
            {
              id: `event:${event.id}`,
              title: "Upcoming event",
              body: event.title,
              deliveryDate,
              action: {
                type: "openRoute",
                route: {
                  kind: "event",
                  id: event.id
                }
              } satisfies NativeAction
            }
          ];
        });
    } catch {
      return [];
    }
  }

  private menuBarSnapshot(): NativeMenuBarSnapshot {
    const settings = this.options.settings.get();
    const now = this.now();
    const todayStart = startOfLocalDay(now);
    const tomorrowStart = addDays(todayStart, 1);
    const dayAfterTomorrowStart = addDays(todayStart, 2);
    const tasks = activeTasks(this.options.planner);
    const events = calendarEvents(
      this.options.planner,
      todayStart,
      dayAfterTomorrowStart
    );
    const overdueTasks = tasks
      .filter((task) => taskDueBefore(task, todayStart))
      .sort(compareTasksByDueDate);
    const todayTasks = tasks
      .filter((task) => taskDueBetween(task, todayStart, tomorrowStart))
      .sort(compareTasksByDueDate);
    const tomorrowTasks = tasks
      .filter((task) => taskDueBetween(task, tomorrowStart, dayAfterTomorrowStart))
      .sort(compareTasksByDueDate);
    const todayEvents = events
      .filter((event) => eventStartsBetween(event, todayStart, tomorrowStart))
      .sort(compareEventsByStart);
    const tomorrowEvents = events
      .filter((event) => eventStartsBetween(event, tomorrowStart, dayAfterTomorrowStart))
      .sort(compareEventsByStart);
    const currentEvent = todayEvents.find((event) => {
      const startsAt = dateFromIso(event.startsAt);
      const endsAt = dateFromIso(event.endsAt);

      return Boolean(startsAt && endsAt && startsAt <= now && endsAt > now);
    });
    const nextEvent = todayEvents.find((event) => {
      const startsAt = dateFromIso(event.startsAt);

      return Boolean(startsAt && startsAt > now);
    });
    const sections = menuBarSections(settings.menuBarPanelStyle, {
      overdueTasks,
      todayTasks,
      tomorrowTasks,
      todayEvents,
      tomorrowEvents
    });
    const todayCount = todayTasks.length + todayEvents.length;
    const title = menuBarTitle(overdueTasks.length, todayCount, currentEvent, nextEvent);
    const subtitle = menuBarSubtitle(overdueTasks.length, todayCount, tomorrowTasks.length + tomorrowEvents.length);
    const adaptiveLabel =
      settings.menuBarPanelStyle === "adaptive"
        ? adaptiveTrayLabel(overdueTasks.length, todayCount, currentEvent, nextEvent)
        : "";

    return {
      panelStyle: settings.menuBarPanelStyle,
      primaryClickAction: settings.trayClickAction,
      title,
      subtitle,
      badgeLabel:
        settings.showMenuBarBadge && overdueTasks.length > 0
          ? cappedBadgeLabel(overdueTasks.length)
          : adaptiveLabel,
      tooltip: subtitle ? `${title} - ${subtitle}` : title,
      sections
    };
  }

  private checkForUpdates(): void | Promise<void> {
    const result = this.options.adapter.checkForUpdates();

    if (isPromise(result)) {
      return result.then((resolved) => {
        this.applyUpdateStatus(resolved);
      });
    }

    this.applyUpdateStatus(result);
  }

  private applyUpdateStatus(result: NativeOperationResult): void {
    this.status = {
      ...this.status,
      updaterStatus: statusFromResult(
        result,
        "ready",
        "Preview update check completed without blocking startup."
      )
    };
  }

  private handleTrayPrimaryAction(): void {
    const action = this.options.settings.get().trayClickAction;

    if (action === "quick-capture") {
      this.options.windows.showMainWindow();
      this.options.windows.dispatchAction({ type: "quickCapture" });
      return;
    }

    if (action === "open-today") {
      this.options.windows.showMainWindow();
      this.options.windows.dispatchAction({ type: "openRoute", route: { kind: "today" } });
      return;
    }

    if (action === "open-menu") {
      return;
    }

    this.options.windows.showOrHideMainWindow();
  }

  private updateMcpDeferredStatus(settings: SettingsSnapshot): void {
    this.status = {
      ...this.status,
      mcpStatus: settings.mcpEnabled
        ? featureStatus("pending", "MCP listener startup remains deferred until secure token storage is wired.")
        : featureStatus("disabled", "MCP local agent access is disabled.")
    };
  }

  private applyAutostartSetting(enabled: boolean): void {
    const result = this.options.adapter.setAutostart(enabled);

    this.status = {
      ...this.status,
      capabilityReport: updateCapabilityReportStatus(
        this.status.capabilityReport,
        "autostart",
        result,
        enabled ? "Open-at-login is enabled." : "Open-at-login is disabled."
      )
    };
  }
}

interface MenuBarSnapshotData {
  overdueTasks: TaskSummary[];
  todayTasks: TaskSummary[];
  tomorrowTasks: TaskSummary[];
  todayEvents: CalendarEventSummary[];
  tomorrowEvents: CalendarEventSummary[];
}

function activeTasks(planner: NativePlannerSnapshotSource): TaskSummary[] {
  try {
    return planner.listTasks({ status: "active", limit: 100 }).items;
  } catch {
    return [];
  }
}

function calendarEvents(
  planner: NativePlannerSnapshotSource,
  start: Date,
  end: Date
): CalendarEventSummary[] {
  try {
    return planner.listCalendarEvents({
      start: start.toISOString(),
      end: end.toISOString(),
      limit: 100
    }).items;
  } catch {
    return [];
  }
}

function menuBarSections(
  style: SettingsSnapshot["menuBarPanelStyle"],
  data: MenuBarSnapshotData
): NativeMenuBarSnapshot["sections"] {
  if (style === "compact") {
    return [
      {
        title: "Overview",
        items: [
          {
            label: `${data.overdueTasks.length} overdue`,
            detail: `${data.todayTasks.length + data.todayEvents.length} due or scheduled today`
          },
          { label: "Open Today", route: { kind: "today" } },
          { label: "Open Tasks", route: { kind: "tasks" } },
          { label: "Open Calendar", route: { kind: "calendar" } }
        ]
      }
    ];
  }

  const sections: NativeMenuBarSnapshot["sections"] = [];

  if (style === "adaptive" && data.overdueTasks.length > 0) {
    sections.push({
      title: "Needs Attention",
      items: menuBarTaskItems(data.overdueTasks, "Overdue")
    });
  }

  sections.push({
    title: "Today",
    items: [
      ...menuBarEventItems(data.todayEvents),
      ...menuBarTaskItems(data.todayTasks, "Due today")
    ].slice(0, 8)
  });

  sections.push({
    title: "Tomorrow",
    items: [
      ...menuBarEventItems(data.tomorrowEvents),
      ...menuBarTaskItems(data.tomorrowTasks, "Due tomorrow")
    ].slice(0, 8)
  });

  return sections.map((section) =>
    section.items.length > 0
      ? section
      : {
          ...section,
          items: [{ label: "Nothing scheduled", detail: section.title?.toLowerCase() }]
        }
  );
}

function menuBarTaskItems(tasks: TaskSummary[], fallbackDetail: string) {
  return tasks.slice(0, 5).map((task) => ({
    label: truncateMenuLabel(task.title),
    detail: task.dueAt ? dueDetail(task.dueAt, fallbackDetail) : fallbackDetail,
    route: { kind: "task", id: task.id } as const
  }));
}

function menuBarEventItems(events: CalendarEventSummary[]) {
  return events.slice(0, 5).map((event) => ({
    label: truncateMenuLabel(event.title),
    detail: eventDetail(event),
    route: { kind: "event", id: event.id } as const
  }));
}

function menuBarTitle(
  overdueCount: number,
  todayCount: number,
  currentEvent: CalendarEventSummary | undefined,
  nextEvent: CalendarEventSummary | undefined
): string {
  if (overdueCount > 0) {
    return `${overdueCount} overdue`;
  }

  if (currentEvent) {
    return `Now: ${truncateMenuLabel(currentEvent.title, 36)}`;
  }

  if (nextEvent) {
    return `Next: ${truncateMenuLabel(nextEvent.title, 36)}`;
  }

  if (todayCount > 0) {
    return `${todayCount} today`;
  }

  return "Hot Cross Buns 2";
}

function menuBarSubtitle(
  overdueCount: number,
  todayCount: number,
  tomorrowCount: number
): string {
  const parts = [
    overdueCount > 0 ? `${overdueCount} overdue` : "",
    todayCount > 0 ? `${todayCount} today` : "Nothing today",
    tomorrowCount > 0 ? `${tomorrowCount} tomorrow` : ""
  ].filter(Boolean);

  return parts.join(", ");
}

function adaptiveTrayLabel(
  overdueCount: number,
  todayCount: number,
  currentEvent: CalendarEventSummary | undefined,
  nextEvent: CalendarEventSummary | undefined
): string {
  if (overdueCount > 0) {
    return cappedBadgeLabel(overdueCount);
  }

  if (currentEvent) {
    return "Now";
  }

  if (nextEvent) {
    const startsAt = dateFromIso(nextEvent.startsAt);

    return startsAt ? formatShortTime(startsAt) : "Next";
  }

  return todayCount > 0 ? String(todayCount) : "";
}

function cappedBadgeLabel(count: number): string {
  return count > 99 ? "99+" : String(count);
}

function startOfLocalDay(date: Date): Date {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  return start;
}

function addDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function taskDueBefore(task: TaskSummary, date: Date): boolean {
  const dueAt = task.dueAt ? dateFromIso(task.dueAt) : null;

  return Boolean(dueAt && dueAt < date);
}

function taskDueBetween(task: TaskSummary, start: Date, end: Date): boolean {
  const dueAt = task.dueAt ? dateFromIso(task.dueAt) : null;

  return Boolean(dueAt && dueAt >= start && dueAt < end);
}

function eventStartsBetween(event: CalendarEventSummary, start: Date, end: Date): boolean {
  const startsAt = dateFromIso(event.startsAt);

  return Boolean(startsAt && startsAt >= start && startsAt < end);
}

function compareTasksByDueDate(left: TaskSummary, right: TaskSummary): number {
  return isoTime(left.dueAt) - isoTime(right.dueAt) || left.title.localeCompare(right.title);
}

function compareEventsByStart(left: CalendarEventSummary, right: CalendarEventSummary): number {
  return isoTime(left.startsAt) - isoTime(right.startsAt) || left.title.localeCompare(right.title);
}

function isoTime(value: string | null | undefined): number {
  return value ? dateFromIso(value)?.getTime() ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER;
}

function dueDetail(value: string, fallback: string): string {
  const dueAt = dateFromIso(value);

  if (!dueAt) {
    return fallback;
  }

  return isLocalMidnight(dueAt) ? fallback : `${fallback} ${formatShortTime(dueAt)}`;
}

function eventDetail(event: CalendarEventSummary): string {
  if (event.allDay) {
    return "All day";
  }

  const startsAt = dateFromIso(event.startsAt);
  const endsAt = dateFromIso(event.endsAt);

  if (!startsAt || !endsAt) {
    return "Scheduled";
  }

  return `${formatShortTime(startsAt)}-${formatShortTime(endsAt)}`;
}

function formatShortTime(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function isLocalMidnight(date: Date): boolean {
  return date.getHours() === 0 && date.getMinutes() === 0 && date.getSeconds() === 0;
}

function truncateMenuLabel(value: string, maxLength = 54): string {
  const trimmed = value.trim();

  if (trimmed.length <= maxLength) {
    return trimmed || "Untitled";
  }

  return `${trimmed.slice(0, maxLength - 1)}...`;
}

export function parseHotCrossBunsDeepLink(rawUrl: string): NativeAction | null {
  let parsed: URL;

  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }

  if (parsed.protocol !== `${HCB_DEEP_LINK_SCHEME}:`) {
    return null;
  }

  const host = parsed.hostname.toLowerCase();
  const decodedId = safeDecodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
  const id = decodedId?.trim() ?? null;
  const query = parsed.searchParams.get("q")?.trim();

  if (id === null) {
    return null;
  }

  if (host === "today" || host === "") {
    return safeNativeAction({ type: "openRoute", route: { kind: "today" } });
  }

  if (host === "settings") {
    return safeNativeAction({ type: "openSettings" });
  }

  if (host === "search") {
    return query ? safeNativeAction({ type: "openRoute", route: { kind: "search", query } }) : null;
  }

  if (host === "task" || host === "tasks") {
    return id
      ? safeNativeAction({ type: "openRoute", route: { kind: "task", id } })
      : safeNativeAction({ type: "openRoute", route: { kind: "tasks" } });
  }

  if (host === "event" || host === "calendar") {
    return id
      ? safeNativeAction({ type: "openRoute", route: { kind: "event", id } })
      : safeNativeAction({ type: "openRoute", route: { kind: "calendar" } });
  }

  if (host === "note" || host === "notes") {
    return id
      ? safeNativeAction({ type: "openRoute", route: { kind: "note", id } })
      : safeNativeAction({ type: "openRoute", route: { kind: "notes" } });
  }

  return null;
}

function safeNativeAction(action: NativeAction): NativeAction | null {
  const parsed = nativeActionSchema.safeParse(action);

  return parsed.success ? parsed.data : null;
}

function safeDecodeURIComponent(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function initialStatus(
  capabilities: NativePlatformCapabilities,
  settings: SettingsSnapshot
): NativeCapabilitiesResponse {
  return {
    platform: capabilities.platform,
    notifications: capabilities.notifications,
    globalShortcuts: capabilities.globalShortcuts,
    tray: capabilities.tray,
    deepLinks: capabilities.deepLinks,
    trayStatus: capabilities.tray
      ? settings.showTrayIcon
        ? featureStatus("pending", "Tray startup is deferred until the shell is visible.")
        : featureStatus("disabled", "Menu bar icon is disabled in Settings.")
      : featureStatus("unsupported", "Tray/menu bar adapter is unavailable."),
    quickCaptureShortcut: {
      accelerator: settings.quickCaptureShortcut,
      registered: false,
      state: capabilities.globalShortcuts
        ? settings.quickCaptureShortcut
          ? "pending"
          : "disabled"
        : "unsupported",
      message: capabilities.globalShortcuts
        ? "Quick capture shortcut registration is deferred until the shell is visible."
        : "Global shortcuts are not supported by this platform adapter."
    },
    notificationsStatus: {
      permission: capabilities.notifications ? "prompt" : "unsupported",
      scheduledCount: 0,
      state: capabilities.notifications
        ? settings.notificationsEnabled
          ? "pending"
          : "disabled"
        : "unsupported",
      message: capabilities.notifications
        ? settings.notificationsEnabled
          ? "Notification scheduling is deferred until the shell is visible."
          : "Local notifications are disabled in Settings."
        : "Local notifications are not supported by this platform adapter."
    },
    deepLinkStatus: {
      scheme: HCB_DEEP_LINK_SCHEME,
      registered: false,
      state: capabilities.deepLinks ? "pending" : "unsupported",
      message: capabilities.deepLinks
        ? "Protocol registration is deferred until the shell is visible."
        : "Deep links are not supported by this platform adapter."
    },
    updaterStatus: capabilities.updaterChecks
      ? featureStatus("pending", "Update checks are deferred until the shell is visible.")
      : featureStatus("unsupported", "Preview update checks are not configured for this build."),
    mcpStatus: settings.mcpEnabled
      ? featureStatus("pending", "MCP listener startup is deferred until the shell is visible.")
      : featureStatus("disabled", "MCP local agent access is disabled."),
    capabilityReport: capabilities.capabilityReport,
    deferredStartup: {
      state: "pending"
    }
  };
}

function featureStatus(state: NativeFeatureState, message: string) {
  return {
    state,
    message
  };
}

function statusFromResult(
  result: NativeOperationResult,
  successState: NativeFeatureState,
  successMessage: string
) {
  return {
    state: result.ok ? successState : result.state ?? "error",
    message: sanitizedNativeMessage(
      result.message ?? (result.ok ? successMessage : "Native adapter operation failed.")
    )
  };
}

function updateCapabilityReportStatus(
  report: NativeCapabilityReport,
  key: NativeCapabilityKey,
  result: NativeOperationResult,
  successMessage: string
): NativeCapabilityReport {
  return {
    ...report,
    capabilities: report.capabilities.map((capability) =>
      capability.key === key
        ? {
            ...capability,
            supported: capability.supported || result.ok,
            state: result.ok ? "ready" : result.state ?? "error",
            message: sanitizedNativeMessage(
              result.message ?? (result.ok ? successMessage : "Native adapter operation failed.")
            )
          }
        : capability
    )
  };
}

function dateFromIso(value: string): Date | null {
  const date = new Date(value);

  return Number.isFinite(date.getTime()) ? date : null;
}

function messageFromError(error: unknown, fallback: string): string {
  return sanitizedNativeMessage(
    error instanceof Error && error.message.trim() ? error.message : fallback
  );
}

function sanitizedNativeMessage(message: string): string {
  return redactDiagnosticText(message).slice(0, 500);
}

function isPromise<T>(value: T | Promise<T>): value is Promise<T> {
  return typeof (value as Promise<T>).then === "function";
}
