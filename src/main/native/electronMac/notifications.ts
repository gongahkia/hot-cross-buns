import { Notification } from "electron";
import type {
  NativeNotificationRequest,
  ScheduledNativeNotification
} from "../types";

const maxNotificationDelayMs = 2_147_483_647;

export class NotificationScheduler {
  private readonly notificationTimers = new Map<string, NodeJS.Timeout>();

  schedule(
    request: NativeNotificationRequest,
    onClick: () => void
  ): ScheduledNativeNotification | undefined {
    if (process.platform !== "darwin" || !Notification.isSupported()) {
      return undefined;
    }

    const delayMs = Math.max(0, request.deliveryDate.getTime() - Date.now());

    if (delayMs > maxNotificationDelayMs) {
      return undefined;
    }

    const timer = setTimeout(() => {
      this.notificationTimers.delete(request.id);
      const notification = new Notification({
        title: request.title,
        body: request.body
      });
      notification.on("click", onClick);
      notification.show();
    }, delayMs);

    timer.unref?.();
    this.notificationTimers.set(request.id, timer);

    return {
      id: request.id,
      cancel: () => {
        clearTimeout(timer);
        this.notificationTimers.delete(request.id);
      }
    };
  }

  clear(): void {
    for (const timer of this.notificationTimers.values()) {
      clearTimeout(timer);
    }

    this.notificationTimers.clear();
  }
}
