import { app } from "electron";
import { describe, expect, it, vi } from "vitest";
import { registerProtocolClient, setAutostart } from "./appEnvironment";

vi.mock("electron", () => ({
  app: { setAsDefaultProtocolClient: vi.fn(), setLoginItemSettings: vi.fn() },
  Notification: {}, shell: {}
}));

describe("isolated macOS native checks", () => {
  it.skipIf(process.platform !== "darwin")("does not replace URL handlers or login items during tests", () => {
    expect(registerProtocolClient("hotcrossbuns")).toMatchObject({ ok: false, state: "disabled" });
    expect(setAutostart(true)).toMatchObject({ ok: false, state: "disabled" });
    expect(setAutostart(false)).toMatchObject({ ok: false, state: "disabled" });
    expect(app.setAsDefaultProtocolClient).not.toHaveBeenCalled();
    expect(app.setLoginItemSettings).not.toHaveBeenCalled();
  });
});
