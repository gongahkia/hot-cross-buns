import { expect } from "@playwright/test";
import { test, planner, navigate, capture } from "./planner";

test("Lists collapse accessibly, retain selection and stay collapsed after reload", async () => {
  await planner(async (page) => {
    await page.evaluate(async () => {
      for (const title of ["Climbing", "Dev Roadmap", "Future Plans", "Workout"]) {
        const result = await window.hcb!.tasks.createTaskList({ title });
        if (!result.ok) throw new Error(result.error.message);
      }
      window.dispatchEvent(new Event("hcb:core-data-invalidated"));
    });
    await navigate(page, "Tasks");
    const sidebar = page.getByRole("complementary", { name: "Task board navigation" });
    await expect(sidebar.getByRole("button", { name: /^Starred on this device/ })).toHaveCount(0);
    await expect(page.getByRole("complementary", { name: "Workspace navigation" }).locator("img")).toHaveCount(0);
    await sidebar.getByRole("button", { name: /^Climbing/ }).click();
    const lists = sidebar.getByRole("button", { name: "Lists", exact: true });
    await expect(lists).toHaveAttribute("aria-expanded", "true");
    await capture(page, "task-lists-expanded");
    await lists.click();
    await expect(lists).toHaveAttribute("aria-expanded", "false");
    await expect(sidebar.getByRole("button", { name: /^Climbing/ })).toHaveCount(0);
    await expect.poll(async () => (await sidebar.locator(".task-lists-disclosure").boundingBox())?.height).toBe(0);
    await lists.press("Tab");
    await expect(sidebar.getByRole("button", { name: "New list", exact: true })).toBeFocused();
    await capture(page, "task-lists-collapsed");
    await page.reload();
    await expect(lists).toHaveAttribute("aria-expanded", "false");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await lists.click();
    await expect(sidebar.getByRole("button", { name: /^Climbing/ })).toHaveAttribute("aria-current", "page");
    expect(await sidebar.locator(".task-lists-disclosure").evaluate((element) => parseFloat(getComputedStyle(element).transitionDuration))).toBeLessThan(0.001);
  });
});
