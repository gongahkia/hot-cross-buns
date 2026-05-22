import { _electron as electron, expect, test, type ElectronApplication } from "@playwright/test";
import { resolve } from "node:path";

test("launches and renders the planner shell", async () => {
  let electronApp: ElectronApplication | undefined;

  try {
    electronApp = await electron.launch({
      args: [resolve(__dirname, "../..")],
      env: {
        ...process.env,
        NODE_ENV: "test"
      }
    });

    const page = await electronApp.firstWindow();

    await expect(page.getByTestId("app-shell")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();

    for (const label of ["Today", "Tasks", "Calendar", "Notes", "Search", "Settings"]) {
      await expect(page.getByRole("button", { name: new RegExp(label) })).toBeVisible();
    }

    const health = await page.evaluate(async () => globalThis.window.hcb?.diagnostics.health());
    expect(health?.ok).toBe(true);
  } finally {
    await electronApp?.close();
  }
});
