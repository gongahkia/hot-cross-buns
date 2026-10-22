import { _electron as electron, expect, test, type Page } from "@playwright/test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test.setTimeout(120_000);

async function planner(run: (page: Page) => Promise<void>) {
  const profile = mkdtempSync(join(tmpdir(), "hcb-workspace-ui-"));
  const app = await electron.launch({ args: [...(process.platform === "linux" ? ["--disable-gpu"] : []), resolve(__dirname, "../.."), `--user-data-dir=${profile}`], env: { ...process.env, NODE_ENV: "test", HCB_TEST_DATABASE_ROOT: profile } });
  const errors: string[] = [];
  try {
    const page = await app.firstWindow();
    page.on("pageerror", (error) => errors.push(error.message));
    await expect(page.getByTestId("app-shell")).toBeVisible();
    await page.evaluate(async () => {
      await window.hcb!.settings.update({ onboardingStatus: "skipped", syncMode: "manual", defaultTimeZone: "UTC", theme: "light", colorTheme: "hcb-neutral-light" });
      window.dispatchEvent(new Event("hcb:core-data-invalidated"));
    });
    await expect(page.getByRole("dialog", { name: "Hot Cross Buns", exact: true })).toBeHidden();
    await page.setViewportSize({ width: 1180, height: 760 });
    await run(page);
    expect(errors).toEqual([]);
  } finally { await app.close(); rmSync(profile, { recursive: true, force: true }); }
}

const navigate = (page: Page, section: string) => page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: section, exact: true }).click();
async function capture(page: Page, name: string) {
  mkdirSync("output/ui-review", { recursive: true });
  await page.screenshot({ path: `output/ui-review/${name}.png` });
}

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const clipped = await page.locator(".calendar-header button, .calendar-header select").evaluateAll((controls) => controls.filter((control) => {
    const rect = control.getBoundingClientRect();
    const parent = control.closest(".pane-content")!.getBoundingClientRect();
    return rect.width > 0 && (rect.right > parent.right + 1 || rect.left < parent.left - 1);
  }).map((control) => control.getAttribute("aria-label") ?? control.textContent));
  expect(clipped).toEqual([]);
}

test("navigates calendar views, filters sources, edits in context and preserves drafts", async () => {
  await planner(async (page) => {
    const fixture = await page.evaluate(async () => {
      const day = new Date().toISOString().slice(0, 10);
      const ids: string[] = [];
      for (const [index, title] of ["Design review", "Team planning"].entries()) {
        const result = await window.hcb!.calendar.create({ calendarId: "primary", title, startsAt: `${day}T${10 + index}:00:00Z`, endsAt: `${day}T${11 + index}:00:00Z`, allDay: false });
        if (!result.ok) throw new Error(result.error.message);
        ids.push(result.data.id);
      }
      window.dispatchEvent(new Event("hcb:core-data-invalidated"));
      return { ids, day };
    });
    const calendar = page.getByTestId("calendar-view");
    for (const view of ["day", "multiDay", "week", "month", "agenda"]) {
      await page.getByRole("combobox", { name: "Calendar view" }).selectOption(view);
      await expect(page.getByRole("combobox", { name: "Calendar view" })).toHaveValue(view);
      await noOverflow(page);
    }
    const source = page.getByRole("complementary", { name: "Workspace navigation" }).getByRole("checkbox").first();
    await source.uncheck();
    await expect(calendar.getByText("Design review", { exact: true })).toHaveCount(0);
    await source.check();
    await calendar.getByText("Design review", { exact: true }).click();
    const inspector = page.getByTestId("inspector-shell");
    await expect(inspector).toHaveAttribute("data-inspector-layout", "docked");
    await expect(inspector).toHaveAttribute("aria-modal", "false");
    await calendar.getByText("Team planning", { exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Event title", exact: true })).toHaveValue("Team planning");
    const resize = page.getByRole("separator", { name: "Resize details panel" });
    await resize.focus(); await resize.press("ArrowLeft");
    await expect(resize).toHaveAttribute("aria-valuenow", "404");
    const dividerBounds = (await resize.boundingBox())!;
    await page.mouse.move(dividerBounds.x + 3, dividerBounds.y + 100);
    await page.mouse.down(); await page.mouse.move(dividerBounds.x - 33, dividerBounds.y + 100, { steps: 5 }); await page.mouse.up();
    expect(Number(await resize.getAttribute("aria-valuenow"))).toBeGreaterThan(420);
    await page.getByRole("button", { name: "Float details" }).click();
    await expect(inspector).toHaveAttribute("data-inspector-layout", "popover");
    await page.getByRole("button", { name: "Dock details" }).click();
    await page.getByRole("textbox", { name: "Event title" }).fill("Unsaved planning");
    await navigate(page, "Tasks");
    await expect(page.getByRole("textbox", { name: "Event title" })).toHaveValue("Unsaved planning");
    await expect(calendar).toBeVisible();
    await page.getByRole("button", { name: "Discard", exact: true }).click();
    await expect(inspector).toHaveCount(0);
    await calendar.getByText("Design review", { exact: true }).click();
    await page.getByRole("textbox", { name: "Event location" }).fill("Studio 2");
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect.poll(async () => page.evaluate(async (id) => { const event = await window.hcb!.calendar.get({ id }); return event.ok && event.data.location; }, fixture.ids[0])).toBe("Studio 2");
    await expect(inspector).toHaveCount(0);
    await page.getByRole("button", { name: "Choose calendar date" }).click();
    await page.getByLabel("Go to date", { exact: true }).fill("2027-01-15");
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await expect(calendar).toHaveAttribute("data-range-start", "2027-01-15T00:00:00.000Z");
    await page.getByRole("combobox", { name: "Calendar view" }).selectOption("month");
    await expect(page.getByRole("button", { name: "Choose calendar date" })).toContainText("January 2027");
    await page.getByRole("combobox", { name: "Calendar view" }).selectOption("agenda");
    await page.getByRole("button", { name: "Jump to today" }).click();
    await expect(calendar).toHaveAttribute("data-range-start", `${fixture.day}T00:00:00.000Z`);
    await page.getByRole("combobox", { name: "Calendar view" }).selectOption("week");
    await expect(page.getByText("Calendar range could not be loaded.", { exact: true })).toHaveCount(0);
    await capture(page, "calendar-light");
    await page.getByRole("button", { name: "New event", exact: true }).click();
    await noOverflow(page);
    await capture(page, "calendar-context");
    await page.setViewportSize({ width: 960, height: 620 });
    await expect(inspector).toHaveAttribute("data-inspector-layout", "sheet");
    await expect(inspector).toHaveAttribute("aria-modal", "true");
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await noOverflow(page);
    await page.getByRole("button", { name: "Split view", exact: true }).click();
    await expect(page.getByTestId("pane-leaf")).toHaveCount(2);
    await noOverflow(page);
    await capture(page, "split-960");
  });
});

test("validates event creation and requires a scope for recurring edits", async () => {
  await planner(async (page) => {
    await page.getByRole("button", { name: "New event", exact: true }).click();
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(page.getByText("Title is required.", { exact: true })).toBeVisible();
    await page.getByRole("textbox", { name: "Event title" }).fill("Daily design check-in");
    await page.getByRole("button", { name: "More details", exact: true }).click();
    await page.getByRole("combobox", { name: "Event repeat frequency" }).selectOption("daily");
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(page.getByTestId("inspector-shell")).toHaveCount(0);
    await page.getByTestId("calendar-view").getByText("Daily design check-in", { exact: true }).click();
    await page.getByRole("textbox", { name: "Event title" }).fill("Daily planning check-in");
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    const scope = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Save recurring event" }) }).last();
    await expect(scope).toBeVisible();
    await scope.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Event title" })).toHaveValue("Daily planning check-in");
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    await scope.getByRole("button", { name: "Entire series", exact: true }).click();
    await expect(page.getByTestId("inspector-shell")).toHaveCount(0);
    await expect(page.getByTestId("calendar-view").getByText("Daily planning check-in", { exact: true })).toBeVisible();
  });
});

test("reviews task scheduling before writing a calendar block", async () => {
  await planner(async (page) => {
    const taskId = await page.evaluate(async () => {
      const result = await window.hcb!.tasks.create({ listId: "inbox", title: "Review the prototype", durationMinutes: 45 });
      if (!result.ok) throw new Error(result.error.message);
      window.dispatchEvent(new Event("hcb:core-data-invalidated"));
      return result.data.id;
    });
    await navigate(page, "Tasks");
    const row = page.locator(`[data-task-row="${taskId}"]`);
    await row.hover();
    await page.getByRole("button", { name: "Schedule Review the prototype", exact: true }).click();
    const schedule = page.getByRole("dialog", { name: "Schedule task", exact: true });
    await expect(schedule.getByRole("spinbutton", { name: "Schedule duration" })).toHaveValue("45");
    await schedule.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect.poll(async () => page.evaluate(async () => { const result = await window.hcb!.calendar.listScheduledTaskBlocks({}); return result.ok && result.data.items.length; })).toBe(0);
    await row.hover();
    await page.getByRole("button", { name: "More actions for Review the prototype", exact: true }).click();
    await page.getByRole("button", { name: "Schedule on calendar", exact: true }).click();
    await schedule.getByRole("button", { name: "Create Calendar block", exact: true }).click();
    await expect(schedule).toHaveCount(0);
    await expect.poll(async () => page.evaluate(async (id) => { const result = await window.hcb!.calendar.listScheduledTaskBlocks({}); return result.ok && result.data.items.some((block) => block.taskId === id); }, taskId)).toBe(true);
    await row.hover();
    await expect(page.getByRole("button", { name: "Reschedule Review the prototype", exact: true })).toBeVisible();
  });
});

test("creates and renames lists, edits tasks, completes them and switches presentation", async () => {
  await planner(async (page) => {
    await navigate(page, "Tasks");
    await expect(page.getByTestId("tasks-board")).toHaveAttribute("data-presentation", "list");
    await page.getByRole("button", { name: "New list", exact: true }).click();
    await page.getByRole("textbox", { name: "List name" }).fill("Product work");
    await page.getByRole("button", { name: "Create list", exact: true }).click();
    await page.getByRole("complementary", { name: "Task board navigation" }).getByRole("button", { name: /^Product work/ }).click();
    await page.getByRole("button", { name: "Open Product work list menu" }).click();
    await page.getByRole("button", { name: "Rename list", exact: true }).click();
    await page.getByRole("textbox", { name: "List name" }).fill("Design work");
    await page.getByRole("dialog", { name: "Rename list" }).getByRole("button", { name: "Save" }).click();
    await page.getByRole("button", { name: "New task", exact: true }).click();
    await page.getByRole("textbox", { name: "Task title" }).fill("Ship the new planner");
    await page.getByLabel("Task due date").fill("2027-02-03");
    await page.getByRole("button", { name: "Add task", exact: true }).click();
    await expect(page.getByTestId("inspector-shell")).toHaveCount(0);
    const task = page.getByRole("button", { name: "Ship the new planner", exact: true });
    await expect(task).toBeVisible(); await task.click();
    await page.getByRole("textbox", { name: "Task title" }).fill("Ship the polished planner");
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(page.getByTestId("inspector-shell")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Ship the polished planner", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Complete Ship the polished planner", exact: true }).click();
    await page.getByRole("button", { name: "Completed (1)", exact: true }).click();
    await page.getByRole("button", { name: "Reopen Ship the polished planner", exact: true }).click();
    await expect(page.getByRole("button", { name: "Complete Ship the polished planner", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Board", exact: true }).click();
    await expect(page.getByTestId("tasks-board")).toHaveAttribute("data-presentation", "board");
    await page.getByRole("button", { name: "List", exact: true }).click();
    await page.getByRole("button", { name: "Collapse navigation" }).click();
    await expect(page.getByRole("button", { name: "New task", exact: true })).toBeVisible();
    await capture(page, "tasks-list");
    await page.reload();
    await expect(page.getByTestId("tasks-board")).toHaveAttribute("data-presentation", "list");
    await expect(page.getByTestId("inspector-shell")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Ship the polished planner", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Expand navigation" })).toBeVisible();
  });
});

test("creates a document and autosaves edits when moving between sections", async () => {
  await planner(async (page) => {
    await navigate(page, "Notes");
    await page.getByRole("button", { name: "New note", exact: true }).click();
    await page.getByRole("textbox", { name: "Note title" }).fill("Design decisions");
    await page.getByRole("textbox", { name: "Note body" }).fill("The calendar stays visible while editing.");
    await page.getByRole("button", { name: "Create note", exact: true }).click();
    await expect(page.getByRole("button", { name: "Create note", exact: true })).toHaveCount(0);
    const document = page.getByTestId("inspector-shell");
    await expect(document).toHaveAttribute("data-document-editor", "true");
    await expect(document).toHaveAttribute("aria-modal", "false");
    await page.getByRole("button", { name: "Source", exact: true }).click();
    await page.getByRole("textbox", { name: "Note body" }).fill("# Decisions\n\n- [ ] Verify all editing flows\n- [x] Keep context visible");
    await navigate(page, "Tasks");
    await expect(page.getByTestId("tasks-board")).toBeVisible();
    await navigate(page, "Notes");
    await expect(page.getByRole("textbox", { name: "Note body" })).toContainText("Verify all editing flows");
    await page.getByRole("textbox", { name: "Note body" }).getByRole("checkbox").first().check();
    await expect(page.getByText("Saved on this device", { exact: true })).toBeVisible();
    await capture(page, "notes-document");
    await page.getByRole("button", { name: "New note list", exact: true }).click();
    await page.getByRole("textbox", { name: "List name" }).fill("Research");
    await page.getByRole("button", { name: "Create list", exact: true }).click();
    await page.getByRole("button", { name: "More actions for Research", exact: true }).click();
    await page.getByRole("button", { name: "Rename list", exact: true }).click();
    await page.getByRole("textbox", { name: "List name" }).fill("Project research");
    await page.getByRole("dialog", { name: "Rename list" }).getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("complementary", { name: "Notes navigation" }).getByRole("button", { name: "Project research", exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("textbox", { name: "Note title" })).toHaveValue("Design decisions");
    await expect(page.getByRole("textbox", { name: "Note body" }).getByRole("checkbox").first()).toBeChecked();
  });
});

test("keeps settings navigation stable, searches categories and changes theme", async () => {
  await planner(async (page) => {
    const settingsButton = page.getByRole("button", { name: "Settings", exact: true });
    await settingsButton.click();
    const categories = page.getByRole("navigation", { name: "Settings categories" });
    for (const name of ["Accounts", "General", "Hotkeys", "Alerts", "Data", "About", "Appearance"]) {
      await categories.getByRole("button", { name, exact: true }).click();
      await expect(categories.getByRole("button", { name, exact: true })).toHaveAttribute("aria-pressed", "true");
    }
    await page.getByRole("combobox", { name: "Theme", exact: true }).selectOption("dark");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.locator("html")).toHaveAttribute("data-color-theme", "hcb-neutral-dark");
    await capture(page, "settings-dark");
    await page.getByRole("textbox", { name: "Search settings", exact: true }).fill("nothing-matches-this-query");
    await expect(page.getByRole("status").filter({ hasText: "No settings match" })).toBeVisible();
    await page.getByRole("button", { name: "Clear search", exact: true }).click();
    await page.getByRole("button", { name: "Close settings", exact: true }).click();
    await expect(page.getByTestId("settings-workspace")).toHaveCount(0);
    await settingsButton.click();
    await expect(categories.getByRole("button", { name: "Appearance", exact: true })).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("settings-workspace")).toHaveCount(0);
    await capture(page, "calendar-dark");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-color-theme", "hcb-neutral-dark");
  });
});
