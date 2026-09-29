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
import appIconUrl from "../../../../assets/brand/buns-app-icon-sidebar.png";
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
  const refreshedConnectedAccount = useRef<string | null>(null);
  const selectedTaskLists = useMemo(() => new Set(selectedTaskListIds), [selectedTaskListIds]);
  const selectedCalendars = useMemo(() => new Set(selectedCalendarIds), [selectedCalendarIds]);
  const accountState = source.diagnosticsSummary?.account.state ?? "signed_out";
  const connectedGoogleAccount = source.googleStatus.accounts.find((account) => account.connectionState === "connected");
  const googleConnected = Boolean(connectedGoogleAccount) || accountState === "connected";
  const googleAccountLabel =
    connectedGoogleAccount?.displayName ?? connectedGoogleAccount?.email ?? source.googleStatus.account?.displayName ?? source.googleStatus.account?.email ?? "Google account";
  const nativeFlags = source.diagnosticsSummary?.native.flags ?? source.native.capabilityReport.flags;
  const oauthRuntimeReady =
    nativeFlags.supportsOAuthLoopback ??
    nativeFlags.supportsCredentialStorage ??
    false;
  const googleClientConfigured = source.googleStatus.oauthClientConfigured;
  const googleConnecting = source.googleStatus.authorizationInProgress === true;
  const googleTaskLists = source.taskLists.filter((taskList) => taskList.accountId !== "local");
  const googleCalendars = source.calendarSources.filter((calendar) => calendar.accountId !== "local");
  const googleResourcesReady = googleConnected && googleTaskLists.length > 0 && googleCalendars.length > 0;
  const canAdvance =
    activeStep === 0
      ? true
      : activeStep === 1
        ? googleResourcesReady
        : activeStep === 2
          ? selectedTaskListIds.length > 0
          : activeStep === 3
            ? selectedCalendarIds.length > 0
          : true;
  const canFinish = googleResourcesReady && selectedTaskListIds.length > 0 && selectedCalendarIds.length > 0;

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
    setLocalError(null);
    setActiveStep((current) => Math.min(5, current + 1));
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
    if (!googleResourcesReady) {
      setLocalError("Wait for Google Calendar and Google Tasks to finish their first sync.");
      return;
    }
    setSubmitting(true);
    setLocalError(null);

    const saved = await source.updateSettings({
      selectedTaskListIds: overrides.selectedTaskListIds ?? selectedTaskListIds,
      selectedCalendarIds: overrides.selectedCalendarIds ?? selectedCalendarIds,
      syncMode: overrides.syncMode ?? syncMode,
      notificationsEnabled: overrides.notificationsEnabled ?? notificationsEnabled,
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
      setLocalError("Save a Google Desktop OAuth client ID before connecting.");
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
    <div
      aria-labelledby="first-run-title"
      aria-modal="true"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-bg-primary/60 p-3 backdrop-blur-sm sm:p-6"
      role="dialog"
    >
      <div className="hcb-raised flex h-[min(760px,calc(100dvh-48px))] w-[min(1180px,calc(100vw-48px))] flex-col overflow-hidden rounded-hcbLg border border-border bg-bg-primary">
        <header className="flex min-h-14 items-center justify-between gap-3 border-b border-border px-3 py-2 sm:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <img
              alt=""
              aria-hidden="true"
              className="hcb-media-outline size-8 shrink-0 rounded-hcbMd object-cover"
              draggable={false}
              src={appIconUrl}
            />
            <h2 className="truncate text-[var(--text-md)] font-semibold text-text-primary" id="first-run-title">
              Hot Cross Buns
            </h2>
          </div>
          <p aria-live="polite" className="shrink-0 text-[var(--text-sm)] text-text-muted">
            Step {activeStep + 1} of 6
          </p>
        </header>

        <div className="grid min-h-0 flex-1 content-start gap-3 overflow-y-auto p-4 sm:p-6">
          {activeStep === 0 ? (
            <section className="mx-auto flex h-full max-w-xl flex-col items-center justify-center gap-5 py-12 text-center sm:py-20">
              <img
                alt=""
                aria-hidden="true"
                className="size-20 rounded-hcbLg object-cover"
                draggable={false}
                src={appIconUrl}
              />
              <div>
                <h3 className="hcb-heading text-balance text-[var(--text-2xl)] font-bold text-text-primary">
                  Welcome to Hot Cross Buns
                </h3>
                <p className="hcb-copy mt-3 text-pretty text-[var(--text-md)] text-text-muted">
                  This setup takes about 2 minutes. You’ll connect Google, choose what to sync, and set your preferences.
                </p>
              </div>
            </section>
          ) : null}

          {activeStep === 1 ? (
            <SetupCard
              description={
                googleConnected
                  ? `Connected as ${googleAccountLabel}.`
                  : !oauthRuntimeReady
                    ? "Google OAuth browser handoff is unavailable in this runtime."
                    : googleClientConfigured
                      ? "Open the browser to authorize Google Tasks and Calendar sync."
                    : "Save a Desktop OAuth client ID, then connect your Google account."
              }
              icon={Cloud}
              title="Google account"
            >
              {!googleConnected ? (
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
              {!googleConnected ? (
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
            <section className="min-w-0 rounded-hcbMd border border-border bg-bg-secondary">
              <div className="border-b border-border px-3 py-2">
                <h3 className="hcb-heading text-[var(--text-md)] font-semibold text-text-primary">Task lists</h3>
                <p className="hcb-copy text-[var(--text-xs)] text-text-muted">Choose the task lists HCB should show and sync.</p>
              </div>
              <div className="grid max-h-44 gap-2 overflow-y-auto p-3">
                {source.taskLists.length === 0 ? (
                  <p className="text-[var(--text-sm)] text-text-muted">
                    No task lists are available yet.
                  </p>
                ) : source.taskLists.map((taskList) => (
                  <label
                    className="flex min-h-8 items-center gap-2 rounded-hcbMd border border-border bg-bg-tertiary px-3 text-[var(--text-sm)] text-text-secondary"
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
          ) : null}

          {activeStep === 3 ? (
            <section className="min-w-0 rounded-hcbMd border border-border bg-bg-secondary">
              <div className="border-b border-border px-3 py-2">
                <h3 className="hcb-heading text-[var(--text-md)] font-semibold text-text-primary">Calendars</h3>
                <p className="hcb-copy text-[var(--text-xs)] text-text-muted">Choose the calendars HCB should show and sync.</p>
              </div>
              <div className="grid max-h-44 gap-2 overflow-y-auto p-3">
                {source.calendarSources.length === 0 ? (
                  <p className="text-[var(--text-sm)] text-text-muted">
                    No calendars are available yet.
                  </p>
                ) : source.calendarSources.map((calendar) => (
                  <label
                    className="flex min-h-8 items-center gap-2 rounded-hcbMd border border-border bg-bg-tertiary px-3 text-[var(--text-sm)] text-text-secondary"
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
          ) : null}

          {activeStep === 4 ? (
            <SetupOption title="Sync mode" icon={RefreshCw}>
              <select
                aria-label="Onboarding sync mode"
                className={onboardingSelectClass}
                onChange={(event) => setSyncMode(event.target.value as SettingsSnapshot["syncMode"])}
                value={syncMode}
              >
                <option value="manual">Manual</option>
                <option value="balanced">Balanced</option>
                <option value="near-real-time">Near real time</option>
              </select>
            </SetupOption>
          ) : null}

          {activeStep === 5 ? (
            <SetupOption title="Notifications" icon={Bell}>
              <label className="flex min-h-10 items-center gap-2 text-[var(--text-sm)] text-text-secondary">
                <Checkbox
                  aria-label="Local notifications"
                  checked={notificationsEnabled}
                  onCheckedChange={(checked) => setNotificationsEnabled(checked === true)}
                />
                Local notifications
              </label>
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
            {activeStep < 5 ? (
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
      </div>
    </div>
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
      <p className="hcb-copy mt-2 line-clamp-2 text-[var(--text-sm)] text-text-muted">{description}</p>
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

const onboardingSelectClass =
  "min-h-10 w-full rounded-hcbMd border border-border bg-surface-0 px-2 text-[var(--text-base)] text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
