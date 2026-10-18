import { _electron as electron, expect, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { cpus, freemem, loadavg, release, tmpdir, totalmem } from "node:os";
import { join, resolve } from "node:path";
import { currentZonedDay, zonedDateTimeIso, zonedDayRange } from "../src/shared/zonedTime";
import { evaluatePerformanceBudgets, type BudgetResult } from "./performanceBudgets";

const FIXTURE_COUNT = performanceFixtureCount();
const TASK_COUNT = FIXTURE_COUNT;
const EVENT_COUNT = FIXTURE_COUNT;
const NOTE_COUNT = FIXTURE_COUNT;
const heapLimitMiB = performanceHeapLimit();
// Keep generated events in the currently rendered agenda window. That makes
// this exercise both the SQLite pagination path and real Calendar rendering,
// rather than timing an empty calendar after a large write fixture.
let fixtureStartMs = 0;
let fixtureDay = "";
let fixtureTimeZone = "UTC";
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
  status: "passed" | "failed";
  fixture: { tasks: number; events: number; notes: number; timeZone: string; day: string };
  environment: { platform: string; arch: string; node: string; osRelease: string; cpu: string; logicalCpus: number; totalMemoryMiB: number; freeMemoryAtStartMiB: number; loadAtStart: number[]; loadAtEnd: number[]; requestedHeapMiB: number | null; actualRendererHeapLimitMiB: number };
  measurements: Measurement[];
  resources: ResourceSample[];
  budgets: BudgetResult[];
  noteServiceTimings: Array<{ name: string; durationMs: number }>;
  latencySamples: { inputToPaintMs: number[]; scrollFrameMs: number[]; mainIpcMs: number[] };
  inputLongTasks: Array<{ startTimeMs: number; durationMs: number }>;
}

interface ResourceSample { phase: string; pssMiB: number | null; processCount: number; renderedTaskRows: number; rendererHeapMiB: number | null; processes: Array<{ type: string; pssMiB: number }> }

function percentile(values: number[], fraction: number): number {
  if (!values.length) throw new Error("No latency samples were recorded.");
  const sorted = [...values].sort((left, right) => left - right);
  return Math.round(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)] * 100) / 100;
}

async function sampleResources(app: ElectronApplication, page: Page, phase: string): Promise<ResourceSample> {
  const processes = await app.evaluate(({ app }) => app.getAppMetrics().map((metric) => ({ pid: metric.pid, type: metric.type })));
  let pssKiB = 0;
  const samples: Array<{ type: string; pssMiB: number }> = [];
  if (process.platform === "linux") for (const process of processes) {
    try {
      const pss = readFileSync(`/proc/${process.pid}/smaps_rollup`, "utf8").match(/^Pss:\s+(\d+)/m);
      if (pss) { pssKiB += Number(pss[1]); samples.push({ type: process.type, pssMiB: Math.round(Number(pss[1]) / 1024 * 10) / 10 }); }
    } catch { /* A utility may exit between sampling and reading. */ }
  }
  const session = await page.context().newCDPSession(page);
  await session.send("Performance.enable");
  const metrics = await session.send("Performance.getMetrics");
  const usedHeap = metrics.metrics.find((metric) => metric.name === "JSHeapUsedSize")?.value;
  await session.detach();
  const rendererHeapMiB = usedHeap === undefined ? null : Math.round(usedHeap / 104857.6) / 10;
  return { phase, pssMiB: samples.length === processes.length ? Math.round(pssKiB / 1024 * 10) / 10 : null, processCount: processes.length, renderedTaskRows: await page.getByTestId("tasks-board").getByRole("listitem").count(), rendererHeapMiB, processes: samples };
}

async function frameSamples(page: Page): Promise<number[]> {
  return page.evaluate(async () => {
    const samples: number[] = [];
    let previous = performance.now();
    for (let index = 0; index < 60; index += 1) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const now = performance.now(); samples.push(now - previous); previous = now;
    }
    return samples.slice(1);
  });
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

function performanceHeapLimit(): number | null {
  const configured = process.env.HCB_PERF_HEAP_MB;
  if (configured === undefined) return null;
  const limit = Number(configured);
  if (!Number.isInteger(limit) || limit < 64 || limit > 4096) throw new Error("HCB_PERF_HEAP_MB must be an integer between 64 and 4,096.");
  return limit;
}

function fixtureRange(): { start: string; end: string } {
  return {
    start: new Date(fixtureStartMs - 60 * 60_000).toISOString(),
    end: new Date(fixtureStartMs + (EVENT_COUNT + 60) * 60_000).toISOString()
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

/** Time the click handler through real content and paint inside Chromium.
 * Playwright assertion backoff (100/250/500 ms) otherwise quantizes this
 * measurement and can report ~900 ms for content that rendered much sooner.
 */
async function measureRenderedNavigation(measurements: Measurement[], page: Page, section: "Notes" | "Tasks", count: number, refresh = false): Promise<void> {
  const durationMs = await page.evaluate(async ({ section, count, refresh }) => {
    const navigation = document.querySelector('nav[aria-label="Primary"]');
    const button = [...navigation!.querySelectorAll("button")].find((button) => button.textContent?.trim().startsWith(section))!;
    const startedAt = performance.now();
    await new Promise<void>((resolve, reject) => {
      const observer = new MutationObserver(() => {
        const viewport = section === "Notes"
          ? document.querySelector('[role="list"][aria-label="Notes"]') as HTMLElement | null
          : document.querySelector('[data-testid="tasks-board"]') as HTMLElement | null;
        const total = section === "Notes" ? viewport?.dataset.totalCount : viewport?.dataset.taskCount;
        const content = section === "Notes"
          ? viewport?.querySelector(`button[aria-label="Open note Performance note ${String(count - 1).padStart(4, "0")}"]`)
          : [...(viewport?.querySelectorAll("button[data-virtual-focus]") ?? [])].find((button) => button.textContent?.trim() === "Performance task 0000");
        if (total === String(count) && (!refresh || viewport?.dataset.hydrationState === "success") && content?.getClientRects().length) {
          observer.disconnect(); window.clearTimeout(timer); resolve();
        }
      });
      const timer = window.setTimeout(() => { observer.disconnect(); reject(new Error(`${section} did not render its fixture.`)); }, 60000);
      observer.observe(document.body, { subtree: true, childList: true, attributes: true });
      if (refresh) window.dispatchEvent(new Event("hcb:core-data-invalidated"));
      button.click();
    });
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    return Math.round((performance.now() - startedAt) * 100) / 100;
  }, { section, count, refresh });
  measurements.push({ name: refresh ? `renderer-cold-hydration-${TASK_COUNT}-tasks-${EVENT_COUNT}-events` : section === "Notes" ? `renderer-notes-${count}-notes` : "renderer-tasks-warm-navigation", durationMs, itemCount: refresh ? TASK_COUNT + EVENT_COUNT : count });
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
  const loadAtStart = loadavg();
  const freeMemoryAtStartMiB = Math.round(freemem() / 1048576);

  try {
    const launchStartedAt = performance.now();
    app = await electron.launch({
      args: [resolve(process.cwd()), `--user-data-dir=${profileDir}`, ...(heapLimitMiB === null ? [] : [`--js-flags=--max-old-space-size=${heapLimitMiB}`])],
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
    const settings = await requireSuccess(await page.evaluate(() => window.hcb!.settings.get()), "Fixture settings");
    fixtureTimeZone = (settings.data as { defaultTimeZone: string }).defaultTimeZone;
    fixtureDay = currentZonedDay(fixtureTimeZone);
    fixtureStartMs = Date.parse(zonedDateTimeIso(fixtureDay, 8, 0, fixtureTimeZone));
    const actualRendererHeapLimitMiB = await page.evaluate(() => Math.round((performance as Performance & { memory: { jsHeapSizeLimit: number } }).memory.jsHeapSizeLimit / 1048576));
    if (heapLimitMiB !== null && actualRendererHeapLimitMiB > heapLimitMiB + 64) throw new Error(`Renderer ignored the requested heap limit: ${actualRendererHeapLimitMiB} MiB.`);
    await page.getByTestId("calendar-view").waitFor({ state: "visible" });
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    resources.push(await sampleResources(app, page, "idle"));
    const idleFrames = await frameSamples(page);
    measurements.push({ name: "idle-frame-p95", durationMs: percentile(idleFrames, 0.95), itemCount: idleFrames.length });
    const metrics = await page.context().newCDPSession(page);
    await metrics.send("Performance.enable");


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
          if (samples.length > 10000) samples.shift();
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
        }, { start, end: Math.min(start + 100, EVENT_COUNT), fixtureStart: fixtureStartMs });
      }
    }, EVENT_COUNT);

    await measure(measurements, "create-local-notes", async () => {
      for (let start = 0; start < NOTE_COUNT; start += 100) {
        await page.evaluate(async ({ start, end }) => {
          for (let index = start; index < end; index += 1) {
            const result = await window.hcb!.notes.create({ title: `Performance note ${index.toString().padStart(4, "0")}`, body: "Full note content retained in SQLite, not in the list. ".repeat(80) });
            if (!result.ok) throw new Error(result.error.message);
          }
        }, { start, end: Math.min(start + 100, NOTE_COUNT) });
      }
    }, NOTE_COUNT);

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

    const ordering = await page.evaluate(async (count) => {
      const board = await window.hcb!.tasks.board({ listId: "inbox", limit: 1, cursor: String(count - 1) });
      if (!board.ok || !board.data.items[0]?.task) throw new Error("Last task could not be read for ordering measurement.");
      const id = board.data.items[0].task.id;
      const context = await window.hcb!.tasks.context({ id });
      if (!context.ok) throw new Error(context.error.message);
      return { id, listId: "inbox", parentId: null, previousSiblingId: context.data.previousId };
    }, TASK_COUNT);
    await measure(measurements, "task-reorder-initialize", async () => requireSuccess(await page.evaluate(async (request) => window.hcb!.tasks.move(request), ordering), "Initialize task ordering"));
    await measure(measurements, "task-reorder-warm", async () => requireSuccess(await page.evaluate(async (request) => window.hcb!.tasks.move(request), ordering), "Reorder task"));

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

    await measure(measurements, "automation-cold-hydration-and-validation", async () => {
      await measureRenderedNavigation(measurements, page, "Tasks", TASK_COUNT, true);
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

    const beforeScrollMetrics = await metrics.send("Performance.getMetrics");
    const scrollFrames = await taskViewport.evaluate(async (element) => {
      const samples: number[] = [];
      let previous = performance.now();
      for (let index = 1; index <= 120; index += 1) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        const now = performance.now(); samples.push(now - previous); previous = now;
        element.scrollTop = (element.scrollHeight - element.clientHeight) * (index / 120);
      }
      return samples.slice(1);
    });
    const afterScrollMetrics = await metrics.send("Performance.getMetrics");
    for (const name of ["ScriptDuration", "LayoutDuration", "RecalcStyleDuration", "TaskDuration"]) {
      const before = beforeScrollMetrics.metrics.find((metric) => metric.name === name)?.value ?? 0;
      const after = afterScrollMetrics.metrics.find((metric) => metric.name === name)?.value ?? 0;
      measurements.push({ name: `tasks-scroll-${name}`, durationMs: Math.round((after - before) * 1000 * 100) / 100 });
    }
    measurements.push({ name: "tasks-scroll-frame-p95", durationMs: percentile(scrollFrames, 0.95), itemCount: scrollFrames.length });
    if (Number(await page.getByTestId("tasks-board").getAttribute("data-cached-task-count")) > 100) throw new Error("Task lookup summaries exceeded their bound.");
    if (Number(await taskViewport.getAttribute("data-loaded-count")) > 600) throw new Error("Task page cache exceeded its bound.");
    await page.getByRole("button", { name: "New task", exact: true }).click();
    const title = page.getByRole("textbox", { name: "Task title", exact: true });
    await title.waitFor({ state: "visible" });
    await title.focus();
    const beforeInputMetrics = await metrics.send("Performance.getMetrics");
    await title.evaluate((element) => {
      (window as any).__hcbPerfInput = [];
      (window as any).__hcbPerfInputLongTasks = [];
      const observer = new PerformanceObserver((list) => (window as any).__hcbPerfInputLongTasks.push(...list.getEntries().map((entry) => ({ startTimeMs: entry.startTime, durationMs: entry.duration }))));
      observer.observe({ type: "longtask" });
      (window as any).__hcbPerfInputObserver = observer;
      element.addEventListener("input", () => {
        const started = performance.now();
        requestAnimationFrame(() => requestAnimationFrame(() => (window as any).__hcbPerfInput.push(performance.now() - started)));
      }, { capture: true });
    });
    for (const character of "Keep planning responsive") {
      await page.keyboard.type(character);
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    }
    const typingSamples = await page.evaluate(() => (window as any).__hcbPerfInput as number[]);
    const inputLongTasks = await page.evaluate(() => {
      (window as any).__hcbPerfInputObserver.disconnect();
      return (window as any).__hcbPerfInputLongTasks as Array<{ startTimeMs: number; durationMs: number }>;
    });
    const afterInputMetrics = await metrics.send("Performance.getMetrics");
    for (const name of ["ScriptDuration", "LayoutDuration", "RecalcStyleDuration", "TaskDuration"]) {
      const before = beforeInputMetrics.metrics.find((metric) => metric.name === name)?.value ?? 0;
      const after = afterInputMetrics.metrics.find((metric) => metric.name === name)?.value ?? 0;
      measurements.push({ name: `task-title-${name}`, durationMs: Math.round((after - before) * 100000) / 100 });
    }
    measurements.push({ name: "task-title-input-to-paint-p95", durationMs: percentile(typingSamples, 0.95), itemCount: typingSamples.length });
    await title.fill("");
    await page.getByRole("button", { name: "Close inspector", exact: true }).click();

    await measure(measurements, "automation-notes-navigation-and-validation", async () => {
      await measureRenderedNavigation(measurements, page, "Notes", NOTE_COUNT);
      const viewport = page.getByRole("list", { name: "Notes", exact: true });
      await expect(viewport).toHaveAttribute("data-total-count", String(NOTE_COUNT));
      await page.getByRole("button", { name: `Open note Performance note ${(NOTE_COUNT - 1).toString().padStart(4, "0")}`, exact: true }).waitFor({ state: "visible" });
      if (Number(await viewport.getAttribute("data-loaded-count")) > 600) throw new Error("Note page cache exceeded its bound.");
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    }, NOTE_COUNT);
    resources.push(await sampleResources(app, page, "notes-hydrated"));
    await measure(measurements, "notes-scroll-to-end", async () => {
      const viewport = page.getByRole("list", { name: "Notes", exact: true });
      await viewport.focus(); await viewport.press("End");
      await expect(viewport.locator(`[data-virtual-index="${NOTE_COUNT - 1}"]`)).toBeVisible();
    }, NOTE_COUNT);
    const note = await requireSuccess(await page.evaluate(() => window.hcb!.notes.list({ limit: 1, summary: true })), "Note summary");
    const firstNote = (note.data as { items: Array<{ id: string; body: string }> }).items[0];
    if (firstNote.body.length > 240) throw new Error("Full note bodies leaked into list summaries.");
    const detail = await requireSuccess(await page.evaluate((id) => window.hcb!.notes.get({ id }), firstNote.id), "Full note");
    if ((detail.data as { body: string }).body.length < 4000) throw new Error("Full note body was lost.");

    const visibleEventCount = await measure(measurements, `renderer-calendar-agenda-${EVENT_COUNT}-fixture-events`, async () => {
      await page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: /^Calendar/ }).click();
      const calendar = page.getByTestId("calendar-view");
      await calendar.waitFor({ state: "visible" });
      // A benchmark that crosses local midnight still exercises its seeded day.
      const expectedRange = zonedDayRange(fixtureDay, fixtureTimeZone);
      for (let attempt = 0; attempt < 2 && await calendar.getAttribute("data-range-start") !== expectedRange.start; attempt += 1) {
        const actualStart = await calendar.getAttribute("data-range-start");
        await page.getByRole("button", { name: actualStart! > expectedRange.start ? "Previous day" : "Next day", exact: true }).click();
      }
      await expect(calendar).toHaveAttribute("data-range-start", expectedRange.start);
      const windowCount = await page.evaluate(async () => {
        const calendar = document.querySelector('[data-testid="calendar-view"]') as HTMLElement;
        const result = await window.hcb!.calendar.listEvents({ start: calendar.dataset.rangeStart, end: calendar.dataset.rangeEnd, summary: true, limit: 1 });
        if (!result.ok) throw new Error(result.error.message);
        return result.data.page.totalKnown as number;
      });
      await expect(calendar).toHaveAttribute("data-visible-event-count", String(windowCount));
      await page.getByText("Performance event 0000", { exact: true }).first().waitFor({ state: "visible" });
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      return windowCount;
    });
    measurements[measurements.length - 1].itemCount = visibleEventCount;

    resources.push(await sampleResources(app, page, "calendar-agenda"));
    await measure(measurements, "automation-tasks-warm-navigation-and-validation", async () => {
      await measureRenderedNavigation(measurements, page, "Tasks", TASK_COUNT);
      await page.getByRole("button", { name: "Performance task 0000", exact: true }).waitFor({ state: "visible" });
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    });
    const diagnostics = await requireSuccess(await page.evaluate(() => window.hcb!.diagnostics.summary()), "Performance diagnostics");
    const noteServiceTimings = ((diagnostics.data as { performance?: { timings?: Array<{ name: string; durationMs: number }> } }).performance?.timings ?? [])
      .filter(({ name }) => ["notes.list", "notes.legacyMigrationPreview"].includes(name)).map(({ name, durationMs }) => ({ name, durationMs }));
    // Also launch the populated profile. Empty-profile shell launch and a
    // warm in-process invalidation alone do not prove large-cache startup.
    await expect.poll(async () => {
      const result = await page.evaluate(() => window.hcb!.settings.get());
      if (!result.ok) throw new Error(result.error.message);
      return result.data.paneWorkspace?.root?.content?.sectionId;
    }).toBe("tasks");
    await metrics.detach();
    await app.close();
    const restartStartedAt = performance.now();
    app = await electron.launch({
      args: [resolve(process.cwd()), `--user-data-dir=${profileDir}`, ...(heapLimitMiB === null ? [] : [`--js-flags=--max-old-space-size=${heapLimitMiB}`])],
      env: { ...process.env, HCB_TEST_DATABASE_ROOT: profileDir, NODE_ENV: "test" }
    });
    const restartedPage = await app.firstWindow();
    restartedPage.setDefaultTimeout(60000);
    await restartedPage.getByTestId("app-shell").waitFor({ state: "visible" });
    measurements.push({ name: "cached-profile-shell-visible", durationMs: elapsed(restartStartedAt) });
    await restartedPage.waitForFunction((count) => {
      const board = document.querySelector('[data-testid="tasks-board"]') as HTMLElement | null;
      return board?.dataset.taskCount === String(count) && board.dataset.hydrationState === "success" &&
        [...board.querySelectorAll("button[data-virtual-focus]")].some((button) => button.textContent?.trim() === "Performance task 0000");
    }, TASK_COUNT);
    await restartedPage.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    measurements.push({ name: "cached-profile-content-visible", durationMs: elapsed(restartStartedAt), itemCount: TASK_COUNT + EVENT_COUNT + NOTE_COUNT });
    resources.push(await sampleResources(app, restartedPage, "cached-profile-tasks"));
    const budgets = evaluatePerformanceBudgets(measurements, resources);
    const report: PerfReport = {
      generatedAt: new Date().toISOString(),
      status: budgets.some(({ status }) => status === "regression") ? "failed" : "passed",
      fixture: { tasks: TASK_COUNT, events: EVENT_COUNT, notes: NOTE_COUNT, timeZone: fixtureTimeZone, day: fixtureDay },
      environment: { platform: process.platform, arch: process.arch, node: process.version, osRelease: release(), cpu: cpus()[0]?.model ?? "unknown", logicalCpus: cpus().length, totalMemoryMiB: Math.round(totalmem() / 1048576), freeMemoryAtStartMiB, loadAtStart, loadAtEnd: loadavg(), requestedHeapMiB: heapLimitMiB, actualRendererHeapLimitMiB },
      measurements,
      resources,
      budgets,
      noteServiceTimings,
      latencySamples: { inputToPaintMs: typingSamples, scrollFrameMs: scrollFrames, mainIpcMs: healthSamples },
      inputLongTasks
    };
    writeReport(report);
    console.table(measurements);
    console.table(resources);
    console.table(budgets);
    if (report.status === "failed") throw new Error("Performance regression ceilings exceeded; see the saved report.");
  } finally {
    await app?.close();
    rmSync(profileDir, { recursive: true, force: true });
  }
}

function writeReport(report: PerfReport): void {
  mkdirSync(artifactDir, { recursive: true });
  if (report.status === "passed") rmSync(join(artifactDir, "latest-failure.txt"), { force: true });
  const json = `${JSON.stringify(report, null, 2)}\n`;
  writeFileSync(join(artifactDir, "latest.json"), json);
  writeFileSync(join(artifactDir, `${report.fixture.tasks}-each${heapLimitMiB === null ? "" : `-heap${heapLimitMiB}`}.json`), json);
  writeFileSync(
    join(artifactDir, "latest.md"),
    [
      "# HCB Electron Performance Smoke",
      "",
      `Generated: ${report.generatedAt}`,
      "",
      `Fixture: ${report.fixture.tasks} local tasks, ${report.fixture.events} local calendar events, and ${report.fixture.notes} local notes.`,
      `Regression gate: ${report.status}. Target misses are recorded separately from regressions.`,
      "",
      "| Measurement | Duration | Items |",
      "| --- | ---: | ---: |",
      ...report.measurements.map((item) => `| ${item.name} | ${item.durationMs.toFixed(2)} ms | ${item.itemCount ?? "—"} |`),
      "", "| Budget | Actual | Target | Regression ceiling | Result |", "| --- | ---: | ---: | ---: | --- |",
      ...report.budgets.map((item) => `| ${item.name} | ${item.actual} ${item.unit} | ${item.target} | ${item.ceiling} | ${item.status} |`)
    ].join("\n")
  );
}

void run().catch((error: unknown) => {
  mkdirSync(artifactDir, { recursive: true });
  writeFileSync(join(artifactDir, "latest-failure.txt"), `${new Date().toISOString()} — ${FIXTURE_COUNT} items per collection; requested old-space limit: ${heapLimitMiB ?? "default"} MiB\n${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  console.error(error);
  process.exitCode = 1;
});
