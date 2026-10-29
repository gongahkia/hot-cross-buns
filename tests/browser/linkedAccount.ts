import type { Page } from "@playwright/test";

/** Simulate a workspace whose Google account was verified on an earlier visit.
 * No access token is installed: UI tests exercise cached/offline operation.
 * Account-gate tests use actual mocked GIS consent instead of this fixture.
 */
export async function seedLinkedAccount(page: Page): Promise<void> {
  await page.waitForFunction(() => Boolean(window.hcb?.__testing));
  await page.evaluate(async () => {
    const now = new Date().toISOString();
    const result = await window.hcb!.__testing.seedDatabase({ statements: [{
      sql: "INSERT OR IGNORE INTO google_accounts(id,google_account_id,email,display_name,connection_state,created_at,updated_at) VALUES('linked-fixture','linked-subject','cached@example.test','Cached account','reauth_required',?,?)",
      values: [now, now]
    }] });
    if (!result.ok) throw new Error(result.error.message);
    window.dispatchEvent(new Event("hcb:core-data-invalidated"));
  });
}
