import { expect, test } from "@playwright/test";
import { mockOnboardingGoogle, configureOnboardingGoogle } from "./googleMock";

for (const onboardingStatus of ["completed", "skipped"] as const) {
  test(`a legacy ${onboardingStatus} workspace needs Google, keeps its data, and remains usable after expiry`, async ({ page, context }) => {
    await mockOnboardingGoogle(page);
    await page.goto("/");
    await expect(page.getByTestId("app-shell")).toBeVisible();
    const taskId = await page.evaluate(async status => {
      const task = await window.hcb!.tasks.create({ listId: "inbox", title: "Keep my existing task" });
      if (!task.ok) throw new Error(task.error.message);
      const settings = await window.hcb!.settings.update({ onboardingStatus: status, syncMode: "manual", theme: "dark" });
      if (!settings.ok) throw new Error(settings.error.message);
      return task.data.id;
    }, onboardingStatus);
    await page.reload();
    const gate = page.getByRole("dialog", { name: "Hot Cross Buns", exact: true });
    await expect(gate).toBeVisible();
    await expect(gate.getByRole("button", { name: "Connect Google", exact: true })).toBeVisible();
    await expect(gate.getByRole("button", { name: "Continue", exact: true })).toHaveCount(0);
    await expect(page.getByTestId("app-shell")).toHaveAttribute("inert", "");
    await page.keyboard.press(process.platform === "darwin" ? "Meta+p" : "Control+p");
    await expect(gate).toBeVisible();
    await configureOnboardingGoogle(page);
    await gate.getByRole("button", { name: "Connect Google", exact: true }).click();
    await expect(gate).toBeHidden();
    await expect(page.getByTestId("app-shell")).not.toHaveAttribute("inert");
    await page.reload(); // Browser tokens are intentionally not persisted.
    await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
    await expect(gate).toBeHidden();
    await page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "Tasks", exact: true }).click();
    await expect(page.getByRole("button", { name: "Keep my existing task", exact: true })).toBeVisible();
    await context.setOffline(true);
    await page.getByRole("button", { name: "Board", exact: true }).click();
    await expect(page.getByTestId("tasks-board")).toHaveAttribute("data-presentation", "board");
    const stored = await page.evaluate(async id => {
      const task = await window.hcb!.tasks.get({ id });
      const settings = await window.hcb!.settings.get();
      const google = await window.hcb!.google.status();
      return { title: task.ok && task.data.title, theme: settings.ok && settings.data.theme, accounts: google.ok && google.data.accounts };
    }, taskId);
    expect(stored.title).toBe("Keep my existing task");
    expect(stored.theme).toBe("dark");
    expect(stored.accounts && stored.accounts[0].connectionState).toBe("reauth_required");
    await context.setOffline(false);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("navigation", { name: "Settings categories" }).getByRole("button", { name: "Accounts", exact: true }).click();
    await page.getByRole("button", { name: "Disconnect", exact: true }).click();
    await expect(gate).toBeVisible();
    await expect(page.getByTestId("app-shell")).toHaveAttribute("inert", "");
  });
}
