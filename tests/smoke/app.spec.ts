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
    page.on("pageerror", (error) => {
      console.error(`Renderer error: ${error.stack ?? error.message}`);
    });

    await expect(page.getByTestId("app-shell")).toBeVisible();
    const finishSetup = page.getByRole("button", { name: "Finish setup" });
    if (await finishSetup.isVisible()) {
      await finishSetup.click();
      await expect(finishSetup).toBeHidden();
    }

    for (const label of ["Tasks", "Calendar", "Notes"]) {
      await expect(page.getByRole("button", { name: label, exact: true })).toBeVisible();
    }

    await expect(page.getByRole("button", { name: "Settings", exact: true })).toBeVisible();

    const health = await page.evaluate(async () => globalThis.window.hcb?.diagnostics.health());
    expect(health?.ok).toBe(true);
  } finally {
    await electronApp?.close();
  }
});
