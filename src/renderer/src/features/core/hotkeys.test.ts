import { describe, expect, it } from "vitest";
import { defaultKeybindings } from "@shared/ipc/contracts";
import { eventMatchesAccelerator } from "./hotkeys";

describe("primary navigation shortcuts", () => {
  it("ships Calendar, Tasks, and Notes on the first three primary shortcuts", () => {
    expect(defaultKeybindings).toMatchObject({
      "navigation.calendar": "CmdOrCtrl+1",
      "navigation.tasks": "CmdOrCtrl+2",
      "navigation.notes": "CmdOrCtrl+3"
    });
  });

  it("matches the macOS command binding without consuming plain text input", () => {
    expect(eventMatchesAccelerator(
      { altKey: false, ctrlKey: false, key: "1", metaKey: true, shiftKey: false },
      defaultKeybindings["navigation.calendar"]
    )).toBe(true);
    expect(eventMatchesAccelerator(
      { altKey: false, ctrlKey: false, key: "1", metaKey: false, shiftKey: false },
      defaultKeybindings["navigation.calendar"]
    )).toBe(false);
  });
});
