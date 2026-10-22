import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { platform, release } from "node:os";
import { planner, navigate, openPalette, capture } from "./planner";
import { chooseCalendarView } from "./calendarActions";
import { goToPopulatedDay, seedPopulatedPlanner } from "./populatedPlanner";

test.setTimeout(120_000);

async function measuredView(page: Page, view: string) {
  const label = ({ month: "Month", week: "Week", day: "Day", multiDay: "3 days" } as Record<string, string>)[view];
  const gridLabel = `Calendar ${view === "multiDay" ? "multi-day" : view} view`;
  await page.evaluate(({ label, gridLabel }) => {
    (window as any).__populatedTransition = new Promise((resolve, reject) => {
      const listener = (event: MouseEvent) => {
        const item = (event.target as Element).closest('[role="menuitemradio"], [role="menuitem"]');
        if (item?.textContent?.trim() !== label) return;
        document.removeEventListener("click", listener, true);
        const start = performance.now(); let previous = start, settled = 0;
        const frames: number[] = [];
        const tick = (now: number) => {
          frames.push(now - previous); previous = now;
          const active = document.querySelector('.calendar-transition-frame[data-active="true"]');
          const grid = active?.querySelector(`[role="grid"][aria-label="${gridLabel}"]`);
          settled = grid && getComputedStyle(active!).opacity === "1" && !document.querySelector('.calendar-transition-frame[data-active="false"]') ? settled + 1 : 0;
          if (settled >= 2) resolve({ durationMs: now - start, frames });
          else if (now - start > 5000) reject(new Error("Populated calendar did not settle in 5 seconds"));
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      };
      document.addEventListener("click", listener, true);
    });
  }, { label, gridLabel });
  await chooseCalendarView(page, view);
  const sample = await page.evaluate(() => (window as any).__populatedTransition) as { durationMs: number; frames: number[] };
  const frames = sample.frames.slice(1).sort((a, b) => a - b);
  const frameP95Ms = frames[Math.min(frames.length - 1, Math.floor(frames.length * .95))];
  expect(sample.durationMs, `${view} click to settled grid`).toBeLessThan(1500);
  // A single 200 ms animation has too few frames for a stable percentile gate.
  // Retain the sample for diagnosis; the sustained frame gate lives in test:perf.
  return { view, durationMs: Math.round(sample.durationMs), frameP95Ms: Math.round(frameP95Ms), frameCount: frames.length, targetMs: 400, ceilingMs: 1500 };
}

async function assertReadableGrid(page: Page, view: string) {
  const grid = page.getByRole("grid", { name: `Calendar ${view === "multiDay" ? "multi-day" : view} view`, exact: true });
  await expect(grid).toBeVisible();
  expect(await grid.locator(".calendar-event-chip").count()).toBeGreaterThan(5);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (view === "month") {
    await expect(grid.getByRole("gridcell")).toHaveCount(42);
    expect(await grid.locator(".calendar-event-chip").count()).toBeLessThanOrEqual(84);
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
      const report = { theme, fixture: fixture.counts, environment: { platform: platform(), release: release(), viewport: "1600x1000", graphics: process.platform === "linux" ? "Electron --disable-gpu / Xvfb" : "Electron" }, measurements };
      mkdirSync("output/ui-review", { recursive: true });
      const path = `output/ui-review/populated-performance-${theme}.json`;
      writeFileSync(path, JSON.stringify(report, null, 2));
      await test.info().attach(`populated-performance-${theme}`, { path, contentType: "application/json" });
      for (const view of ["month", "week", "day", "multiDay"]) await test.info().attach(`populated-${view}-${theme}`, { path: `output/ui-review/populated-${view}-${theme}.png`, contentType: "image/png" });
    });
  });
}
