import { expect } from "@playwright/test";
import { capture, navigate, planner, test } from "./planner";

test("keeps bundled icons legible and stateful without decorating navigation", async () => {
  await planner(async (page) => {
    await expect(page.getByRole("navigation", { name: "Primary" }).locator("svg")).toHaveCount(0);
    await expect(page.locator(".lucide")).toHaveCount(0);
    const toggle = page.locator(".calendar-source-toggle").first();
    await toggle.hover();
    const box = await toggle.locator(".hcb-icon-swap").boundingBox();
    expect(box).toMatchObject({ width: 16, height: 16 });
    await expect(toggle.locator('svg[data-icon="eye"]')).toHaveAttribute("data-prefix", "far");
    await capture(page, "icons-calendar-light");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await expect(toggle.locator("svg")).toHaveCount(1);
    await expect(toggle.locator('svg[data-icon="eye-slash"]')).toBeVisible();
    expect(await toggle.locator(".hcb-icon-swap").boundingBox()).toEqual(box);
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(toggle.locator("svg")).toHaveCount(1);

    await navigate(page, "Tasks");
    await page.getByRole("button", { name: "New task", exact: true }).click();
    await page.getByRole("textbox", { name: "Task title" }).fill("Review icon states");
    await page.getByRole("button", { name: "Close inspector" }).click();
    const star = page.getByRole("button", { name: "Star Review icon states", exact: true });
    await star.focus();
    await expect(star.locator("svg")).toHaveAttribute("data-prefix", "far");
    await star.click();
    const starred = page.getByRole("button", { name: "Unstar Review icon states", exact: true });
    await expect(starred).toHaveAttribute("aria-pressed", "true");
    await expect(starred.locator("svg")).toHaveCount(1);
    await expect(starred.locator("svg")).toHaveAttribute("data-prefix", "fas");
    await capture(page, "icons-tasks-starred");

    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const categories = page.getByRole("navigation", { name: "Settings categories" });
    await expect(categories.getByRole("button").locator("svg")).toHaveCount(0);
    await categories.getByRole("button", { name: "Appearance", exact: true }).click();
    const theme = page.getByRole("combobox", { name: "Theme", exact: true, includeHidden: true });
    await theme.click();
    await expect(theme.locator("svg")).toHaveCSS("rotate", "180deg");
    await page.getByRole("option", { name: "Dark", exact: true }).click();
    await expect(theme.locator("svg")).toHaveCSS("rotate", "0deg");
    await capture(page, "icons-settings-dark");
    await page.getByRole("button", { name: "Close settings", exact: true }).click();
    await navigate(page, "Calendar");
    await capture(page, "icons-calendar-dark");
    await page.getByRole("button", { name: "Calendar tools", exact: true }).click();
    await page.getByRole("menuitem", { name: "New event", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Event title" })).toBeVisible();
    await capture(page, "icons-event-editor-dark");
  });
});

test("respects both motion preferences while preserving visible state feedback", async () => {
  await planner(async (page) => {
    const toggle = page.locator(".calendar-source-toggle").first();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await expect(toggle.locator(".hcb-icon-swap-layer")).toHaveCount(0);
    await expect(toggle.locator('svg[data-icon="eye-slash"]')).toBeVisible();
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.evaluate(async () => {
      const result = await window.hcb!.settings.update({ disableAnimations: true });
      if (!result.ok) throw new Error(result.error.message);
      window.dispatchEvent(new Event("hcb:core-data-invalidated"));
    });
    await expect(page.locator("html")).toHaveAttribute("data-animations", "disabled");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(toggle.locator(".hcb-icon-swap-layer")).toHaveCount(0);
    await expect(toggle.locator('svg[data-icon="eye"]')).toBeVisible();
    await page.setViewportSize({ width: 640, height: 480 });
    await capture(page, "icons-narrow-reduced-motion");
  });
});

test("animates Refresh only during an actual Google request and stops for reduced motion", async ({ page, context }) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let hold = false;
  await context.addInitScript(() => {
    (window as any).google = { accounts: { oauth2: { initTokenClient: (config: any) => ({
      requestAccessToken: () => queueMicrotask(() => config.callback({ access_token: "icon-test-token", expires_in: 3600, scope: config.scope }))
    }) } } };
  });
  await context.route("https://openidconnect.googleapis.com/v1/userinfo", route => route.fulfill({ json: { sub: "icons-subject", email: "icons@example.test" } }));
  await context.route(/https:\/\/(tasks|www)\.googleapis\.com\//, async route => {
    if (hold) await gate;
    await route.fulfill({ json: { items: [] } }).catch(() => {});
  });
  try {
    await page.goto("/");
    await page.waitForFunction(() => window.hcb?.__testing);
    await page.evaluate(async () => {
      await window.hcb!.settings.update({ onboardingStatus: "completed", syncMode: "manual" });
      await window.hcb!.__testing.configureGoogleAuth("icons-test.apps.googleusercontent.com");
      await window.hcb!.google.beginOAuth({});
      await window.hcb!.sync.runNow({});
      window.dispatchEvent(new Event("hcb:core-data-invalidated"));
    });
    const refresh = page.getByRole("button", { name: "Reload", exact: true });
    await expect(refresh).toBeEnabled();
    await expect(refresh.locator("svg")).toHaveCSS("animation-name", "none");
    hold = true;
    await refresh.click();
    await expect(refresh).toHaveAttribute("aria-busy", "true");
    await expect(refresh).toBeDisabled();
    await expect(refresh.locator("svg")).toHaveCSS("animation-name", "fa-spin");
    await expect(refresh).toHaveAttribute("title", "Syncing with Google…");
    // Review the real animation at 10% playback speed, then restore it.
    await refresh.locator("svg").evaluate(el => el.getAnimations().forEach(animation => animation.updatePlaybackRate(0.1)));
    await capture(page, "icons-sync-slow-motion");
    await refresh.locator("svg").evaluate(el => el.getAnimations().forEach(animation => animation.updatePlaybackRate(1)));
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(refresh.locator("svg")).toHaveCSS("animation-name", "none");
    await expect(refresh).toHaveAttribute("aria-busy", "true");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.evaluate(async () => {
      await window.hcb!.settings.update({ disableAnimations: true });
      window.dispatchEvent(new Event("hcb:core-data-invalidated"));
    });
    await expect(page.locator("html")).toHaveAttribute("data-animations", "disabled");
    await expect(refresh.locator("svg")).toHaveCSS("animation-name", "none");
    hold = false; release();
    await expect(refresh).toHaveAttribute("aria-busy", "false");
    await expect(refresh).toBeEnabled();
    await expect(refresh.locator("svg")).toHaveCSS("animation-name", "none");
  } finally { hold = false; release(); }
});
