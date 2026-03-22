/**
 * End-to-end tests for the TickClone desktop application.
 *
 * These tests use Playwright to drive the Tauri webview. They are designed
 * to run in CI after the app has been built (`tauri build`).
 *
 * NOTE: A Playwright + Tauri driver setup (e.g. @tauri-apps/tauri-driver or
 * playwright-tauri) is expected. Each test is skipped until the driver is
 * configured, but contains a real test body that will work once the
 * integration is in place.
 */

import { test, expect } from "@playwright/test";

test.describe("App Launch", () => {
  test("window opens with correct title", async ({ page }) => {
    test.skip(true, "Requires Tauri driver integration");

    await page.waitForLoadState("domcontentloaded");
    await expect(page).toHaveTitle(/TickClone/i);
  });

  test("sidebar is visible on launch", async ({ page }) => {
    test.skip(true, "Requires Tauri driver integration");

    await page.waitForLoadState("domcontentloaded");

    const sidebar = page.locator(".sidebar");
    await expect(sidebar).toBeVisible();
    await expect(sidebar).toHaveCSS("width", "250px");

    // Verify the app name heading is present in the sidebar header
    const heading = sidebar.locator(".sidebar-header h2");
    await expect(heading).toHaveText("TickClone");
  });

  test("sidebar navigation items are rendered", async ({ page }) => {
    test.skip(true, "Requires Tauri driver integration");

    await page.waitForLoadState("domcontentloaded");

    const sidebar = page.locator(".sidebar");

    // The three built-in nav items: Today, Week, Calendar
    const navItems = sidebar.locator(".sidebar-nav .nav-item");
    await expect(navItems).toHaveCount(3);

    await expect(navItems.nth(0).locator(".nav-label")).toHaveText("Today");
    await expect(navItems.nth(1).locator(".nav-label")).toHaveText("Week");
    await expect(navItems.nth(2).locator(".nav-label")).toHaveText("Calendar");
  });

  test("toolbar is visible with title and search bar", async ({ page }) => {
    test.skip(true, "Requires Tauri driver integration");

    await page.waitForLoadState("domcontentloaded");

    const toolbar = page.locator(".toolbar");
    await expect(toolbar).toBeVisible();

    const title = toolbar.locator(".toolbar-title");
    await expect(title).toHaveText("TickClone");

    // SearchBar component should render inside the toolbar
    const searchInput = toolbar.locator("input");
    await expect(searchInput).toBeVisible();
  });

  test("default empty state is shown when no list is selected", async ({ page }) => {
    test.skip(true, "Requires Tauri driver integration");

    await page.waitForLoadState("domcontentloaded");

    const emptyState = page.locator(".empty-state");
    await expect(emptyState).toBeVisible();
    await expect(emptyState).toHaveText("Select a list to view tasks");
  });

  test("clicking Today nav item switches to today view", async ({ page }) => {
    test.skip(true, "Requires Tauri driver integration");

    await page.waitForLoadState("domcontentloaded");

    const todayButton = page.locator(".sidebar-nav .nav-item", {
      hasText: "Today",
    });
    await todayButton.click();

    // Today nav item should become active
    await expect(todayButton).toHaveClass(/active/);

    // The empty state should no longer be visible; TodayView renders instead
    const emptyState = page.locator(".empty-state");
    await expect(emptyState).not.toBeVisible();
  });

  test("can select Inbox list and see the task list view", async ({ page }) => {
    test.skip(true, "Requires Tauri driver integration");

    await page.waitForLoadState("domcontentloaded");

    const inboxItem = page.locator(".list-item", { hasText: "Inbox" });
    await expect(inboxItem).toBeVisible();
    await inboxItem.click();
    await expect(inboxItem).toHaveClass(/active/);

    // Quick add input should be visible in the task list view
    const quickAddInput = page.locator(".quick-add-input");
    await expect(quickAddInput).toBeVisible();
  });

  test("can create a new task via quick add", async ({ page }) => {
    test.skip(true, "Requires Tauri driver integration");

    await page.waitForLoadState("domcontentloaded");

    // Select Inbox first
    const inboxItem = page.locator(".list-item", { hasText: "Inbox" });
    await inboxItem.click();

    const quickAddInput = page.locator(".quick-add-input");
    await expect(quickAddInput).toBeVisible();
    await quickAddInput.fill("E2E Test Task");
    await quickAddInput.press("Enter");

    // The new task should appear as a TaskRow in the list
    const taskRow = page.locator(".task-row", { hasText: "E2E Test Task" });
    await expect(taskRow).toBeVisible();
  });

  test("can create a new list from the sidebar", async ({ page }) => {
    test.skip(true, "Requires Tauri driver integration");

    await page.waitForLoadState("domcontentloaded");

    const newListBtn = page.locator(".new-list-btn");
    await expect(newListBtn).toBeVisible();
    await newListBtn.click();

    const newListInput = page.locator(".new-list-input");
    await expect(newListInput).toBeVisible();
    await expect(newListInput).toBeFocused();
    await newListInput.fill("My Test List");
    await newListInput.press("Enter");

    // The new list should appear in the sidebar
    const listItem = page.locator(".list-item", { hasText: "My Test List" });
    await expect(listItem).toBeVisible();
  });

  test("theme toggle button cycles through themes", async ({ page }) => {
    test.skip(true, "Requires Tauri driver integration");

    await page.waitForLoadState("domcontentloaded");

    const themeButton = page.locator('.gear-btn[aria-label="Toggle theme"]');
    await expect(themeButton).toBeVisible();

    // Click to cycle the theme
    await themeButton.click();

    // The button should still be visible after cycling
    await expect(themeButton).toBeVisible();
    // The title attribute should update to reflect the new theme
    const title = await themeButton.getAttribute("title");
    expect(title).toMatch(/Theme: (System|Dark|Light)/);
  });

  test("sync settings dialog opens and closes", async ({ page }) => {
    test.skip(true, "Requires Tauri driver integration");

    await page.waitForLoadState("domcontentloaded");

    const syncButton = page.locator('.gear-btn[aria-label="Sync settings"]');
    await expect(syncButton).toBeVisible();
    await syncButton.click();

    // The sync settings overlay should appear
    const overlay = page.locator(".sync-overlay");
    await expect(overlay).toBeVisible();

    const panelTitle = page.locator(".panel-title");
    await expect(panelTitle).toHaveText("Sync Settings");

    // Close the dialog
    const closeBtn = page.locator(".panel-close");
    await closeBtn.click();
    await expect(overlay).not.toBeVisible();
  });

  test("sync settings magic link flow shows email and token inputs", async ({ page }) => {
    test.skip(true, "Requires Tauri driver integration");

    await page.waitForLoadState("domcontentloaded");

    // Open sync settings
    const syncButton = page.locator('.gear-btn[aria-label="Sync settings"]');
    await syncButton.click();

    // Click magic link button
    const magicLinkBtn = page.locator(".magic-link-btn");
    await expect(magicLinkBtn).toBeVisible();
    await magicLinkBtn.click();

    // Email input form should appear
    const magicLinkForm = page.locator(".magic-link-form");
    await expect(magicLinkForm).toBeVisible();

    const emailInput = magicLinkForm.locator('input[type="email"]');
    await expect(emailInput).toBeVisible();

    const sendBtn = magicLinkForm.locator(".magic-link-submit");
    await expect(sendBtn).toHaveText("Send Magic Link");

    // Clicking magic link button again should toggle it off
    await magicLinkBtn.click();
    await expect(magicLinkForm).not.toBeVisible();
  });

  test("keyboard shortcut Escape closes sync settings", async ({ page }) => {
    test.skip(true, "Requires Tauri driver integration");

    await page.waitForLoadState("domcontentloaded");

    const syncButton = page.locator('.gear-btn[aria-label="Sync settings"]');
    await syncButton.click();

    const overlay = page.locator(".sync-overlay");
    await expect(overlay).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(overlay).not.toBeVisible();
  });

  test("app does not crash on launch", async ({ page }) => {
    test.skip(true, "Requires Tauri driver integration");

    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(3000);
    expect(errors).toHaveLength(0);

    // Verify the main app container rendered
    const app = page.locator(".app");
    await expect(app).toBeVisible();
  });
});
