import { expect } from "@playwright/test";
import { test, planner, openPalette, navigate, capture } from "./planner";

test("Quick Add hands off from the palette, traps focus and opens a parsed task", async () => {
  await planner(async (page) => {
    await navigate(page, "Tasks");
    await openPalette(page);
    await page.getByRole("option", { name: "Quick Add", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Quick Add", exact: true });
    const input = dialog.getByRole("textbox", { name: "Quick add text" });
    await expect(input).toBeFocused();
    await expect(page.locator(".command-palette")).toHaveCount(0);
    await expect(input).toBeFocused();
    await expect(dialog).toHaveCSS("animation-name", "quick-add-in");
    await expect(page.locator(".quick-add-overlay")).toHaveCSS("background-color", "rgba(0, 0, 0, 0.18)");
    await capture(page, "quick-add-empty-light");
    await dialog.getByRole("tab", { name: "Event", exact: true }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(dialog.getByRole("tab", { name: "Task", exact: true })).toBeFocused();
    await expect(dialog.getByRole("tab", { name: "Task", exact: true })).toHaveAttribute("aria-selected", "true");
    await input.fill("Review the proposal tomorrow #Inbox");
    await capture(page, "quick-add-task-light");
    await dialog.getByRole("button", { name: "Add", exact: true }).focus();
    await page.keyboard.press("Tab");
    await expect(dialog.getByRole("button", { name: "Close quick add" })).toBeFocused();
    await input.focus();
    await input.press(process.platform === "darwin" ? "Meta+Enter" : "Control+Enter");
    await expect(dialog).toHaveCount(0);
    const title = page.getByRole("textbox", { name: "Task title", exact: true });
    await expect(title).toHaveValue("Review the proposal");
    await expect(title).toBeFocused();
    await page.keyboard.press("Escape");
  });
});

test("Quick Add fits dark and narrow windows and honors reduced motion", async () => {
  await planner(async (page) => {
    await page.evaluate(async () => {
      await window.hcb!.settings.update({ theme: "dark", colorTheme: "hcb-neutral-dark" });
      window.dispatchEvent(new Event("hcb:core-data-invalidated"));
    });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await openPalette(page);
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Quick Add", exact: true });
    const input = dialog.getByRole("textbox", { name: "Quick add text" });
    await expect(input).toBeFocused();
    await input.fill("Lunch tomorrow 1pm at Philz");
    await capture(page, "quick-add-event-dark");
    await dialog.getByRole("combobox", { name: "Quick add calendar" }).click();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    await expect(page.getByRole("listbox")).toBeHidden();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await page.setViewportSize({ width: 380, height: 480 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openPalette(page);
    await page.keyboard.press("Enter");
    await expect(input).toBeFocused();
    const box = await dialog.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(15);
    expect(box!.y).toBeGreaterThanOrEqual(15);
    expect(box!.x + box!.width).toBeLessThanOrEqual(365);
    expect(box!.y + box!.height).toBeLessThanOrEqual(465);
    expect(await dialog.evaluate((element) => parseFloat(getComputedStyle(element).animationDuration))).toBeLessThan(0.001);
    await expect(dialog).toHaveCSS("animation-delay", "0s");
    await capture(page, "quick-add-narrow");
    await page.mouse.click(5, 5);
    await expect(dialog).toHaveCount(0);
  });
});
