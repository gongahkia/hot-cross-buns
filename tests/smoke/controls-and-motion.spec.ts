import { expect, test, type Page } from "@playwright/test";
import { planner, navigate, capture } from "./planner";
import { chooseOption } from "./controls";
import { chooseCalendarView, newCalendarEvent } from "./calendarActions";

test.setTimeout(120_000);

async function openSettings(page: Page, category: string) {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("navigation", { name: "Settings categories" }).getByRole("button", { name: category, exact: true }).click();
}

for (const theme of ["light", "dark"] as const) {
  test(`settings dropdowns paint visible choices, fit the window and dismiss only themselves in ${theme}`, async () => {
    await planner(async (page) => {
      await page.evaluate(async (theme) => { await window.hcb!.settings.update({ theme }); window.dispatchEvent(new Event("hcb:core-data-invalidated")); }, theme);
      await openSettings(page, "Appearance");
      let checked = 0;
      for (const category of ["Appearance", "General", "Alerts", "Accounts"]) {
        await page.getByRole("navigation", { name: "Settings categories" }).getByRole("button", { name: category, exact: true }).click();
        const controls = page.getByRole("combobox");
        for (let index = 0; index < await controls.count(); index++) {
          const control = controls.nth(index);
          if (!await control.isVisible() || !await control.isEnabled()) continue;
          await control.click();
          const menu = page.getByRole("listbox");
          await expect(menu).toBeVisible();
          await expect(menu.getByRole("option").first()).toBeAttached();
          await expect(menu.locator('[data-highlighted]').first()).toBeVisible();
          expect(await menu.innerText()).not.toBe("");
          const box = await menu.boundingBox();
          expect(box!.width).toBeGreaterThan(40); expect(box!.height).toBeGreaterThan(20);
          expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.y).toBeGreaterThanOrEqual(0);
          expect(box!.x + box!.width).toBeLessThanOrEqual(1181); expect(box!.y + box!.height).toBeLessThanOrEqual(761);
          if (index === 0) await capture(page, `choices-${category.toLowerCase()}-${theme}`);
          await page.keyboard.press("Escape");
          await expect(menu).toBeHidden();
          await expect(control).toBeFocused();
          await expect(page.getByTestId("settings-workspace")).toBeVisible();
          checked++;
        }
      }
      expect(checked).toBeGreaterThanOrEqual(12);
      // Radix's hidden form mirror is allowed; no visible native popup triggers.
      await expect(page.locator("select:visible")).toHaveCount(0);
    });
  });
}

test("dropdown keyboard selection and empty System choices persist across reload", async () => {
  await planner(async (page) => {
    await openSettings(page, "Appearance");
    const theme = page.getByRole("combobox", { name: "Theme", exact: true });
    await theme.focus(); await theme.press("Enter");
    await page.keyboard.press("End"); await page.keyboard.press("Enter");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await chooseOption(page, theme, "Follow system");
    const font = page.getByRole("combobox", { name: "Font family", exact: true });
    await chooseOption(page, font, "System");
    await page.getByRole("navigation", { name: "Settings categories" }).getByRole("button", { name: "General", exact: true }).click();
    await chooseOption(page, page.getByRole("combobox", { name: "Sync mode" }), "Balanced");
    await expect.poll(async () => page.evaluate(async () => { const result = await window.hcb!.settings.get(); return result.ok && result.data.syncMode; })).toBe("balanced");
    await page.reload();
    await openSettings(page, "General");
    await expect(page.getByRole("combobox", { name: "Sync mode" })).toHaveText("Balanced");
  });
});

test("task date picker selects leap day, changes priority, autosaves, reloads and clears", async () => {
  await planner(async (page) => {
    await navigate(page, "Tasks");
    await page.getByRole("button", { name: "New task", exact: true }).click();
    await page.getByRole("textbox", { name: "Task title", exact: true }).fill("Leap day review");
    await page.getByRole("button", { name: "Choose task due date", exact: true }).click();
    const picker = page.getByRole("dialog", { name: "Task due date picker" });
    await picker.getByRole("spinbutton", { name: "Picker year" }).fill("");
    await picker.getByRole("spinbutton", { name: "Picker year" }).pressSequentially("2028");
    await chooseOption(page, picker.getByRole("combobox", { name: "Picker month" }), "February");
    await picker.getByRole("button", { name: "Tuesday, February 29, 2028", exact: true }).click();
    await expect(page.getByLabel("Task due date", { exact: true })).toHaveValue("2028-02-29");
    await chooseOption(page, page.getByRole("combobox", { name: "Task priority" }), "High");
    await page.getByRole("combobox", { name: "Task priority" }).click();
    await page.keyboard.press("l");
    await expect(page.getByRole("option", { name: "Low", exact: true })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("combobox", { name: "Task priority" })).toHaveText("Low");
    await chooseOption(page, page.getByRole("combobox", { name: "Task priority" }), "High");
    await page.getByRole("button", { name: "Close inspector", exact: true }).click();
    await page.reload();
    await page.getByRole("button", { name: "Leap day review", exact: true }).click();
    await expect(page.getByLabel("Task due date", { exact: true })).toHaveValue("2028-02-29");
    await expect(page.getByRole("combobox", { name: "Task priority" })).toHaveText("High");
    await page.getByRole("button", { name: "Choose task due date", exact: true }).click();
    await capture(page, "task-due-date-picker");
    await page.keyboard.press("ArrowRight"); await page.keyboard.press("Enter");
    await expect(page.getByLabel("Task due date", { exact: true })).toHaveValue("2028-03-01");
    await page.getByRole("button", { name: "Choose task due date", exact: true }).click();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("inspector-shell")).toBeVisible();
    await page.getByRole("button", { name: "Choose task due date", exact: true }).click();
    await picker.getByRole("button", { name: "Clear", exact: true }).click();
    await chooseOption(page, page.getByRole("combobox", { name: "Task priority" }), "None");
    await page.getByRole("button", { name: "Close inspector", exact: true }).click();
    await page.getByRole("button", { name: "Leap day review", exact: true }).click();
    await expect(page.getByLabel("Task due date", { exact: true })).toHaveValue("");
    await expect(page.getByRole("combobox", { name: "Task priority" })).toHaveText("None");
  });
});

test("event date and nested time menus edit without closing the inspector, including narrow layouts", async () => {
  await planner(async (page) => {
    await navigate(page, "Calendar"); await newCalendarEvent(page);
    await page.getByRole("textbox", { name: "Event title", exact: true }).fill("Time picker review");
    await page.getByLabel("All day", { exact: true }).uncheck();
    await page.setViewportSize({ width: 850, height: 700 });
    await page.getByRole("button", { name: "Choose event starts", exact: true }).click();
    const picker = page.getByRole("dialog", { name: "Event starts picker" });
    await chooseOption(page, picker.getByRole("combobox", { name: "Picker time" }), "09:15");
    await expect(page.getByLabel("Event starts", { exact: true })).toHaveValue(/T09:15$/);
    await picker.getByRole("combobox", { name: "Picker time" }).click();
    await page.keyboard.press("Escape");
    await expect(picker).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(picker).toBeHidden();
    await expect(page.getByTestId("inspector-shell")).toBeVisible();
    await page.getByRole("button", { name: "Choose event starts", exact: true }).click();
    await capture(page, "event-date-picker-narrow");
    await picker.getByRole("button", { name: "Close", exact: true }).click();
    await expect(page.locator("select:visible")).toHaveCount(0);
  });
});

for (const theme of ["light", "dark"] as const) {
  test(`calendar timescales animate and remain interactive in ${theme}`, async () => {
    await planner(async (page) => {
      await page.evaluate(async (theme) => { await window.hcb!.settings.update({ theme, disableAnimations: false }); window.dispatchEvent(new Event("hcb:core-data-invalidated")); }, theme);
      await navigate(page, "Calendar");
      await page.evaluate(() => {
        const probe = { running: true, intermediateFrames: 0 };
        (window as any).__calendarMotionProbe = probe;
        function sample() {
          const frame = document.querySelector('.calendar-transition-frame[data-active="true"]');
          const opacity = frame ? Number(getComputedStyle(frame).opacity) : 1;
          if (opacity > 0 && opacity < 1) probe.intermediateFrames++;
          if (probe.running) requestAnimationFrame(sample);
        }
        requestAnimationFrame(sample);
      });
      for (const view of ["day", "week", "month", "multiDay", "day"]) {
        await chooseCalendarView(page, view);
        const name = view === "multiDay" ? "multi-day" : view;
        await expect(page.getByRole("grid", { name: `Calendar ${name} view`, exact: true })).toBeVisible();
        await expect(page.locator('.calendar-transition-frame[data-active="true"]')).toHaveCount(1);
        await expect(page.locator('.calendar-transition-frame')).toHaveCount(1);
        expect(await page.locator('.calendar-transition-frame').evaluate(el => getComputedStyle(el).transform)).toMatch(/none|matrix\(1, 0, 0, 1, 0, 0\)/);
        await capture(page, `timescale-${view}-${theme}`);
      }
      expect(await page.evaluate(() => { const probe = (window as any).__calendarMotionProbe; probe.running = false; return probe.intermediateFrames; })).toBeGreaterThan(2);
      for (const count of [2, 3, 4, 5, 6, 7, 8, 9]) {
        await page.getByRole("button", { name: "Calendar view", exact: true }).click();
        await page.getByRole("menuitem", { name: "Number of days" }).hover();
        await page.getByRole("menuitem", { name: `${count} days`, exact: true }).click();
        await expect(page.getByRole("grid", { name: "Calendar multi-day view" }).getByRole("columnheader")).toHaveCount(count);
      }
      await page.getByRole("button", { name: "Calendar view", exact: true }).click();
      await page.getByRole("menuitem", { name: "Number of days" }).hover();
      await page.getByRole("menuitem", { name: "Other…" }).click();
      await page.getByRole("spinbutton", { name: "Number of days" }).fill("12");
      await page.getByRole("button", { name: "Apply", exact: true }).click();
      await expect(page.getByRole("grid", { name: "Calendar multi-day view" }).getByRole("columnheader")).toHaveCount(12);
      await page.emulateMedia({ reducedMotion: "reduce" });
      await chooseCalendarView(page, "week");
      await expect(page.locator('.calendar-transition')).toHaveAttribute("data-motion", "off");
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await page.evaluate(async () => { await window.hcb!.settings.update({ disableAnimations: true }); window.dispatchEvent(new Event("hcb:core-data-invalidated")); });
      await expect(page.locator("html")).toHaveAttribute("data-animations", "disabled");
      await chooseCalendarView(page, "month");
      await expect(page.locator('.calendar-transition')).toHaveAttribute("data-motion", "off");
      await newCalendarEvent(page);
      await expect(page.getByRole("textbox", { name: "Event title", exact: true })).toBeVisible();
    });
  });
}

test("Markdown style choices apply to note content and survive reopening", async () => {
  await planner(async (page) => {
    await navigate(page, "Notes");
    await page.getByRole("button", { name: "New note", exact: true }).click();
    await page.getByRole("textbox", { name: "Note title", exact: true }).fill("Formatting menu check");
    const body = page.getByRole("textbox", { name: "Note body", exact: true });
    await body.fill("A useful heading");
    await chooseOption(page, page.getByRole("combobox", { name: "Text style", exact: true }), "Heading 2");
    await expect(body.locator("h2")).toHaveText("A useful heading");
    await page.getByRole("combobox", { name: "Text style", exact: true }).click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("textbox", { name: "Note title", exact: true })).toBeVisible();
    await navigate(page, "Calendar"); await navigate(page, "Notes");
    await page.getByRole("button", { name: /Formatting menu check/ }).first().click();
    await expect(body.locator("h2")).toHaveText("A useful heading");
  });
});
