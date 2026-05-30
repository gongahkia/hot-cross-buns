import { describe, expect, it } from "vitest";
import { movePaneToEdge, splitPaneWebUrl, type PaneNode } from "./paneWorkspaceModel";

describe("paneWorkspaceModel", () => {
  it("moves panes to top and bottom edges as vertical splits", () => {
    const root: PaneNode = {
      id: "root",
      kind: "split",
      direction: "row",
      ratio: 0.5,
      children: [
        { id: "left", kind: "leaf", content: { kind: "section", sectionId: "tasks" } },
        { id: "right", kind: "leaf", content: { kind: "section", sectionId: "calendar" } }
      ]
    };

    const top = movePaneToEdge(root, "left", "right", "top");
    expect(top.node).toMatchObject({ kind: "split", direction: "column" });

    const bottom = movePaneToEdge(root, "left", "right", "bottom");
    expect(bottom.node).toMatchObject({ kind: "split", direction: "column" });
  });

  it("normalizes typed webpage targets", () => {
    expect(splitPaneWebUrl("example.com", "https://app.local")).toBe("https://example.com/");
    expect(splitPaneWebUrl("https://example.com/docs", "https://app.local")).toBe("https://example.com/docs");
    expect(splitPaneWebUrl("javascript:alert(1)", "https://app.local")).toBeNull();
  });
});
