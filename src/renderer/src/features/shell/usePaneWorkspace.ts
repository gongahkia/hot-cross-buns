import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CoreViewModelSource } from "../core/coreViewModelSource";
import type { SectionId } from "../../data/mockPlanner";
import { writeLocalStorageJSON } from "../core/localStorageHelpers";
import {
  createDefaultPaneTree,
  paneWorkspaceStorageKey,
  sanitizeStoredPaneWorkspace,
  type StoredPaneWorkspace
} from "./paneWorkspaceModel";

interface PaneWorkspaceState extends StoredPaneWorkspace { updatedAt?: number }

function readPaneWorkspaceState(): PaneWorkspaceState {
  try {
    const parsed = JSON.parse(window.localStorage?.getItem?.(paneWorkspaceStorageKey) ?? "null");
    const stored = sanitizeStoredPaneWorkspace(parsed);
    if (stored) return { ...stored, updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : 0 };
  } catch {
    // View preferences must never prevent opening the planner.
  }
  const root = createDefaultPaneTree();
  return { focusedPaneId: root.id, root };
}

export function usePaneWorkspace(source?: Pick<CoreViewModelSource, "settings" | "dataState" | "updateSettings">) {
  const [state, setState] = useState<PaneWorkspaceState>(() => {
    if (!source) return readPaneWorkspaceState();
    const root = createDefaultPaneTree();
    return { focusedPaneId: root.id, root };
  });
  const hydrated = useRef(false);
  const durableState = useRef(state);
  const requestedState = useRef(state);
  const navigationGeneration = useRef(0);
  const persist = useRef(source?.updateSettings);
  persist.current = source?.updateSettings;
  useEffect(() => {
    if (!source || hydrated.current || !["ready", "empty"].includes(source.dataState)) return;
    hydrated.current = true;
    const raw = source.settings.paneWorkspace;
    const saved = sanitizeStoredPaneWorkspace(raw);
    if ((saved || raw == null) && navigationGeneration.current === 0) {
      const updatedAt = Number(raw?.updatedAt) || 0;
      const restored = saved ? { ...saved, updatedAt } : durableState.current;
      durableState.current = restored;
      requestedState.current = restored;
      setState(restored);
      // Persist a new pane's identity and retire legacy split/web layouts once.
      // The settings queue places this before any subsequent user navigation;
      // completion never changes the route, and failures use the normal error UI.
      if (!raw || JSON.stringify({ focusedPaneId: raw.focusedPaneId, root: raw.root }) !== JSON.stringify({ focusedPaneId: restored.focusedPaneId, root: restored.root })) {
        void source.updateSettings({ paneWorkspace: restored }).catch(() => {
          window.dispatchEvent(new CustomEvent("hcb:save-feedback", { detail: "Workspace layout could not be saved. Your previous saved workspace has been preserved." }));
        });
      }
    }
  }, [source?.dataState, source?.settings.paneWorkspace]);

  useEffect(() => { if (!source) writeLocalStorageJSON(paneWorkspaceStorageKey, state); }, [state, source]);

  const replaceFocusedWithSection = useCallback((sectionId: SectionId): void => {
    const current = requestedState.current;
    if (current.root.content.sectionId === sectionId) return;
    const next: PaneWorkspaceState = {
      ...current,
      updatedAt: Date.now(),
      root: { ...current.root, content: { kind: "section", sectionId } }
    };
    requestedState.current = next;
    const generation = ++navigationGeneration.current;
    const save = persist.current;
    if (!save) {
      durableState.current = next;
      startTransition(() => setState(next));
      return;
    }
    // A completed navigation must survive an immediate reload. Settings writes
    // already use a queue; keep the current route until IndexedDB acknowledges
    // this one, and let a later click supersede a pending route transition.
    void save({ paneWorkspace: next }).then((saved) => {
      if (saved) durableState.current = next;
      if (generation !== navigationGeneration.current) return;
      requestedState.current = durableState.current;
      startTransition(() => setState(durableState.current));
    }).catch(() => {
      if (generation !== navigationGeneration.current) return;
      requestedState.current = durableState.current;
      startTransition(() => setState(durableState.current));
      window.dispatchEvent(new CustomEvent("hcb:save-feedback", { detail: "Navigation could not be saved. Your previous workspace is still available; try again." }));
    });
  }, []);

  return useMemo(() => ({
    activeSectionId: state.root.content.sectionId,
    focusedPaneId: state.root.id,
    replaceFocusedWithSection,
    root: state.root
  }), [state.root, replaceFocusedWithSection]);
}
