import { expect } from "@playwright/test";
import { test, planner, capture } from "./planner";
import { seedDatabase } from "./database";

test("onboarding shows complete resource lists together and explains every sync mode", async () => {
  await planner(async (page, app) => {
    await page.evaluate(async () => {
      for (const title of ["Climbing", "Dev Roadmap", "End of Month", "Future Plans", "My Tasks", "Quotes", "SMU", "To Do", "Workout", "Travel"]) {
        const result = await window.hcb!.tasks.createTaskList({ title });
        if (!result.ok) throw new Error(result.error.message);
      }
    });
    const now = new Date().toISOString();
    await seedDatabase(app, [
      { sql: "INSERT INTO google_accounts(id,google_account_id,email,display_name,connection_state,created_at,updated_at) VALUES('setup-fixture','setup-fixture','planner@example.com','Planner','connected',?,?)", values: [now, now] },
      { sql: "UPDATE task_lists SET account_id='setup-fixture'" },
      { sql: "UPDATE calendars SET account_id='setup-fixture',title='Personal calendar'" }
    ]);
    await page.evaluate(async () => {
      const result = await window.hcb!.settings.update({ onboardingStatus: "pending" });
      if (!result.ok) throw new Error(result.error.message);
    });
    await page.reload();
    const dialog = page.getByRole("dialog", { name: "Hot Cross Buns", exact: true });
    await dialog.getByRole("button", { name: "Get started" }).click();
    await dialog.getByRole("button", { name: "Continue" }).click();
    await expect(dialog.getByRole("heading", { name: "Task lists", exact: true })).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "Calendars", exact: true })).toBeVisible();
    await expect(dialog.getByRole("checkbox", { name: /^Select task list/ })).toHaveCount(11);
    await expect(dialog.locator("header, img")).toHaveCount(0);
    // the resource list grows naturally; only the page owns vertical scrolling.
    for (const heading of ["Task lists", "Calendars"]) {
      const section = dialog.locator("section").filter({ has: page.getByRole("heading", { name: heading, exact: true }) });
      expect(await section.evaluate((element) => [...element.querySelectorAll("div")].filter((node) => ["auto", "scroll"].includes(getComputedStyle(node).overflowY)).length)).toBe(0);
    }
    await capture(page, "onboarding-resources");
    await page.setViewportSize({ width: 640, height: 480 });
    await dialog.getByRole("checkbox", { name: "Select calendar Personal calendar" }).scrollIntoViewIfNeeded();
    await expect(dialog.getByRole("checkbox", { name: "Select calendar Personal calendar" })).toBeInViewport();
    await expect(dialog.getByRole("button", { name: "Continue" })).toBeInViewport();
    await capture(page, "onboarding-resources-narrow");
    await dialog.getByRole("button", { name: "Continue" }).click();
    await page.setViewportSize({ width: 1180, height: 760 });
    for (const name of ["Manual", "Balanced", "Near real time"]) {
      await expect(dialog.getByRole("radio", { name, exact: true })).toBeVisible();
      await expect(dialog.getByRole("radio", { name, exact: true })).toHaveAccessibleDescription(/For example/);
    }
    await capture(page, "onboarding-sync-modes");
    await dialog.getByRole("radio", { name: "Manual", exact: true }).check();
    await dialog.getByRole("button", { name: "Continue" }).click();
    await expect(dialog).toContainText("Step 5 of 5");
    await dialog.getByRole("button", { name: "Finish setup" }).click();
    await expect(dialog).toHaveCount(0);
  });
});
