import { expect, test } from "@playwright/test";

test("renders the browser-only Google setup boundary", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Connect your own Google Cloud project/i })).toBeVisible();
  await expect(page.getByText(/Do not paste a client secret/i)).toBeVisible();
  await expect(page.getByLabel(/Google Web OAuth client ID/i)).toBeVisible();
});

test("publishes install metadata and registers the static PWA worker", async ({ page }) => {
  await page.goto("/");
  const manifestUrl = await page.locator('link[rel="manifest"]').getAttribute("href");
  expect(manifestUrl).toBeTruthy();
  const manifest = await page.evaluate(async (url) => (await fetch(url!)).json(), manifestUrl);
  expect(manifest.icons).toEqual(expect.arrayContaining([
    expect.objectContaining({ src: "/icon-192.png", purpose: "any maskable" }),
    expect.objectContaining({ src: "/icon-512.png", purpose: "any maskable" })
  ]));
  await expect.poll(() => page.evaluate(async () => Boolean(await navigator.serviceWorker?.getRegistration()))).toBe(true);
});
