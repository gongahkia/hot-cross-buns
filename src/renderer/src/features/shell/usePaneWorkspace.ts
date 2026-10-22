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
  const [state, setState] = useState<PaneWorkspaceState>(readPaneWorkspaceState);
  const hydrated = useRef(false);
  const [preferencesReady, setPreferencesReady] = useState(!source);
  useEffect(() => {
    if (!source || hydrated.current || !["ready", "empty"].includes(source.dataState)) return;
    hydrated.current = true;
    const saved = sanitizeStoredPaneWorkspace(source.settings.paneWorkspace);
    if (saved) {
      const updatedAt = Number(source.settings.paneWorkspace?.updatedAt) || 0;
      setState((current) => updatedAt >= (current.updatedAt ?? 0) ? { ...saved, updatedAt } : current);
    }
    setPreferencesReady(true);
  }, [source?.dataState, source?.settings.paneWorkspace]);

  const savedPreferences = JSON.stringify(source?.settings.paneWorkspace);
  useEffect(() => {
    if (!source || !preferencesReady || savedPreferences === JSON.stringify(state)) return;
    const timer = window.setTimeout(() => { void source.updateSettings({ paneWorkspace: state }); }, 300);
    return () => window.clearTimeout(timer);
  }, [preferencesReady, state, savedPreferences, source?.updateSettings]);

  useEffect(() => { writeLocalStorageJSON(paneWorkspaceStorageKey, state); }, [state]);

  const replaceFocusedWithSection = useCallback((sectionId: SectionId): void => {
    // Keep the current view visible while its next route module loads.
    startTransition(() => setState((current) => current.root.content.sectionId === sectionId ? current : {
      ...current,
      updatedAt: Date.now(),
      root: { ...current.root, content: { kind: "section", sectionId } }
    }));
  }, []);

  return useMemo(() => ({
    activeSectionId: state.root.content.sectionId,
    focusedPaneId: state.root.id,
    replaceFocusedWithSection,
    root: state.root
  }), [state.root, replaceFocusedWithSection]);
}
