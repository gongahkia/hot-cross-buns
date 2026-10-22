import type { SectionId } from "../../data/mockPlanner";

// Keep the storage shape and pane IDs so existing view preferences still apply.
export const paneWorkspaceStorageKey = "hcb.paneWorkspace.v1";
export interface PaneLeafNode {
  id: string;
  kind: "leaf";
  content: { kind: "section"; sectionId: SectionId };
}
export interface StoredPaneWorkspace {
  focusedPaneId: string;
  root: PaneLeafNode;
}

const validSectionIds = new Set(["tasks", "calendar", "notes", "settings"]);
let paneIdCounter = 0;

export function createDefaultPaneTree(sectionId: SectionId = "calendar"): PaneLeafNode {
  return {
    id: `pane-${Date.now().toString(36)}-${++paneIdCounter}`,
    kind: "leaf",
    content: { kind: "section", sectionId }
  };
}

export function sanitizeStoredPaneWorkspace(value: unknown): StoredPaneWorkspace | null {
  if (!isRecord(value) || !isRecord(value.root)) return null;
  if (value.root.kind !== "leaf" && value.root.kind !== "split") return null;
  const sections = savedSections(value.root, 0);
  // Retired webpage/chooser panes fall back to an existing app section first.
  const root = sections.find((leaf) => leaf.id === value.focusedPaneId) ?? sections[0] ?? createDefaultPaneTree();
  return { focusedPaneId: root.id, root };
}

function savedSections(value: unknown, depth: number): PaneLeafNode[] {
  if (!isRecord(value) || depth > 4) return [];
  if (value.kind === "split" && Array.isArray(value.children)) {
    return value.children.slice(0, 2).flatMap((child) => savedSections(child, depth + 1));
  }
  if (value.kind !== "leaf" || !isRecord(value.content) || value.content.kind !== "section") return [];
  const sectionId = value.content.sectionId === "today" ? "calendar" : value.content.sectionId;
  if (typeof sectionId !== "string" || !validSectionIds.has(sectionId)) return [];
  return [{
    id: typeof value.id === "string" && value.id.trim() ? value.id : createDefaultPaneTree().id,
    kind: "leaf",
    content: { kind: "section", sectionId: sectionId as SectionId }
  }];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
