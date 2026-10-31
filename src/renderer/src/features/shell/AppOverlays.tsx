import type { DiagnosticsTab } from "../core/DiagnosticsTabs";
import * as Dialog from "@radix-ui/react-dialog";
import type { RefObject } from "react";
import { Bell, X } from "@renderer/components/icons";
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
      className="fixed inset-0 z-50 flex items-start justify-end overflow-auto bg-bg-tertiary/80 p-3 sm:p-5"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        aria-labelledby="notifications-overlay-title"
        aria-modal="true"
        className="hcb-raised flex max-h-[calc(100dvh-24px)] w-full max-w-[720px] flex-col overflow-hidden rounded-hcbLg border border-border bg-bg-primary sm:mt-12 sm:max-h-[calc(100dvh-96px)]"
        role="dialog"
      >
        <header className="flex min-h-14 items-center justify-between gap-3 border-b border-border bg-bg-secondary px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-hcbMd bg-surface-0 text-accent">
              <Bell aria-hidden="true" size={18} />
            </div>
            <div className="min-w-0">
              <h2 className="hcb-heading truncate text-[var(--text-lg)] font-semibold" id="notifications-overlay-title">
                Notifications
              </h2>
              <p className="hcb-copy truncate text-[var(--text-sm)] text-text-muted">App notices</p>
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
                          className="size-10"
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
  initialDiagnosticsTab,
  onClose
}: {
  dialogRef: RefObject<HTMLElement | null>;
  initialDiagnosticsTab?: DiagnosticsTab;
  onClose: () => void;
}): JSX.Element {
  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
      <Dialog.Content asChild aria-describedby={undefined}>
      <section
        aria-labelledby="settings-overlay-title"
        className="fixed inset-0 z-50 flex min-h-0 flex-col bg-bg-primary text-text-primary"
        ref={dialogRef}
        data-testid="settings-workspace"
      >
        <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border px-5">
          <Dialog.Title asChild><h1 className="text-lg font-semibold" id="settings-overlay-title">Settings</h1></Dialog.Title>
          <Dialog.Close asChild><Button variant="ghost" aria-label="Close settings"><X size={16} />Back to planner</Button></Dialog.Close>
        </header>
        <div className="min-h-0 flex-1 overflow-hidden"><SettingsView initialDiagnosticsTab={initialDiagnosticsTab} /></div>
      </section>
      </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
