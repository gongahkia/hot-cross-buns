import { createContext, useCallback, useContext, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import type { HcbResult } from "@shared/result";

export const PaneIdentity = createContext("default");
const storageKey = "hcb.panePreferences.v1";
type Preferences = Record<string, Record<string, unknown>>;
let browserPreferences: Preferences = {};
let durablePreferences: Preferences = {};
const versions = new Map<string, number>();

export function hydratePanePreferences(value: Preferences): void {
  browserPreferences = structuredClone(value);
  durablePreferences = structuredClone(value);
}

export function readPanePreference<T>(pane: string, key: string, fallback: T): T {
  if (window.hcb?.workspace) return (browserPreferences[pane]?.[key] as T | undefined) ?? fallback;
  try { return JSON.parse(localStorage.getItem(storageKey) ?? "{}")[pane]?.[key] ?? fallback; }
  catch { return fallback; }
}

export function writePanePreference(pane: string, key: string, value: unknown): void {
  if (window.hcb?.workspace) {
    const id = JSON.stringify([pane, key]);
    const version = (versions.get(id) ?? 0) + 1;
    versions.set(id, version);
    browserPreferences = { ...browserPreferences, [pane]: { ...browserPreferences[pane], [key]: value } };
    void window.hcb.workspace.setPreference({ pane, key, value }).then((result: HcbResult<Preferences>) => {
      if (result.ok) {
        durablePreferences = { ...durablePreferences, [pane]: { ...durablePreferences[pane], [key]: value } };
      } else {
        if (versions.get(id) === version) {
          browserPreferences = { ...browserPreferences, [pane]: { ...browserPreferences[pane], [key]: durablePreferences[pane]?.[key] } };
          window.dispatchEvent(new CustomEvent("hcb:preference-reverted", { detail: { pane, key } }));
        }
        window.dispatchEvent(new CustomEvent("hcb:save-feedback", { detail: `View preference was not saved. ${result.error.message}` }));
      }
    });
    return;
  }
  // Compatibility for legacy renderer harnesses without the browser service.
  try {
    const all: Preferences = JSON.parse(localStorage.getItem(storageKey) ?? "{}");
    const values = { ...all[pane] };
    delete values[key];
    values[key] = value;
    delete all[pane];
    all[pane] = Object.fromEntries(Object.entries(values).slice(-48));
    localStorage.setItem(storageKey, JSON.stringify(Object.fromEntries(Object.entries(all).slice(-16))));
  } catch { /* View preferences must never prevent editing. */ }
}

export function usePanePreference<T>(key: string, initial: T | (() => T)): [T, Dispatch<SetStateAction<T>>] {
  const pane = useContext(PaneIdentity);
  const [value, setValue] = useState<T>(() => readPanePreference(pane, key, typeof initial === "function" ? (initial as () => T)() : initial));
  useEffect(() => {
    const reverted = (event: Event) => {
      const detail = (event as CustomEvent<{ pane: string; key: string }>).detail;
      if (detail.pane === pane && detail.key === key) setValue(readPanePreference(pane, key, typeof initial === "function" ? (initial as () => T)() : initial));
    };
    window.addEventListener("hcb:preference-reverted", reverted);
    return () => window.removeEventListener("hcb:preference-reverted", reverted);
  }, [pane, key, initial]);
  const update = useCallback<Dispatch<SetStateAction<T>>>((next) => setValue((previous) => {
    const resolved = typeof next === "function" ? (next as (previous: T) => T)(previous) : next;
    writePanePreference(pane, key, resolved);
    return resolved;
  }), [pane, key]);
  return [value, update];
}
