import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CoreViewModelSource } from "../core/coreViewModelSource";
import { usePaneWorkspace } from "./usePaneWorkspace";

afterEach(cleanup);

function source(updateSettings: (request: any) => Promise<boolean>) {
  return { settings: { paneWorkspace: { focusedPaneId: "saved-calendar", root: { id: "saved-calendar", kind: "leaf", content: { kind: "section", sectionId: "calendar" } } } }, dataState: "ready", updateSettings } as unknown as Pick<CoreViewModelSource, "settings" | "dataState" | "updateSettings">;
}

describe("durable workspace navigation", () => {
  it("normalizes a saved legacy layout once before later navigation writes", async () => {
    const save = vi.fn(async () => true);
    const input = source(save);
    input.settings.paneWorkspace = { focusedPaneId: "saved-notes", updatedAt: 42, root: { kind: "split", children: [
      { id: "saved-web", kind: "leaf", content: { kind: "web", url: "https://example.com" } },
      { id: "saved-notes", kind: "leaf", content: { kind: "section", sectionId: "notes" } }
    ] } };
    const { result, rerender } = renderHook(() => usePaneWorkspace(input));
    expect(result.current.activeSectionId).toBe("notes");
    expect(save).toHaveBeenCalledWith({ paneWorkspace: { focusedPaneId: "saved-notes", updatedAt: 42, root: { id: "saved-notes", kind: "leaf", content: { kind: "section", sectionId: "notes" } } } });
    rerender();
    expect(save).toHaveBeenCalledTimes(1);
    await act(async () => result.current.replaceFocusedWithSection("tasks"));
    expect(save).toHaveBeenCalledTimes(2);
    expect(result.current.activeSectionId).toBe("tasks");
  });

  it("durably records a fresh pane identity even without navigating away from Calendar", () => {
    const save = vi.fn(async () => true);
    const input = source(save);
    delete input.settings.paneWorkspace;
    const { result, rerender } = renderHook(() => usePaneWorkspace(input));
    expect(save).toHaveBeenCalledWith({ paneWorkspace: expect.objectContaining({ focusedPaneId: result.current.focusedPaneId, root: result.current.root }) });
    rerender();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("keeps the previous route visible until its new route is durably saved", async () => {
    let finish!: (saved: boolean) => void;
    const save = vi.fn(() => new Promise<boolean>((resolve) => { finish = resolve; }));
    const { result } = renderHook(() => usePaneWorkspace(source(save)));
    act(() => result.current.replaceFocusedWithSection("tasks"));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ paneWorkspace: expect.objectContaining({ root: expect.objectContaining({ content: { kind: "section", sectionId: "tasks" } }) }) }));
    expect(result.current.activeSectionId).toBe("calendar");
    await act(async () => finish(true));
    expect(result.current.activeSectionId).toBe("tasks");
  });

  it("deduplicates pending navigation and preserves the last saved route after failure", async () => {
    const completions: Array<(saved: boolean) => void> = [];
    const save = vi.fn(() => new Promise<boolean>((resolve) => { completions.push(resolve); }));
    const { result } = renderHook(() => usePaneWorkspace(source(save)));
    act(() => {
      result.current.replaceFocusedWithSection("tasks");
      result.current.replaceFocusedWithSection("tasks");
      result.current.replaceFocusedWithSection("notes");
    });
    expect(save).toHaveBeenCalledTimes(2);
    await act(async () => completions[0](true));
    expect(result.current.activeSectionId).toBe("calendar");
    await act(async () => completions[1](false));
    expect(result.current.activeSectionId).toBe("tasks");
    act(() => result.current.replaceFocusedWithSection("notes"));
    expect(save).toHaveBeenCalledTimes(3);
    await act(async () => completions[2](true));
    expect(result.current.activeSectionId).toBe("notes");
  });
});
