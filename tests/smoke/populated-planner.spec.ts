import { expect, type Page, type CDPSession } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { cpus, loadavg, platform, release } from "node:os";
import { test, planner, navigate, openPalette, capture } from "./planner";
import { chooseCalendarView } from "./calendarActions";
import { goToPopulatedDay, seedPopulatedPlanner } from "./populatedPlanner";

test.setTimeout(120_000);

type ViewTimingSample = {
  durationMs: number;
  gridMountedMs: number;
  incomingAnimationSettledMs: number;
  outgoingAnimationSettledMs: number;
  finalSettledMs: number;
  loadingIntervals: { startMs: number; endMs: number }[];
  frames: number[];
};
type TraceEvent = { name: string; ph: string; ts: number; dur?: number; pid: number; tid: number };

async function finishViewTrace(profiler: CDPSession, markPrefix: string) {
  const completed = new Promise<{ stream?: string }>(resolve => profiler.once("Tracing.tracingComplete", resolve));
  await profiler.send("Tracing.end");
  const { stream } = await completed;
  if (!stream) throw new Error("Calendar trace completed without its result stream");
  const chunks: Buffer[] = [];
  try {
    for (;;) {
      const result = await profiler.send("IO.read", { handle: stream });
      chunks.push(Buffer.from(result.data, result.base64Encoded ? "base64" : "utf8"));
      if (result.eof) break;
    }
  } finally { await profiler.send("IO.close", { handle: stream }); }
  const raw = Buffer.concat(chunks).toString("utf8");
  const events = (JSON.parse(raw) as { traceEvents: TraceEvent[] }).traceEvents;
  const start = events.find(event => event.name === `${markPrefix}:click`);
  if (!start) throw new Error("Calendar trace is missing its click UserTiming mark");
  const interval = (name: string) => {
    const end = events.find(event => event.name === `${markPrefix}:${name}` && event.pid === start.pid && event.tid === start.tid);
    if (!end) throw new Error(`Calendar trace is missing its ${name} UserTiming mark`);
    const totals = Object.fromEntries(["Layout", "UpdateLayoutTree"].map(name => {
      const overlaps = events.filter(event => event.name === name && event.ph === "X" && event.pid === start.pid && event.tid === start.tid)
        .map(event => Math.max(0, Math.min(end.ts, event.ts + (event.dur ?? 0)) - Math.max(start.ts, event.ts))).filter(duration => duration > 0);
      return [name, { durationMs: Math.round(overlaps.reduce((total, duration) => total + duration, 0) / 100) / 10, eventCount: overlaps.length }];
    }));
    return { durationMs: Math.round((end.ts - start.ts) / 100) / 10, ...totals };
  };
  return { raw, intervals: { clickToVisualSettled: interval("visual-settled"), clickToFinalSettled: interval("final-settled") } };
}

async function measuredView(page: Page, view: string) {
  // Finish the preceding viewport before attributing its loading state to a new click.
  await expect(page.getByTestId("calendar-view")).toHaveAttribute("aria-busy", "false");
  const hostLoadBefore = loadavg();
  const profiler = process.env.HCB_PROFILE_VIEWS ? await page.context().newCDPSession(page) : null;
  if (profiler) { await profiler.send("Profiler.enable"); await profiler.send("Performance.enable"); }
  let metricsBefore: Record<string, number> = {};
  let tracing = false, profiling = false;
  const theme = await page.locator("html").getAttribute("data-color-theme");
  const markPrefix = `hcb-calendar-${view}-${Date.now()}`;
  const label = ({ month: "Month", week: "Week", day: "Day", multiDay: "3 days" } as Record<string, string>)[view];
  const gridLabel = `Calendar ${view === "multiDay" ? "multi-day" : view} view`;
  await page.evaluate(({ label, gridLabel, markPrefix }) => {
    (window as any).__populatedTransition = new Promise((resolve, reject) => {
      const listener = (event: MouseEvent) => {
        const item = (event.target as Element).closest('[role="menuitemradio"], [role="menuitem"]');
        if (item?.textContent?.trim() !== label) return;
        document.removeEventListener("click", listener, true);
        const start = performance.now();
        performance.mark(`${markPrefix}:click`, { startTime: start });
        const workspace = document.querySelector('[data-testid="calendar-view"]')!;
        let previous = start, visualFrames = 0, readyFrames = 0;
        let gridMountedMs: number | null = null, incomingAnimationSettledMs: number | null = null, outgoingAnimationSettledMs: number | null = null;
        let durationMs: number | null = null, loadingStartMs: number | null = null;
        const frames: number[] = [], loadingIntervals: { startMs: number; endMs: number }[] = [];
        const grid = () => workspace.querySelector(`.calendar-transition-frame[data-active="true"] [role="grid"][aria-label="${gridLabel}"]`);
        const mark = (name: string, elapsed: number) => performance.mark(`${markPrefix}:${name}`, { startTime: start + elapsed });
        const observeGrid = (elapsed: number) => {
          if (gridMountedMs === null && grid()) { gridMountedMs = elapsed; mark("grid-mounted", elapsed); }
        };
        const observeLoading = (busy: boolean, elapsed: number) => {
          if (busy && loadingStartMs === null) { loadingStartMs = elapsed; mark(`loading-${loadingIntervals.length}-start`, elapsed); }
          if (!busy && loadingStartMs !== null) {
            loadingIntervals.push({ startMs: loadingStartMs, endMs: elapsed });
            loadingStartMs = null; mark(`loading-${loadingIntervals.length - 1}-end`, elapsed);
          }
        };
        const observer = new MutationObserver(records => {
          const elapsed = performance.now() - start;
          observeGrid(elapsed);
          const changes = records.filter(record => record.target === workspace && record.attributeName === "aria-busy");
          changes.forEach((_record, index) => {
            // Attribute changes can share one delivery. Retain even zero-duration
            // busy intervals instead of silently losing a fast cached range load.
            const value = index + 1 < changes.length ? changes[index + 1].oldValue : workspace.getAttribute("aria-busy");
            observeLoading(value === "true", elapsed);
          });
        });
        observer.observe(workspace, { subtree: true, childList: true, attributes: true, attributeOldValue: true, attributeFilter: ["aria-busy", "data-active"] });
        observeLoading(workspace.getAttribute("aria-busy") === "true", 0);
        const tick = () => {
          const now = performance.now(), elapsed = now - start;
          if (durationMs === null) frames.push(now - previous);
          previous = now;
          observeGrid(elapsed);
          const active = grid()?.closest('.calendar-transition-frame');
          const style = active ? getComputedStyle(active) : null;
          const outgoing = workspace.querySelector('.calendar-transition-frame[data-active="false"]');
          const visualReady = Boolean(active && style?.opacity === "1" && !outgoing);
          if (active && style?.opacity === "1" && incomingAnimationSettledMs === null) {
            const transform = new DOMMatrixReadOnly(style.transform === "none" ? undefined : style.transform);
            if (Math.abs(transform.m41) < .01 && Math.abs(transform.m42) < .01) {
              incomingAnimationSettledMs = elapsed; mark("incoming-animation-settled", elapsed);
            }
          }
          if (active && !outgoing && outgoingAnimationSettledMs === null) {
            outgoingAnimationSettledMs = elapsed; mark("outgoing-animation-settled", elapsed);
          }
          visualFrames = visualReady ? visualFrames + 1 : 0;
          if (visualFrames >= 2 && durationMs === null) { durationMs = elapsed; mark("visual-settled", elapsed); }
          const busy = workspace.getAttribute("aria-busy") === "true";
          observeLoading(busy, elapsed);
          readyFrames = visualReady && !busy && incomingAnimationSettledMs !== null ? readyFrames + 1 : 0;
          if (readyFrames >= 2 && durationMs !== null) {
            observer.disconnect(); mark("final-settled", elapsed);
            resolve({ durationMs, gridMountedMs, incomingAnimationSettledMs, outgoingAnimationSettledMs, finalSettledMs: elapsed, loadingIntervals, frames });
          } else if (elapsed > 5000) {
            observer.disconnect(); reject(new Error("Populated calendar did not finish its view transition and visible range loading in 5 seconds"));
          } else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      };
      document.addEventListener("click", listener, true);
    });
  }, { label, gridLabel, markPrefix });
  try {
    await chooseCalendarView(page, view, profiler ? async () => {
      await profiler.send("Tracing.start", { categories: "devtools.timeline,blink.user_timing", transferMode: "ReturnAsStream" });
      tracing = true;
      const { metrics } = await profiler.send("Performance.getMetrics");
      metricsBefore = Object.fromEntries(metrics.map(metric => [metric.name, metric.value]));
      await profiler.send("Profiler.start");
      profiling = true;
    } : undefined);
    const sample = await page.evaluate(() => (window as any).__populatedTransition) as ViewTimingSample;
    if (profiler) {
      const { profile } = await profiler.send("Profiler.stop");
      profiling = false;
      const { metrics } = await profiler.send("Performance.getMetrics");
      const broadWindowMetrics = Object.fromEntries(metrics.filter(metric => ["LayoutDuration", "RecalcStyleDuration", "ScriptDuration", "TaskDuration"].includes(metric.name)).map(metric => [metric.name, Math.round((metric.value - (metricsBefore[metric.name] ?? 0)) * 1000)]));
      const trace = await finishViewTrace(profiler, markPrefix);
      tracing = false;
      mkdirSync("output/ui-review", { recursive: true });
      writeFileSync(`output/ui-review/calendar-${view}-${theme}.cpuprofile`, JSON.stringify(profile));
      writeFileSync(`output/ui-review/calendar-${view}-${theme}-trace.json`, trace.raw);
      const phases = {
        measuredIntervals: trace.intervals,
        broaderProfilingWindow: { includes: "Automation input/actionability and CDP overhead before the click and after final settle; not a decomposition of durationMs", metricsMs: broadWindowMetrics },
        notes: "Trace totals clip complete Layout/UpdateLayoutTree events to matching UserTiming marks on the renderer thread. Intervals and event categories overlap; do not sum them as exclusive phases. Profiling itself adds overhead."
      };
      writeFileSync(`output/ui-review/calendar-${view}-${theme}-phases.json`, JSON.stringify(phases, null, 2));
    }
    const frames = sample.frames.slice(1).sort((a, b) => a - b);
    const frameP95Ms = frames[Math.min(frames.length - 1, Math.floor(frames.length * .95))];
    // Preserve the visual-transition gate. Range loading is separately observable:
    // aria-busy includes the loader debounce, IPC/cache work and resulting render.
    // No UI-only measurement can identify pure database/provider time.
    const measurement = {
      view, durationMs: Math.round(sample.durationMs), targetMs: 400, ceilingMs: 1500,
      gridMountedMs: Math.round(sample.gridMountedMs), incomingAnimationSettledMs: Math.round(sample.incomingAnimationSettledMs),
      outgoingAnimationSettledMs: Math.round(sample.outgoingAnimationSettledMs), finalSettledMs: Math.round(sample.finalSettledMs),
      rangeLoading: { observation: "aria-busy; includes debounce, IPC/cache and render; not pure data-service time", intervals: sample.loadingIntervals.map(interval => ({ startMs: Math.round(interval.startMs), endMs: Math.round(interval.endMs) })), totalMs: Math.round(sample.loadingIntervals.reduce((total, interval) => total + interval.endMs - interval.startMs, 0)) },
      frameP95Ms: Math.round(frameP95Ms), frameCount: frames.length,
      hostLoadAverage1m5m15m: { before: hostLoadBefore, after: loadavg() }
    };
    mkdirSync("output/ui-review", { recursive: true });
    const timingPath = `output/ui-review/calendar-${view}-${theme}-timing.json`;
    writeFileSync(timingPath, JSON.stringify({ ...measurement, logicalCpuCount: cpus().length, profilingEnabled: Boolean(profiler) }, null, 2));
    await test.info().attach(`calendar-${view}-${theme}-timing`, { path: timingPath, contentType: "application/json" });
    expect(sample.durationMs, `${view} click to settled grid`).toBeLessThan(1500);
    return measurement;
  } finally {
    if (profiler) {
      // A rejected transition still owns active CDP work. Release it without
      // replacing the original measurement failure with a cleanup error.
      if (profiling) await profiler.send("Profiler.stop").catch(() => undefined);
      if (tracing) await profiler.send("Tracing.end").catch(() => undefined);
      await profiler.detach().catch(() => undefined);
    }
  }
}

async function assertReadableGrid(page: Page, view: string) {
  const grid = page.getByRole("grid", { name: `Calendar ${view === "multiDay" ? "multi-day" : view} view`, exact: true });
  await expect(grid).toBeVisible();
  expect(await grid.locator(".calendar-event-chip").count()).toBeGreaterThan(5);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (view === "month") {
    await expect(grid.getByRole("gridcell")).toHaveCount(42);
    const lanes = Number(await grid.getAttribute("data-month-lanes"));
    expect(lanes).toBeGreaterThanOrEqual(1);
    expect(lanes).toBeLessThanOrEqual(6);
    expect(await grid.locator(".calendar-event-chip").count()).toBeLessThanOrEqual(42 * lanes);
    expect(await grid.getByRole("button", { name: /Show \d+ more calendar items/ }).count()).toBeGreaterThan(20);
    expect(await grid.locator('[data-calendar-month-all-day-segment][data-day-span="3"]').count()).toBeGreaterThan(0);
  } else {
    // Inspect actual painted rectangles, not the layout algorithm's own lane values.
    const issues = await grid.locator("[data-calendar-day-events]").evaluateAll((days) => days.flatMap(day => {
      const bounds = day.getBoundingClientRect();
      const boxes = Array.from(day.querySelectorAll<HTMLElement>("[data-calendar-event-layout]")).map(element => ({ title: element.textContent, rect: element.getBoundingClientRect() }));
      const failures: string[] = [];
      boxes.forEach(({ title, rect }, index) => {
        if (rect.width < 40 || rect.height < 14 || rect.left < bounds.left - 1 || rect.right > bounds.right + 1) failures.push(`Clipped/small event: ${title}`);
        for (const other of boxes.slice(index + 1)) {
          if (Math.min(rect.right, other.rect.right) - Math.max(rect.left, other.rect.left) > 1 && Math.min(rect.bottom, other.rect.bottom) - Math.max(rect.top, other.rect.top) > 1) failures.push(`Overlapping boxes: ${title} / ${other.title}`);
        }
      }); return failures;
    }));
    expect(issues).toEqual([]);
    // Frame the working day consistently while retaining real native scrolling.
    await grid.evaluate(element => {
      const morning = element.querySelector<HTMLElement>('[data-calendar-event-layout][data-start-minute="540"]')!;
      element.scrollTop = Number.parseFloat(morning.style.top) * 8 / 9;
    });
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const completed = grid.locator('.calendar-event-chip[data-completed="true"]').first();
    await expect(completed).toHaveCSS("opacity", "0.5");
    const shortTitle = grid.locator(".calendar-event-short .calendar-event-title").first();
    await expect(shortTitle).toHaveCSS("white-space", "nowrap");
  }
  const clippedTitles = await grid.locator(".calendar-event-chip").evaluateAll(chips => chips.filter(chip => {
    const content = chip.querySelector(".calendar-event-content");
    return content && content.scrollWidth > content.clientWidth;
  }).map(chip => ({ label: chip.getAttribute("aria-label"), title: chip.getAttribute("title") })));
  for (const chip of clippedTitles) { expect(chip.label).toBeTruthy(); expect(chip.title).toContain(chip.label!); }
}

for (const theme of ["light", "dark"] as const) {
  test(`populated local account stays readable and usable in ${theme}`, async () => {
    await planner(async (page) => {
      const fixture = await seedPopulatedPlanner(page);
      await page.setViewportSize({ width: 1600, height: 1000 });
      await page.evaluate(async theme => {
        const result = await window.hcb!.settings.update({ theme });
        if (!result.ok) throw new Error(result.error.message);
        window.dispatchEvent(new Event("hcb:core-data-invalidated"));
      }, theme);
      await expect(page.locator("html")).toHaveAttribute("data-color-theme", `hcb-neutral-${theme}`);
      await navigate(page, "Calendar"); await goToPopulatedDay(page);
      const measurements: Awaited<ReturnType<typeof measuredView>>[] = [];
      for (const view of ["month", "week", "day", "multiDay"]) {
        measurements.push(await measuredView(page, view));
        await assertReadableGrid(page, view);
        await capture(page, `populated-${view}-${theme}`);
      }
      await chooseCalendarView(page, "month");
      const month = page.getByRole("grid", { name: "Calendar month view", exact: true });
      const spaciousLanes = Number(await month.getAttribute("data-month-lanes"));
      expect(spaciousLanes).toBeGreaterThanOrEqual(3);
      for (const width of [1180, 850]) {
        await page.setViewportSize({ width, height: width === 850 ? 700 : 760 });
        await expect.poll(() => month.evaluate(grid => grid.scrollHeight <= grid.clientHeight + 2)).toBe(true);
        expect(Number(await month.getAttribute("data-month-lanes"))).toBeLessThan(spaciousLanes);
        await expect(month.getByRole("gridcell")).toHaveCount(42);
        if (width === 850) {
          const chip = month.locator('.calendar-event-chip[data-all-day="false"]').first();
          await expect(chip.locator(".calendar-event-time")).toBeHidden();
          expect(await chip.locator(".calendar-event-title").evaluate(title => title.getBoundingClientRect().width)).toBeGreaterThan(40);
        }
        await capture(page, `populated-month-${width}-${theme}`);
      }
      await page.setViewportSize({ width: 1600, height: 1000 });
      await expect(month).toHaveAttribute("data-month-lanes", String(spaciousLanes));
      const overflow = page.getByRole("button", { name: /Show \d+ more calendar items/ }).first();
      await overflow.click();
      const dialog = page.getByRole("dialog").filter({ has: page.getByRole("button", { name: "Close overflow items" }) });
      await expect(dialog).toBeVisible();
      expect(await dialog.getByRole("button").count()).toBeGreaterThan(3);
      const completed = dialog.getByRole("button", { name: /^Completed \(/ });
      if (await completed.count()) { await completed.click(); await expect(completed).toHaveAttribute("aria-expanded", "true"); }
      await capture(page, `populated-overflow-${theme}`);
      await dialog.getByRole("button").filter({ hasText: "Architecture review" }).click();
      await expect(page.getByRole("textbox", { name: "Event title", exact: true })).toHaveValue("Architecture review");
      await page.getByRole("button", { name: "Close inspector", exact: true }).click();

      // Rare results must remain reachable among hundreds of other records.
      const calendarRange = await page.getByTestId("calendar-view").getAttribute("data-range-start");
      await page.getByRole("button", { name: "Toggle search sidebar" }).click();
      const panel = page.getByTestId("inspector-shell");
      const search = page.getByRole("searchbox", { name: "Search events, tasks and birthdays" });
      for (const [query, title, field] of [["Beacon architecture", "Beacon architecture review", "Event title"], ["Beacon launch checklist", "Beacon launch checklist", "Task title"], ["Avery", "Avery's birthday", "Birthday title"]]) {
        await search.fill(query);
        await panel.locator(".inspector-search-result").filter({ hasText: title }).click();
        await expect(panel.getByRole("textbox", { name: field, exact: true })).toHaveValue(title);
        await expect(page.getByTestId("calendar-view")).toHaveAttribute("data-range-start", calendarRange!);
        await panel.getByRole("button", { name: "Search", exact: true }).click();
      }
      await search.fill("Beacon");
      await expect(panel.locator(".inspector-search-result")).toHaveCount(2);
      await capture(page, `populated-search-${theme}`);
      await page.setViewportSize({ width: 900, height: 760 });
      await expect(panel).toHaveAttribute("aria-modal", "true");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await capture(page, `populated-search-narrow-${theme}`);
      await page.getByRole("button", { name: "Close inspector", exact: true }).click();
      await page.setViewportSize({ width: 1600, height: 1000 });

      await navigate(page, "Tasks");
      await page.getByRole("button", { name: "Board", exact: true }).click();
      await expect(page.getByTestId("tasks-board")).toBeVisible();
      expect(await page.locator("[data-virtual-index]").count()).toBeLessThan(220);
      await expect(page.getByRole("button", { name: /^Beacon launch checklist/ })).toBeVisible();
      await capture(page, `populated-tasks-${theme}`);
      await openPalette(page);
      await page.getByRole("searchbox").fill("Beacon launch brief");
      await page.getByRole("option").filter({ hasText: "Beacon launch brief" }).click();
      await expect(page.getByRole("textbox", { name: "Note title", exact: true })).toHaveValue("Beacon launch brief");
      await expect(page.getByRole("textbox", { name: "Note body" })).toContainText("Confirm owners");
      await capture(page, `populated-note-${theme}`);
      await page.getByRole("button", { name: "Close inspector", exact: true }).click();
      await page.reload();
      await expect(page.getByTestId("app-shell")).toBeVisible();
      expect(await page.evaluate(async id => { const result = await window.hcb!.calendar.get({ id }); return result.ok && result.data.completed; }, fixture.ids.completedEvent)).toBe(true);
      const report = { theme, fixture: fixture.counts, environment: { platform: platform(), release: release(), logicalCpuCount: cpus().length, profilingEnabled: Boolean(process.env.HCB_PROFILE_VIEWS), viewport: "1600x1000", graphics: process.platform === "linux" ? "Electron --disable-gpu / Xvfb" : "Electron" }, measurements };
      mkdirSync("output/ui-review", { recursive: true });
      const path = `output/ui-review/populated-performance-${theme}.json`;
      writeFileSync(path, JSON.stringify(report, null, 2));
      await test.info().attach(`populated-performance-${theme}`, { path, contentType: "application/json" });
      for (const view of ["month", "week", "day", "multiDay"]) await test.info().attach(`populated-${view}-${theme}`, { path: `output/ui-review/populated-${view}-${theme}.png`, contentType: "image/png" });
    });
  });
}
