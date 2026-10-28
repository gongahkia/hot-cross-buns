import { expect, test } from "@playwright/test";

test("task presentation and workspace layout reload from IndexedDB without localStorage", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("app-shell")).toBeVisible();
  await page.evaluate(async () => {
    const result = await window.hcb!.settings.update({ onboardingStatus: "completed" });
    if (!result.ok) throw new Error(result.error.message);
  });
  await page.reload();
  await page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "Tasks", exact: true }).click();
  await page.getByRole("button", { name: "Board", exact: true }).click();
  await expect.poll(() => page.evaluate(async () => {
    const result = await window.hcb!.workspace.getPreferences();
    return result.ok && Object.values(result.data).some((pane: any) => pane["tasks.presentation"] === "board");
  })).toBe(true);
  await expect.poll(() => page.evaluate(async () => {
    const result = await window.hcb!.settings.get();
    return result.ok && result.data.paneWorkspace?.root?.content?.sectionId;
  })).toBe("tasks");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId("tasks-board")).toHaveAttribute("data-presentation", "board");
  expect(await page.evaluate(() => localStorage.getItem("hcb.panePreferences.v1"))).toBeNull();
});

test("a fresh Calendar-only workspace keeps its pane identity and scroll after reopening", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("app-shell")).toBeVisible();
  await page.evaluate(async () => {
    const result = await window.hcb!.settings.update({ onboardingStatus: "completed" });
    if (!result.ok) throw new Error(result.error.message);
    window.dispatchEvent(new Event("hcb:core-data-invalidated"));
  });
  await expect(page.getByRole("dialog", { name: "Hot Cross Buns", exact: true })).toBeHidden();
  const paneId = await page.getByTestId("pane-leaf").getAttribute("data-pane-id");
  await page.getByRole("button", { name: "Calendar view", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "Week", exact: true }).click();
  await expect(page.getByRole("grid", { name: "Calendar week view", exact: true })).toBeVisible();
  const timeline = page.locator("[data-calendar-timeline-scroll]");
  await expect(timeline).toHaveCount(1);
  await timeline.evaluate(node => { node.scrollTop = 550; node.dispatchEvent(new Event("scroll")); });
  await expect.poll(() => page.evaluate(async paneId => {
    const result = await window.hcb!.workspace.getPreferences();
    return result.ok && Object.entries(result.data[paneId!] ?? {}).some(([key, value]: any) => key.startsWith("calendar.scroll:") && value.top === 550);
  }, paneId)).toBe(true);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId("pane-leaf")).toHaveAttribute("data-pane-id", paneId!);
  await expect(page.getByRole("button", { name: "Calendar view", exact: true })).toContainText("Week");
  await expect.poll(() => timeline.evaluate(node => node.scrollTop)).toBe(550);
});
