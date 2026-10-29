import { seedLinkedAccount } from "../browser/linkedAccount";
import { expect, test as base, type Browser, type Page, type TestInfo } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { BrowserApplication } from "./browserApp";

const browsers = new Map<TestInfo, Browser>();
export const test = base.extend<{ plannerLifecycle: void }>({
  plannerLifecycle: [async ({ browser }, use, info) => {
    browsers.set(info, browser);
    try { await use(); } finally { browsers.delete(info); }
  }, { auto: true }]
});

export async function planner(run: (page: Page, app: BrowserApplication) => Promise<void>) {
  const browser = browsers.get(test.info());
  if (!browser) throw new Error('Planner tests must import test from "./planner".');
  const context = await browser.newContext({ viewport: { width: 1180, height: 760 }, permissions: ["clipboard-read", "clipboard-write"] });
  const errors: string[] = [];
  try {
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    await page.goto("http://127.0.0.1:4174");
    await expect(page.getByTestId("app-shell")).toBeVisible();
    await seedLinkedAccount(page);
    await page.evaluate(async () => {
      const result = await window.hcb!.settings.update({ onboardingStatus: "skipped", syncMode: "manual", defaultTimeZone: "UTC", theme: "light", colorTheme: "hcb-neutral-light" });
      if (!result.ok) throw new Error(result.error.message);
      window.dispatchEvent(new Event("hcb:core-data-invalidated"));
    });
    await expect(page.getByRole("dialog", { name: "Hot Cross Buns", exact: true })).toBeHidden();
    await run(page, new BrowserApplication(context, page));
    expect(errors).toEqual([]);
  } finally { await context.close(); }
}

export const openPalette = (page: Page) => page.keyboard.press(process.platform === "darwin" ? "Meta+p" : "Control+p");
export const navigate = (page: Page, section: string) => page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: section, exact: true }).click();
export async function capture(page: Page, name: string) {
  mkdirSync("output/ui-review", { recursive: true });
  await page.locator(".inspector-item-menu, .calendar-menu, .app-select-content, .date-picker").evaluateAll((menus) => Promise.all(menus.flatMap((menu) => menu.getAnimations().map((animation) => animation.finished.catch(() => undefined)))));
  await page.screenshot({ path: `output/ui-review/${name}.png` });
}
