import { expect, test } from "@playwright/test";

test("renders the browser-only Google setup boundary", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Connect your own Google Cloud project/i })).toBeVisible();
  await expect(page.getByText(/Do not paste a client secret/i)).toBeVisible();
  await expect(page.getByLabel(/Google Web OAuth client ID/i)).toBeVisible();
});
