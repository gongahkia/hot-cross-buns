import { _electron as electron, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const FIXTURE_COUNT = performanceFixtureCount();
const TASK_COUNT = FIXTURE_COUNT;
const EVENT_COUNT = FIXTURE_COUNT;
// Keep generated events in the currently rendered agenda window. That makes
// this exercise both the SQLite pagination path and real Calendar rendering,
// rather than timing an empty calendar after a large write fixture.
const FIXTURE_START_MS = new Date(new Date().toISOString().slice(0, 10) + "T08:00:00.000Z").getTime();
const artifactDir = join(process.cwd(), "artifacts", "perf");
const profileDir = mkdtempSync(join(tmpdir(), "hcb-perf-"));
const debugPerformanceRun = process.env.HCB_PERF_DEBUG === "1";

interface Measurement {
  name: string;
  durationMs: number;
  itemCount?: number;
}

interface PerfReport {
  generatedAt: string;
  status: "passed";
  fixture: { tasks: number; events: number };
  measurements: Measurement[];
}

function performanceFixtureCount(): number {
  const configured = process.env.HCB_PERF_COUNT;
  if (configured === undefined) return 1_000;
  const count = Number(configured);
  if (!Number.isInteger(count) || count < 1 || count > 50_000) {
    throw new Error("HCB_PERF_COUNT must be an integer between 1 and 50,000.");
  }
  return count;
}

function eventTime(index: number): { startsAt: string; endsAt: string } {
  return {
    startsAt: new Date(FIXTURE_START_MS + index * 60_000).toISOString(),
    endsAt: new Date(FIXTURE_START_MS + (index + 30) * 60_000).toISOString()
  };
}

function fixtureRange(): { start: string; end: string } {
  return {
    start: new Date(FIXTURE_START_MS - 60 * 60_000).toISOString(),
    end: new Date(FIXTURE_START_MS + (EVENT_COUNT + 60) * 60_000).toISOString()
  };
}

function elapsed(startedAt: number): number {
  return Math.round((performance.now() - startedAt) * 100) / 100;
}

async function measure<T>(
  measurements: Measurement[], name: string, action: () => Promise<T>, itemCount?: number
): Promise<T> {
  const startedAt = performance.now();
  const result = await action();
  measurements.push({ name, durationMs: elapsed(startedAt), ...(itemCount === undefined ? {} : { itemCount }) });
  return result;
}

async function requireSuccess<T extends { ok: boolean; data?: unknown; error?: { message?: string } }>(
  result: T | undefined, label: string
): Promise<T & { ok: true; data: NonNullable<T["data"]> }> {
  if (!result?.ok) throw new Error(`${label} failed: ${result?.error?.message ?? "No result returned"}`);
  return result as T & { ok: true; data: NonNullable<T["data"]> };
}

async function finishOnboarding(page: Page): Promise<void> {
  const onboarding = page.getByRole("dialog", { name: "First-run setup" });
  await onboarding.waitFor({ state: "visible" });
  const finishSetup = page.getByRole("button", { name: "Finish setup" });
  await finishSetup.click();
  await onboarding.waitFor({ state: "hidden" });
}

async function run(): Promise<void> {
  let app: ElectronApplication | undefined;
  const measurements: Measurement[] = [];

  try {
    app = await electron.launch({
      args: [resolve(process.cwd()), `--user-data-dir=${profileDir}`],
      env: { ...process.env, NODE_ENV: "test" }
    });
    if (debugPerformanceRun) {
      app.process().stderr?.on("data", (chunk: Buffer) => process.stderr.write(chunk));
    }
    const page = await app.firstWindow();
    if (debugPerformanceRun) {
      page.on("close", () => console.error("Performance renderer closed."));
      page.on("crash", () => console.error("Performance renderer crashed."));
      page.on("pageerror", (error) => console.error(`Performance renderer error: ${error.message}`));
    }
    await page.getByTestId("app-shell").waitFor({ state: "visible" });
    await finishOnboarding(page);

    await measure(measurements, "create-local-tasks", async () => {
      for (let index = 0; index < TASK_COUNT; index += 1) {
        const result = await page.evaluate(async ({ index }) => window.hcb?.tasks.create({
          listId: "inbox",
          title: `Performance task ${index.toString().padStart(4, "0")}`,
          notes: "Deterministic local performance fixture."
        }), { index });
        await requireSuccess(result, `Create task ${index}`);
      }
    }, TASK_COUNT);

    await measure(measurements, "create-local-events", async () => {
      for (let index = 0; index < EVENT_COUNT; index += 1) {
        const { startsAt, endsAt } = eventTime(index);
        const result = await page.evaluate(async ({ index, startsAt, endsAt }) => window.hcb?.calendar.create({
          calendarId: "primary",
          title: `Performance event ${index.toString().padStart(4, "0")}`,
          startsAt,
          endsAt,
          allDay: false
        }), { index, startsAt, endsAt });
        await requireSuccess(result, `Create event ${index}`);
      }
    }, EVENT_COUNT);

    await measure(measurements, `task-list-pagination-${TASK_COUNT}-tasks`, async () => {
      let cursor: string | undefined;
      let taskCount = 0;
      do {
        const result = await requireSuccess(await page.evaluate(async (request) =>
          window.hcb?.tasks.list(request), {
          status: "all",
          limit: 1_000,
          ...(cursor ? { cursor } : {})
        }), "Task list page");
        const response = result.data as { items?: unknown[]; page?: { nextCursor?: string } };
        taskCount += response.items?.length ?? 0;
        cursor = response.page?.nextCursor;
      } while (cursor);
      if (taskCount !== TASK_COUNT) {
        throw new Error(`Task pagination returned ${taskCount} tasks; expected ${TASK_COUNT}.`);
      }
    }, TASK_COUNT);

    const search = await measure(measurements, `fts-search-${TASK_COUNT}-tasks`, async () =>
      requireSuccess(await page.evaluate(async () => window.hcb?.search.query({
        query: "Performance task", limit: 100
      })), "FTS query"));
    const searchData = search.data as { items?: unknown[] };
    if ((searchData.items?.length ?? 0) === 0) throw new Error("FTS returned no generated tasks.");

    await measure(measurements, `calendar-range-pagination-${EVENT_COUNT}-events`, async () => {
      const range = fixtureRange();
      let cursor: string | undefined;
      let eventCount = 0;
      do {
        const result = await requireSuccess(await page.evaluate(async (request) =>
          window.hcb?.calendar.listEvents(request), { ...range, limit: 1_000, ...(cursor ? { cursor } : {}) }), "Calendar range page");
        const response = result.data as { items?: unknown[]; page?: { nextCursor?: string } };
        eventCount += response.items?.length ?? 0;
        cursor = response.page?.nextCursor;
      } while (cursor);
      if (eventCount !== EVENT_COUNT) {
        throw new Error(`Calendar pagination returned ${eventCount} events; expected ${EVENT_COUNT}.`);
      }
    }, EVENT_COUNT);

    await measure(measurements, `renderer-cold-hydration-${TASK_COUNT}-tasks-${EVENT_COUNT}-events`, async () => {
      await page.reload();
      await page.getByTestId("app-shell").waitFor({ state: "visible" });
      await page.getByRole("button", { name: "Tasks", exact: true }).click();
      await page.getByText("Performance task 0000", { exact: true }).waitFor({ state: "visible" });
    }, TASK_COUNT + EVENT_COUNT);

    await measure(measurements, `renderer-calendar-agenda-${EVENT_COUNT}-events`, async () => {
      await page.getByRole("button", { name: "Calendar", exact: true }).click();
      await page.getByText("Performance event 0000", { exact: true }).waitFor({ state: "visible" });
    }, EVENT_COUNT);

    const report: PerfReport = {
      generatedAt: new Date().toISOString(),
      status: "passed",
      fixture: { tasks: TASK_COUNT, events: EVENT_COUNT },
      measurements
    };
    writeReport(report);
    console.table(measurements);
  } finally {
    await app?.close();
    rmSync(profileDir, { recursive: true, force: true });
  }
}

function writeReport(report: PerfReport): void {
  mkdirSync(artifactDir, { recursive: true });
  writeFileSync(join(artifactDir, "latest.json"), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(
    join(artifactDir, "latest.md"),
    [
      "# HCB Electron Performance Smoke",
      "",
      `Generated: ${report.generatedAt}`,
      "",
      `Fixture: ${report.fixture.tasks} local tasks and ${report.fixture.events} local calendar events.`,
      "",
      "| Measurement | Duration | Items |",
      "| --- | ---: | ---: |",
      ...report.measurements.map((item) => `| ${item.name} | ${item.durationMs.toFixed(2)} ms | ${item.itemCount ?? "—"} |`)
    ].join("\n")
  );
}

void run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
