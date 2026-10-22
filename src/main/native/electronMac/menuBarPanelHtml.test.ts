import { describe, expect, it } from "vitest";
import { buildNativeMenuBarSnapshot } from "../menuBarSnapshot";
import { menuBarPanelHtml } from "./menuBarPanelHtml";
import { parseMenuBarPanelUrl } from "./menuBarPanelNavigation";

const settings = { menuBarPanelStyle: "calendar", theme: "dark", pinnedSavedSearchViewIds: [], savedSearchViews: [], historyCategoryVisibility: {}, calendarEventColorOverrides: {}, perSurfaceFontOverrides: {} };
const planner = { listTasks: () => ({ items: [] }), listCalendarEvents: () => ({ items: [] }) };
const now = new Date(2026, 9, 23, 10);
const snapshot = () => buildNativeMenuBarSnapshot({ settings, planner, now, account: null });

describe("native menu bar presentation", () => {
  it("preserves full titles and encoded item routes without turning text into markup", () => {
    const data = snapshot();
    const label = 'Review <script>alert("hello")</script> & the full project delivery plan';
    data.calendar!.selectedItems = [{ label: "Short preview", fullLabel: label, detail: "10:00–11:00", route: { kind: "event", id: 'item & ?/#"' } }];
    const doc = new DOMParser().parseFromString(menuBarPanelHtml(data), "text/html");
    expect(doc.querySelector("script")).toBeNull();
    const row = doc.querySelector<HTMLAnchorElement>(".native-row")!;
    expect(row.title).toBe(label);
    expect(row.querySelector(".row-title")!.textContent).toBe(label);
    expect(parseMenuBarPanelUrl(row.href)).toEqual({ kind: "route", route: { kind: "event", id: 'item & ?/#"' } });
    expect([...doc.querySelectorAll<HTMLAnchorElement>(".panel-footer a")].map(a => parseMenuBarPanelUrl(a.href))).toEqual([
      { kind: "action", action: "showWindow" }, { kind: "action", action: "refresh" },
      { kind: "action", action: "openSettings" }, { kind: "action", action: "quit" }
    ]);
  });

  it("uses noninteractive empty rows and an honest Calendar link and connection label", () => {
    const data = snapshot();
    const doc = new DOMParser().parseFromString(menuBarPanelHtml(data), "text/html");
    expect(doc.querySelector(".empty-row")?.tagName).toBe("DIV");
    expect(doc.querySelector('a[href="#"]')).toBeNull();
    expect(doc.querySelectorAll(".day")).toHaveLength(42);
    expect(parseMenuBarPanelUrl(doc.querySelector<HTMLAnchorElement>(".calendar-open")!.href)).toEqual({ kind: "route", route: { kind: "today" } });
    expect(data.syncLabel).toBe("On this device");
    const connected = buildNativeMenuBarSnapshot({ settings, planner, now, account: { connectionState: "connected", displayName: "Alex" } as never });
    expect(connected.syncLabel).toBe("Google connected");
  });

  it("carries shared appearance and safely escapes a per-surface font in the style element", () => {
    const data = buildNativeMenuBarSnapshot({ settings: { ...settings, uiFontName: "Global font", perSurfaceFontOverrides: { menuBar: { uiFontName: '</style><script>bad()</script>"', uiTextSizePoints: 16 } }, disableAnimations: true }, planner, now, account: null });
    expect(data.appearance?.textSize).toBe(16);
    const doc = new DOMParser().parseFromString(menuBarPanelHtml(data), "text/html");
    expect(doc.querySelectorAll("style")).toHaveLength(1);
    expect(doc.querySelector("script")).toBeNull();
    expect(doc.querySelector("style")!.textContent).toContain("--color-bg-primary: #191919;");
    expect(doc.querySelector("style")!.textContent).not.toContain("background-color 120ms");
    expect(doc.querySelector("style")!.textContent).not.toContain("@media (prefers-color-scheme: dark)");
  });
});
