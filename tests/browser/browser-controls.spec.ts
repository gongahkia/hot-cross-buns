import { seedLinkedAccount } from "./linkedAccount";
import { expect, test, type Page } from "@playwright/test";

async function openPlanner(page: Page) {
  await page.goto("/");
  await expect(page.getByTestId("app-shell")).toBeVisible();
  await seedLinkedAccount(page);
  await page.evaluate(async () => {
    const result = await window.hcb!.settings.update({ onboardingStatus: "completed", notificationsEnabled: false });
    if (!result.ok) throw new Error(result.error.message);
  });
  await page.reload();
}
async function settings(page: Page, tab: string) {
  if (!await page.getByRole("navigation", { name: "Settings categories" }).isVisible()) {
    await page.getByRole("button", { name: "Settings", exact: true }).click();
  }
  await page.getByRole("navigation", { name: "Settings categories" }).getByRole("button", { name: tab, exact: true }).click();
}

test("browser settings expose local recovery and omit unavailable desktop controls", async ({ page }) => {
  await openPlanner(page);
  await settings(page, "Accounts");
  await expect(page.getByText(/VITE_GOOGLE_CLIENT_ID/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Add Google Account", exact: true })).toBeDisabled();
  await expect(page.getByLabel("Google OAuth client secret")).toHaveCount(0);
  await settings(page, "General");
  await expect(page.getByText("Open Hot Cross Buns at login", { exact: true })).toHaveCount(0);
  await settings(page, "Alerts");
  await expect(page.getByRole("heading", { name: "Menu bar", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Dock", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Import sound", exact: true })).toHaveCount(0);
  await expect(page.getByText(/after the app closes/)).toBeVisible();
  await settings(page, "About");
  await expect(page.getByRole("button", { name: "Check for Updates Now", exact: true })).toHaveCount(0);
  await expect(page.getByText("com.gongahkia.hotcrossbuns.mac", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Copy version info", exact: true }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain("Hot Cross Buns");
  await settings(page, "Data");
  await expect(page.getByRole("button", { name: "Export workspace", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Import workspace…", exact: true })).toBeVisible();
});

test("notification and clipboard permission refusal are honest and do not enable reminders", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(Notification, "requestPermission", { configurable: true, value: async () => "denied" });
    Object.defineProperty(Notification, "permission", { configurable: true, get: () => "denied" });
    Object.defineProperty(navigator.clipboard, "writeText", { configurable: true, value: async () => { throw new DOMException("Denied", "NotAllowedError"); } });
  });
  await openPlanner(page);
  await settings(page, "Alerts");
  await page.getByRole("checkbox", { name: "Local reminders", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect.poll(() => page.evaluate(async () => {
    const result = await window.hcb!.settings.get();
    return result.ok && result.data.notificationsEnabled;
  })).toBe(false);
  await settings(page, "About");
  await page.getByRole("button", { name: "Copy version info", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Clipboard access was denied" })).toBeVisible();
});

test("GIS popup grant verifies identity, syncs real services, and disappears after reload", async ({ page, context }) => {
  const requests: string[] = [];
  await page.addInitScript(() => {
    (window as any).__mockGoogle = { activeGesture: false, requestedScope: "" };
    (window as any).google = { accounts: { oauth2: { initTokenClient: (config: any) => ({ requestAccessToken: () => {
      (window as any).__mockGoogle.activeGesture = navigator.userActivation.isActive;
      (window as any).__mockGoogle.requestedScope = config.scope;
      queueMicrotask(() => config.callback({ access_token: "test-ephemeral-google-token", expires_in: 3600, scope: config.scope }));
    } }) } } };
  });
  await context.route("https://openidconnect.googleapis.com/v1/userinfo", async (route) => {
    expect(route.request().headers().authorization).toBe("Bearer test-ephemeral-google-token");
    await route.fulfill({ json: { sub: "verified-browser-subject", email: "browser@example.test", name: "Browser account" } });
  });
  await context.route(/https:\/\/(tasks|www)\.googleapis\.com\//, async (route) => {
    const url = new URL(route.request().url()); requests.push(url.pathname);
    expect(route.request().headers().authorization).toBe("Bearer test-ephemeral-google-token");
    if (url.pathname.endsWith("/users/@me/lists")) return route.fulfill({ json: { items: [{ id: "remote-browser-list", title: "Google browser list" }] } });
    if (url.pathname.endsWith("/calendarList")) return route.fulfill({ json: { items: [{ id: "remote-browser-calendar", summary: "Google browser calendar", accessRole: "owner", timeZone: "UTC" }] } });
    if (url.pathname.endsWith("/tasks")) return route.fulfill({ json: { items: [{ id: "remote-browser-task", title: "Task from Google browser sync", status: "needsAction", updated: new Date().toISOString(), position: "0001" }] } });
    return route.fulfill({ json: { items: [], nextSyncToken: "mock-calendar-sync-token" } });
  });
  await openPlanner(page);
  await page.evaluate(async () => {
    await window.hcb!.__testing.configureGoogleAuth("test-web.apps.googleusercontent.com");
    window.dispatchEvent(new Event("hcb:core-data-invalidated"));
  });
  await settings(page, "Accounts");
  const add = page.getByRole("button", { name: "Add Google Account", exact: true });
  await expect(add).toBeEnabled();
  await add.click();
  await expect.poll(() => page.evaluate(async () => {
    const result = await window.hcb!.google.status();
    return result.ok && result.data.accounts.find((account: any) => account.googleAccountId === "verified-browser-subject")?.connectionState;
  })).toBe("connected");
  expect(await page.evaluate(() => (window as any).__mockGoogle.activeGesture)).toBe(true);
  await expect.poll(() => page.evaluate(async () => {
    const result = await window.hcb!.tasks.list({ limit: 100 });
    return result.ok && result.data.items.some((task: any) => task.title === "Task from Google browser sync");
  })).toBe(true);
  expect(requests.some((path) => path.endsWith("/calendarList"))).toBe(true);
  expect(requests.some((path) => path.endsWith("/tasks"))).toBe(true);
  expect(await page.evaluate(async () => {
    const archive = await window.hcb!.__testing.exportArchive();
    return archive.ok && new TextDecoder().decode(archive.data.bytes).includes("test-ephemeral-google-token");
  })).toBe(false);
  await page.reload();
  await expect.poll(() => page.evaluate(async () => {
    const result = await window.hcb!.google.status();
    return result.ok && result.data.accounts.find((account: any) => account.googleAccountId === "verified-browser-subject")?.connectionState;
  })).not.toBe("connected");
});
