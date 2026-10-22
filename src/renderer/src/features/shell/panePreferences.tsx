import { createContext, useContext, useState, type Dispatch, type SetStateAction } from "react";

export const PaneIdentity = createContext("default");
const storageKey = "hcb.panePreferences.v1";
type Preferences = Record<string, Record<string, unknown>>;

export function readPanePreference<T>(pane: string, key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(storageKey) ?? "{}")[pane]?.[key] ?? fallback; }
  catch { return fallback; }
}

export function writePanePreference(pane: string, key: string, value: unknown): void {
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
  const update: Dispatch<SetStateAction<T>> = (next) => setValue((previous) => {
    const resolved = typeof next === "function" ? (next as (previous: T) => T)(previous) : next;
    writePanePreference(pane, key, resolved);
    return resolved;
  });
  return [value, update];
}
