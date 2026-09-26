import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { existsSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

const mutationAcknowledgement = "I_UNDERSTAND_HCB_LIVE_TEST_WRITES_AND_DELETES";
const liveTestTitlePrefix = "[HCB live smoke ";

type LiveGoogleTestMode = "read-only" | "mutating";
type HcbResult<T = any> = { ok: boolean; data?: T; error?: { message?: string } };

interface LiveGoogleConfig {
  accountEmail: string;
  calendarName?: string;
  mode: LiveGoogleTestMode;
  profileDir: string;
  taskListName?: string;
}

interface LiveGoogleResources {
  calendarId: string;
  taskListId: string;
}

interface TimedValue<T> {
  elapsedMs: number;
  value: T;
}

interface BenchmarkRun {
  cleanupLocalMs: number;
  cleanupSyncMs: number;
  createLocalMs: number;
  createSyncMs: number;
  localWriteMs: number;
  run: number;
  syncMs: number;
  totalCleanupMs: number;
  updateLocalMs: number;
  updateSyncMs: number;
}

const config = readLiveGoogleConfig();
let liveElectronExit: string | null = null;
const liveElectronStderr: string[] = [];

function readLiveGoogleConfig(): LiveGoogleConfig {
  const mode = process.env.HCB_LIVE_GOOGLE_TEST_MODE;
  if (mode !== "read-only" && mode !== "mutating") {
    throw new Error("Set HCB_LIVE_GOOGLE_TEST_MODE to read-only or mutating before running the live Google suite.");
  }

  const profileDir = requiredEnvironment("HCB_LIVE_GOOGLE_PROFILE_DIR");
  if (!isAbsolute(profileDir) || !existsSync(profileDir) || !statSync(profileDir).isDirectory()) {
    throw new Error("HCB_LIVE_GOOGLE_PROFILE_DIR must be an existing absolute Electron user-data directory.");
  }

  const accountEmail = requiredEnvironment("HCB_LIVE_GOOGLE_TEST_ACCOUNT_EMAIL").toLowerCase();
  if (mode === "read-only") {
    return { accountEmail, mode, profileDir };
  }

  if (process.env.HCB_LIVE_GOOGLE_TEST_MUTATION_ACK !== mutationAcknowledgement) {
    throw new Error(`Mutating mode requires HCB_LIVE_GOOGLE_TEST_MUTATION_ACK=${mutationAcknowledgement}.`);
  }

  return {
    accountEmail,
    calendarName: requiredEnvironment("HCB_LIVE_GOOGLE_TEST_CALENDAR_NAME"),
    mode,
    profileDir,
    taskListName: requiredEnvironment("HCB_LIVE_GOOGLE_TEST_TASK_LIST_NAME")
  };
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Set ${name} before running the live Google suite.`);
  return value;
}

function requireSuccess<T>(result: HcbResult<T> | undefined, label: string): T {
  if (!result?.ok || result.data === undefined) {
    throw new Error(`${label} failed: ${result?.error?.message ?? "No result returned"}`);
  }
  return result.data;
}

async function measure<T>(operation: () => Promise<T>): Promise<TimedValue<T>> {
  const startedAt = performance.now();
  const value = await operation();
  return { elapsedMs: Math.round((performance.now() - startedAt) * 100) / 100, value };
}

function percentile(values: readonly number[], percentileValue: number): number {
  const ordered = [...values].sort((left, right) => left - right);
  const index = (ordered.length - 1) * percentileValue;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const remainder = index - lower;
  const value = ordered[lower] + (ordered[upper] - ordered[lower]) * remainder;
  return Math.round(value * 100) / 100;
}

function benchmarkMetric(runs: readonly BenchmarkRun[], field: keyof Omit<BenchmarkRun, "run">): {
  medianMs: number;
  p95Ms: number;
  runsMs: number[];
} {
  const values = runs.map((run) => run[field]);
  return {
    medianMs: percentile(values, 0.5),
    p95Ms: percentile(values, 0.95),
    runsMs: values
  };
}

function googleLocalRecurrenceDateTime(value: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date(value));
  const field = (type: Intl.DateTimeFormatPartTypes): string => parts.find((part) => part.type === type)?.value ?? "00";
  return `${field("year")}${field("month")}${field("day")}T${field("hour")}${field("minute")}${field("second")}`;
}

async function syncAccount(page: Page, accountId: string, readOnly: boolean, phase: string): Promise<Record<string, unknown>> {
  const result = await page.evaluate(async ({ accountId, phase, readOnly }) =>
    window.hcb?.sync.runNow({ accountId, readOnly, reason: `live-google-${phase}` }), { accountId, phase, readOnly });

  if (!result?.ok || result.data === undefined) {
    const runtimeStatus = await page.evaluate(async () => window.hcb?.sync.status());
    const status = runtimeStatus?.ok && runtimeStatus.data && typeof runtimeStatus.data === "object"
      ? runtimeStatus.data as { lastErrorCode?: unknown; message?: unknown }
      : null;
    const diagnostic = [
      result?.error?.message,
      typeof status?.lastErrorCode === "string" ? `code ${status.lastErrorCode}` : null,
      typeof status?.message === "string" ? status.message : null
    ].filter(Boolean).join("; ");
    const processDiagnostic = page.isClosed()
      ? `; Electron page closed${liveElectronExit ? ` (${liveElectronExit})` : ""}${liveElectronStderr.length ? `; stderr: ${liveElectronStderr.at(-1)}` : ""}`
      : "";
    throw new Error(`${phase} sync failed: ${diagnostic || "No result returned"}${processDiagnostic}`);
  }

  const status = requireSuccess(result, `${phase} sync`) as Record<string, unknown>;
  expect(status.state).toBe("idle");
  if (!readOnly) expect(status.pendingMutationCount).toBe(0);
  return status;
}

/**
 * A prior interrupted run can leave an explicitly marked smoke mutation in
 * the dedicated resources. Recover only those records before starting a new
 * mutating run; never touch unmarked user work or another resource.
 */
async function recoverMarkedLiveTestResidue(
  page: Page,
  accountId: string,
  { calendarId, taskListId }: LiveGoogleResources
): Promise<void> {
  const recovery = await page.evaluate(async ({ calendarId, taskListId, titlePrefix }) => {
    const diagnostics = await window.hcb?.diagnostics.pendingMutations({ limit: 100 });
    if (!diagnostics?.ok) return { errors: [diagnostics?.error?.message ?? "Could not inspect pending mutations."], retried: 0 };

    const errors: string[] = [];
    let retried = 0;
    for (const mutation of diagnostics.data.mutations as Array<{ id?: string; resourceId?: string; resourceType?: string }>) {
      if (!mutation.id || !mutation.resourceId || (mutation.resourceType !== "task" && mutation.resourceType !== "event")) continue;
      const record = mutation.resourceType === "task"
        ? await window.hcb?.tasks.get({ id: mutation.resourceId })
        : await window.hcb?.calendar.get({ id: mutation.resourceId });
      if (!record?.ok) continue;
      const item = record.data as { calendarId?: string; listId?: string; title?: string };
      const isDedicatedRecord = mutation.resourceType === "task"
        ? item.listId === taskListId
        : item.calendarId === calendarId;
      if (!isDedicatedRecord || !item.title?.startsWith(titlePrefix)) continue;

      const retriedMutation = await window.hcb?.diagnostics.retryPendingMutation({ id: mutation.id });
      if (!retriedMutation?.ok) errors.push(retriedMutation?.error?.message ?? `Could not retry marked mutation ${mutation.id}.`);
      else retried += 1;
    }
    return { errors, retried };
  }, { calendarId, taskListId, titlePrefix: liveTestTitlePrefix });
  expect(recovery.errors, "Could not recover interrupted, explicitly marked live-test work.").toEqual([]);
  if (recovery.retried > 0) await syncAccount(page, accountId, false, "recover-marked-live-test-residue");

  // A process interruption after delivery can leave an active record without
  // an outbox row. Recover it too, but only when its title and resource both
  // prove it belongs to this suite's disposable test area.
  await cleanupLiveRecords(page, {
    accountId,
    calendarId,
    taskListId,
    titlePrefix: liveTestTitlePrefix
  });
}

async function requireDedicatedResources(page: Page, accountId: string): Promise<LiveGoogleResources> {
  const resources = await page.evaluate(async ({ accountId, calendarName, taskListName }) => ({
    calendars: await window.hcb?.calendar.listCalendars({ limit: 1_000 }),
    sync: await window.hcb?.sync.status(),
    taskLists: await window.hcb?.tasks.listTaskLists({ limit: 1_000 }),
    accountId,
    calendarName,
    taskListName
  }), {
    accountId,
    calendarName: config.calendarName,
    taskListName: config.taskListName
  });
  const taskLists = requireSuccess(resources.taskLists as HcbResult<{ items: Array<Record<string, unknown>> }>, "Task-list preflight").items;
  const calendars = requireSuccess(resources.calendars as HcbResult<{ items: Array<Record<string, unknown>> }>, "Calendar preflight").items;
  const matchingTaskLists = taskLists.filter((item) => item.accountId === accountId && item.title === config.taskListName);
  const matchingCalendars = calendars.filter((item) => item.accountId === accountId && item.title === config.calendarName);

  expect(matchingTaskLists, `Expected exactly one dedicated task list named ${config.taskListName}.`).toHaveLength(1);
  expect(matchingCalendars, `Expected exactly one dedicated calendar named ${config.calendarName}.`).toHaveLength(1);

  const dedicatedResources = {
    calendarId: String(matchingCalendars[0].id),
    taskListId: String(matchingTaskLists[0].id)
  };
  await recoverMarkedLiveTestResidue(page, accountId, dedicatedResources);
  const syncStatus = requireSuccess(await page.evaluate(async () => window.hcb?.sync.status()) as HcbResult<Record<string, unknown>>, "Mutating preflight status");
  expect(syncStatus.pendingMutationCount ?? 0).toBe(0);
  return dedicatedResources;
}

async function cleanupLiveRecords(
  page: Page,
  {
    accountId,
    calendarId,
    eventId,
    taskId,
    taskListId,
    titlePrefix
  }: {
    accountId: string;
    calendarId: string;
    eventId?: string;
    taskId?: string;
    taskListId: string;
    titlePrefix?: string;
  }
): Promise<void> {
  const cleanup = await page.evaluate(async ({ accountId, calendarId, eventId, taskId, taskListId, titlePrefix }) => {
    const errors: string[] = [];
    const eventIds = new Set<string>(eventId ? [eventId] : []);
    const taskIds = new Set<string>(taskId ? [taskId] : []);

    if (titlePrefix) {
      const [events, tasks] = await Promise.all([
        window.hcb?.calendar.listEvents({ limit: 1_000 }),
        window.hcb?.tasks.list({ limit: 1_000, status: "all" })
      ]);

      if (!events?.ok) {
        errors.push(`list events: ${events?.error?.message ?? "request failed"}`);
      } else {
        for (const event of events.data.items as Array<{ calendarId?: string; id: string; recurringEventId?: string | null; title?: string }>) {
          // Deleting either recurrence master removes its exceptions. Do not
          // subsequently issue an invalid delete for a now-gone instance.
          if (event.calendarId === calendarId && !event.recurringEventId && event.title?.startsWith(titlePrefix)) {
            eventIds.add(event.id);
          }
        }
      }

      if (!tasks?.ok) {
        errors.push(`list tasks: ${tasks?.error?.message ?? "request failed"}`);
      } else {
        for (const task of tasks.data.items as Array<{ id: string; listId?: string; title?: string }>) {
          if (task.listId === taskListId && task.title?.startsWith(titlePrefix)) {
            taskIds.add(task.id);
          }
        }
      }
    }

    for (const id of eventIds) {
      const result = await window.hcb?.calendar.delete({ id });
      if (!result?.ok) errors.push(`event ${id}: ${result?.error?.message ?? "delete failed"}`);
    }
    for (const id of taskIds) {
      const result = await window.hcb?.tasks.delete({ id });
      if (!result?.ok) errors.push(`task ${id}: ${result?.error?.message ?? "delete failed"}`);
    }

    if (errors.length > 0) return { errors };
    const sync = await window.hcb?.sync.runNow({ accountId, reason: "live-google-cleanup" });
    return { errors, sync };
  }, { accountId, calendarId, eventId, taskId, taskListId, titlePrefix });
  expect(cleanup.errors, "Live-test cleanup failed; search the dedicated resources for the HCB live smoke prefix.").toEqual([]);
  const cleanupStatus = requireSuccess(cleanup.sync as HcbResult<Record<string, unknown>>, "Cleanup sync");
  expect(cleanupStatus.pendingMutationCount).toBe(0);

  if (!titlePrefix) {
    return;
  }

  await assertNoRetainedLiveRecords(page, { calendarId, taskListId, titlePrefix });
}

async function assertNoRetainedLiveRecords(
  page: Page,
  { calendarId, taskListId, titlePrefix }: Pick<Parameters<typeof cleanupLiveRecords>[1], "calendarId" | "taskListId" | "titlePrefix">
): Promise<void> {
  if (!titlePrefix) {
    return;
  }

  const retained = await page.evaluate(async ({ calendarId, taskListId, titlePrefix }) => {
    const [events, tasks] = await Promise.all([
      window.hcb?.calendar.listEvents({ limit: 1_000 }),
      window.hcb?.tasks.list({ limit: 1_000, status: "all" })
    ]);
    return {
      events: events?.ok
        ? (events.data.items as Array<{ calendarId?: string; title?: string }>).filter(
          (event) => event.calendarId === calendarId && event.title?.startsWith(titlePrefix)
        )
        : null,
      tasks: tasks?.ok
        ? (tasks.data.items as Array<{ listId?: string; title?: string }>).filter(
          (task) => task.listId === taskListId && task.title?.startsWith(titlePrefix)
        )
        : null
    };
  }, { calendarId, taskListId, titlePrefix });
  expect(retained.events, "A marked live event remained locally after cleanup.").toEqual([]);
  expect(retained.tasks, "A marked live task remained locally after cleanup.").toEqual([]);
}

test.describe.serial("live Google account smoke", () => {
  let accountId = "";
  let app: ElectronApplication | undefined;
  let page: Page;
  let rendererErrors: string[] = [];

  test.beforeAll(async () => {
    app = await electron.launch({
      args: [resolve(__dirname, "../.."), `--user-data-dir=${config.profileDir}`],
      env: {
        ...process.env,
        NODE_ENV: "test",
        HCB_LIVE_GOOGLE_TEST_MODE: config.mode
      }
    });
    liveElectronExit = null;
    liveElectronStderr.length = 0;
    app.process().on("exit", (code, signal) => {
      liveElectronExit = `exit code ${code ?? "none"}${signal ? `, signal ${signal}` : ""}`;
    });
    app.process().stderr?.on("data", (chunk: Buffer) => {
      liveElectronStderr.push(String(chunk).trim());
    });
    page = await app.firstWindow();
    page.on("pageerror", (error) => {
      rendererErrors.push(`page error: ${error.stack ?? error.message}`);
    });
    page.on("console", (message) => {
      if (message.type() === "error") {
        rendererErrors.push(`console error: ${message.text()}`);
      }
    });
    await expect(page.getByTestId("app-shell")).toBeVisible();

    const onboarding = page.getByRole("dialog", { name: "First-run setup" });
    if (await onboarding.isVisible()) {
      throw new Error("The supplied profile has not completed HCB setup. Complete setup outside this suite, then rerun it.");
    }

    const connection = await page.evaluate(async (accountEmail) => {
      const status = await window.hcb?.google.status();
      if (!status?.ok) return { error: status?.error?.message ?? "Google status was unavailable." };
      const accounts = status.data.accounts ?? (status.data.account ? [status.data.account] : []);
      const account = accounts.find((candidate: any) =>
        candidate.connectionState === "connected" && candidate.email?.toLowerCase() === accountEmail
      );
      return account ? { accountId: account.accountId } : { error: `No connected account matched ${accountEmail}.` };
    }, config.accountEmail);

    if (!connection.accountId) throw new Error(connection.error ?? "The expected Google account was not connected.");
    accountId = connection.accountId;
  });

  test.afterAll(async () => {
    await app?.close();
  });

  test("reads Google data and renders the connected account", async () => {
    await syncAccount(page, accountId, true, "read-only");
    const data = await page.evaluate(async () => ({
      calendars: await window.hcb?.calendar.listCalendars({ limit: 1_000 }),
      events: await window.hcb?.calendar.listEvents({ limit: 100 }),
      taskLists: await window.hcb?.tasks.listTaskLists({ limit: 1_000 }),
      tasks: await window.hcb?.tasks.list({ limit: 100, status: "all" })
    }));

    for (const [label, result] of Object.entries(data)) requireSuccess(result as HcbResult, `Read ${label}`);

    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.waitForTimeout(150);
    expect(rendererErrors).toEqual([]);
    const settings = page.getByRole("dialog", { name: "Settings" });
    await expect(settings).toBeVisible();
    await expect(settings).toContainText(config.accountEmail);
    await page.getByRole("button", { name: "Close settings" }).click();

    for (const section of ["Tasks", "Calendar"]) {
      await page.getByRole("button", { name: section, exact: true }).click();
      await expect(page.getByRole("button", { name: section, exact: true })).toBeVisible();
    }
  });

  test("recovers only explicitly marked residue in the dedicated smoke resources", async () => {
    test.skip(config.mode !== "mutating", "Mutating checks require HCB_LIVE_GOOGLE_TEST_MODE=mutating.");

    await requireDedicatedResources(page, accountId);
    expect(rendererErrors).toEqual([]);
  });

  test("creates, updates, and deletes only marked records in dedicated test resources", async () => {
    test.skip(config.mode !== "mutating", "Mutating checks require HCB_LIVE_GOOGLE_TEST_MODE=mutating.");

    const { calendarId, taskListId } = await requireDedicatedResources(page, accountId);
    const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const title = `[HCB live smoke ${runId}]`;
    const startsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000).toISOString();
    const endsAt = new Date(Date.parse(startsAt) + 30 * 60_000).toISOString();
    let taskId: string | undefined;
    let eventId: string | undefined;

    try {
      const created = await page.evaluate(async ({ calendarId, endsAt, startsAt, taskListId, title }) => ({
        event: await window.hcb?.calendar.create({
          allDay: false,
          calendarId,
          description: "Created by HCB's opt-in live Google smoke test. Safe to delete.",
          endsAt,
          startsAt,
          title
        }),
        task: await window.hcb?.tasks.create({
          listId: taskListId,
          notes: "Created by HCB's opt-in live Google smoke test. Safe to delete.",
          title
        })
      }), { calendarId, endsAt, startsAt, taskListId, title });
      if (created.task?.ok) taskId = created.task.data?.id;
      if (created.event?.ok) eventId = created.event.data?.id;
      requireSuccess(created.task as HcbResult<{ id: string }>, "Create live task");
      requireSuccess(created.event as HcbResult<{ id: string }>, "Create live event");
      await syncAccount(page, accountId, false, "create");

      const updated = await page.evaluate(async ({ eventId, taskId, title }) => ({
        event: await window.hcb?.calendar.update({ id: eventId, title: `${title} updated` }),
        task: await window.hcb?.tasks.update({ id: taskId, notes: "Updated by HCB's opt-in live Google smoke test.", title: `${title} updated` })
      }), { eventId, taskId, title });
      expect(requireSuccess(updated.task as HcbResult<{ title: string }>, "Update live task").title).toBe(`${title} updated`);
      expect(requireSuccess(updated.event as HcbResult<{ title: string }>, "Update live event").title).toBe(`${title} updated`);
      await syncAccount(page, accountId, false, "update");
    } finally {
      await cleanupLiveRecords(page, { accountId, calendarId, eventId, taskId, taskListId, titlePrefix: title });
    }
  });

  test("round-trips Google Calendar's complete recurrence line set", async () => {
    test.skip(config.mode !== "mutating", "Mutating checks require HCB_LIVE_GOOGLE_TEST_MODE=mutating.");

    const { calendarId, taskListId } = await requireDedicatedResources(page, accountId);
    const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const title = `[HCB live smoke recurrence ${runId}]`;
    const scheduledStart = new Date(Date.now() + 21 * 24 * 60 * 60 * 1_000);
    scheduledStart.setUTCHours(1, 0, 0, 0);
    const startsAt = scheduledStart.toISOString();
    const endsAt = new Date(Date.parse(startsAt) + 30 * 60_000).toISOString();
    const timeZone = "Asia/Singapore";
    const recurrenceLines = [
      "RRULE:FREQ=DAILY;COUNT=3",
      "EXRULE:FREQ=YEARLY;BYMONTH=12",
      `EXDATE;TZID=${timeZone}:${googleLocalRecurrenceDateTime(new Date(Date.parse(startsAt) + 24 * 60 * 60 * 1_000).toISOString(), timeZone)}`,
      `RDATE;TZID=${timeZone}:${googleLocalRecurrenceDateTime(new Date(Date.parse(startsAt) + 4 * 24 * 60 * 60 * 1_000).toISOString(), timeZone)}`
    ];
    let eventId: string | undefined;

    try {
      const created = await page.evaluate(async ({ calendarId, endsAt, recurrenceLines, startsAt, timeZone, title }) =>
        window.hcb?.calendar.create({ allDay: false, calendarId, endsAt, recurrenceLines, startsAt, timeZone, title }),
      { calendarId, endsAt, recurrenceLines, startsAt, timeZone, title });
      eventId = requireSuccess(created as HcbResult<{ id: string }>, "Create recurrence event").id;
      await syncAccount(page, accountId, false, "recurrence-create");

      const firstPull = requireSuccess(await page.evaluate(async (id) => window.hcb?.calendar.get({ id }), eventId) as HcbResult<Record<string, unknown>>, "Read recurrence event");
      expect([...(firstPull.recurrenceLines as string[])].sort()).toEqual([...recurrenceLines].sort());
      const canonicalRecurrenceLines = firstPull.recurrenceLines as string[];

      requireSuccess(await page.evaluate(async ({ id, title }) => window.hcb?.calendar.update({ id, title }), {
        id: eventId,
        title: `${title} renamed`
      }) as HcbResult, "Rename recurrence event");
      await syncAccount(page, accountId, false, "recurrence-rename");
      const secondPull = requireSuccess(await page.evaluate(async (id) => window.hcb?.calendar.get({ id }), eventId) as HcbResult<Record<string, unknown>>, "Read renamed recurrence event");
      expect(secondPull.recurrenceLines).toEqual(canonicalRecurrenceLines);
    } finally {
      await cleanupLiveRecords(page, { accountId, calendarId, eventId, taskListId, titlePrefix: title });
    }
  });

  test("splits an advanced series and preserves future exceptions in Google", async () => {
    test.skip(config.mode !== "mutating", "Mutating checks require HCB_LIVE_GOOGLE_TEST_MODE=mutating.");

    const { calendarId, taskListId } = await requireDedicatedResources(page, accountId);
    const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const title = `[HCB live smoke recurrence split ${runId}]`;
    const successorTitle = `${title} future`;
    const timeZone = "Asia/Singapore";
    const startDate = new Date(Date.now() + 28 * 24 * 60 * 60 * 1_000);
    startDate.setUTCHours(1, 0, 0, 0);
    const startsAt = startDate.toISOString();
    const endsAt = new Date(Date.parse(startsAt) + 30 * 60_000).toISOString();
    const exdate = new Date(Date.parse(startsAt) + 24 * 60 * 60 * 1_000).toISOString();
    const splitAt = new Date(Date.parse(startsAt) + 3 * 24 * 60 * 60 * 1_000).toISOString();
    const futureExceptionStart = new Date(Date.parse(startsAt) + 4 * 24 * 60 * 60 * 1_000).toISOString();
    const rdate = new Date(Date.parse(startsAt) + 6 * 24 * 60 * 60 * 1_000).toISOString();
    const recurrenceLines = [
      "RRULE:FREQ=DAILY;COUNT=5",
      `EXDATE;TZID=${timeZone}:${googleLocalRecurrenceDateTime(exdate, timeZone)}`,
      `RDATE;TZID=${timeZone}:${googleLocalRecurrenceDateTime(rdate, timeZone)}`
    ];
    let eventId: string | undefined;

    try {
      const created = await page.evaluate(async ({ calendarId, endsAt, recurrenceLines, startsAt, timeZone, title }) =>
        window.hcb?.calendar.create({ allDay: false, calendarId, endsAt, recurrenceLines, startsAt, timeZone, title }),
      { calendarId, endsAt, recurrenceLines, startsAt, timeZone, title });
      eventId = requireSuccess(created as HcbResult<{ id: string }>, "Create advanced recurrence event").id;
      await syncAccount(page, accountId, false, "recurrence-split-create");

      const editedException = requireSuccess(await page.evaluate(async ({ eventId, futureExceptionStart, title }) =>
        window.hcb?.calendar.update({
          id: eventId,
          originalStartAt: futureExceptionStart,
          scope: "occurrence",
          description: "Future exception preserved by HCB live smoke.",
          startsAt: new Date(Date.parse(futureExceptionStart) + 2 * 60 * 60 * 1_000).toISOString(),
          endsAt: new Date(Date.parse(futureExceptionStart) + 150 * 60_000).toISOString(),
          title
        }),
      { eventId, futureExceptionStart, title }) as HcbResult<{ id: string }>, "Edit future recurrence exception");
      expect(editedException.id).toBeTruthy();
      await syncAccount(page, accountId, false, "recurrence-split-exception");

      const successor = requireSuccess(await page.evaluate(async ({ eventId, splitAt, startsAt, endsAt, successorTitle }) =>
        window.hcb?.calendar.update({
          id: eventId,
          originalStartAt: splitAt,
          scope: "following",
          startsAt: splitAt,
          endsAt: new Date(Date.parse(splitAt) + (Date.parse(endsAt) - Date.parse(startsAt))).toISOString(),
          title: successorTitle
        }),
      { eventId, splitAt, startsAt, endsAt, successorTitle }) as HcbResult<{ id: string }>, "Split advanced recurrence series");
      await syncAccount(page, accountId, false, "recurrence-split");

      const records = await page.evaluate(async ({ eventId, successorId, futureExceptionStart }) => ({
        parent: await window.hcb?.calendar.get({ id: eventId }),
        successor: await window.hcb?.calendar.get({ id: successorId }),
        occurrences: await window.hcb?.calendar.listEvents({
          start: futureExceptionStart,
          end: new Date(Date.parse(futureExceptionStart) + 24 * 60 * 60 * 1_000).toISOString(),
          limit: 100
        })
      }), { eventId, successorId: successor.id, futureExceptionStart });
      const parent = requireSuccess(records.parent as HcbResult<Record<string, unknown>>, "Read split parent");
      const splitSuccessor = requireSuccess(records.successor as HcbResult<Record<string, unknown>>, "Read split successor");
      const occurrences = requireSuccess(records.occurrences as HcbResult<{ items: Array<Record<string, unknown>> }>, "Read split occurrences").items;
      const parentLines = parent.recurrenceLines as string[];
      const successorLines = splitSuccessor.recurrenceLines as string[];
      expect(parentLines.some((line) => line.startsWith("RRULE:") && line.includes("UNTIL="))).toBe(true);
      expect(parentLines).toContain(`EXDATE;TZID=${timeZone}:${googleLocalRecurrenceDateTime(exdate, timeZone)}`);
      expect(parentLines.some((line) => line.split(";", 1)[0] === "RDATE")).toBe(false);
      expect(successorLines).toContain(`RDATE;TZID=${timeZone}:${googleLocalRecurrenceDateTime(rdate, timeZone)}`);
      expect(successorLines.some((line) => line.startsWith("RRULE:") && line.includes("COUNT=2"))).toBe(true);
      expect(occurrences).toEqual(expect.arrayContaining([
        expect.objectContaining({ description: "Future exception preserved by HCB live smoke." })
      ]));
    } finally {
      await cleanupLiveRecords(page, { accountId, calendarId, eventId, taskListId, titlePrefix: title });
    }
  });

  test("round-trips supported Calendar and task metadata through a fresh Google pull", async () => {
    test.skip(config.mode !== "mutating", "Mutating checks require HCB_LIVE_GOOGLE_TEST_MODE=mutating.");

    const { calendarId, taskListId } = await requireDedicatedResources(page, accountId);
    const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const title = `[HCB live smoke metadata ${runId}]`;
    const startsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1_000).toISOString();
    const endsAt = new Date(Date.parse(startsAt) + 45 * 60_000).toISOString();
    const recurrenceLines = ["RRULE:FREQ=WEEKLY;COUNT=3;BYDAY=MO,WE"];
    const dueDate = new Date(Date.now() + 15 * 24 * 60 * 60 * 1_000).toISOString().slice(0, 10);
    const planning = {
      durationMinutes: 45,
      lockedSchedule: true,
      plannedEnd: endsAt,
      plannedStart: startsAt,
      priority: "high",
      snoozeUntil: new Date(Date.now() + 13 * 24 * 60 * 60 * 1_000).toISOString(),
      tags: ["live-smoke", "metadata"]
    };
    let eventId: string | undefined;
    let taskId: string | undefined;

    try {
      const created = await page.evaluate(async ({ calendarId, dueDate, endsAt, planning, recurrenceLines, startsAt, taskListId, title, accountEmail }) => ({
        event: await window.hcb?.calendar.create({
          allDay: false,
          attendees: [{ email: accountEmail }],
          calendarId,
          colorId: "9",
          description: "Metadata fidelity event description.",
          endsAt,
          location: "HCB metadata test location",
          recurrenceLines,
          reminders: [{ method: "popup", minutes: 10 }],
          remindersUseDefault: false,
          startsAt,
          timeZone: "Asia/Singapore",
          title,
          transparency: "transparent",
          visibility: "private"
        }),
        task: await window.hcb?.tasks.create({
          dueDate,
          listId: taskListId,
          notes: "Metadata fidelity task note.",
          title,
          ...planning
        })
      }), { calendarId, dueDate, endsAt, planning, recurrenceLines, startsAt, taskListId, title, accountEmail: config.accountEmail });
      eventId = requireSuccess(created.event as HcbResult<{ id: string }>, "Create metadata event").id;
      taskId = requireSuccess(created.task as HcbResult<{ id: string }>, "Create metadata task").id;
      await syncAccount(page, accountId, false, "metadata-create");

      const firstPull = await page.evaluate(async ({ eventId, taskId }) => ({
        event: await window.hcb?.calendar.get({ id: eventId }),
        task: await window.hcb?.tasks.get({ id: taskId })
      }), { eventId, taskId });
      const event = requireSuccess(firstPull.event as HcbResult<Record<string, unknown>>, "Read metadata event after fresh pull");
      const task = requireSuccess(firstPull.task as HcbResult<Record<string, unknown>>, "Read metadata task after fresh pull");
      expect(event).toMatchObject({
        colorId: "9",
        description: "Metadata fidelity event description.",
        location: "HCB metadata test location",
        remindersUseDefault: false,
        timeZone: "Asia/Singapore",
        title,
        transparency: "transparent",
        visibility: "private"
      });
      // Calendar normalises the order of recurrence properties. It must retain
      // the complete set, then HCB must retain Google's canonical returned
      // order through a later unrelated event update.
      expect([...(event.recurrenceLines as string[])].sort()).toEqual([...recurrenceLines].sort());
      const canonicalRecurrenceLines = event.recurrenceLines as string[];
      expect(event.reminders).toEqual(expect.arrayContaining([{ method: "popup", minutes: 10 }]));
      expect((event.attendees as Array<{ email?: string }>).some((attendee) => attendee.email?.toLowerCase() === config.accountEmail)).toBe(true);
      expect(task).toMatchObject({
        dueAt: expect.stringMatching(new RegExp(`^${dueDate}`)),
        notes: "Metadata fidelity task note.",
        title,
        ...planning
      });

      const updatedTitle = `${title} renamed`;
      const updated = await page.evaluate(async ({ eventId, taskId, updatedTitle }) => ({
        event: await window.hcb?.calendar.update({ id: eventId, title: updatedTitle }),
        task: await window.hcb?.tasks.update({ id: taskId, title: updatedTitle })
      }), { eventId, taskId, updatedTitle });
      requireSuccess(updated.event as HcbResult, "Rename metadata event");
      requireSuccess(updated.task as HcbResult, "Rename metadata task");
      await syncAccount(page, accountId, false, "metadata-rename");

      const secondPull = await page.evaluate(async ({ eventId, taskId }) => ({
        event: await window.hcb?.calendar.get({ id: eventId }),
        task: await window.hcb?.tasks.get({ id: taskId })
      }), { eventId, taskId });
      const renamedEvent = requireSuccess(secondPull.event as HcbResult<Record<string, unknown>>, "Read renamed metadata event");
      const renamedTask = requireSuccess(secondPull.task as HcbResult<Record<string, unknown>>, "Read renamed metadata task");
      expect(renamedEvent).toMatchObject({
        colorId: "9",
        description: "Metadata fidelity event description.",
        location: "HCB metadata test location",
        title: updatedTitle,
        transparency: "transparent",
        visibility: "private"
      });
      expect(renamedEvent.recurrenceLines).toEqual(canonicalRecurrenceLines);
      expect(renamedTask).toMatchObject({ notes: "Metadata fidelity task note.", title: updatedTitle, ...planning });
    } finally {
      await cleanupLiveRecords(page, { accountId, calendarId, eventId, taskId, taskListId, titlePrefix: title });
    }
  });

  test("benchmarks three live create, update, sync, and cleanup runs without retaining records", async ({}, testInfo) => {
    test.skip(config.mode !== "mutating", "Mutating checks require HCB_LIVE_GOOGLE_TEST_MODE=mutating.");

    const { calendarId, taskListId } = await requireDedicatedResources(page, accountId);
    const runs: BenchmarkRun[] = [];

    for (let run = 1; run <= 3; run += 1) {
      const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const title = `[HCB live smoke benchmark ${run}-${runId}]`;
      const startsAt = new Date(Date.now() + (7 + run) * 24 * 60 * 60 * 1_000).toISOString();
      const endsAt = new Date(Date.parse(startsAt) + 30 * 60_000).toISOString();
      let taskId: string | undefined;
      let eventId: string | undefined;
      let cleanupLocalMs = 0;
      let cleanupSyncMs = 0;

      try {
        const created = await measure(() => page.evaluate(async ({ calendarId, endsAt, startsAt, taskListId, title }) => ({
          event: await window.hcb?.calendar.create({
            allDay: false,
            calendarId,
            description: "Created by HCB's opt-in live Google benchmark. Safe to delete.",
            endsAt,
            startsAt,
            title
          }),
          task: await window.hcb?.tasks.create({
            listId: taskListId,
            notes: "Created by HCB's opt-in live Google benchmark. Safe to delete.",
            title
          })
        }), { calendarId, endsAt, startsAt, taskListId, title }));
        if (created.value.task?.ok) taskId = created.value.task.data?.id;
        if (created.value.event?.ok) eventId = created.value.event.data?.id;
        requireSuccess(created.value.task as HcbResult<{ id: string }>, `Benchmark ${run} create task`);
        requireSuccess(created.value.event as HcbResult<{ id: string }>, `Benchmark ${run} create event`);

        const createSync = await measure(() => syncAccount(page, accountId, false, `benchmark-${run}-create`));
        const updated = await measure(() => page.evaluate(async ({ eventId, taskId, title }) => ({
          event: await window.hcb?.calendar.update({ id: eventId, title: `${title} updated` }),
          task: await window.hcb?.tasks.update({
            id: taskId,
            notes: "Updated by HCB's opt-in live Google benchmark.",
            title: `${title} updated`
          })
        }), { eventId, taskId, title }));
        expect(requireSuccess(updated.value.task as HcbResult<{ title: string }>, `Benchmark ${run} update task`).title).toBe(`${title} updated`);
        expect(requireSuccess(updated.value.event as HcbResult<{ title: string }>, `Benchmark ${run} update event`).title).toBe(`${title} updated`);
        const updateSync = await measure(() => syncAccount(page, accountId, false, `benchmark-${run}-update`));

        runs.push({
          cleanupLocalMs: 0,
          cleanupSyncMs: 0,
          createLocalMs: created.elapsedMs,
          createSyncMs: createSync.elapsedMs,
          localWriteMs: Math.round((created.elapsedMs + updated.elapsedMs) * 100) / 100,
          run,
          syncMs: Math.round((createSync.elapsedMs + updateSync.elapsedMs) * 100) / 100,
          totalCleanupMs: 0,
          updateLocalMs: updated.elapsedMs,
          updateSyncMs: updateSync.elapsedMs
        });
      } finally {
        const benchmarkRun = runs.find((candidate) => candidate.run === run);
        if (!benchmarkRun) {
          await cleanupLiveRecords(page, { accountId, calendarId, eventId, taskId, taskListId, titlePrefix: title });
        } else {
          const localCleanup = await measure(() => page.evaluate(async ({ eventId, taskId }) => {
            const errors: string[] = [];
            if (eventId) {
              const result = await window.hcb?.calendar.delete({ id: eventId });
              if (!result?.ok) errors.push(`event: ${result?.error?.message ?? "delete failed"}`);
            }
            if (taskId) {
              const result = await window.hcb?.tasks.delete({ id: taskId });
              if (!result?.ok) errors.push(`task: ${result?.error?.message ?? "delete failed"}`);
            }
            return { errors };
          }, { eventId, taskId }));
          cleanupLocalMs = localCleanup.elapsedMs;
          if (localCleanup.value.errors.length > 0) {
            await cleanupLiveRecords(page, { accountId, calendarId, eventId, taskId, taskListId, titlePrefix: title });
            expect(localCleanup.value.errors, `Benchmark ${run} local cleanup failed.`).toEqual([]);
          }

          const syncedCleanup = await measure(() => syncAccount(page, accountId, false, `benchmark-${run}-cleanup`));
          cleanupSyncMs = syncedCleanup.elapsedMs;
          benchmarkRun.cleanupLocalMs = cleanupLocalMs;
          benchmarkRun.cleanupSyncMs = cleanupSyncMs;
          benchmarkRun.totalCleanupMs = Math.round((cleanupLocalMs + cleanupSyncMs) * 100) / 100;
          await assertNoRetainedLiveRecords(page, { calendarId, taskListId, titlePrefix: title });
        }
      }
    }

    const summary = {
      cleanup: benchmarkMetric(runs, "totalCleanupMs"),
      localWrite: benchmarkMetric(runs, "localWriteMs"),
      runs,
      sync: benchmarkMetric(runs, "syncMs")
    };
    await testInfo.attach("live-google-benchmark.json", {
      body: Buffer.from(JSON.stringify(summary, null, 2)),
      contentType: "application/json"
    });
    console.log(`Live Google benchmark (milliseconds): ${JSON.stringify(summary)}`);
    expect(rendererErrors).toEqual([]);
  });

  test("uses Command Palette Quick Add to create and remove an event and task", async () => {
    test.skip(config.mode !== "mutating", "Mutating checks require HCB_LIVE_GOOGLE_TEST_MODE=mutating.");

    const { calendarId, taskListId } = await requireDedicatedResources(page, accountId);
    const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const titlePrefix = `[HCB live smoke quick add ${runId}`;
    const eventTitle = `${titlePrefix} event]`;
    const taskTitle = `${titlePrefix} task]`;
    let eventId: string | undefined;
    let taskId: string | undefined;

    try {
      await page.getByRole("button", { name: "Command palette", exact: true }).click();
      const commandPalette = page.getByRole("dialog", { name: "Command palette" });
      await expect(commandPalette).toBeVisible();
      await commandPalette.locator('[data-action-id="quickAdd.open"]').click();

      const quickAdd = page.getByRole("dialog", { name: "Quick Add" });
      await expect(quickAdd).toBeVisible();
      await quickAdd.getByLabel("Quick add text").fill(`${eventTitle} tomorrow 10:00 AM - 10:30 AM tz Asia/Singapore`);
      await quickAdd.getByLabel("Quick add calendar").selectOption(calendarId);
      await quickAdd.getByRole("button", { name: "Add", exact: true }).click();

      const eventInspector = page.getByTestId("inspector-shell");
      await expect(eventInspector).toBeVisible();
      await expect(eventInspector.getByLabel("Event title")).toHaveValue(eventTitle);
      await expect(eventInspector.getByLabel("Event calendar")).toHaveValue(calendarId);
      await eventInspector.getByRole("button", { name: "Save", exact: true }).click();
      await expect(eventInspector).toBeHidden();

      await expect.poll(async () => page.evaluate(async ({ calendarId, eventTitle }) => {
        const events = await window.hcb?.calendar.listEvents({ limit: 1_000 });
        return events?.ok
          ? (events.data.items as Array<{ calendarId?: string; id: string; title?: string }>).find(
            (event) => event.calendarId === calendarId && event.title === eventTitle
          )?.id ?? null
          : null;
      }, { calendarId, eventTitle }), { timeout: 10_000 }).not.toBeNull();
      eventId = await page.evaluate(async ({ calendarId, eventTitle }) => {
        const events = await window.hcb?.calendar.listEvents({ limit: 1_000 });
        return events?.ok
          ? (events.data.items as Array<{ calendarId?: string; id: string; title?: string }>).find(
            (event) => event.calendarId === calendarId && event.title === eventTitle
          )?.id
          : undefined;
      }, { calendarId, eventTitle });
      await syncAccount(page, accountId, false, "quick-add-event-create");

      await page.getByRole("button", { name: "Command palette", exact: true }).click();
      await page.getByRole("dialog", { name: "Command palette" }).locator('[data-action-id="quickAdd.open"]').click();
      await expect(quickAdd).toBeVisible();
      await quickAdd.getByRole("tab", { name: "Task", exact: true }).click();
      await quickAdd.getByLabel("Quick add text").fill(`${taskTitle} tomorrow`);
      await quickAdd.getByLabel("Quick add task list").selectOption(taskListId);
      await quickAdd.getByRole("button", { name: "Add", exact: true }).click();

      const taskInspector = page.getByTestId("inspector-shell");
      await expect(taskInspector).toBeVisible();
      await expect(taskInspector.getByLabel("Task title")).toHaveValue(taskTitle);
      await expect(taskInspector.getByLabel("Task list")).toHaveValue(taskListId);
      await taskInspector.getByRole("button", { name: "Save", exact: true }).click();

      await expect.poll(async () => page.evaluate(async ({ taskListId, taskTitle }) => {
        const tasks = await window.hcb?.tasks.list({ limit: 1_000, status: "all" });
        return tasks?.ok
          ? (tasks.data.items as Array<{ id: string; listId?: string; title?: string }>).find(
            (task) => task.listId === taskListId && task.title === taskTitle
          )?.id ?? null
          : null;
      }, { taskListId, taskTitle }), { timeout: 10_000 }).not.toBeNull();
      taskId = await page.evaluate(async ({ taskListId, taskTitle }) => {
        const tasks = await window.hcb?.tasks.list({ limit: 1_000, status: "all" });
        return tasks?.ok
          ? (tasks.data.items as Array<{ id: string; listId?: string; title?: string }>).find(
            (task) => task.listId === taskListId && task.title === taskTitle
          )?.id
          : undefined;
      }, { taskListId, taskTitle });
      await expect(taskInspector).toBeHidden();

      await syncAccount(page, accountId, false, "quick-add-create");
      expect(rendererErrors).toEqual([]);
    } finally {
      await cleanupLiveRecords(page, { accountId, calendarId, eventId, taskId, taskListId, titlePrefix });
    }
  });
});
