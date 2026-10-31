import { browserApp, type BrowserApplication } from "./browserApp";
import { expect, test } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test.setTimeout(60_000); // Allow deferred UI startup, including browser shutdown.

test("opens deferred diagnostics through its keyboard shortcut", async () => {
  const profile = mkdtempSync(join(tmpdir(), "hcb-deferred-diagnostics-"));
  const app = await browserApp.launch({ args: [resolve(__dirname, "../.."), `--user-data-dir=${profile}`],
    env: { ...process.env, NODE_ENV: "test", HCB_TEST_DATABASE_ROOT: profile } });
  try {
    const page = await app.firstWindow();
    await expect(page.getByTestId("app-shell")).toBeVisible();
    const onboarding = page.getByRole("dialog", { name: "Hot Cross Buns", exact: true });
    // The shell appears before bootstrap and the deferred onboarding dialog.
    // Wait for that initial state so an absent dialog cannot look like a
    // completed onboarding transition while its shortcut gate is still active.
    await expect(onboarding).toBeVisible();
    await page.evaluate(async () => {
      const result = await window.hcb!.settings.update({ onboardingStatus: "skipped", syncMode: "manual" });
      if (!result.ok) throw new Error(result.error.message);
      window.dispatchEvent(new Event("hcb:core-data-invalidated"));
    });
    await expect(onboarding).toBeHidden();
    await page.getByRole("button", { name: "Settings", exact: true }).focus();
    await page.keyboard.press(process.platform === "darwin" ? "Meta+Alt+d" : "Control+Alt+d");
    await expect(page.getByTestId("settings-workspace")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("settings-workspace")).toBeHidden();
  } finally {
    await app.close();
    rmSync(profile, { recursive: true, force: true });
  }
});
