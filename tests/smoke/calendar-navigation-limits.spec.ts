import { expect, test } from "@playwright/test";
import { planner } from "./planner";
import { chooseCalendarView } from "./calendarActions";

test("calendar limits explain stopped navigation and leave a way back to today", async () => {
  await planner(async page => {
    await page.clock.setFixedTime(new Date("2027-01-12T12:00:00Z"));
    await page.evaluate(async () => {
      const result = await window.hcb!.settings.update({ eventRetentionDaysBack: 1, monthScrollFutureMonths: 0 });
      if (!result.ok) throw new Error(result.error.message);
    });
    await page.reload();
    await chooseCalendarView(page, "day");
    await page.getByRole("button", { name: "Choose calendar date" }).click();
    await page.getByLabel("Go to date", { exact: true }).fill("2027-01-11");
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await expect(page.getByRole("button", { name: "Previous day", exact: true })).toBeDisabled();
    const notice = page.locator("[data-calendar-navigation-limit]");
    await expect(notice).toContainText("calendar history kept on this device");
    const grid = page.getByRole("grid", { name: "Calendar day view", exact: true });
    await grid.hover(); await page.mouse.wheel(-200, 0);
    await expect(page.getByTestId("calendar-view")).toHaveAttribute("data-range-start", "2027-01-11T00:00:00.000Z");
    await page.getByRole("button", { name: "Jump to today", exact: true }).click();
    await expect(page.getByTestId("calendar-view")).toHaveAttribute("data-range-start", "2027-01-12T00:00:00.000Z");
    await chooseCalendarView(page, "month");
    await expect(page.getByRole("button", { name: "Next month", exact: true })).toBeDisabled();
    await expect(notice).toContainText("Month navigation is limited");
    await notice.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(page.getByRole("navigation", { name: "Settings categories" })).toBeVisible();
  });
});
