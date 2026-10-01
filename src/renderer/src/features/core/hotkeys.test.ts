import { describe, expect, it } from "vitest";
import { defaultKeybindings } from "@shared/ipc/contracts";
import { eventMatchesAccelerator } from "./hotkeys";

describe("primary navigation shortcuts", () => {
  it("ships Calendar, Tasks, and Notes on the first three primary shortcuts", () => {
    expect(defaultKeybindings).toMatchObject({
      "commandPalette.open": "CmdOrCtrl+P",
      "undo.perform": "CmdOrCtrl+Z",
      "redo.perform": "CmdOrCtrl+Shift+Z",
      "sync.refresh": "CmdOrCtrl+R",
      "navigation.diagnostics.toggle": "CmdOrCtrl+Alt+D",
      "pane.split.horizontal": "CmdOrCtrl+D",
      "pane.split.vertical": "CmdOrCtrl+Shift+D",
      "navigation.settings": "CmdOrCtrl+Shift+?",
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

  it("ships the command palette on the primary P shortcut", () => {
    expect(eventMatchesAccelerator(
      { altKey: false, ctrlKey: false, key: "p", metaKey: true, shiftKey: false },
      defaultKeybindings["commandPalette.open"]
    )).toBe(true);
  });

  it("opens Settings on the primary question-mark shortcut", () => {
    expect(eventMatchesAccelerator(
      { altKey: false, ctrlKey: false, key: "?", metaKey: true, shiftKey: true },
      defaultKeybindings["navigation.settings"]
    )).toBe(true);
  });

  it("ships the requested application actions on their standard shortcuts", () => {
    const macShortcut = (key: string, { altKey = false, shiftKey = false } = {}) =>
      ({ altKey, ctrlKey: false, key, metaKey: true, shiftKey });

    expect(eventMatchesAccelerator(macShortcut("z"), defaultKeybindings["undo.perform"])).toBe(true);
    expect(eventMatchesAccelerator(macShortcut("z", { shiftKey: true }), defaultKeybindings["redo.perform"])).toBe(true);
    expect(eventMatchesAccelerator(macShortcut("r"), defaultKeybindings["sync.refresh"])).toBe(true);
    expect(eventMatchesAccelerator(macShortcut("d", { altKey: true }), defaultKeybindings["navigation.diagnostics.toggle"])).toBe(true);
    expect(eventMatchesAccelerator(macShortcut("d"), defaultKeybindings["pane.split.horizontal"])).toBe(true);
    expect(eventMatchesAccelerator(macShortcut("d", { shiftKey: true }), defaultKeybindings["pane.split.vertical"])).toBe(true);
  });
});
