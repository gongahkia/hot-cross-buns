import { EventEmitter } from "node:events";
import { expect, it, vi } from "vitest";
import type { NativeTrayActions } from "../types";
import { buildNativeMenuBarSnapshot } from "../menuBarSnapshot";
import { MenuBarPanelController } from "./menuBarPanelController";

const windows = vi.hoisted(() => [] as any[]);
vi.mock("electron", () => ({
  screen: { getDisplayMatching: () => ({ workArea: { x: 0, y: 24, width: 1200, height: 640 } }) },
  BrowserWindow: class extends EventEmitter {
    visible = false;
    webContents = Object.assign(new EventEmitter(), { setWindowOpenHandler: vi.fn() });
    constructor(public options: unknown) { super(); windows.push(this); }
    setBounds = vi.fn(); loadURL = vi.fn(async () => undefined); focus = vi.fn();
    setAlwaysOnTop = vi.fn(); setVisibleOnAllWorkspaces = vi.fn();
    show() { this.visible = true; } hide() { this.visible = false; }
    isVisible() { return this.visible; } isDestroyed() { return false; } destroy = vi.fn();
  }
}));

it("dismisses the script-free panel on Escape and dispatches existing item routes", async () => {
  const snapshot = buildNativeMenuBarSnapshot({ now: new Date(), account: null, settings: { menuBarPanelStyle: "calendar", pinnedSavedSearchViewIds: [], savedSearchViews: [], historyCategoryVisibility: {}, calendarEventColorOverrides: {}, perSurfaceFontOverrides: {} }, planner: { listTasks: () => ({ items: [] }), listCalendarEvents: () => ({ items: [] }) } });
  const actions = { openRoute: vi.fn() } as unknown as NativeTrayActions;
  const controller = new MenuBarPanelController();
  const bounds = { x: 1180, y: 0, width: 20, height: 24 };
  await controller.toggle(actions, snapshot, bounds);
  const panel = windows.at(-1);
  expect(panel.options.webPreferences).toMatchObject({ javascript: false, nodeIntegration: false, contextIsolation: true, sandbox: true });
  const placed = panel.setBounds.mock.calls[0][0];
  expect(placed.x + placed.width).toBeLessThanOrEqual(1200);
  expect(placed.y + placed.height).toBeLessThanOrEqual(664);
  const event = { preventDefault: vi.fn() };
  panel.webContents.emit("before-input-event", event, { type: "keyDown", key: "Escape" });
  expect(event.preventDefault).toHaveBeenCalledOnce(); expect(panel.visible).toBe(false);
  await controller.toggle(actions, snapshot, bounds);
  panel.webContents.emit("will-navigate", event, "hcb-panel://route?kind=event&id=meeting%26review");
  expect(actions.openRoute).toHaveBeenCalledWith({ kind: "event", id: "meeting&review" });
  expect(panel.visible).toBe(false);
  controller.destroy(); expect(panel.destroy).toHaveBeenCalledOnce();
});
