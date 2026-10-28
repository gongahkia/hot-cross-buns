import { expect } from "@playwright/test";
import { test, planner, capture } from "./planner";
import { buildNativeMenuBarSnapshot } from "../../src/main/native/menuBarSnapshot";
import { menuBarPanelDataUrl } from "../../src/main/native/electronMac/menuBarPanelHtml";
import { parseMenuBarPanelUrl } from "../../src/main/native/electronMac/menuBarPanelNavigation";

test("menu bar shares app appearance, remains usable at large text sizes, and preserves native item links", async () => {
  test.setTimeout(60_000);
  await planner(async (_page, app) => {
    const now = new Date(2026, 9, 23, 10);
    const title = "Review the full launch checklist with the product and engineering teams";
    const source = {
      listTasks: () => ({ items: [{ id: "task & launch", listId: "inbox", title, dueAt: "2026-10-23" }] }),
      listCalendarEvents: () => ({ items: Array.from({ length: 8 }, (_, index) => ({ id: `event-${index}`, title: index ? `Project planning session ${index}` : "Architecture review and implementation planning", startsAt: new Date(2026, 9, 23, 11 + index).toISOString(), endsAt: new Date(2026, 9, 23, 12 + index).toISOString() })) })
    };
    const makeSnapshot = (theme: string, style = "adaptive", size = 13, empty = false) => buildNativeMenuBarSnapshot({
      settings: { theme, menuBarPanelStyle: style, uiTextSizePoints: size, pinnedSavedSearchViewIds: [], savedSearchViews: [], historyCategoryVisibility: {}, calendarEventColorOverrides: {}, perSurfaceFontOverrides: {} },
      planner: empty ? { listTasks: () => ({ items: [] }), listCalendarEvents: () => ({ items: [] }) } : source,
      now, account: empty ? null : { connectionState: "connected", displayName: "Alex Morgan", email: "alex@example.test", avatarUrl: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#efefef"/><text x="16" y="22" text-anchor="middle" fill="#32302c">A</text></svg>') } as never
    });
    const waiting = app.waitForEvent("window");
    const windowId = await app.evaluate(async ({ BrowserWindow }, url) => {
      const panel = new BrowserWindow({ width: 360, height: 720, frame: false, webPreferences: { javascript: false, contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true } });
      panel.webContents.on("will-navigate", (event, destination) => { event.preventDefault(); (panel as any).__destination = destination; });
      await panel.loadURL(url); panel.show(); panel.focus(); return panel.id;
    }, menuBarPanelDataUrl(makeSnapshot("light")));
    const panel = await waiting;
    const cdp = await panel.context().newCDPSession(panel);
    await cdp.send("Animation.enable"); await cdp.send("Animation.setPlaybackRate", { playbackRate: 0.1 });
    await expect(panel.getByRole("heading", { name: "Agenda", exact: true })).toBeVisible();
    await expect(panel.locator(".popover")).toHaveCSS("background-color", "rgb(255, 255, 255)");
    await panel.keyboard.press("Tab");
    await expect(panel.locator("a:focus")).toHaveCSS("outline-style", "solid");
    await panel.getByRole("link", { name: /Architecture review/ }).hover();
    await expect(panel.locator(".native-row").first().locator(".row-open")).toHaveCSS("opacity", "1");
    await capture(panel, "menu-bar-agenda-light");
    await cdp.send("Animation.setPlaybackRate", { playbackRate: 1 });
    await panel.getByRole("link", { name: /Architecture review/ }).click({ noWaitAfter: true });
    await expect.poll(async () => parseMenuBarPanelUrl(await app.evaluate(({ BrowserWindow }, id) => (BrowserWindow.fromId(id) as any).__destination, windowId)))
      .toEqual({ kind: "route", route: { kind: "event", id: "event-0" } });

    for (const [theme, style, size, height, empty] of [["dark", "calendar", 13, 720, false], ["light", "compact", 24, 480, false], ["dark", "compact", 13, 420, true]] as const) {
      await app.evaluate(async ({ BrowserWindow }, { id, url, height }) => { const window = BrowserWindow.fromId(id)!; window.setSize(360, height); await window.loadURL(url); }, { id: windowId, url: menuBarPanelDataUrl(makeSnapshot(theme, style, size, empty)), height });
      await expect(panel.locator(".popover")).toHaveCSS("background-color", theme === "dark" ? "rgb(25, 25, 25)" : "rgb(255, 255, 255)");
      const layout = await panel.evaluate(() => {
        const footer = document.querySelector(".panel-footer")!.getBoundingClientRect();
        return { noHorizontalOverflow: document.documentElement.scrollWidth <= innerWidth, footerVisible: footer.bottom <= innerHeight && footer.top >= 0, targets: [...document.querySelectorAll(".panel-footer a")].map(a => a.getBoundingClientRect().height) };
      });
      expect(layout.noHorizontalOverflow).toBe(true); expect(layout.footerVisible).toBe(true);
      expect(layout.targets.every(height => height >= 40)).toBe(true);
      if (style === "calendar") { await expect(panel.locator(".day")).toHaveCount(42); await expect(panel.getByRole("link", { name: "Open today in Calendar" })).toBeVisible(); }
      if (empty) { await expect(panel.locator(".empty-row").first()).toBeVisible(); expect(await panel.locator('a[href="#"]').count()).toBe(0); }
      await capture(panel, `menu-bar-${style}-${theme}-${size}`);
      if (!empty) { await panel.locator(".account").scrollIntoViewIfNeeded(); await capture(panel, `menu-bar-account-${theme}-${size}`); }
    }
    await panel.emulateMedia({ reducedMotion: "reduce" });
    await expect(panel.locator(".open-app")).toHaveCSS("transition-duration", "0s");
    await cdp.detach();
    await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id)!.destroy(), windowId);
  });
});
