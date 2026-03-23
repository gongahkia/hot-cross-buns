import { writable } from 'svelte/store';

export interface Notification {
  id: string;
  taskId: string;
  listId: string;
  title: string;
  message: string;
  read: boolean;
  createdAt: string;
}

const MAX_NOTIFICATIONS = 50;

export const notifications = writable<Notification[]>([]);

/**
 * Add a notification, keeping the list bounded to MAX_NOTIFICATIONS.
 * Most recent notifications appear first.
 */
export function addNotification(n: Omit<Notification, 'id' | 'read' | 'createdAt'>): void {
  notifications.update((current) => {
    const entry: Notification = {
      ...n,
      id: crypto.randomUUID(),
      read: false,
      createdAt: new Date().toISOString(),
    };
    const next = [entry, ...current];
    if (next.length > MAX_NOTIFICATIONS) {
      next.length = MAX_NOTIFICATIONS;
    }
    return next;
  });
}

/**
 * Mark a single notification as read.
 */
export function markRead(notificationId: string): void {
  notifications.update((current) =>
    current.map((n) => (n.id === notificationId ? { ...n, read: true } : n))
  );
}

/**
 * Mark every notification as read.
 */
export function markAllRead(): void {
  notifications.update((current) => current.map((n) => ({ ...n, read: true })));
}

/**
 * Remove a single notification.
 */
export function removeNotification(notificationId: string): void {
  notifications.update((current) => current.filter((n) => n.id !== notificationId));
}
