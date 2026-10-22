import { chooseCalendarView, newCalendarEvent } from "./calendarActions";
import { _electron as electron, expect, test, type Page, type ElectronApplication } from "@playwright/test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test.setTimeout(120_000);

async function planner(run: (page: Page, app: ElectronApplication) => Promise<void>) {
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
    await run(page, app);
    expect(errors).toEqual([]);
  } finally { await app.close(); rmSync(profile, { recursive: true, force: true }); }
}

const openPalette = (page: Page) => page.keyboard.press(process.platform === "darwin" ? "Meta+p" : "Control+p");
const navigate = (page: Page, section: string) => page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: section, exact: true }).click();
async function capture(page: Page, name: string) {
  mkdirSync("output/ui-review", { recursive: true });
  await page.locator(".inspector-item-menu").evaluateAll((menus) => Promise.all(menus.flatMap((menu) => menu.getAnimations().map((animation) => animation.finished.catch(() => undefined)))));
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

async function seedSearchFixtures(page: Page) {
  await page.evaluate(async () => {
      const day = new Date().toISOString().slice(0, 10);
      const results = await Promise.all([
        window.hcb!.tasks.create({ listId: "inbox", title: "Marmalade task" }),
        window.hcb!.notes.create({ title: "Marmalade note", body: "A searchable local document." }),
        window.hcb!.calendar.create({ calendarId: "primary", title: "Marmalade event", startsAt: `${day}T10:00:00Z`, endsAt: `${day}T11:00:00Z`, allDay: false })
      ]);
      for (const result of results) if (!result.ok) throw new Error(result.error.message);
      const secondNote = await window.hcb!.notes.create({ title: "Unrelated recent note", body: "Search should open the older result." });
      if (!secondNote.ok) throw new Error(secondNote.error.message);
      window.dispatchEvent(new Event("hcb:core-data-invalidated"));
    });
}

test("opens keyboard search from every section and searches local planner data", async () => {
  await planner(async (page) => {
    await seedSearchFixtures(page);
    for (const section of ["Notes", "Tasks", "Calendar"]) {
      await navigate(page, section);
      await openPalette(page);
      const search = page.getByRole("searchbox");
      await expect(search).toBeFocused();
      await expect(search).toHaveValue("");
      await search.fill("Marmalade");
      for (const title of ["Marmalade task", "Marmalade note", "Marmalade event"]) {
        await expect(page.getByRole("listbox").getByRole("option").filter({ has: page.getByText(title, { exact: true }) })).toBeVisible();
      }
      await search.fill("marmalade-no-such-item-7781");
      await expect(page.getByRole("listbox").getByRole("option")).toHaveCount(0);
      await page.keyboard.press("Escape");
      await expect(search).toHaveCount(0);
      await expect(page.getByTestId("app-shell")).toBeVisible();
    }
    await expect(page.getByRole("button", { name: "Search planner", exact: true })).toHaveCount(0);
    await openPalette(page);
    await expect(page.getByRole("searchbox")).toHaveValue("");
    await page.keyboard.press("Escape");
    await page.keyboard.press(process.platform === "darwin" ? "Meta+p" : "Control+p");
    await page.getByRole("searchbox").fill("Marmalade task");
    await expect(page.getByRole("listbox").getByRole("option").filter({ has: page.getByText("Marmalade task", { exact: true }) })).toBeVisible();
    await page.keyboard.press("Escape");
  });
});

test("opens search results after the destination view has mounted", async () => {
  await planner(async (page) => {
    await seedSearchFixtures(page);
    for (const [origin, title, field] of [
      ["Notes", "Marmalade task", "Task title"],
      ["Tasks", "Marmalade note", "Note title"],
      ["Notes", "Marmalade event", "Event title"]
    ]) {
      await navigate(page, origin);
      await openPalette(page);
      await page.getByRole("searchbox").fill(title);
      await page.getByRole("listbox").getByRole("option").filter({ has: page.getByText(title, { exact: true }) }).click();
      await expect(page.getByRole("textbox", { name: field, exact: true })).toHaveValue(title);
      await page.getByRole("button", { name: "Close inspector", exact: true }).click();
    }
  });
});

test("restores the active app pane and sends webpage links to the default browser", async () => {
  await planner(async (page, app) => {
    await page.evaluate(async () => {
      const note = await window.hcb!.notes.create({ title: "Browser handoff", body: "[Project reference](https://example.com/docs)" });
      if (!note.ok) throw new Error(note.error.message);
      const paneWorkspace = {
        focusedPaneId: "saved-notes", updatedAt: Date.now(),
        root: { id: "old-split", kind: "split", direction: "row", ratio: 0.5, children: [
          { id: "saved-web", kind: "leaf", content: { kind: "web", url: "https://example.com/old" } },
          { id: "saved-notes", kind: "leaf", content: { kind: "section", sectionId: "notes" } }
        ] }
      };
      const settings = await window.hcb!.settings.get();
      if (!settings.ok) throw new Error(settings.error.message);
      await window.hcb!.settings.update({ paneWorkspace, keybindings: {
        ...settings.data.keybindings,
        "pane.split.horizontal": "CmdOrCtrl+D", "pane.split.vertical": "CmdOrCtrl+Shift+D",
        "pane.create": "CmdOrCtrl+Alt+S", "web.tab.create": "CmdOrCtrl+Alt+T"
      } });
      localStorage.removeItem("hcb.paneWorkspace.v1");
    });
    await page.reload();
    await expect(page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "Notes", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("pane-leaf")).toHaveCount(1);
    await expect(page.getByTestId("pane-leaf")).toHaveAttribute("data-pane-id", "saved-notes");
    await expect(page.getByRole("button", { name: "Split view", exact: true })).toHaveCount(0);
    const primary = process.platform === "darwin" ? "Meta" : "Control";
    for (const suffix of ["+d", "+Shift+d", "+Alt+s", "+Alt+t"]) await page.keyboard.press(primary + suffix);
    await expect(page.getByTestId("pane-leaf")).toHaveCount(1);
    await page.getByRole("button", { name: "Open note Browser handoff", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Note title" })).toHaveValue("Browser handoff");
    await app.evaluate(({ shell }) => {
      const state = globalThis as typeof globalThis & { openedPlannerLinks: string[] };
      state.openedPlannerLinks = [];
      shell.openExternal = async (url) => { state.openedPlannerLinks.push(url); };
    });
    const appUrl = page.url();
    await page.getByRole("link", { name: "Project reference", exact: true }).click();
    await expect.poll(() => app.evaluate(() => (globalThis as typeof globalThis & { openedPlannerLinks: string[] }).openedPlannerLinks)).toEqual(["https://example.com/docs"]);
    expect(page.url()).toBe(appUrl);
    await expect(page.locator("webview")).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: "Note title" })).toHaveValue("Browser handoff");
    await expect.poll(async () => page.evaluate(async () => {
      const settings = await window.hcb!.settings.get();
      return settings.ok && settings.data.paneWorkspace.root.kind;
    })).toBe("leaf");
    await page.reload();
    await expect(page.getByTestId("pane-leaf")).toHaveAttribute("data-pane-id", "saved-notes");
  });
});

test("uses the reference command menu with keyboard navigation, motion and narrow layouts", async () => {
  await planner(async (page) => {
    const palette = page.locator(".command-palette");
    const search = page.getByRole("searchbox");
    for (const mode of ["light", "dark"] as const) {
      // Retired preferences must also land on the new defaults.
      await page.evaluate(async (theme) => {
        await window.hcb!.settings.update({ theme, colorTheme: "catppuccin-latte" });
        window.dispatchEvent(new Event("hcb:core-data-invalidated"));
      }, mode);
      await expect(page.locator("html")).toHaveAttribute("data-color-theme", `hcb-neutral-${mode}`);
      await openPalette(page);
      await expect(search).toBeFocused();
      await expect(palette).toHaveCSS("animation-name", "command-menu-in");
      await expect(palette).toHaveCSS("animation-duration", "0.2s");
      await expect(page.locator(".command-palette-group").getByText("Navigation", { exact: true })).toHaveCount(1);
      const box = await palette.boundingBox();
      expect(box!.width).toBeLessThanOrEqual(512);
      expect(Math.abs(box!.x + box!.width / 2 - 590)).toBeLessThan(2);
      await page.keyboard.press("End");
      const selected = page.getByRole("option", { selected: true });
      await expect(selected).toHaveText("Open Sync Issues");
      await expect(selected).toBeInViewport();
      await page.keyboard.press("Home");
      await expect(selected).toHaveText("Quick Add");
      for (let index = 0; index < 16; index += 1) {
        await page.keyboard.press("ArrowDown");
        await expect(selected).toBeEnabled();
      }
      await page.keyboard.press("Home");
      await capture(page, `command-palette-${mode}`);
      await search.fill("Go to Notes");
      await page.keyboard.press("Enter");
      await expect(palette).toHaveCount(0);
      await expect(page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "Notes", exact: true })).toHaveAttribute("aria-current", "page");
      await openPalette(page);
      await expect(search).toBeFocused();
      await page.mouse.click(10, 10);
      await expect(palette).toHaveCount(0);
    }
    await page.setViewportSize({ width: 640, height: 480 });
    await openPalette(page);
    await expect(search).toBeFocused();
    const narrowBox = await palette.boundingBox();
    expect(narrowBox!.x).toBeGreaterThanOrEqual(16);
    expect(narrowBox!.y).toBeGreaterThanOrEqual(16);
    expect(narrowBox!.y + narrowBox!.height).toBeLessThanOrEqual(464);
    await capture(page, "command-palette-narrow");
    await page.getByRole("button", { name: "Close command palette", exact: true }).click();
    await expect(palette).toHaveCount(0);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openPalette(page);
    expect(await palette.evaluate((element) => parseFloat(getComputedStyle(element).animationDuration))).toBeLessThan(0.001);
    await page.keyboard.press("Escape");
    await expect(palette).toHaveCount(0);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.evaluate(async () => {
      await window.hcb!.settings.update({ disableAnimations: true });
      window.dispatchEvent(new Event("hcb:core-data-invalidated"));
    });
    await expect(page.locator("html")).toHaveAttribute("data-animations", "disabled");
    await openPalette(page);
    expect(await palette.evaluate((element) => parseFloat(getComputedStyle(element).animationDuration))).toBeLessThan(0.001);
    await page.keyboard.press("Escape");
    await expect(palette).toHaveCount(0);
  });
});

test("keeps the mini calendar visible and synchronizes dates across sections and reloads", async () => {
  await planner(async (page) => {
    const mini = page.getByRole("region", { name: "Mini calendar" });
    await expect(mini).toBeVisible();
    await expect(mini.locator(".mini-calendar-day")).toHaveCount(42);
    await expect(page.getByRole("button", { name: /^(Collapse|Expand) (navigation|task sidebar|notes sidebar)$/ })).toHaveCount(0);
    await chooseCalendarView(page, "week");
    await page.getByRole("button", { name: "Choose calendar date" }).click();
    await page.getByLabel("Go to date", { exact: true }).fill("2026-12-31");
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await expect(mini.getByRole("heading")).toHaveText("January 2027");
    await expect(mini.locator('td[data-in-range="true"]')).toHaveCount(7);
    await expect(mini.locator('[data-date="2026-12-31"]')).toHaveAttribute("aria-pressed", "true");
    await mini.getByRole("button", { name: "Mini calendar: next month", exact: true }).click();
    await expect(mini.getByRole("heading")).toHaveText("February 2027");
    await expect(page.getByRole("button", { name: "Choose calendar date" })).toContainText("2027");
    await navigate(page, "Notes");
    await expect(mini).toBeVisible();
    await mini.locator('[data-date="2027-02-09"]').click();
    await expect(page.getByTestId("calendar-view")).toHaveAttribute("data-range-start", "2027-02-07T00:00:00.000Z");
    await expect(mini.locator('[data-date="2027-02-09"]')).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Next week", exact: true }).click();
    await expect(mini.locator('[data-date="2027-02-16"]')).toHaveAttribute("aria-pressed", "true");
    await navigate(page, "Tasks");
    await expect(mini).toBeVisible();
    const day = mini.locator('[data-date="2027-02-16"]');
    await day.focus();
    await page.keyboard.press("ArrowRight");
    await expect(mini.locator('[data-date="2027-02-17"]')).toBeFocused();
    await page.keyboard.press("PageDown");
    await expect(mini.locator('[data-date="2027-03-17"]')).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("calendar-view")).toHaveAttribute("data-range-start", "2027-03-14T00:00:00.000Z");
    await page.reload();
    await expect(mini).toBeVisible();
    await expect(mini.locator('[data-date="2027-03-17"]')).toHaveAttribute("aria-pressed", "true");
    await mini.getByRole("button", { name: "Mini calendar: return to today", exact: true }).click();
    await expect(mini.locator('[aria-current="date"]')).toHaveAttribute("aria-pressed", "true");
    await capture(page, "persistent-sidebar-light");
    await page.evaluate(async () => {
      await window.hcb!.settings.update({ theme: "dark" });
      window.dispatchEvent(new Event("hcb:core-data-invalidated"));
      const preferences = JSON.parse(localStorage.getItem("hcb.panePreferences.v1") ?? "{}");
      preferences.default = { ...preferences.default, "navigation.collapsed": true };
      localStorage.setItem("hcb.panePreferences.v1", JSON.stringify(preferences));
    });
    await page.reload();
    await expect(mini).toBeVisible();
    await expect(page.getByRole("button", { name: "Expand navigation" })).toHaveCount(0);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await capture(page, "persistent-sidebar-dark");
    await navigate(page, "Tasks");
    await page.getByRole("button", { name: "New task", exact: true }).click();
    await page.getByRole("textbox", { name: "Task title", exact: true }).fill("Preserve this draft");
    await mini.locator('[aria-current="date"]').click();
    await expect.poll(async () => page.evaluate(async () => { const result = await window.hcb!.tasks.list({ status: "all" }); return result.ok && result.data.items.some((task) => task.title === "Preserve this draft"); })).toBe(true);
    await expect(page.getByTestId("calendar-view")).toBeVisible();
    await page.setViewportSize({ width: 640, height: 480 });
    await expect(mini).toBeVisible();
    await expect(page.getByRole("button", { name: "Settings", exact: true })).toBeInViewport();
    await noOverflow(page);
  });
});

test("uses the display timezone for mini-calendar Today across leap day and midnight", async () => {
  await planner(async (page) => {
    await page.clock.setFixedTime(new Date("2028-02-29T23:30:00Z"));
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    const mini = page.getByRole("region", { name: "Mini calendar" });
    await mini.getByRole("button", { name: "Mini calendar: return to today", exact: true }).click();
    await expect(mini.locator('[data-date="2028-02-29"]')).toHaveAttribute("aria-current", "date");
    await expect(mini.locator('[data-date="2028-02-29"]')).toHaveAttribute("aria-pressed", "true");
    await page.evaluate(async () => {
      await window.hcb!.settings.update({ defaultTimeZone: "Pacific/Kiritimati" });
      window.dispatchEvent(new Event("hcb:core-data-invalidated"));
    });
    await expect(mini.locator('[data-date="2028-03-01"]')).toHaveAttribute("aria-current", "date");
    await expect(mini.locator('[data-date="2028-03-01"]')).toHaveAttribute("aria-pressed", "true");
    await page.clock.setFixedTime(new Date("2028-03-01T10:01:00Z"));
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(mini.locator('[data-date="2028-03-02"]')).toHaveAttribute("aria-current", "date");
    await expect(mini.locator('[data-date="2028-03-01"]')).toHaveAttribute("aria-pressed", "true");
  });
});

test("navigates calendar views, filters sources, edits in context and preserves drafts", async () => {
  await planner(async (page) => {
    // Existing profiles that selected the retired pop-up mode must dock too.
    await page.evaluate(() => {
      const preferences = JSON.parse(localStorage.getItem("hcb.panePreferences.v1") ?? "{}");
      preferences.default = { ...preferences.default, "inspector.docked": false };
      localStorage.setItem("hcb.panePreferences.v1", JSON.stringify(preferences));
    });
    await page.reload();
    await expect(page.getByTestId("app-shell")).toBeVisible();
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
      await chooseCalendarView(page, view);
      await expect(page.getByRole("button", { name: "Calendar view", exact: true })).toContainText(view === "multiDay" ? "3 days" : view === "agenda" ? "Agenda" : view[0].toUpperCase() + view.slice(1));
      await noOverflow(page);
    }
    const source = page.getByRole("complementary", { name: "Workspace navigation" }).locator(".calendar-source-toggle").first();
    await source.click();
    await expect(calendar.getByText("Design review", { exact: true })).toHaveCount(0);
    await source.click();
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
    await page.getByRole("textbox", { name: "Event title" }).fill("Unsaved planning");
    await navigate(page, "Tasks");
    await expect(page.getByTestId("tasks-board")).toBeVisible();
    await expect.poll(async () => page.evaluate(async (id) => { const event = await window.hcb!.calendar.get({ id }); return event.ok && event.data.title; }, fixture.ids[1])).toBe("Unsaved planning");
    await navigate(page, "Calendar");
    await calendar.getByText("Design review", { exact: true }).click();
    await page.getByRole("textbox", { name: "Event location" }).fill("Studio 2");
    await page.getByRole("button", { name: "Close inspector", exact: true }).click();
    await expect.poll(async () => page.evaluate(async (id) => { const event = await window.hcb!.calendar.get({ id }); return event.ok && event.data.location; }, fixture.ids[0])).toBe("Studio 2");
    await expect(inspector).toHaveCount(0);
    await page.getByRole("button", { name: "Choose calendar date" }).click();
    await page.getByLabel("Go to date", { exact: true }).fill("2027-01-15");
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await expect(calendar).toHaveAttribute("data-range-start", "2027-01-15T00:00:00.000Z");
    await chooseCalendarView(page, "month");
    await expect(page.getByRole("button", { name: "Choose calendar date" })).toContainText("January 2027");
    await chooseCalendarView(page, "agenda");
    await page.getByRole("button", { name: "Jump to today" }).click();
    await expect(calendar).toHaveAttribute("data-range-start", `${fixture.day}T00:00:00.000Z`);
    await chooseCalendarView(page, "week");
    await expect(page.getByText("Calendar range could not be loaded.", { exact: true })).toHaveCount(0);
    await capture(page, "calendar-light");
    await newCalendarEvent(page);
    await noOverflow(page);
    await capture(page, "calendar-context");
    await page.setViewportSize({ width: 960, height: 620 });
    await expect(inspector).toHaveAttribute("data-inspector-layout", "sheet");
    await expect(inspector).toHaveAttribute("aria-modal", "true");
    await page.getByRole("button", { name: "Close inspector", exact: true }).click();
    await noOverflow(page);
    await expect(page.getByTestId("pane-leaf")).toHaveCount(1);
    await noOverflow(page);
    await capture(page, "calendar-960");
  });
});

test("validates event edits and requires a scope for recurring edits", async () => {
  await planner(async (page) => {
    await newCalendarEvent(page);
    const title = page.getByRole("textbox", { name: "Event title" });
    await title.fill("Daily design check-in");
    await title.press("Tab");
    await expect(page.getByTestId("inspector-shell")).not.toHaveAttribute("data-inspector-id", "new");
    await title.fill("");
    await title.press("Tab");
    await expect(page.getByText("Title is required.", { exact: true })).toBeVisible();
    await title.fill("Daily design check-in");
    await page.getByRole("button", { name: "More details", exact: true }).click();
    await page.getByRole("combobox", { name: "Event repeat frequency" }).selectOption("daily");
    await page.getByRole("button", { name: "Close inspector", exact: true }).click();
    await expect(page.getByTestId("inspector-shell")).toHaveCount(0);
    await page.getByTestId("calendar-view").getByText("Daily design check-in", { exact: true }).click();
    await title.fill("Daily planning check-in");
    await title.press("Tab");
    const scope = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Save recurring event" }) }).last();
    await expect(scope).toBeVisible();
    await scope.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(title).toHaveValue("Daily planning check-in");
    await page.getByRole("button", { name: "Close inspector", exact: true }).click();
    await scope.getByRole("button", { name: "Entire series", exact: true }).click();
    await expect(scope).toHaveCount(0);
    await expect(page.getByTestId("inspector-shell")).toBeVisible();
    await page.getByRole("button", { name: "Close inspector", exact: true }).click();
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
    await page.getByRole("button", { name: "Close inspector", exact: true }).click();
    await expect(page.getByTestId("inspector-shell")).toHaveCount(0);
    const task = page.getByRole("button", { name: "Ship the new planner", exact: true });
    await expect(task).toBeVisible(); await task.click();
    await page.getByRole("textbox", { name: "Task title" }).fill("Ship the polished planner");
    await page.getByRole("button", { name: "Close inspector", exact: true }).click();
    await expect(page.getByTestId("inspector-shell")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Ship the polished planner", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Complete Ship the polished planner", exact: true }).click();
    await page.getByRole("button", { name: "Completed (1)", exact: true }).click();
    await page.getByRole("button", { name: "Reopen Ship the polished planner", exact: true }).click();
    await expect(page.getByRole("button", { name: "Complete Ship the polished planner", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Board", exact: true }).click();
    await expect(page.getByTestId("tasks-board")).toHaveAttribute("data-presentation", "board");
    await page.getByRole("button", { name: "List", exact: true }).click();
    await expect(page.getByRole("button", { name: "Collapse navigation" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "New task", exact: true })).toBeVisible();
    await capture(page, "tasks-list");
    await page.reload();
    await expect(page.getByTestId("tasks-board")).toHaveAttribute("data-presentation", "list");
    await expect(page.getByTestId("inspector-shell")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Ship the polished planner", exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "Mini calendar" })).toBeVisible();
  });
});

test("creates a document and autosaves edits when moving between sections", async () => {
  await planner(async (page) => {
    await navigate(page, "Notes");
    await page.getByRole("button", { name: "New note", exact: true }).click();
    await page.getByRole("textbox", { name: "Note title" }).fill("Design decisions");
    await page.getByRole("textbox", { name: "Note body" }).fill("The calendar stays visible while editing.");
    await page.getByRole("textbox", { name: "Note title" }).focus();
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
    await page.getByRole("textbox", { name: "Note title" }).focus();
    await expect.poll(async () => page.evaluate(async () => { const result = await window.hcb!.notes.list({}); return result.ok && result.data.items.some((note) => note.title === "Design decisions" && note.body.includes("- [x] Verify all editing flows")); })).toBe(true);
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
    await expect(page.getByRole("textbox", { name: "Search color themes" })).toHaveCount(0);
    const themeSelect = page.getByRole("combobox", { name: "Theme", exact: true });
    await expect(themeSelect.locator("option")).toHaveText(["Follow system", "Light", "Dark"]);
    await themeSelect.selectOption("light");
    await expect(page.locator("html")).toHaveAttribute("data-color-theme", "hcb-neutral-light");
    await page.emulateMedia({ colorScheme: "dark" });
    await themeSelect.selectOption("system");
    await expect(page.locator("html")).toHaveAttribute("data-color-theme", "hcb-neutral-dark");
    await page.emulateMedia({ colorScheme: "light" });
    await expect(page.locator("html")).toHaveAttribute("data-color-theme", "hcb-neutral-light");
    await themeSelect.selectOption("dark");
    await expect(page.locator("html")).toHaveAttribute("data-color-theme", "hcb-neutral-dark");
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

test("autosaves inspector fields and supports copy, duplicate, delete and both menu themes", async () => {
  await planner(async (page, app) => {
    await newCalendarEvent(page);
    const panel = page.getByTestId("inspector-shell");
    await expect(panel.getByRole("button", { name: /Save changes|Create event/ })).toHaveCount(0);
    await page.getByRole("button", { name: "Item type", exact: true }).click();
    await expect(page.getByRole("menuitemradio")).toHaveText(["Event", "Task", "Birthday", "Note"]);
    await page.getByRole("menuitemradio", { name: "Event", exact: true }).press("End");
    await expect(page.getByRole("menuitemradio", { name: "Note", exact: true })).toBeFocused();
    await page.keyboard.press("Escape");
    const title = page.getByRole("textbox", { name: "Event title" });
    await title.fill("Architecture review");
    await title.press("Tab");
    await expect(panel).not.toHaveAttribute("data-inspector-id", "new");
    const id = (await panel.getAttribute("data-inspector-id"))!;
    await page.getByRole("textbox", { name: "Event notes" }).fill("Review the column assignment algorithm.");
    await page.getByRole("textbox", { name: "Event location" }).fill("Studio 3");
    await page.getByRole("textbox", { name: "Event location" }).press("Tab");
    await page.getByRole("combobox", { name: "Event visibility" }).selectOption("private");
    await page.getByRole("combobox", { name: "Event reminder mode" }).selectOption("custom");
    await expect.poll(async () => page.evaluate(async (id) => {
      const result = await window.hcb!.calendar.get({ id });
      return result.ok && { notes: result.data.notes, location: result.data.location, visibility: result.data.visibility, custom: !result.data.remindersUseDefault };
    }, id)).toEqual({ notes: "Review the column assignment algorithm.", location: "Studio 3", visibility: "private", custom: true });
    await panel.getByTestId("inspector-body").evaluate((element) => { element.scrollTop = 0; });
    await capture(page, "reference-inspector-light");
    await page.getByRole("button", { name: "Item actions", exact: true }).click();
    await expect(page.getByRole("menuitem")).toHaveText(["Cut", "Copy", "Duplicate", "Delete"]);
    await page.getByRole("menuitem", { name: "Copy", exact: true }).click();
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toContain("Architecture review\n\nReview the column assignment algorithm.");
    await page.getByRole("button", { name: "Item actions", exact: true }).click();
    await page.getByRole("menuitem", { name: "Duplicate", exact: true }).click();
    await expect(title).toHaveValue("Architecture review (copy)");
    await expect(panel).not.toHaveAttribute("data-inspector-id", id);
    const copyId = (await panel.getAttribute("data-inspector-id"))!;
    await page.getByRole("button", { name: "Item actions", exact: true }).click();
    await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
    await expect(panel).toHaveCount(0);
    expect(await page.evaluate(async (id) => (await window.hcb!.calendar.get({ id })).ok, copyId)).toBe(false);
    expect(await page.evaluate(async (id) => (await window.hcb!.calendar.get({ id })).ok, id)).toBe(true);
    await page.evaluate(async (id) => {
      await window.hcb!.settings.update({ theme: "dark" });
      window.dispatchEvent(new Event("hcb:core-data-invalidated"));
      window.dispatchEvent(new CustomEvent("hcb:open-entity", { detail: { kind: "event", id } }));
    }, id);
    await expect(title).toHaveValue("Architecture review");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.getByRole("button", { name: "Item type", exact: true }).click();
    await capture(page, "reference-inspector-dark-menu");
    await page.keyboard.press("Escape");
    await page.setViewportSize({ width: 960, height: 620 });
    await expect(panel).toHaveAttribute("data-inspector-layout", "sheet");
    await noOverflow(page);
    await capture(page, "reference-inspector-narrow");
  });
});

test("confirms replacement and preserves content across task, note, birthday and event conversions", async () => {
  await planner(async (page) => {
    const confirmations: string[] = [];
    let acceptConversion = false;
    page.on("dialog", async (dialog) => { confirmations.push(dialog.message()); if (acceptConversion) await dialog.accept(); else await dialog.dismiss(); });
    await navigate(page, "Tasks");
    await page.getByRole("button", { name: "New task", exact: true }).click();
    await page.getByRole("textbox", { name: "Task title" }).fill("Conversion keeps my writing");
    await page.getByRole("textbox", { name: "Task notes" }).fill("Keep this description through every type.");
    await page.getByRole("textbox", { name: "Task title" }).focus();
    const panel = page.getByTestId("inspector-shell");
    await expect(panel).not.toHaveAttribute("data-inspector-id", "new");
    const taskId = (await panel.getAttribute("data-inspector-id"))!;
    const changeType = async (kind: string) => {
      await page.getByRole("button", { name: "Item type", exact: true }).click();
      await page.getByRole("menuitemradio", { name: kind, exact: true }).click();
    };
    await changeType("Note");
    await expect.poll(() => confirmations.length).toBe(1);
    await expect(panel).toHaveAttribute("data-inspector-kind", "task");
    expect(await page.evaluate(async (id) => (await window.hcb!.tasks.get({ id })).ok, taskId)).toBe(true);
    acceptConversion = true;
    await changeType("Note");
    await expect(panel).toHaveAttribute("data-inspector-kind", "note");
    await expect(panel).not.toHaveAttribute("data-inspector-id", /^note-draft-/);
    const noteId = (await panel.getAttribute("data-inspector-id"))!;
    await expect(page.getByRole("textbox", { name: "Note body" })).toContainText("Keep this description through every type.");
    await expect.poll(async () => page.evaluate(async (id) => { const result = await window.hcb!.tasks.get({ id }); return result.ok && result.data.status; }, taskId)).toBe("deleted");
    await changeType("Birthday");
    await expect(page.getByRole("textbox", { name: "Birthday title" })).toHaveValue("Conversion keeps my writing");
    await expect(panel).not.toHaveAttribute("data-inspector-id", "new");
    const birthdayId = (await panel.getAttribute("data-inspector-id"))!;
    await expect.poll(async () => page.evaluate(async (id) => {
      const result = await window.hcb!.calendar.get({ id });
      return result.ok && { kind: result.data.hcbKind, allDay: result.data.allDay, notes: result.data.notes };
    }, birthdayId)).toEqual({ kind: "birthday", allDay: true, notes: "Keep this description through every type." });
    await expect.poll(async () => page.evaluate(async (id) => (await window.hcb!.notes.get({ id })).ok, noteId)).toBe(false);
    await page.getByRole("button", { name: "Close inspector", exact: true }).click();
    await page.reload();
    await expect(page.getByTestId("app-shell")).toBeVisible();
    await page.evaluate((id) => window.dispatchEvent(new CustomEvent("hcb:open-entity", { detail: { kind: "event", id } })), birthdayId);
    await expect(page.getByRole("textbox", { name: "Birthday title" })).toHaveValue("Conversion keeps my writing");
    await changeType("Event");
    const scope = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Save recurring event" }) }).last();
    await scope.getByRole("button", { name: "Entire series", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Event title" })).toHaveValue("Conversion keeps my writing");
    await expect.poll(async () => page.evaluate(async (id) => { const result = await window.hcb!.calendar.get({ id }); return result.ok && result.data.hcbKind; }, birthdayId)).toBeNull();
    await changeType("Task");
    await expect(panel).toHaveAttribute("data-inspector-kind", "task");
    await expect(page.getByRole("textbox", { name: "Task notes" })).toContainText("Keep this description through every type.");
    await expect.poll(async () => page.evaluate(async (id) => (await window.hcb!.calendar.get({ id })).ok, birthdayId)).toBe(false);
    expect(confirmations.length).toBe(5);
  });
});
