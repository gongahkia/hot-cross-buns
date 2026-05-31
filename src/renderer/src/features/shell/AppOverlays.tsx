import type { RefObject } from "react";
import type { SyncStatusResponse } from "@shared/ipc/contracts";
import { Bell, RefreshCw, Settings2, X } from "lucide-react";
import { Badge, Button, IconButton } from "../../components/primitives";
import { SettingsView } from "../core/CoreScreens";
import type { AppNotification, AppNotificationTone } from "../core/appNotifications";

function notificationBadgeTone(tone: AppNotificationTone): "neutral" | "success" | "warning" | "danger" | "info" {
  if (tone === "success") {
    return "success";
  }

  if (tone === "danger") {
    return "danger";
  }

  if (tone === "warning" || tone === "offline") {
    return "warning";
  }

  return "info";
}

export function NotificationsOverlay({
  notifications,
  onClose,
  onDismiss,
  onDismissAll
}: {
  notifications: AppNotification[];
  onClose: () => void;
  onDismiss: (id: string) => void;
  onDismissAll: () => void;
}): JSX.Element {
  const hasNotifications = notifications.length > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-end overflow-auto bg-bg-tertiary/45 p-3 backdrop-blur-sm sm:p-5"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        aria-labelledby="notifications-overlay-title"
        aria-modal="true"
        className="flex max-h-[calc(100dvh-24px)] w-full max-w-[720px] flex-col overflow-hidden rounded-hcbLg border border-border bg-bg-primary shadow-2xl sm:mt-12 sm:max-h-[calc(100dvh-96px)]"
        role="dialog"
      >
        <header className="flex min-h-14 items-center justify-between gap-3 border-b border-border bg-bg-secondary px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-hcbMd bg-surface-0 text-accent">
              <Bell aria-hidden="true" size={18} />
            </div>
            <div className="min-w-0">
              <h2 className="truncate text-[var(--text-lg)] font-semibold" id="notifications-overlay-title">
                Notifications
              </h2>
              <p className="truncate text-[var(--text-sm)] text-text-muted">App notices</p>
            </div>
          </div>
          <IconButton icon={X} label="Close notifications" onClick={onClose} variant="ghost" />
        </header>

        <div className="grid min-h-0 gap-3 overflow-auto p-4">
          <section className="grid gap-2">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-[var(--text-md)] font-semibold">App notices</h3>
              <div className="flex items-center gap-2">
                <Badge tone={notifications.length > 1 ? "warning" : "neutral"}>
                  {notifications.length}
                </Badge>
                <Button
                  disabled={!hasNotifications}
                  onClick={onDismissAll}
                  size="sm"
                  variant="ghost"
                >
                  Dismiss all
                </Button>
              </div>
            </div>
            <div className="grid gap-2" role="list">
              {hasNotifications ? (
                notifications.map((notification) => (
                  <div
                    className="grid gap-1 rounded-hcbMd border border-border bg-bg-tertiary px-3 py-2"
                    key={notification.id}
                    role="listitem"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="min-w-0 truncate text-[var(--text-base)] font-medium">
                        {notification.title}
                      </span>
                      <div className="flex shrink-0 items-center gap-2">
                        <Badge tone={notificationBadgeTone(notification.tone)}>{notification.status}</Badge>
                        <IconButton
                          className="size-7"
                          icon={X}
                          label="Dismiss notification"
                          onClick={() => onDismiss(notification.id)}
                          size="sm"
                          variant="ghost"
                        />
                      </div>
                    </div>
                    <p className="text-[var(--text-sm)] text-text-muted">{notification.description}</p>
                  </div>
                ))
              ) : (
                <p className="rounded-hcbMd border border-border bg-bg-tertiary px-3 py-4 text-[var(--text-sm)] text-text-muted">
                  No app notices.
                </p>
              )}
            </div>
          </section>
        </div>
      </section>
    </div>
  );
}

export function SettingsOverlay({
  dialogRef,
  onOpenDiagnostics,
  onClose
}: {
  dialogRef: RefObject<HTMLElement>;
  onOpenDiagnostics: () => void;
  onClose: () => void;
}): JSX.Element {
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center overflow-auto bg-bg-tertiary/45 p-3 backdrop-blur-sm sm:p-5"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        aria-labelledby="settings-overlay-title"
        aria-modal="true"
        className="flex max-h-[calc(100dvh-24px)] w-full max-w-[1120px] flex-col overflow-hidden rounded-hcbLg border border-border bg-bg-primary shadow-2xl sm:max-h-[calc(100dvh-72px)]"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <header className="flex min-h-14 items-center justify-between gap-3 border-b border-border bg-bg-secondary px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-hcbMd bg-surface-0 text-accent">
              <Settings2 aria-hidden="true" size={18} />
            </div>
            <div className="min-w-0">
              <h2 className="truncate text-[var(--text-lg)] font-semibold" id="settings-overlay-title">
                Settings
              </h2>
              <p className="truncate text-[var(--text-sm)] text-text-muted">App preferences</p>
            </div>
          </div>
          <IconButton icon={X} label="Close settings" onClick={onClose} variant="ghost" />
        </header>

        <div className="min-h-0 flex-1 overflow-auto p-3 sm:p-4">
          <SettingsView onOpenDiagnostics={onOpenDiagnostics} />
        </div>
      </section>
    </div>
  );
}

export function SyncProgressOverlay({
  dataState,
  status
}: {
  dataState: string;
  status: SyncStatusResponse;
}): JSX.Element | null {
  if (status.state !== "running" && dataState !== "loading") {
    return null;
  }

  const pendingText = status.pendingMutationCount > 0
    ? `Queued writes: ${status.pendingMutationCount}`
    : "Added/modified: 0 up 1 down";

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-bg-tertiary/35 backdrop-blur-sm" role="status" aria-live="polite">
      <section className="w-[min(420px,calc(100vw-48px))] overflow-hidden rounded-hcbLg border border-border bg-bg-primary shadow-2xl">
        <header className="flex min-h-10 items-center gap-2 border-b border-border bg-bg-secondary px-3 py-2">
          <RefreshCw aria-hidden="true" className="animate-spin text-accent" size={16} />
          <h2 className="text-[var(--text-base)] font-semibold text-text-primary">Hot Cross Buns 2</h2>
        </header>
        <div className="grid gap-1 px-4 py-3 text-center text-[var(--text-sm)] font-medium text-text-secondary">
          <div>{pendingText}</div>
          <div>Removed: 0 up 0 down</div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-0">
            <div className="h-full w-1/2 animate-pulse rounded-full bg-accent shadow-[0_0_16px_var(--color-accent)]" />
          </div>
        </div>
      </section>
    </div>
  );
}
