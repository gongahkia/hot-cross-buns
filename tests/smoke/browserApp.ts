import { seedLinkedAccount } from "../browser/linkedAccount";
import { chromium, type BrowserContext, type Page } from "@playwright/test";

/** Browser-owned profile; reopening the same directory exercises real IndexedDB. */
export class BrowserApplication {
  constructor(readonly context: BrowserContext, readonly page: Page) {}
  async firstWindow() { return this.page; }
  async close() { await this.context.close(); }
}

export const browserApp = {
  async launch(options: { args?: string[]; env?: Record<string, string | undefined> } = {}) {
    const profile = options.env?.HCB_TEST_DATABASE_ROOT ?? "";
    const context = await chromium.launchPersistentContext(profile, {
      headless: true,
      viewport: { width: 1180, height: 760 },
      permissions: ["clipboard-read", "clipboard-write"]
    });
    const page = context.pages()[0] ?? await context.newPage();
    await page.goto("http://127.0.0.1:4174");
    await seedLinkedAccount(page);
    return new BrowserApplication(context, page);
  }
};
