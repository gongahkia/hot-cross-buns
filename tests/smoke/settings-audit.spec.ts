import { expect } from "@playwright/test";
import { test, planner, capture } from "./planner";

const categories = ["Accounts", "General", "Appearance", "Hotkeys", "Alerts", "Data", "Diagnostics", "Sync", "Logs", "History", "Support", "About"];

test("settings categories stay usable at desktop and narrow widths in both themes", async () => {
  test.setTimeout(120_000);
  await planner(async (page) => {
    const primary = page.getByRole("navigation", { name: "Primary" });
    await expect(primary.locator("svg")).toHaveCount(0);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const navigation = page.getByRole("navigation", { name: "Settings categories" });
    await expect(navigation.getByRole("button").locator("svg")).toHaveCount(0);
    for (const [width, theme] of [[1180, "light"], [640, "dark"], [390, "dark"]] as const) {
      await page.setViewportSize({ width, height: 760 });
      await page.evaluate(async (theme) => {
        await window.hcb!.settings.update({ theme, colorTheme: theme === "dark" ? "hcb-neutral-dark" : "hcb-neutral-light" });
        window.dispatchEvent(new Event("hcb:core-data-invalidated"));
      }, theme);
      if (width <= 700) {
        expect((await navigation.boundingBox())!.height).toBeLessThan(140);
      }
      for (const category of categories) {
        await navigation.getByRole("button", { name: category, exact: true }).click();
        const content = page.locator(".settings-content");
        await expect(content.getByRole("heading", { level: 2 })).toHaveText(category === "Data" ? "Data and recovery" : category);
        expect(await content.evaluate(el => el.scrollWidth <= el.clientWidth + 1), `${category} at ${width}px should not overflow horizontally`).toBe(true);
        // Each settings control must fit inside its visible group, including long labels.
        const overflow = await content.locator(".settings-control-row").evaluateAll(rows => rows.filter(row => row.scrollWidth > row.clientWidth + 1).map(row => row.textContent));
        expect(overflow, `${category} at ${width}px has clipped controls`).toEqual([]);
        if (category === "Appearance") {
          await expect(page.getByRole("checkbox", { name: "Restore previous session" })).toHaveCount(0);
          await expect(page.getByRole("combobox", { name: "Menu bar font", exact: true })).toHaveCount(0);
          await expect(page.getByRole("button", { name: "Move up Command palette", exact: true })).toHaveCount(0);
        }
      }
      await navigation.getByRole("button", { name: "General", exact: true }).click();
      await capture(page, `settings-audit-${width}-${theme}`);
    }
    await page.setViewportSize({ width: 1180, height: 760 });
    await navigation.getByRole("button", { name: "Alerts", exact: true }).click();
    const completion = page.getByRole("checkbox", { name: "Task completion", exact: true });
    const checked = await completion.isChecked();
    await completion.focus();
    await page.keyboard.press("Space");
    await expect.poll(() => page.evaluate(async () => {
      const result = await window.hcb!.settings.get();
      return result.ok && result.data.taskCompletionSoundEnabled;
    })).toBe(!checked);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("settings-workspace")).toBeHidden();
  });
});

test("settings search exposes matching categories, empty results, and normal navigation", async () => {
  await planner(async (page) => {
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const search = page.getByRole("textbox", { name: "Search settings" });
    await search.fill("workspace archives");
    await expect(page.getByRole("heading", { name: "Workspace archives", exact: true })).toBeVisible();
    await expect(page.getByLabel("Matching settings categories").getByRole("button", { name: "Data", exact: true })).toBeVisible();
    await search.fill("appearance");
    await expect(page.getByRole("combobox", { name: "Theme", exact: true })).toBeVisible();
    await search.fill("menu bar");
    await expect(page.getByRole("status").filter({ hasText: "No settings match your search." })).toBeVisible();
    await expect(page.locator(".settings-content .settings-control-row")).toHaveCount(0);
    await search.fill("no such setting");
    await expect(page.getByRole("status").filter({ hasText: "No settings match your search." })).toBeVisible();
    await page.getByRole("navigation", { name: "Settings categories" }).getByRole("button", { name: "Alerts", exact: true }).click();
    await expect(search).toHaveValue("");
    await expect(page.getByRole("checkbox", { name: "Task completion", exact: true })).toBeVisible();
  });
});

test("Google setup cannot be skipped through keyboard or background navigation", async ({ page }) => {
  await page.goto("/");
  const dialog = page.getByRole("dialog", { name: "Hot Cross Buns", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/Step [1-5] of 5/)).toHaveCount(0);
  await dialog.getByRole("button", { name: "Get started" }).click();
  await expect(dialog.getByRole("button", { name: "Continue", exact: true })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Connect Google", exact: true })).toBeDisabled();
  await expect(dialog).toContainText("Google sign-in is not configured");
  await page.keyboard.press("Escape");
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press("Tab");
    expect(await dialog.evaluate(el => el.contains(document.activeElement))).toBe(true);
  }
  await expect(dialog).toBeVisible();
  await capture(page, "onboarding-google-required");
});

test("failed Google connection is reported as a failure in Settings", async () => {
  await planner(async (page) => {
    await page.evaluate(async () => {
      (window as any).google = { accounts: { oauth2: { initTokenClient: (config: any) => ({
        requestAccessToken: () => queueMicrotask(() => config.callback({ error: "access_denied" }))
      }) } } };
      await window.hcb!.__testing.configureGoogleAuth("test-web.apps.googleusercontent.com");
      window.dispatchEvent(new Event("hcb:core-data-invalidated"));
    });
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("navigation", { name: "Settings categories" }).getByRole("button", { name: "Accounts", exact: true }).click();
    await page.getByRole("button", { name: "Add Google Account", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Action could not be completed" })).toContainText("Google access was denied");
    await expect(page.getByText("Action completed", { exact: true })).toHaveCount(0);
  });
});

test("simplified settings hide removed controls and Connect opens setup help", async () => {
  await planner(async page => {
    await expect(page.getByRole("heading", { name: "Hot Cross Buns", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const settings = page.getByTestId("settings-workspace");
    const categories = settings.getByRole("navigation", { name: "Settings categories" });
    await categories.getByRole("button", { name: "Appearance", exact: true }).click();
    for (const name of ["Custom background", "Infer theme from background", "Per-surface fonts", "Primary navigation", "Toolbar actions"]) {
      await expect(settings.getByText(name, { exact: true })).toHaveCount(0);
    }
    await categories.getByRole("button", { name: "Accounts", exact: true }).click();
    await expect(settings.locator("details").filter({ hasText: "Google Cloud setup" })).toHaveCount(0);
    const connect = settings.getByRole("button", { name: "Connect", exact: true });
    await connect.click();
    const help = page.getByRole("dialog", { name: "Google Cloud setup", exact: true });
    await expect(help).toBeVisible();
    await expect(help).toContainText("Authorized JavaScript origins");
    await page.keyboard.press("Escape");
    await expect(help).toHaveCount(0);
    await expect(settings).toBeVisible();
    await expect(connect).toBeFocused();
  });
});
