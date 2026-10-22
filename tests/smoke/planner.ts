import { _electron as electron, expect, test, type Page, type ElectronApplication } from "@playwright/test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export async function planner(run: (page: Page, app: ElectronApplication) => Promise<void>) {
  const profile = mkdtempSync(join(tmpdir(), "hcb-workspace-ui-"));
  const app = await electron.launch({ args: [...(process.platform === "linux" ? ["--disable-gpu"] : []), resolve(__dirname, "../.."), `--user-data-dir=${profile}`], env: { ...process.env, NODE_ENV: "test", HCB_TEST_DATABASE_ROOT: profile } });
  const errors: string[] = [];
  try {
    const page = await app.firstWindow();
    page.on("pageerror", (error) => errors.push(error.message));
    await expect(page.getByTestId("app-shell")).toBeVisible();
    await page.evaluate(async () => {
      const result = await window.hcb!.settings.update({ onboardingStatus: "skipped", syncMode: "manual", defaultTimeZone: "UTC", theme: "light", colorTheme: "hcb-neutral-light" });
      if (!result.ok) throw new Error(result.error.message);
      window.dispatchEvent(new Event("hcb:core-data-invalidated"));
    });
    await expect(page.getByRole("dialog", { name: "Hot Cross Buns", exact: true })).toBeHidden();
    await page.setViewportSize({ width: 1180, height: 760 });
    await run(page, app);
    expect(errors).toEqual([]);
  } finally {
    if (errors.length) await test.info().attach("renderer-errors", { body: JSON.stringify(errors, null, 2), contentType: "application/json" });
    await app.close(); rmSync(profile, { recursive: true, force: true });
  }
}

export const openPalette = (page: Page) => page.keyboard.press(process.platform === "darwin" ? "Meta+p" : "Control+p");
export const navigate = (page: Page, section: string) => page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: section, exact: true }).click();
export async function capture(page: Page, name: string) {
  mkdirSync("output/ui-review", { recursive: true });
  await page.locator(".inspector-item-menu, .calendar-menu, .app-select-content, .date-picker").evaluateAll((menus) => Promise.all(menus.flatMap((menu) => menu.getAnimations().map((animation) => animation.finished.catch(() => undefined)))));
  await page.screenshot({ path: `output/ui-review/${name}.png` });
}
