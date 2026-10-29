import type { Page } from "@playwright/test";

/** Exercises the browser auth bridge and worker using simulated Google responses. */
export async function mockOnboardingGoogle(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as any).google = { accounts: { oauth2: { initTokenClient: (config: any) => ({
      requestAccessToken: () => queueMicrotask(() => config.callback({
        access_token: "onboarding-test-token", expires_in: 3600, scope: config.scope
      }))
    }) } } };
  });
  await page.context().route("https://openidconnect.googleapis.com/v1/userinfo", (route) =>
    route.fulfill({ json: { sub: "setup-fixture", email: "planner@example.test", name: "Planner" } }));
  await page.context().route(/https:\/\/(tasks|www)\.googleapis\.com\//, (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/users/@me/lists")) return route.fulfill({ json: { items: [{ id: "setup-list", title: "Google tasks" }] } });
    if (path.endsWith("/calendarList")) return route.fulfill({ json: { items: [{ id: "setup-calendar", summary: "Personal calendar", accessRole: "owner", timeZone: "UTC" }] } });
    return route.fulfill({ json: { items: [] } });
  });
}

export async function configureOnboardingGoogle(page: Page): Promise<void> {
  await page.waitForFunction(() => Boolean(window.hcb?.__testing));
  await page.evaluate(async () => {
    await window.hcb!.__testing.configureGoogleAuth("test-web.apps.googleusercontent.com");
    window.dispatchEvent(new Event("hcb:core-data-invalidated"));
  });
}
