import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { SettingsSnapshot } from "@shared/ipc/contracts";
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  CheckCircle2,
  Cloud,
  ExternalLink,
  RefreshCw,
  Save,
  X
} from "lucide-react";
import type { CoreViewModelSource } from "../features/core/coreViewModelSource";
import { Badge, Button, Input, StatusBanner } from "./primitives";
import { Checkbox } from "./ui/checkbox";

export function FirstRunOnboarding({ source }: { source: CoreViewModelSource }): JSX.Element {
  const initialTaskListIds =
    source.settings.selectedTaskListIds.length > 0
      ? source.settings.selectedTaskListIds
      : source.taskLists.map((taskList) => taskList.id);
  const initialCalendarIds =
    source.settings.selectedCalendarIds.length > 0
      ? source.settings.selectedCalendarIds
      : source.calendarSources.filter((calendar) => calendar.selected).map((calendar) => calendar.id);
  const [selectedTaskListIds, setSelectedTaskListIds] = useState<string[]>(initialTaskListIds);
  const [selectedCalendarIds, setSelectedCalendarIds] = useState<string[]>(initialCalendarIds);
  const [syncMode, setSyncMode] = useState<SettingsSnapshot["syncMode"]>(source.settings.syncMode);
  const [notificationsEnabled, setNotificationsEnabled] = useState(source.settings.notificationsEnabled);
  const [localError, setLocalError] = useState<string | null>(null);
  const [googleMessage, setGoogleMessage] = useState<string | null>(null);
  const [googleClientId, setGoogleClientId] = useState(source.googleStatus.clientId ?? "");
  const [googleClientSecret, setGoogleClientSecret] = useState("");
  const [googleClientSaving, setGoogleClientSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [activeStep, setActiveStep] = useState(0);
  const contentRef = useRef<HTMLDivElement>(null);
  const refreshedConnectedAccount = useRef<string | null>(null);
  const selectedTaskLists = useMemo(() => new Set(selectedTaskListIds), [selectedTaskListIds]);
  const selectedCalendars = useMemo(() => new Set(selectedCalendarIds), [selectedCalendarIds]);
  const connectedGoogleAccount = source.googleStatus.accounts.find((account) => account.connectionState === "connected");
  const googleConnected = Boolean(connectedGoogleAccount);
  const googleAccountLabel =
    connectedGoogleAccount?.displayName ?? connectedGoogleAccount?.email ?? source.googleStatus.account?.displayName ?? source.googleStatus.account?.email ?? "Google account";
  const nativeFlags = source.diagnosticsSummary?.native.flags ?? source.native.capabilityReport.flags;
  const notificationsAvailable = nativeFlags.supportsNotifications === true;
  const browserRuntime = source.native.capabilityReport.platform === "web";
  const oauthRuntimeReady = browserRuntime ||
    (nativeFlags.supportsOAuthLoopback ??
    nativeFlags.supportsCredentialStorage ??
    false);
  const googleClientConfigured = source.googleStatus.oauthClientConfigured;
  const googleConnecting = source.googleStatus.authorizationInProgress === true;
  const googleTaskLists = source.taskLists.filter((taskList) => taskList.accountId !== "local");
  const googleCalendars = source.calendarSources.filter((calendar) => calendar.accountId !== "local");
  const resourcesReady = source.taskLists.length > 0 && source.calendarSources.length > 0;
  const canAdvance =
    activeStep === 0
      ? true
      : activeStep === 1
        ? googleConnected && resourcesReady
        : activeStep === 2
          ? selectedTaskListIds.length > 0 && selectedCalendarIds.length > 0
          : true;
  const canFinish = googleConnected && resourcesReady && selectedTaskListIds.length > 0 && selectedCalendarIds.length > 0;

  useEffect(() => {
    if (contentRef.current) contentRef.current.scrollTop = 0;
  }, [activeStep]);

  useEffect(() => {
    setGoogleClientId(source.googleStatus.clientId ?? "");
  }, [source.googleStatus.clientId]);

  useEffect(() => {
    if (source.googleStatus.authorizationError) {
      setLocalError(source.googleStatus.authorizationError);
    }
  }, [source.googleStatus.authorizationError]);

  useEffect(() => {
    if (!googleConnecting) {
      return;
    }

    // OAuth completion occurs in the browser and may happen long after the
    // initial handoff. Keep setup current until the callback settles it.
    source.refreshGoogleStatus();
    const interval = window.setInterval(() => source.refreshGoogleStatus(), 1_500);

    return () => window.clearInterval(interval);
  }, [googleConnecting, source.refreshGoogleStatus]);

  useEffect(() => {
    const accountId = connectedGoogleAccount?.accountId ?? source.googleStatus.account?.accountId ?? null;
    if (!googleConnected || !accountId || refreshedConnectedAccount.current === accountId) return;

    refreshedConnectedAccount.current = accountId;
    source.refresh();
    const timers = [1_500, 4_000, 8_000].map((delayMs) => window.setTimeout(() => source.refresh(), delayMs));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [connectedGoogleAccount?.accountId, googleConnected, source.googleStatus.account?.accountId, source.refresh]);

  useEffect(() => {
    if (!googleConnected) return;
    const taskListIds = googleTaskLists.map((taskList) => taskList.id);
    const calendarIds = googleCalendars.map((calendar) => calendar.id);
    if (taskListIds.length > 0) {
      setSelectedTaskListIds((current) => current.includes("inbox") ? taskListIds : current);
    }
    if (calendarIds.length > 0) {
      setSelectedCalendarIds((current) => current.includes("primary") ? calendarIds : current);
    }
  }, [googleCalendars, googleConnected, googleTaskLists]);

  function toggleTaskList(taskListId: string, selected: boolean): void {
    setSelectedTaskListIds((current) => {
      const next = new Set(current);

      if (selected) {
        next.add(taskListId);
      } else {
        next.delete(taskListId);
      }

      return [...next];
    });
  }

  function toggleCalendar(calendarId: string, selected: boolean): void {
    setSelectedCalendarIds((current) => {
      const next = new Set(current);

      if (selected) {
        next.add(calendarId);
      } else {
        next.delete(calendarId);
      }

      return [...next];
    });
  }

  function goBack(): void {
    setLocalError(null);
    setActiveStep((current) => Math.max(0, current - 1));
  }

  function goForward(): void {
    if (!canAdvance) return;
    setLocalError(null);
    setActiveStep((current) => Math.min(4, current + 1));
  }

  async function completeSetup(
    overrides: Partial<Pick<
      SettingsSnapshot,
      | "selectedTaskListIds"
      | "selectedCalendarIds"
      | "syncMode"
      | "notificationsEnabled"
    >> = {}
  ): Promise<void> {
    if (!canFinish) {
      setLocalError(googleConnected ? "Choose at least one task list and calendar to finish setup." : "Connect your Google account to finish setup.");
      return;
    }
    setSubmitting(true);
    setLocalError(null);

    let enableNotifications = notificationsAvailable && (overrides.notificationsEnabled ?? notificationsEnabled);
    if (browserRuntime && enableNotifications) {
      const permission = await window.hcb?.native.requestNotificationPermission();
      if (!permission?.ok || permission.data.permission !== "granted") {
        setNotificationsEnabled(false);
        setSubmitting(false);
        setLocalError(permission && !permission.ok ? permission.error.message : "Notification permission was not granted. Finish setup again to continue without reminders, or allow notifications in your browser's site settings.");
        return;
      }
    }
    const saved = await source.updateSettings({
      selectedTaskListIds: overrides.selectedTaskListIds ?? selectedTaskListIds,
      selectedCalendarIds: overrides.selectedCalendarIds ?? selectedCalendarIds,
      syncMode: overrides.syncMode ?? syncMode,
      notificationsEnabled: enableNotifications,
      onboardingStatus: "completed",
      setupCompletedAt: new Date().toISOString()
    });

    if (!saved) {
      setSubmitting(false);
      setLocalError("Setup preferences were not saved.");
    }
  }

  async function connectGoogle(): Promise<void> {
    if (!googleClientConfigured) {
      setLocalError(browserRuntime ? "Google sign-in is not configured for this site. Contact the site owner to enable it before continuing." : "Save a Google Desktop OAuth client ID before connecting.");
      return;
    }

    await beginGoogleAuthorization();
  }

  async function beginGoogleAuthorization(): Promise<void> {
    setGoogleMessage(null);
    setLocalError(null);

    const result = await window.hcb?.google.beginOAuth();

    if (result?.ok) {
      setGoogleMessage(result.data.message);
      source.setGoogleStatus(result.data);
      source.refreshGoogleStatus();
      for (const delayMs of [2_000, 5_000, 10_000]) {
        window.setTimeout(() => source.refreshGoogleStatus(), delayMs);
      }
    } else {
      setLocalError(result?.error.message ?? "Google authorization could not start.");
    }
  }

  async function cancelGoogleAuthorization(): Promise<void> {
    setGoogleMessage(null);
    setLocalError(null);
    const result = await window.hcb?.google.cancelOAuth();

    if (result?.ok) {
      source.setGoogleStatus(result.data);
      setGoogleMessage(result.data.message);
    } else {
      setLocalError(result?.error.message ?? "Google authorization could not be cancelled.");
    }
  }

  async function saveGoogleClient(): Promise<void> {
    setGoogleClientSaving(true);
    setGoogleMessage(null);
    setLocalError(null);

    const request =
      googleClientSecret.trim().length > 0
        ? { clientId: googleClientId, clientSecret: googleClientSecret.trim() }
        : { clientId: googleClientId };
    const result = await window.hcb?.google.saveOAuthClient(request);

    if (result?.ok) {
      source.setGoogleStatus(result.data);
      setGoogleClientSecret("");
      setGoogleMessage("Google OAuth client saved. Opening your browser…");
      await beginGoogleAuthorization();
    } else {
      setLocalError(result?.error.message ?? "Google OAuth client could not be saved.");
    }

    setGoogleClientSaving(false);
  }

  return (
    <Dialog.Root open>
    <Dialog.Portal>
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-bg-primary/80 p-3 sm:p-6"
    >
      <Dialog.Content aria-describedby={undefined} onEscapeKeyDown={(event) => event.preventDefault()} onInteractOutside={(event) => event.preventDefault()} className="hcb-raised flex h-[min(760px,calc(100dvh-48px))] w-[min(1180px,calc(100vw-48px))] flex-col overflow-hidden rounded-hcbLg border border-border bg-bg-primary">
        <Dialog.Title className="sr-only">Hot Cross Buns</Dialog.Title>

        <div ref={contentRef} className="grid min-h-0 flex-1 content-start gap-3 overflow-y-auto p-4 sm:p-6">
          {activeStep === 0 ? (
            <section className="mx-auto flex h-full max-w-xl flex-col items-center justify-center gap-5 py-12 text-center sm:py-20">
              <div>
                <h3 className="hcb-heading text-balance text-[var(--text-2xl)] font-bold text-text-primary">
                  Welcome to Hot Cross Buns
                </h3>
                <p className="hcb-copy mt-3 text-pretty text-[var(--text-md)] text-text-muted">
                  Turn tasks into a realistic day: capture work, preview free time with Smart Schedule, then create Calendar blocks. Your workspace saves in this browser. Connect your Google account, then choose your task lists and calendars to get started.
                </p>
              </div>
            </section>
          ) : null}

          {activeStep === 1 && !oauthRuntimeReady ? (
            <SetupCard
              description="A Google account is required to finish setup."
              icon={Save}
              title="Google connection unavailable"
            >
              <p className="text-[var(--text-sm)] text-text-muted">This version cannot connect to Google. Open a supported version of Hot Cross Buns to continue setup.</p>
            </SetupCard>
          ) : null}

          {activeStep === 1 && oauthRuntimeReady ? (
            <SetupCard
              description={
                googleConnected
                  ? `Connected as ${googleAccountLabel}.`
                  : !oauthRuntimeReady
                    ? "Google OAuth browser handoff is unavailable in this runtime."
                    : googleClientConfigured
                      ? "Connect your Google account to continue. Allow access to Tasks and Calendar to sync your planner."
                    : browserRuntime ? "Google sign-in is not configured for this site. Contact the site owner to enable it before continuing." : "Save a Desktop OAuth client ID, then connect your Google account."
              }
              icon={Cloud}
              title="Connect Google"
            >
              {!googleConnected && !browserRuntime ? (
                <div className="grid w-full gap-2">
                  <Input
                    aria-label="Google OAuth client ID"
                    onChange={(event) => setGoogleClientId(event.currentTarget.value)}
                    placeholder="Desktop OAuth client ID"
                    value={googleClientId}
                  />
                  <Input
                    aria-label="Google OAuth client secret"
                    onChange={(event) => setGoogleClientSecret(event.currentTarget.value)}
                    placeholder={source.googleStatus.hasClientSecret ? "Stored client secret" : "Client secret (optional)"}
                    type="password"
                    value={googleClientSecret}
                  />
                </div>
              ) : null}
              {!googleConnected && !browserRuntime ? (
                <Button
                  disabled={googleClientId.trim().length < 10 || googleClientSaving}
                  onClick={() => void saveGoogleClient()}
                  variant="secondary"
                >
                  <Save aria-hidden="true" size={14} />
                  Save OAuth Client
                </Button>
              ) : null}
              <Button
                disabled={googleConnecting || !oauthRuntimeReady || !googleClientConfigured || googleConnected}
                onClick={() => void connectGoogle()}
                variant="primary"
              >
                <ExternalLink aria-hidden="true" size={14} />
                {googleConnected ? "Google connected" : googleConnecting ? "Opening Google" : "Connect Google"}
              </Button>
              {googleConnecting ? (
                <Button onClick={() => void cancelGoogleAuthorization()} variant="secondary">
                  <X aria-hidden="true" size={14} />
                  Cancel authorization
                </Button>
              ) : null}
              {googleMessage ? (
                <p className="text-[var(--text-xs)] text-text-muted">{googleMessage}</p>
              ) : null}
            </SetupCard>
          ) : null}

          {activeStep === 2 ? (
            <div className="grid items-start gap-8 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
              <section className="min-w-0">
                <div className="mb-3 border-b border-border pb-3">
                  <h3 className="hcb-heading text-[var(--text-md)] font-semibold text-text-primary">Task lists</h3>
                  <p className="hcb-copy text-[var(--text-xs)] text-text-muted">Choose the task lists HCB should show.</p>
                </div>
                <div className="grid gap-1">
                  {source.taskLists.length === 0 ? (
                    <p className="text-[var(--text-sm)] text-text-muted">
                      No task lists are available yet.
                    </p>
                  ) : source.taskLists.map((taskList) => (
                    <label
                      className="flex min-h-10 items-center gap-3 rounded-hcbMd px-2 text-[var(--text-base)] text-text-secondary transition-colors hover:bg-surface-0"
                      key={taskList.id}
                    >
                      <Checkbox
                        aria-label={`Select task list ${taskList.title}`}
                        checked={selectedTaskLists.has(taskList.id)}
                        onCheckedChange={(checked) => toggleTaskList(taskList.id, checked === true)}
                      />
                      <span className="min-w-0 flex-1 truncate">{taskList.title}</span>
                      <Badge>{taskList.activeTaskCount ?? taskList.taskCount ?? 0}</Badge>
                    </label>
                  ))}
                </div>
              </section>
              <section className="min-w-0">
                <div className="mb-3 border-b border-border pb-3">
                  <h3 className="hcb-heading text-[var(--text-md)] font-semibold text-text-primary">Calendars</h3>
                  <p className="hcb-copy text-[var(--text-xs)] text-text-muted">Choose the calendars HCB should show.</p>
                </div>
                <div className="grid gap-1">
                  {source.calendarSources.length === 0 ? (
                    <p className="text-[var(--text-sm)] text-text-muted">
                      No calendars are available yet.
                    </p>
                  ) : source.calendarSources.map((calendar) => (
                    <label
                      className="flex min-h-10 items-center gap-3 rounded-hcbMd px-2 text-[var(--text-base)] text-text-secondary transition-colors hover:bg-surface-0"
                      key={calendar.id}
                    >
                      <Checkbox
                        aria-label={`Select calendar ${calendar.title}`}
                        checked={selectedCalendars.has(calendar.id)}
                        onCheckedChange={(checked) => toggleCalendar(calendar.id, checked === true)}
                      />
                      <span className="min-w-0 flex-1 truncate">{calendar.title}</span>
                      <Badge>{calendar.eventCount ?? 0}</Badge>
                    </label>
                  ))}
                </div>
              </section>
            </div>
          ) : null}

          {activeStep === 3 && (!oauthRuntimeReady || browserRuntime) ? (
            <SetupCard title="Saved in this browser" icon={Save} description="Changes save automatically in IndexedDB before the planner confirms success. Reloading the page keeps your workspace.">
              <p className="text-[var(--text-sm)] text-text-muted">Use the same browser profile to return to your workspace. Clearing this site's browser data removes the workspace; private browsing keeps it only for that private session.</p>
            </SetupCard>
          ) : null}

          {activeStep === 3 && oauthRuntimeReady && !browserRuntime ? (
            <SetupOption title="Sync mode" icon={RefreshCw}>
              <fieldset className="grid gap-3" aria-label="Onboarding sync mode">
                {syncOptions.map((option) => (
                  <label key={option.value} className="flex cursor-pointer items-start gap-3 rounded-hcbMd border border-border bg-bg-primary p-4 transition-colors has-[:checked]:border-accent/50 has-[:checked]:bg-accent/5">
                    <input
                      className="mt-1 size-4 shrink-0 accent-[var(--color-accent)]"
                      type="radio"
                      name="onboarding-sync-mode"
                      value={option.value}
                      aria-label={option.label}
                      checked={syncMode === option.value}
                      onChange={() => setSyncMode(option.value)}
                      aria-describedby={`sync-${option.value}-description`}
                    />
                    <span className="min-w-0">
                      <span className="text-[var(--text-md)] font-medium text-text-primary">{option.label}</span>
                      <span id={`sync-${option.value}-description`} className="mt-1 block text-[var(--text-sm)] leading-relaxed text-text-secondary">
                        {option.description}
                        <span className="mt-1 block text-text-muted">{option.example}</span>
                      </span>
                    </span>
                  </label>
                ))}
              </fieldset>
            </SetupOption>
          ) : null}

          {activeStep === 4 && !notificationsAvailable ? (
            <SetupCard title="Notifications" icon={Bell} description="Background reminders are unavailable in this browser release. Finish setup to start using your tasks, notes, and calendars." />
          ) : null}

          {activeStep === 4 && notificationsAvailable ? (
            <SetupOption title="Notifications" icon={Bell}>
              <>
              <label className="flex min-h-10 items-center gap-2 text-[var(--text-sm)] text-text-secondary">
                <Checkbox
                  aria-label="Local notifications"
                  checked={notificationsEnabled}
                  onCheckedChange={(checked) => setNotificationsEnabled(checked === true)}
                />
                Local notifications
              </label>
              {browserRuntime ? <p className="mt-2 text-sm text-text-muted">Your browser will ask for permission when you finish setup. Reminders work while HCB is open; they do not run after you close it.</p> : null}
              </>
            </SetupOption>
          ) : null}

          {source.settingsMutationError || localError ? (
            <StatusBanner
              description={source.settingsMutationError ?? localError ?? "Setup settings failed."}
              title={source.settingsMutationError ? "Setup not saved" : "Setup needs attention"}
              tone="warning"
            />
          ) : null}
        </div>

        <footer className="flex min-h-14 flex-wrap items-center justify-between gap-3 border-t border-border px-3 py-2 sm:px-5">
          {activeStep > 0 ? (
            <Button onClick={goBack} variant="secondary">
              <ArrowLeft aria-hidden="true" size={14} />
              Back
            </Button>
          ) : <span />}
          <div className="flex flex-wrap items-center gap-2">
            {activeStep < 4 ? (
              <Button disabled={!canAdvance} onClick={goForward} variant="primary">
                {activeStep === 0 ? "Get started" : "Continue"}
                <ArrowRight aria-hidden="true" size={14} />
              </Button>
            ) : (
              <Button
                disabled={submitting || source.settingsMutationPending || !canFinish}
                onClick={() => void completeSetup()}
                variant="primary"
              >
                <CheckCircle2 aria-hidden="true" size={15} />
                Finish setup
              </Button>
            )}
          </div>
        </footer>
      </Dialog.Content>
    </div>
    </Dialog.Portal>
    </Dialog.Root>
  );
}

function SetupCard({
  children,
  description,
  icon: Icon,
  title
}: {
  children?: ReactNode;
  description: string;
  icon: typeof Cloud;
  title: string;
}): JSX.Element {
  return (
    <section className="min-w-0 rounded-hcbMd border border-border bg-bg-secondary p-3">
      <div className="flex items-center gap-2">
        <div className="flex size-7 shrink-0 items-center justify-center rounded-hcbSm bg-surface-0 text-accent">
          <Icon aria-hidden="true" size={15} />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="hcb-heading truncate text-[var(--text-md)] font-semibold text-text-primary">{title}</h3>
        </div>
      </div>
      <p className="hcb-copy mt-2 text-pretty text-[var(--text-sm)] text-text-muted">{description}</p>
      {children ? <div className="mt-3 grid gap-2">{children}</div> : null}
    </section>
  );
}

function SetupOption({
  children,
  icon: Icon,
  title
}: {
  children: JSX.Element;
  icon: typeof Cloud;
  title: string;
}): JSX.Element {
  return (
    <section className="min-w-0 rounded-hcbMd border border-border bg-bg-secondary p-3">
      <div className="mb-3 flex items-center gap-2">
        <Icon aria-hidden="true" className="text-accent" size={15} />
        <h3 className="hcb-heading truncate text-[var(--text-md)] font-semibold text-text-primary">{title}</h3>
      </div>
      {children}
    </section>
  );
}

const syncOptions: Array<{ value: SettingsSnapshot["syncMode"]; label: string; description: string; example: string }> = [
  {
    value: "manual",
    label: "Manual",
    description: "Sync with Google only when you press Refresh. Your edits stay local until then.",
    example: "For example, plan offline on a flight, then refresh when you’re connected again."
  },
  {
    value: "balanced",
    label: "Balanced",
    description: "Sync after your edits and check Google for changes every 5 minutes.",
    example: "For example, organize your day here while occasional changes from your phone arrive in the background."
  },
  {
    value: "near-real-time",
    label: "Near real time",
    description: "Sync after your edits and check Google every 30 seconds. Uses more network activity.",
    example: "For example, coordinate a busy calendar across devices and pick up changes sooner."
  }
];
