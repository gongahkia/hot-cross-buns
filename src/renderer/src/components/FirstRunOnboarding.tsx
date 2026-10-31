import { AnimatePresence, motion, useIsPresent, useReducedMotion } from "motion/react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/onboarding-dialog";
import { useEffect, useMemo, useRef, useState, forwardRef, type ReactNode } from "react";
import type { SettingsSnapshot } from "@shared/ipc/contracts";
import { ArrowLeft, ArrowRight, CheckCircle2, ExternalLink, Save, X } from "@renderer/components/icons";
import type { CoreViewModelSource } from "../features/core/coreViewModelSource";
import { Badge, Button, Input, StatusBanner } from "./primitives";
import { Checkbox } from "./ui/checkbox";
import { LoadingIndicator } from "./LoadingIndicator";
import { BrowserGoogleClientFields, BrowserGoogleSetupInstructions } from "./BrowserGoogleClientFields";

export function FirstRunOnboarding({ source, connectionOnly = false }: { source: CoreViewModelSource; connectionOnly?: boolean }): JSX.Element {
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
  const [activeStep, setActiveStep] = useState(connectionOnly ? 1 : 0);
  const contentRef = useRef<HTMLDivElement>(null);
  const [googleSetupPage, setGoogleSetupPage] = useState<"instructions" | "client" | null>(null);
  const prefersReducedMotion = useReducedMotion();
  const motionDisabled = source.settings.disableAnimations || prefersReducedMotion;
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
    if (contentRef.current) {
      contentRef.current.scrollTop = 0;
      // Next may become disabled after leaving welcome. Keep keyboard focus
      // inside the dialog rather than on the now-disabled navigation button.
      contentRef.current.closest<HTMLElement>('[role="dialog"]')?.focus({ preventScroll: true });
    }
  }, [activeStep, googleSetupPage]);

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
      setLocalError(browserRuntime ? "Save a Google Web application client ID below before connecting." : "Save a Google Desktop OAuth client ID before connecting.");
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

    try {
      const request = googleClientSecret.trim().length > 0
        ? { clientId: googleClientId, clientSecret: googleClientSecret.trim() }
        : { clientId: googleClientId };
      const result = await window.hcb?.google.saveOAuthClient(request);
      if (result?.ok) {
        source.setGoogleStatus(result.data);
        setGoogleClientSecret("");
        if (browserRuntime) setGoogleMessage("Client ID saved. Choose Connect Google to continue.");
        else {
          setGoogleMessage("Google OAuth client saved. Opening your browser…");
          await beginGoogleAuthorization();
        }
      } else setLocalError(result?.error.message ?? "Google OAuth client could not be saved.");
    } catch {
      setLocalError("Google OAuth client could not be saved. Try again.");
    } finally {
      setGoogleClientSaving(false);
    }
  }

  const stepContent = [
    { title: "Your day, freshly planned.", description: "Bring tasks and calendars together, then make room for what matters." },
    { title: "Connect Google", description: "Link your account to bring your tasks and calendars into Hot Cross Buns." },
    { title: "Choose your ingredients", description: "Pick the task lists and calendars you want in your planner." },
    { title: browserRuntime ? "A workspace that stays with you" : "Choose your sync rhythm", description: browserRuntime ? "Your changes save in this browser, ready for your next visit." : "Decide how often your planner checks for changes." },
    { title: "Freshly set up", description: "Choose your reminder preferences, then start planning your day." }
  ];

  return (
    <Dialog open>
      <DialogContent showClose={false} className="h-[min(640px,calc(100dvh-2rem))]" aria-label="Hot Cross Buns" aria-labelledby={undefined} onEscapeKeyDown={(event) => event.preventDefault()} onInteractOutside={(event) => event.preventDefault()}>
        <div className="m-2 mb-0 flex h-40 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-surface-0 sm:h-44">
          <LoadingIndicator size={180} illustration="connection" />
        </div>
        <div ref={contentRef} className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-6 pb-3 pt-5">
          <AnimatePresence initial={false} mode="popLayout">
            <OnboardingStep key={`${activeStep}-${googleSetupPage ?? "main"}`} disabled={Boolean(motionDisabled)}>
              <DialogHeader className={activeStep === 0 ? "sr-only" : "mb-5"}>
                <DialogTitle>{googleSetupPage === "instructions" ? "Set up Google sign-in" : googleSetupPage === "client" ? "Add your client ID" : stepContent[activeStep].title}</DialogTitle>
                <DialogDescription>{googleSetupPage === "instructions" ? "A one-time setup connects this site to Google." : googleSetupPage === "client" ? "Paste your OAuth client ID to enable Google sign-in." : stepContent[activeStep].description}</DialogDescription>
              </DialogHeader>
          {activeStep === 0 ? (
            <div className="flex min-h-28 items-center justify-center gap-4 py-4">
              <span className="onboarding-croissant text-6xl" role="img" aria-label="Croissant" data-still={motionDisabled || undefined}>🥐</span>
              <p className="onboarding-speech relative max-w-44 rounded-2xl border border-border bg-surface-0 px-4 py-3 text-sm font-medium text-text-primary">Welcome to Hot Cross Buns</p>
            </div>
          ) : null}

          {googleSetupPage === "instructions" ? (
            browserRuntime ? <BrowserGoogleSetupInstructions /> : <p className="text-sm text-text-secondary">Create a Desktop OAuth client in Google Cloud, enable the Tasks and Calendar APIs, and configure the consent screen. Copy your client ID to continue.</p>
          ) : null}
          {googleSetupPage === "client" ? (
            browserRuntime ? <BrowserGoogleClientFields value={googleClientId} onValueChange={setGoogleClientId} onSave={saveGoogleClient} busy={googleClientSaving || googleConnecting} /> : <div className="grid gap-3">
              <Input aria-label="Google OAuth client ID" placeholder="Desktop OAuth client ID" value={googleClientId} onChange={event => setGoogleClientId(event.currentTarget.value)} />
              <Input aria-label="Google OAuth client secret" placeholder="Client secret (optional)" type="password" value={googleClientSecret} onChange={event => setGoogleClientSecret(event.currentTarget.value)} />
              <Button disabled={googleClientId.trim().length < 10 || googleClientSaving} onClick={() => void saveGoogleClient()} variant="secondary"><Save aria-hidden="true" size={14} />Save OAuth Client</Button>
            </div>
          ) : null}
          {googleSetupPage && googleMessage ? <p role="status" className="text-sm text-text-muted">{googleMessage}</p> : null}

          {activeStep === 1 && !googleSetupPage && !oauthRuntimeReady ? (
            <SetupCard
              description="A Google account is required to finish setup."
              title="Google connection unavailable"
            >
              <p className="text-[var(--text-sm)] text-text-muted">This version cannot connect to Google. Open a supported version of Hot Cross Buns to continue setup.</p>
            </SetupCard>
          ) : null}

          {activeStep === 1 && !googleSetupPage && oauthRuntimeReady ? (
            <SetupCard
              description={
                googleConnected
                  ? `Connected as ${googleAccountLabel}.`
                  : !oauthRuntimeReady
                    ? "Google OAuth browser handoff is unavailable in this runtime."
                    : googleClientConfigured
                      ? "Connect your Google account to continue. Allow access to Tasks and Calendar to sync your planner."
                    : browserRuntime ? "Google sign-in is not configured. Set up your client ID first, then connect your Google account." : "Save a Desktop OAuth client ID, then connect your Google account."
              }
              title="Connect Google"
            >
              {!googleConnected ? <Button variant="secondary" onClick={() => setGoogleSetupPage(googleClientConfigured ? "client" : "instructions")}>{googleClientConfigured ? "Change sign-in configuration" : "Set up Google sign-in"}</Button> : null}
              <Button
                disabled={googleClientSaving || googleConnecting || !oauthRuntimeReady || !googleClientConfigured || googleConnected || (browserRuntime && googleClientId.trim() !== source.googleStatus.clientId)}
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
            <div className="grid items-start gap-5">
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
            <SetupCard title="Saved in this browser" description="Your tasks, notes, and calendars stay here when you reload.">
              <p className="text-[var(--text-sm)] text-text-muted">Use the same browser profile to return to your workspace. Clearing this site's browser data removes the workspace; private browsing keeps it only for that private session.</p>
            </SetupCard>
          ) : null}

          {activeStep === 3 && oauthRuntimeReady && !browserRuntime ? (
            <SetupOption title="Sync mode">
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
            <SetupCard title="Notifications" description="Background reminders are unavailable in this browser release. Finish setup to start using your tasks, notes, and calendars." />
          ) : null}

          {activeStep === 4 && notificationsAvailable ? (
            <SetupOption title="Notifications">
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

          {activeStep > 1 && !googleConnected ? (
            <StatusBanner role="alert" className="[&_.truncate]:whitespace-normal" title="Reconnect Google" description="Your Google session ended. Reconnect before finishing setup." tone="warning"
              action={<Button onClick={() => setActiveStep(1)} variant="secondary">Connect Google</Button>} />
          ) : null}

          {source.settingsMutationError || localError ? (
            <StatusBanner
              role="alert"
              className="[&_.truncate]:whitespace-normal"
              description={source.settingsMutationError ?? localError ?? "Setup settings failed."}
              title={source.settingsMutationError ? "Setup not saved" : "Setup needs attention"}
              tone="warning"
            />
          ) : null}
            </OnboardingStep>
          </AnimatePresence>
        </div>

        {googleSetupPage ? <div className="flex shrink-0 items-center justify-between gap-3 px-6 pb-6 pt-3">
          <div className="flex gap-1.5" role="img" aria-label={`Google setup progress: ${googleSetupPage === "instructions" ? 1 : 2} of 2`}>
            {["instructions", "client"].map(page => <span key={page} className={`size-1.5 rounded-full bg-accent transition-opacity duration-200 ${googleSetupPage === page ? "opacity-100" : "opacity-20"}`} />)}
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => { setLocalError(null); setGoogleSetupPage(googleSetupPage === "client" ? "instructions" : null); }}>Back</Button>
            <Button variant="primary" disabled={googleSetupPage === "client" && (!googleClientConfigured || googleClientSaving || googleClientId.trim() !== source.googleStatus.clientId)} onClick={() => setGoogleSetupPage(googleSetupPage === "instructions" ? "client" : null)}>Continue<ArrowRight aria-hidden="true" size={14} /></Button>
          </DialogFooter>
        </div> : null}
        {!connectionOnly && !googleSetupPage ? <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 px-6 pb-6 pt-3">
          <div className="flex gap-1.5" role="img" aria-label={`Setup progress: ${activeStep + 1} of ${stepContent.length}`}>
            {stepContent.map((step, index) => <span key={step.title} className={`size-1.5 rounded-full bg-accent transition-opacity duration-200 ${index === activeStep ? "opacity-100" : "opacity-20"}`} />)}
          </div>
          <DialogFooter>
          {activeStep > 0 ? (
            <Button onClick={goBack} variant="secondary">
              <ArrowLeft aria-hidden="true" size={14} />
              Back
            </Button>
          ) : null}
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
          </DialogFooter>
        </div> : null}
      </DialogContent>
    </Dialog>
  );
}

const OnboardingStep = forwardRef<HTMLDivElement, { children: ReactNode; disabled: boolean }>(({ children, disabled }, ref) => {
  const present = useIsPresent();
  return <motion.div
    ref={ref}
    data-present={present}
    className="space-y-3"
    inert={!present || undefined}
    aria-hidden={!present || undefined}
    initial={disabled ? false : { opacity: 0, x: 12 }}
    animate={{ opacity: 1, x: 0 }}
    exit={{ opacity: 0, x: -8 }}
    transition={{ duration: disabled ? 0 : .2, ease: "easeOut" }}
  >{children}</motion.div>;
});
OnboardingStep.displayName = "OnboardingStep";

function SetupCard({
  children,
  description,
  title
}: {
  children?: ReactNode;
  description: string;
  title: string;
}): JSX.Element {
  return (
    <section className="min-w-0">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <h3 className={`hcb-heading text-[var(--text-md)] font-semibold text-text-primary ${title === "Connect Google" ? "sr-only" : ""}`}>{title}</h3>
        </div>
      </div>
      <p className="hcb-copy mt-2 text-pretty text-[var(--text-sm)] text-text-muted">{description}</p>
      {children ? <div className="mt-3 grid gap-2">{children}</div> : null}
    </section>
  );
}

function SetupOption({
  children,
  title
}: {
  children: JSX.Element;
  title: string;
}): JSX.Element {
  return (
    <section className="min-w-0">
      <div className="mb-3 flex items-center gap-2">
        <h3 className={`hcb-heading text-[var(--text-md)] font-semibold text-text-primary ${title === "Connect Google" ? "sr-only" : ""}`}>{title}</h3>
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
