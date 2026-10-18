import type { NativeAction } from "@shared/ipc/contracts";
import type { NativeNotificationRequest, NativePlannerSnapshotSource } from "./types";

const notificationHorizonMs = 24 * 60 * 60 * 1000;
const defaultEventReminderMs = 10 * 60 * 1000;
const immediateNotificationDelayMs = 1_000;
const maxScheduledNotifications = 40;

interface BuildNativeNotificationRequestsOptions {
  planner: NativePlannerSnapshotSource;
  now: Date;
  leadMinutes: number;
  excludeIds?: ReadonlySet<string>;
}

export function buildNativeNotificationRequests(
  options: BuildNativeNotificationRequestsOptions
): NativeNotificationRequest[] {
  const horizon = new Date(options.now.getTime() + notificationHorizonMs);

  return [
    ...eventNotificationRequests(options.planner, options.now, horizon, options.leadMinutes),
    ...taskNotificationRequests(options.planner, options.now, horizon)
  ].filter((request) => !options.excludeIds?.has(request.id)).sort((left, right) => left.deliveryDate.getTime() - right.deliveryDate.getTime()).slice(0, maxScheduledNotifications);
}

function taskNotificationRequests(
  planner: NativePlannerSnapshotSource,
  now: Date,
  horizon: Date
): NativeNotificationRequest[] {
  try {
    return planner
      .listTasks({ status: "active", limit: 400, scope: "notifications" })
      .items.flatMap((task) => {
        if (!task.dueAt) {
          return [];
        }

        const dueAt = new Date(`${task.dueAt.slice(0, 10)}T00:00:00`);

        if (!dueAt || dueAt.getTime() > horizon.getTime()) {
          return [];
        }

        const deliveryDate =
          dueAt.getTime() <= now.getTime()
            ? new Date(now.getTime() + immediateNotificationDelayMs)
            : dueAt;

        return [
          {
            id: `task:${task.id}:${task.dueAt}`,
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

function eventNotificationRequests(
  planner: NativePlannerSnapshotSource,
  now: Date,
  horizon: Date,
  leadMinutes: number
): NativeNotificationRequest[] {
  try {
    return planner
      .listCalendarEvents({
        scope: "notifications",
        start: now.toISOString(),
        end: horizon.toISOString(),
        limit: 100
      })
      .items.flatMap((event) => {
        const startsAt = dateFromIso(event.startsAt);

        if (event.completedAt || !startsAt || startsAt.getTime() < now.getTime()) {
          return [];
        }

        const reminderMs = Number.isFinite(leadMinutes) && leadMinutes >= 0 ? leadMinutes * 60_000 : defaultEventReminderMs;
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
            id: `event:${event.id}:${event.startsAt}`,
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

function dateFromIso(value: string): Date | null {
  const date = new Date(value);

  return Number.isFinite(date.getTime()) ? date : null;
}
