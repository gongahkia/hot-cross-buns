import { expect } from "@playwright/test";
import { test, planner, capture } from "./planner";
import { mockOnboardingGoogle, configureOnboardingGoogle } from "../browser/googleMock";

test("onboarding shows complete resource lists together and explains durable browser storage", async () => {
  await planner(async (page) => {
    await mockOnboardingGoogle(page);
    await page.evaluate(async () => {
      for (const title of ["Climbing", "Dev Roadmap", "End of Month", "Future Plans", "My Tasks", "Quotes", "SMU", "To Do", "Workout", "Travel"]) {
        const result = await window.hcb!.tasks.createTaskList({ title });
        if (!result.ok) throw new Error(result.error.message);
      }
    });
    await page.evaluate(async () => {
      const result = await window.hcb!.settings.update({ onboardingStatus: "pending" });
      if (!result.ok) throw new Error(result.error.message);
    });
    await page.reload();
    await configureOnboardingGoogle(page);
    const dialog = page.getByRole("dialog", { name: "Hot Cross Buns", exact: true });
    await dialog.getByRole("button", { name: "Get started" }).click();
    await expect(dialog.getByRole("button", { name: "Continue" })).toBeDisabled();
    await dialog.getByRole("button", { name: "Connect Google", exact: true }).click();
    await expect(dialog.getByRole("button", { name: "Google connected" })).toBeVisible();
    await dialog.getByRole("button", { name: "Continue" }).click();
    await expect(dialog.getByRole("heading", { name: "Task lists", exact: true })).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "Calendars", exact: true })).toBeVisible();
    // Google connects through the real worker while local resources stay available.
    await expect(dialog.getByRole("checkbox", { name: /^Select task list/ })).toHaveCount(12);
    await expect(dialog.getByRole("checkbox", { name: "Select calendar Primary", exact: true })).toBeVisible();
    const localResources = await page.evaluate(async () => {
      const result = await window.hcb!.bootstrap.get({});
      if (!result.ok) throw new Error(result.error.message);
      return {
        lists: result.data.taskLists.items.filter(list => list.accountId === 'local').map(list => list.title),
        calendars: result.data.calendars.items.filter(calendar => calendar.accountId === 'local').map(calendar => calendar.title),
      };
    });
    expect(localResources.lists).toHaveLength(11);
    expect(localResources.lists).toContain('Inbox');
    expect(localResources.calendars).toEqual(['Primary']);
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
    await expect(dialog.getByRole("heading", { name: "Saved in this browser", exact: true })).toBeVisible();
    await expect(dialog).toContainText("Changes save automatically");
    await expect(dialog).toContainText("Clearing this site's browser data removes the workspace");
    await expect(dialog.getByRole("radio")).toHaveCount(0);
    await capture(page, "onboarding-browser-storage");
    await dialog.getByRole("button", { name: "Continue" }).click();
    await expect(dialog.getByText(/Step [1-5] of 5/)).toHaveCount(0);
    await dialog.getByRole("button", { name: "Finish setup" }).click();
    await expect(dialog).toHaveCount(0);
  });
});
