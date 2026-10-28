import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceRefresh } from "./useWorkspaceRefresh";

let changed: () => void;
let originalBridge: typeof window.hcb;
beforeEach(() => {
  vi.useFakeTimers();
  originalBridge = window.hcb;
  Object.defineProperty(window, "hcb", { configurable: true, value: {
    workspace: { subscribeChanges: (listener: () => void) => { changed = listener; return () => undefined; } }
  } });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  Object.defineProperty(window, "hcb", { configurable: true, value: originalBridge });
});

describe("cross-tab workspace refresh", () => {
  it("defers changes for the entire open draft and coalesces them when it closes", () => {
    const refresh = vi.fn();
    const { rerender } = renderHook(({ editing }) => useWorkspaceRefresh(refresh, editing), { initialProps: { editing: true } });
    act(() => { changed(); changed(); vi.advanceTimersByTime(200); });
    expect(refresh).not.toHaveBeenCalled();
    rerender({ editing: false });
    act(() => { vi.advanceTimersByTime(200); });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("preserves an inline editor until focus leaves it", () => {
    const refresh = vi.fn();
    renderHook(() => useWorkspaceRefresh(refresh, false));
    const input = document.createElement("input");
    document.body.append(input);
    input.focus();
    act(() => { changed(); vi.advanceTimersByTime(200); });
    expect(refresh).not.toHaveBeenCalled();
    input.blur();
    act(() => { vi.advanceTimersByTime(200); });
    expect(refresh).toHaveBeenCalledTimes(1);
    input.remove();
  });

  it("refreshes on returning to a tab even if its broadcast was missed", () => {
    const refresh = vi.fn();
    renderHook(() => useWorkspaceRefresh(refresh, false));
    act(() => { window.dispatchEvent(new Event("focus")); vi.advanceTimersByTime(200); });
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
