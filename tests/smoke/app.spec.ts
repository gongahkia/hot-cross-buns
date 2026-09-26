import { _electron as electron, expect, test, type ElectronApplication } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test.setTimeout(60_000);

test("launches and renders the planner shell", async () => {
  let electronApp: ElectronApplication | undefined;
  const profileDir = mkdtempSync(join(tmpdir(), "hcb-smoke-"));

  try {
    electronApp = await electron.launch({
      args: [resolve(__dirname, "../.."), `--user-data-dir=${profileDir}`],
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
    const onboarding = page.getByRole("dialog", { name: "Connect Google" });
    await expect(onboarding).toBeVisible();
    await expect(onboarding).toContainText("HCB requires Google Calendar and Google Tasks");
    await expect(onboarding.getByLabel("Google OAuth client ID")).toBeVisible();
    await expect(onboarding.getByRole("button", { name: "Connect Google" })).toBeDisabled();
  } finally {
    await electronApp?.close();
    rmSync(profileDir, { recursive: true, force: true });
  }
});
