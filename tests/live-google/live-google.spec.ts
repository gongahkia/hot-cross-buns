import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { existsSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

const mutationAcknowledgement = "I_UNDERSTAND_HCB_LIVE_TEST_WRITES_AND_DELETES";

type LiveGoogleTestMode = "read-only" | "mutating";
type HcbResult<T = any> = { ok: boolean; data?: T; error?: { message?: string } };

interface LiveGoogleConfig {
  accountEmail: string;
  calendarName?: string;
  mode: LiveGoogleTestMode;
  profileDir: string;
  taskListName?: string;
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

async function syncAccount(page: Page, accountId: string, readOnly: boolean, phase: string): Promise<Record<string, unknown>> {
  const result = await page.evaluate(async ({ accountId, phase, readOnly }) =>
    window.hcb?.sync.runNow({ accountId, readOnly, reason: `live-google-${phase}` }), { accountId, phase, readOnly });
  const status = requireSuccess(result, `${phase} sync`) as Record<string, unknown>;
  expect(status.state).toBe("idle");
  if (!readOnly) expect(status.pendingMutationCount).toBe(0);
  return status;
}

test.describe.serial("live Google account smoke", () => {
  let accountId = "";
  let app: ElectronApplication | undefined;
  let page: Page;

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
    const syncStatus = requireSuccess(resources.sync as HcbResult<Record<string, unknown>>, "Mutating preflight status");
    expect(syncStatus.pendingMutationCount ?? 0).toBe(0);
    const taskLists = requireSuccess(resources.taskLists as HcbResult<{ items: Array<Record<string, unknown>> }>, "Task-list preflight").items;
    const calendars = requireSuccess(resources.calendars as HcbResult<{ items: Array<Record<string, unknown>> }>, "Calendar preflight").items;
    const matchingTaskLists = taskLists.filter((item) => item.accountId === accountId && item.title === config.taskListName);
    const matchingCalendars = calendars.filter((item) => item.accountId === accountId && item.title === config.calendarName);

    expect(matchingTaskLists, `Expected exactly one dedicated task list named ${config.taskListName}.`).toHaveLength(1);
    expect(matchingCalendars, `Expected exactly one dedicated calendar named ${config.calendarName}.`).toHaveLength(1);

    const taskListId = String(matchingTaskLists[0].id);
    const calendarId = String(matchingCalendars[0].id);
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
      const task = requireSuccess(created.task as HcbResult<{ id: string }>, "Create live task");
      const event = requireSuccess(created.event as HcbResult<{ id: string }>, "Create live event");
      taskId = task.id;
      eventId = event.id;
      await syncAccount(page, accountId, false, "create");

      const updated = await page.evaluate(async ({ eventId, taskId, title }) => ({
        event: await window.hcb?.calendar.update({ id: eventId, title: `${title} updated` }),
        task: await window.hcb?.tasks.update({ id: taskId, notes: "Updated by HCB's opt-in live Google smoke test.", title: `${title} updated` })
      }), { eventId, taskId, title });
      expect(requireSuccess(updated.task as HcbResult<{ title: string }>, "Update live task").title).toBe(`${title} updated`);
      expect(requireSuccess(updated.event as HcbResult<{ title: string }>, "Update live event").title).toBe(`${title} updated`);
      await syncAccount(page, accountId, false, "update");
    } finally {
      const cleanup = await page.evaluate(async ({ accountId, eventId, taskId }) => {
        const errors: string[] = [];
        if (eventId) {
          const result = await window.hcb?.calendar.delete({ id: eventId });
          if (!result?.ok) errors.push(`event: ${result?.error?.message ?? "delete failed"}`);
        }
        if (taskId) {
          const result = await window.hcb?.tasks.delete({ id: taskId });
          if (!result?.ok) errors.push(`task: ${result?.error?.message ?? "delete failed"}`);
        }
        if (errors.length > 0) return { errors };
        const sync = await window.hcb?.sync.runNow({ accountId, reason: "live-google-cleanup" });
        return { errors, sync };
      }, { accountId, eventId, taskId });
      expect(cleanup.errors, "Live-test cleanup failed; search the dedicated resources for the HCB live smoke prefix.").toEqual([]);
      const cleanupStatus = requireSuccess(cleanup.sync as HcbResult<Record<string, unknown>>, "Cleanup sync");
      expect(cleanupStatus.pendingMutationCount).toBe(0);
    }
  });
});
