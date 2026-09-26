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
    throw new Error(`${phase} sync failed: ${diagnostic || "No result returned"}`);
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
  if (recovery.retried === 0) return;

  await syncAccount(page, accountId, false, "recover-marked-live-test-residue");
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
        for (const event of events.data.items as Array<{ calendarId?: string; id: string; title?: string }>) {
          if (event.calendarId === calendarId && event.title?.startsWith(titlePrefix)) {
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
