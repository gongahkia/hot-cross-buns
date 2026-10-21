import { _electron as electron, expect, test } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("opens deferred diagnostics through its keyboard shortcut", async () => {
  const profile = mkdtempSync(join(tmpdir(), "hcb-deferred-diagnostics-"));
  const app = await electron.launch({ args: [resolve(__dirname, "../.."), `--user-data-dir=${profile}`],
    env: { ...process.env, NODE_ENV: "test", HCB_TEST_DATABASE_ROOT: profile } });
  try {
    const page = await app.firstWindow();
    await expect(page.getByTestId("app-shell")).toBeVisible();
    await page.evaluate(async () => {
      const result = await window.hcb!.settings.update({ onboardingStatus: "skipped", syncMode: "manual" });
      if (!result.ok) throw new Error(result.error.message);
      window.dispatchEvent(new Event("hcb:core-data-invalidated"));
    });
    await expect(page.getByRole("dialog", { name: "Hot Cross Buns", exact: true })).toBeHidden();
    await page.keyboard.press(process.platform === "darwin" ? "Meta+Alt+d" : "Control+Alt+d");
    await expect(page.getByRole("dialog", { name: "Diagnostics", exact: true })).toBeVisible();
  } finally {
    await app.close();
    rmSync(profile, { recursive: true, force: true });
  }
});
