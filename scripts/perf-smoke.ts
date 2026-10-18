import { _electron as electron, expect, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  resources: ResourceSample[];
}

interface ResourceSample { phase: string; pssMiB: number | null; processCount: number; renderedTaskRows: number }

function percentile(values: number[], fraction: number): number {
  if (!values.length) throw new Error("No latency samples were recorded.");
  const sorted = [...values].sort((left, right) => left - right);
  return Math.round(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)] * 100) / 100;
}

async function sampleResources(app: ElectronApplication, page: Page, phase: string): Promise<ResourceSample> {
  const processes = await app.evaluate(({ app }) => app.getAppMetrics().map((metric) => metric.pid));
  let pssKiB = 0;
  let measured = 0;
  if (process.platform === "linux") for (const pid of processes) {
    try {
      const pss = readFileSync(`/proc/${pid}/smaps_rollup`, "utf8").match(/^Pss:\s+(\d+)/m);
      if (pss) { pssKiB += Number(pss[1]); measured += 1; }
    } catch { /* A short-lived utility may have exited between sampling and read. */ }
  }
  return { phase, pssMiB: measured === processes.length ? Math.round(pssKiB / 1024 * 10) / 10 : null, processCount: processes.length, renderedTaskRows: await page.getByTestId("tasks-board").getByRole("listitem").count() };
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
  const onboarding = page.getByRole("dialog", { name: "Hot Cross Buns" });
  await onboarding.waitFor({ state: "visible" });
  // These fixtures use isolated local data and never authorize a Google account.
  await requireSuccess(await page.evaluate(() => window.hcb?.settings.update({ onboardingStatus: "skipped", syncMode: "manual" })), "Prepare local fixture");
  await page.evaluate(() => window.dispatchEvent(new Event("hcb:core-data-invalidated")));
  await onboarding.waitFor({ state: "hidden" });
}

async function run(): Promise<void> {
  let app: ElectronApplication | undefined;
  const measurements: Measurement[] = [];
  const resources: ResourceSample[] = [];

  try {
    const launchStartedAt = performance.now();
    app = await electron.launch({
      args: [resolve(process.cwd()), `--user-data-dir=${profileDir}`, ...(process.env.HCB_PERF_HEAP_MB ? [`--js-flags=--max-old-space-size=${Number(process.env.HCB_PERF_HEAP_MB) || 128}`] : [])],
      env: { ...process.env, HCB_TEST_DATABASE_ROOT: profileDir, NODE_ENV: "test" }
    });
    if (debugPerformanceRun) {
      app.process().stderr?.on("data", (chunk: Buffer) => process.stderr.write(chunk));
    }
    const page = await app.firstWindow();
    page.setDefaultTimeout(60_000);
    if (debugPerformanceRun) {
      page.on("close", () => console.error("Performance renderer closed."));
      page.on("crash", () => console.error("Performance renderer crashed."));
      page.on("pageerror", (error) => console.error(`Performance renderer error: ${error.message}`));
    }
    await page.getByTestId("app-shell").waitFor({ state: "visible" });
    measurements.push({ name: "cold-shell-visible", durationMs: elapsed(launchStartedAt) });
    await finishOnboarding(page);
    await page.getByTestId("calendar-view").waitFor({ state: "visible" });
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    resources.push(await sampleResources(app, page, "idle"));

    await page.evaluate(() => {
      const samples: number[] = [];
      let inFlight = false;
      const timer = window.setInterval(async () => {
        if (inFlight) return;
        inFlight = true;
        const started = performance.now();
        try {
          const result = await window.hcb!.diagnostics.health({});
          if (!result.ok) throw new Error(result.error.message);
          samples.push(performance.now() - started);
        } finally { inFlight = false; }
      }, 20);
      (window as any).__hcbPerfHealth = { samples, timer };
    });

    await measure(measurements, "create-local-tasks", async () => {
      for (let start = 0; start < TASK_COUNT; start += 100) {
        await page.evaluate(async ({ start, end }) => {
          for (let index = start; index < end; index += 1) {
            const result = await window.hcb!.tasks.create({ listId: "inbox", title: `Performance task ${index.toString().padStart(4, "0")}`, notes: "Deterministic local performance fixture." });
            if (!result.ok) throw new Error(result.error.message);
          }
        }, { start, end: Math.min(start + 100, TASK_COUNT) });
      }
    }, TASK_COUNT);

    await measure(measurements, "create-local-events", async () => {
      for (let start = 0; start < EVENT_COUNT; start += 100) {
        await page.evaluate(async ({ start, end, fixtureStart }) => {
          for (let index = start; index < end; index += 1) {
            const result = await window.hcb!.calendar.create({ calendarId: "primary", title: `Performance event ${index.toString().padStart(4, "0")}`, startsAt: new Date(fixtureStart + index * 60_000).toISOString(), endsAt: new Date(fixtureStart + (index + 30) * 60_000).toISOString(), allDay: false });
            if (!result.ok) throw new Error(result.error.message);
          }
        }, { start, end: Math.min(start + 100, EVENT_COUNT), fixtureStart: FIXTURE_START_MS });
      }
    }, EVENT_COUNT);

    const healthSamples = await page.evaluate(() => {
      const monitor = (window as any).__hcbPerfHealth as { samples: number[]; timer: number };
      window.clearInterval(monitor.timer);
      return monitor.samples;
    });
    measurements.push({ name: "main-ipc-during-writes-p95", durationMs: percentile(healthSamples, 0.95), itemCount: healthSamples.length });

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
      await page.evaluate(() => window.dispatchEvent(new Event("hcb:core-data-invalidated")));
      await page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: /^Tasks/ }).click();
      await expect(page.getByTestId("tasks-board")).toHaveAttribute("data-task-count", String(TASK_COUNT), { timeout: 60_000 });
      await expect(page.getByTestId("tasks-board")).toHaveAttribute("data-hydration-state", "success", { timeout: 60_000 });
      await page.getByRole("button", { name: "Performance task 0000", exact: true }).waitFor({ state: "visible" });
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    }, TASK_COUNT + EVENT_COUNT);

    const taskViewport = page.getByRole("list", { name: "Inbox tasks", exact: true });
    const renderedRows = await taskViewport.getByRole("listitem").count();
    if (renderedRows > 100) throw new Error(`Tasks rendered ${renderedRows} rows; the DOM should stay bounded by the viewport.`);
    resources.push(await sampleResources(app, page, "tasks-hydrated"));
    await measure(measurements, "tasks-scroll-to-end", async () => {
      await taskViewport.evaluate((element) => { element.scrollTop = element.scrollHeight; });
      await page.getByRole("button", { name: `Performance task ${(TASK_COUNT - 1).toString().padStart(4, "0")}`, exact: true }).waitFor({ state: "visible" });
    }, TASK_COUNT);

    await page.getByRole("button", { name: "New task", exact: true }).click();
    const title = page.getByRole("textbox", { name: "Task title", exact: true });
    await title.waitFor({ state: "visible" });
    await title.focus();
    const typingSamples: number[] = [];
    for (const character of "Keep planning responsive") {
      const started = performance.now();
      await page.keyboard.type(character);
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      typingSamples.push(performance.now() - started);
    }
    measurements.push({ name: "task-title-input-to-paint-p95", durationMs: percentile(typingSamples, 0.95), itemCount: typingSamples.length });
    await title.fill("");
    await page.getByRole("button", { name: "Close inspector", exact: true }).click();

    await measure(measurements, `renderer-calendar-agenda-${EVENT_COUNT}-events`, async () => {
      await page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: /^Calendar/ }).click();
      await page.getByText("Performance event 0000", { exact: true }).first().waitFor({ state: "visible" });
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    }, EVENT_COUNT);

    const report: PerfReport = {
      generatedAt: new Date().toISOString(),
      status: "passed",
      fixture: { tasks: TASK_COUNT, events: EVENT_COUNT },
      measurements,
      resources
    };
    writeReport(report);
    console.table(measurements);
    console.table(resources);
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
  mkdirSync(artifactDir, { recursive: true });
  writeFileSync(join(artifactDir, "latest-failure.txt"), `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  console.error(error);
  process.exitCode = 1;
});
