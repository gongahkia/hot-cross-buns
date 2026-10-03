import { describe, expect, it, vi } from "vitest";

const electronMocks = vi.hoisted(() => ({
  setApplicationMenu: vi.fn()
}));

vi.mock("electron", () => ({
  Menu: { setApplicationMenu: electronMocks.setApplicationMenu },
  Notification: {},
  app: {},
  globalShortcut: {},
  safeStorage: {},
  shell: {}
}));

import { installAppMenu as installLinuxAppMenu } from "./electronLinux/appEnvironment";
import { installAppMenu as installWindowsAppMenu } from "./electronWindows/appEnvironment";

describe("clearDefaultApplicationMenu", () => {
  it("removes Electron's default application menu on Windows", () => {
    installWindowsAppMenu();

    expect(electronMocks.setApplicationMenu).toHaveBeenCalledWith(null);
  });

  it("removes Electron's default application menu on Linux and WSL2", () => {
    installLinuxAppMenu();

    expect(electronMocks.setApplicationMenu).toHaveBeenCalledWith(null);
  });
});
