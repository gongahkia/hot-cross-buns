import { expect, test, type Page } from "@playwright/test";
import { mockOnboardingGoogle } from "./googleMock";

const firstClient = "1234567890-first.apps.googleusercontent.com";
const secondClient = "1234567890-second.apps.googleusercontent.com";

async function openAccounts(page: Page) {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("navigation", { name: "Settings categories" }).getByRole("button", { name: "Accounts", exact: true }).click();
}

test("configures Google in setup, persists across reloads and tabs, and edits the client in Accounts", async ({ page, context }) => {
  await mockOnboardingGoogle(page);
  await page.goto("/");
  const setup = page.getByRole("dialog", { name: "Hot Cross Buns", exact: true });
  await setup.getByRole("button", { name: "Get started" }).click();
  await setup.getByRole("button", { name: "Set up Google sign-in", exact: true }).click();
  await expect(setup.locator("code").filter({ hasText: "http://127.0.0.1:4174" })).toBeVisible();
  await setup.getByRole("button", { name: "Continue", exact: true }).click();
  const client = page.getByRole("textbox", { name: "Google OAuth client ID" });
  await client.fill("not-a-google-client");
  await page.getByRole("button", { name: "Save client ID", exact: true }).click();
  await expect(page.getByText("Enter a Google Web application client ID ending in .apps.googleusercontent.com.")).toBeVisible();
  await expect(setup.getByRole("button", { name: "Continue", exact: true })).toBeDisabled();
  await expect(page.getByLabel("Google OAuth client secret")).toHaveCount(0);
  await page.screenshot({ path: "output/ui-review/google-client-setup.png" });
  await client.fill(` ${firstClient} `);
  await page.getByRole("button", { name: "Save client ID", exact: true }).click();
  await expect(page.getByText("Client ID saved. Choose Connect Google to continue.")).toBeVisible();
  await setup.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(setup.getByRole("button", { name: "Connect Google", exact: true })).toBeEnabled();
  await expect(setup.getByRole("button", { name: "Continue", exact: true })).toBeDisabled();
  expect(await page.evaluate(async () => { const r = await window.hcb!.google.status(); return r.ok && r.data.accounts.length; })).toBe(0);

  await page.reload();
  await setup.getByRole("button", { name: "Get started" }).click();
  await setup.getByRole("button", { name: "Change sign-in configuration", exact: true }).click();
  await expect(client).toHaveValue(firstClient);
  await setup.getByRole("button", { name: "Continue", exact: true }).click();
  await setup.getByRole("button", { name: "Connect Google", exact: true }).click();
  await expect(setup.getByRole("button", { name: "Google connected", exact: true })).toBeVisible();
  for (let step = 0; step < 3; step++) await setup.getByRole("button", { name: "Continue", exact: true }).click();
  await setup.getByRole("checkbox", { name: "Local notifications" }).uncheck();
  await setup.getByRole("button", { name: "Finish setup", exact: true }).click();
  await expect(setup).toBeHidden();
  const taskId = await page.evaluate(async () => {
    await window.hcb!.settings.update({ syncMode: "manual" });
    const r = await window.hcb!.tasks.create({ listId: "inbox", title: "Keep my local work" });
    if (!r.ok) throw new Error(r.error.message);
    return r.data.id;
  });
  await openAccounts(page);
  await expect(client).toHaveValue(firstClient);
  await page.screenshot({ path: "output/ui-review/google-client-settings.png" });

  const secondTab = await context.newPage();
  await mockOnboardingGoogle(secondTab);
  await secondTab.goto("/");
  await openAccounts(secondTab);
  await expect(secondTab.getByRole("textbox", { name: "Google OAuth client ID" })).toHaveValue(firstClient);
  await client.fill(secondClient);
  await page.getByRole("button", { name: "Save client ID", exact: true }).click();
  await expect(page.getByText("Google OAuth client configuration saved.")).toBeVisible();
  await expect(secondTab.getByRole("textbox", { name: "Google OAuth client ID" })).toHaveValue(secondClient);
  await page.reload();
  await openAccounts(page);
  await expect(client).toHaveValue(secondClient);
  await expect(page.getByLabel("Google OAuth client secret")).toHaveCount(0);
  const saved = await page.evaluate(async id => {
    const task = await window.hcb!.tasks.get({ id });
    const status = await window.hcb!.google.status();
    return { title: task.ok && task.data.title, clientId: status.ok && status.data.clientId, stored: JSON.stringify(localStorage) };
  }, taskId);
  expect(saved.title).toBe("Keep my local work");
  expect(saved.clientId).toBe(secondClient);
  expect(saved.stored).not.toContain("onboarding-test-token");
});

test("failed browser storage leaves Google setup unconfigured and allows a retry", async ({ page }) => {
  await mockOnboardingGoogle(page);
  await page.addInitScript(() => {
    (window as any).blockClientSave = true;
    const save = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === "hcb.google.webClientId" && (window as any).blockClientSave) throw new DOMException("Storage blocked", "SecurityError");
      save.call(this, key, value);
    };
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Get started" }).click();
  await page.getByRole("button", { name: "Set up Google sign-in", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("textbox", { name: "Google OAuth client ID" }).fill(firstClient);
  await page.getByRole("button", { name: "Save client ID", exact: true }).click();
  await expect(page.getByText(/The client ID could not be saved/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue", exact: true })).toBeDisabled();
  expect(await page.evaluate(async () => { const r = await window.hcb!.google.status(); return r.ok && r.data.oauthClientConfigured; })).toBe(false);
  await page.evaluate(() => { (window as any).blockClientSave = false; });
  await page.getByRole("button", { name: "Save client ID", exact: true }).click();
  await expect(page.getByRole("button", { name: "Continue", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("button", { name: "Connect Google", exact: true })).toBeEnabled();
});
