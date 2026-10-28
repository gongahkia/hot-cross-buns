import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { hydratePanePreferences, readPanePreference, usePanePreference } from "./panePreferences";

const original = window.hcb;
afterEach(() => {
  cleanup();
  Object.defineProperty(window, "hcb", { configurable: true, value: original });
});

describe("durable pane preferences", () => {
  it("restores the last durable value and reports a rejected save", async () => {
    const setPreference = vi.fn(async () => ({ ok: false, error: { code: "INTERNAL_ERROR", message: "IndexedDB transaction aborted" } }));
    Object.defineProperty(window, "hcb", { configurable: true, value: { workspace: { setPreference } } });
    hydratePanePreferences({ default: { "tasks.presentation": "board" } });
    const feedback = vi.fn();
    window.addEventListener("hcb:save-feedback", feedback);
    try {
      const { result } = renderHook(() => usePanePreference("tasks.presentation", "list"));
      expect(result.current[0]).toBe("board");
      await act(async () => { result.current[1]("list"); });
      expect(setPreference).toHaveBeenCalledWith({ pane: "default", key: "tasks.presentation", value: "list" });
      expect(result.current[0]).toBe("board");
      expect(readPanePreference("default", "tasks.presentation", "list")).toBe("board");
      expect(feedback).toHaveBeenCalledWith(expect.objectContaining({ detail: expect.stringContaining("was not saved") }));
    } finally { window.removeEventListener("hcb:save-feedback", feedback); }
  });
});
