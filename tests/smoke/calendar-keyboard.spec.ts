import { expect } from "@playwright/test";
import { test, planner } from "./planner";
import { chooseCalendarView } from "./calendarActions";

test("Month and Week have one grid Tab stop, arrow navigation and keyboard event creation", async () => {
  await planner(async page => {
    await chooseCalendarView(page, "month");
    await page.getByRole("button", { name: "Choose calendar date" }).click();
    await page.getByLabel("Go to date", { exact: true }).fill("2027-01-12");
    await page.getByRole("button", { name: "Done", exact: true }).click();
    const month = page.getByRole("grid", { name: "Calendar month view", exact: true });
    await expect(month.locator('[role="gridcell"][tabindex="0"]')).toHaveCount(1);
    await month.locator('[role="gridcell"][tabindex="0"]').focus();
    await page.keyboard.press("ArrowRight"); await page.keyboard.press("ArrowDown");
    await expect(month.locator('[data-calendar-date="2027-01-04"]')).toBeFocused();
    await page.keyboard.press("End");
    await expect(month.locator('[data-calendar-date="2027-01-09"]')).toBeFocused();
    await expect(page.getByTestId("inspector-shell")).toHaveCount(0);
    await chooseCalendarView(page, "week");
    const week = page.getByRole("grid", { name: "Calendar week view", exact: true });
    await expect(week.locator('[role="gridcell"][tabindex="0"]')).toHaveCount(1);
    expect(await week.evaluate(grid => [...grid.querySelectorAll<HTMLElement>('button,[tabindex]')].filter(el => el.tabIndex >= 0).length)).toBe(1);
    await week.locator('[role="gridcell"][tabindex="0"]').focus();
    await page.keyboard.press("ArrowDown"); await page.keyboard.press("ArrowDown"); await page.keyboard.press("ArrowRight");
    await expect(week.locator('[data-calendar-cell-key="2027-01-11:1"]')).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("textbox", { name: "Event title", exact: true })).toBeVisible();
  });
});
