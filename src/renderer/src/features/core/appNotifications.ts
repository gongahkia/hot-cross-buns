import type { CoreViewModelSource } from "./coreViewModelSource";

export type AppNotificationTone = "info" | "success" | "warning" | "danger" | "offline";

export interface AppNotification {
  id: string;
  title: string;
  description: string;
  status: string;
  tone: AppNotificationTone;
}

export function getAppNotifications(source: CoreViewModelSource): AppNotification[] {
  const notifications: AppNotification[] = [];

  if (source.dataState === "loading") {
    notifications.push({
      id: "cache.loading",
      title: "Loading planner data",
      description: "Opening the synced planner workspace.",
      status: "Loading",
      tone: "info"
    });
  } else if (source.dataState === "error") {
    notifications.push({
      id: "cache.error",
      title: "Planner data unavailable",
      description: source.errorMessage ?? "The planner data request failed.",
      status: "Error",
      tone: "danger"
    });
  } else if (source.isOffline) {
    notifications.push({
      id: "cache.offline",
      title: "Offline",
      description: source.errorMessage ?? "Google sync is not connected.",
      status: "Offline",
      tone: "offline"
    });
  } else if (source.isStale || source.dataState === "stale") {
    notifications.push({
      id: "cache.stale",
      title: "Refreshing planner data",
      description: "Rendering current rows while a newer read is pending.",
      status: "Stale",
      tone: "info"
    });
  } else if (source.dataState === "empty") {
    notifications.push({
      id: "cache.empty",
      title: "No planner data",
      description: "No tasks, events, or notes are available yet.",
      status: "Empty",
      tone: "warning"
    });
  } else {
    notifications.push({
      id: "cache.ready",
      title: "Planner data ready",
      description: "Tasks, events, notes, and settings are loaded.",
      status: "Ready",
      tone: "success"
    });
  }

  if (source.settingsMutationError) {
    notifications.push({
      id: "settings.error",
      title: "Settings action not applied",
      description: source.settingsMutationError,
      status: "Settings",
      tone: "warning"
    });
  }

  if (source.taskMutationError) {
    notifications.push({
      id: "tasks.error",
      title: "Task action not applied",
      description: source.taskMutationError,
      status: "Tasks",
      tone: "warning"
    });
  }

  return notifications;
}
