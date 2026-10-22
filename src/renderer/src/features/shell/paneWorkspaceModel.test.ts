import { describe, expect, it } from "vitest";
import { sanitizeStoredPaneWorkspace } from "./paneWorkspaceModel";

const calendar = { id: "calendar-pane", kind: "leaf", content: { kind: "section", sectionId: "calendar" } };
const notes = { id: "notes-pane", kind: "leaf", content: { kind: "section", sectionId: "notes" } };
const webpage = { id: "web-pane", kind: "leaf", content: { kind: "web", url: "https://example.com" } };
const split = (first: unknown, second: unknown) => ({ kind: "split", direction: "row", ratio: 0.5, children: [first, second] });

describe("restoring a single planner view", () => {
  it("retains the focused app section and its pane ID from a nested split layout", () => {
    expect(sanitizeStoredPaneWorkspace({ focusedPaneId: notes.id, root: split(calendar, split(webpage, notes)) }))
      .toEqual({ focusedPaneId: notes.id, root: notes });
  });

  it("uses another saved app section when the focused pane was a webpage or chooser", () => {
    for (const retired of [webpage, { id: "chooser-pane", kind: "leaf", content: { kind: "chooser" } }]) {
      expect(sanitizeStoredPaneWorkspace({ focusedPaneId: retired.id, root: split(retired, notes) }))
        .toEqual({ focusedPaneId: notes.id, root: notes });
    }
  });

  it("falls back to Calendar when only a webpage was saved", () => {
    const result = sanitizeStoredPaneWorkspace({ focusedPaneId: webpage.id, root: webpage });
    expect(result?.root.content).toEqual({ kind: "section", sectionId: "calendar" });
    expect(result?.focusedPaneId).toBe(result?.root.id);
  });

  it("preserves an ordinary section and migrates the legacy Today section", () => {
    expect(sanitizeStoredPaneWorkspace({ focusedPaneId: notes.id, root: notes })?.root).toEqual(notes);
    expect(sanitizeStoredPaneWorkspace({ root: { ...calendar, content: { kind: "section", sectionId: "today" } } })?.root).toEqual(calendar);
  });

  it("ignores malformed settings and stops traversing excessively nested data", () => {
    for (const value of [null, [], "invalid", { root: {} }]) expect(sanitizeStoredPaneWorkspace(value)).toBeNull();
    let nested: unknown = notes;
    for (let depth = 0; depth < 20; depth++) nested = split(webpage, nested);
    expect(sanitizeStoredPaneWorkspace({ root: nested })?.root.content.sectionId).toBe("calendar");
  });
});
