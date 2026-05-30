import { useCallback, useEffect, useMemo, useState } from "react";
import type { SectionId } from "../../data/mockPlanner";
import { writeLocalStorageJSON } from "../core/localStorageHelpers";
import {
  closePaneLeaf,
  createDefaultPaneTree,
  findPaneLeaf,
  firstPaneLeaf,
  firstPaneSectionId,
  maxPaneLeaves,
  movePaneToEdge,
  paneLeafCount,
  paneLeafIds,
  paneWorkspaceStorageKey,
  replacePaneContent,
  sanitizeStoredPaneWorkspace,
  setPaneSplitRatio,
  splitPaneLeaf,
  splitPaneWebTitle,
  splitPaneWebUrl,
  swapPaneContents,
  type PaneContent,
  type PaneDropZone,
  type PaneNode,
  type PaneSplitDirection,
  type SplitPaneWebPage
} from "./paneWorkspaceModel";

interface PaneWorkspaceState {
  focusedPaneId: string;
  recentWebPages: SplitPaneWebPage[];
  root: PaneNode;
}

function readPaneWorkspaceState(): PaneWorkspaceState {
  try {
    const parsed = JSON.parse(window.localStorage?.getItem?.(paneWorkspaceStorageKey) ?? "null");
    const stored = sanitizeStoredPaneWorkspace(parsed);

    if (stored) {
      return stored;
    }
  } catch {
    // best-effort persisted UI only
  }

  const root = createDefaultPaneTree("calendar");
  return { focusedPaneId: root.id, recentWebPages: [], root };
}

export function usePaneWorkspace(): {
  activeSectionId: SectionId;
  canSplit: boolean;
  closePane: (paneId: string) => void;
  focusedPaneId: string;
  focusedSectionId: SectionId | null;
  focusedTitle: string;
  focusPane: (paneId: string) => void;
  movePane: (sourcePaneId: string, targetPaneId: string, dropZone: PaneDropZone) => void;
  openChooser: () => void;
  openRecentWebPage: (pageId: string, paneId: string) => void;
  openUrl: (url: string, label: string | null) => void;
  openWebPageInPane: (rawUrl: string, label: string | null, paneId: string) => boolean;
  recentWebPages: SplitPaneWebPage[];
  replaceFocusedWithSection: (sectionId: SectionId) => void;
  replacePane: (paneId: string, content: PaneContent) => void;
  root: PaneNode;
  setSplitRatio: (splitId: string, ratio: number) => void;
  splitPane: (paneId: string, direction: PaneSplitDirection, content?: PaneContent) => void;
} {
  const [state, setState] = useState<PaneWorkspaceState>(() => readPaneWorkspaceState());
  const focusedLeaf = findPaneLeaf(state.root, state.focusedPaneId) ?? firstPaneLeaf(state.root);
  const focusedSectionId = focusedLeaf.content.kind === "section" ? focusedLeaf.content.sectionId : null;
  const activeSectionId = focusedSectionId ?? firstPaneSectionId(state.root);
  const focusedTitle = paneContentTitle(focusedLeaf.content);
  const canSplit = paneLeafCount(state.root) < maxPaneLeaves;

  useEffect(() => {
    writeLocalStorageJSON(paneWorkspaceStorageKey, state);
  }, [state]);

  const focusPane = useCallback((paneId: string): void => {
    setState((current) =>
      findPaneLeaf(current.root, paneId)
        ? { ...current, focusedPaneId: paneId }
        : current
    );
  }, []);

  const replacePane = useCallback((paneId: string, content: PaneContent): void => {
    setState((current) =>
      findPaneLeaf(current.root, paneId)
        ? {
            ...current,
            focusedPaneId: paneId,
            recentWebPages: content.kind === "web"
              ? current.recentWebPages.map((page) =>
                  page.url === content.url ? { ...page, title: content.title } : page
                )
              : current.recentWebPages,
            root: replacePaneContent(current.root, paneId, content)
          }
        : current
    );
  }, []);

  const replaceFocusedWithSection = useCallback((sectionId: SectionId): void => {
    const resolvedSectionId = sectionId === "today" ? "calendar" : sectionId;

    setState((current) => ({
      ...current,
      root: replacePaneContent(current.root, current.focusedPaneId, {
        kind: "section",
        sectionId: resolvedSectionId
      })
    }));
  }, []);

  const splitPane = useCallback((
    paneId: string,
    direction: PaneSplitDirection,
    content: PaneContent = { kind: "chooser" }
  ): void => {
    setState((current) => {
      if (!findPaneLeaf(current.root, paneId) || paneLeafCount(current.root) >= maxPaneLeaves) {
        return current;
      }

      const result = splitPaneLeaf(current.root, paneId, direction, content);
      return result.newPaneId
        ? { ...current, focusedPaneId: result.newPaneId, root: result.node }
        : current;
    });
  }, []);

  const openChooser = useCallback((): void => {
    setState((current) => {
      if (paneLeafCount(current.root) >= maxPaneLeaves) {
        return {
          ...current,
          root: replacePaneContent(current.root, current.focusedPaneId, { kind: "chooser" })
        };
      }

      const result = splitPaneLeaf(current.root, current.focusedPaneId, "row", { kind: "chooser" });
      return result.newPaneId
        ? { ...current, focusedPaneId: result.newPaneId, root: result.node }
        : current;
    });
  }, []);

  const closePane = useCallback((paneId: string): void => {
    setState((current) => {
      if (paneLeafCount(current.root) <= 1) {
        return current;
      }

      const nextRoot = closePaneLeaf(current.root, paneId);

      if (!nextRoot) {
        return current;
      }

      const nextFocusedPaneId = findPaneLeaf(nextRoot, current.focusedPaneId)
        ? current.focusedPaneId
        : firstPaneLeaf(nextRoot).id;

      return { ...current, focusedPaneId: nextFocusedPaneId, root: nextRoot };
    });
  }, []);

  const setSplitRatio = useCallback((splitId: string, ratio: number): void => {
    setState((current) => ({
      ...current,
      root: setPaneSplitRatio(current.root, splitId, ratio)
    }));
  }, []);

  const movePane = useCallback((sourcePaneId: string, targetPaneId: string, dropZone: PaneDropZone): void => {
    setState((current) => {
      if (!findPaneLeaf(current.root, sourcePaneId) || !findPaneLeaf(current.root, targetPaneId)) {
        return current;
      }

      if (dropZone === "center") {
        return {
          ...current,
          focusedPaneId: targetPaneId,
          root: swapPaneContents(current.root, sourcePaneId, targetPaneId)
        };
      }

      const result = movePaneToEdge(current.root, sourcePaneId, targetPaneId, dropZone);
      return result.movedPaneId
        ? { ...current, focusedPaneId: result.movedPaneId, root: result.node }
        : current;
    });
  }, []);

  const addRecentWebPage = useCallback((url: string, label: string | null): SplitPaneWebPage => {
    const page: SplitPaneWebPage = {
      id: url,
      title: splitPaneWebTitle(url, label),
      url
    };

    setState((current) => ({
      ...current,
      recentWebPages: [
        page,
        ...current.recentWebPages.filter((recentPage) => recentPage.url !== url)
      ].slice(0, 8)
    }));

    return page;
  }, []);

  const openUrl = useCallback((rawUrl: string, label: string | null): void => {
    const url = splitPaneWebUrl(rawUrl, window.location.href);

    if (!url) {
      return;
    }

    const page = addRecentWebPage(url, label);

    setState((current) => {
      const leafIds = paneLeafIds(current.root);
      const secondaryPaneId = leafIds.find((paneId) => paneId !== current.focusedPaneId);
      const content: PaneContent = { kind: "web", title: page.title, url: page.url };

      if (secondaryPaneId) {
        return {
          ...current,
          focusedPaneId: secondaryPaneId,
          root: replacePaneContent(current.root, secondaryPaneId, content)
        };
      }

      const result = splitPaneLeaf(current.root, current.focusedPaneId, "row", content);
      return result.newPaneId
        ? { ...current, focusedPaneId: result.newPaneId, root: result.node }
        : current;
    });
  }, [addRecentWebPage]);

  const openRecentWebPage = useCallback((pageId: string, paneId: string): void => {
    setState((current) => {
      const page = current.recentWebPages.find((recentPage) => recentPage.id === pageId);

      if (!page || !findPaneLeaf(current.root, paneId)) {
        return current;
      }

      return {
        ...current,
        focusedPaneId: paneId,
        root: replacePaneContent(current.root, paneId, {
          kind: "web",
          title: page.title,
          url: page.url
        })
      };
    });
  }, []);

  const openWebPageInPane = useCallback((rawUrl: string, label: string | null, paneId: string): boolean => {
    const url = splitPaneWebUrl(rawUrl, window.location.href);

    if (!url) {
      return false;
    }

    const page = addRecentWebPage(url, label);

    setState((current) =>
      findPaneLeaf(current.root, paneId)
        ? {
            ...current,
            focusedPaneId: paneId,
            root: replacePaneContent(current.root, paneId, {
              kind: "web",
              title: page.title,
              url: page.url
            })
          }
        : current
    );

    return true;
  }, [addRecentWebPage]);

  return useMemo(
    () => ({
      activeSectionId,
      canSplit,
      closePane,
      focusedPaneId: state.focusedPaneId,
      focusedSectionId,
      focusedTitle,
      focusPane,
      movePane,
      openChooser,
      openRecentWebPage,
      openUrl,
      openWebPageInPane,
      recentWebPages: state.recentWebPages,
      replaceFocusedWithSection,
      replacePane,
      root: state.root,
      setSplitRatio,
      splitPane
    }),
    [
      activeSectionId,
      canSplit,
      closePane,
      focusPane,
      focusedSectionId,
      focusedTitle,
      movePane,
      openChooser,
      openRecentWebPage,
      openUrl,
      openWebPageInPane,
      replaceFocusedWithSection,
      replacePane,
      setSplitRatio,
      splitPane,
      state.focusedPaneId,
      state.recentWebPages,
      state.root
    ]
  );
}

function paneContentTitle(content: PaneContent): string {
  if (content.kind === "chooser") {
    return "Choose split view";
  }

  if (content.kind === "web") {
    return content.title;
  }

  return content.sectionId[0].toUpperCase() + content.sectionId.slice(1);
}
