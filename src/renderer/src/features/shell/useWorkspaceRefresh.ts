import { useEffect, useRef } from "react";

/** Reconcile other tabs after editing ends; never replace an open draft. */
export function useWorkspaceRefresh(refresh: () => void, editorOpen: boolean): void {
  const pending = useRef(false);
  const blocked = useRef(editorOpen);
  blocked.current = editorOpen;
  const schedule = useRef<() => void>(() => undefined);

  useEffect(() => {
    const subscribe = window.hcb?.workspace?.subscribeChanges;
    if (!subscribe) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pointerDown = false;
    const flush = () => {
      timer = undefined;
      if (!pending.current || blocked.current || pointerDown || document.visibilityState === "hidden") return;
      // Inline task titles, contenteditable notes, prompts and select popovers
      // may hold values even without an inspector open.
      const active = document.activeElement;
      if (active instanceof HTMLElement && active.closest("input, textarea, select, [contenteditable='true'], [role='textbox'], [role='combobox']")) return;
      pending.current = false;
      refresh();
    };
    const queue = () => {
      clearTimeout(timer);
      timer = setTimeout(flush, 150);
    };
    schedule.current = queue;
    const changed = () => { pending.current = true; queue(); };
    const pointerStarted = () => { pointerDown = true; };
    const pointerFinished = () => { pointerDown = false; queue(); };
    const unsubscribe = subscribe(changed);
    // Also cover suspended tabs that missed a broadcast while inactive.
    window.addEventListener("focus", changed);
    document.addEventListener("visibilitychange", changed);
    document.addEventListener("focusout", queue);
    document.addEventListener("pointerdown", pointerStarted, true);
    document.addEventListener("pointerup", pointerFinished, true);
    document.addEventListener("pointercancel", pointerFinished, true);
    return () => {
      clearTimeout(timer);
      unsubscribe();
      schedule.current = () => undefined;
      window.removeEventListener("focus", changed);
      document.removeEventListener("visibilitychange", changed);
      document.removeEventListener("focusout", queue);
      document.removeEventListener("pointerdown", pointerStarted, true);
      document.removeEventListener("pointerup", pointerFinished, true);
      document.removeEventListener("pointercancel", pointerFinished, true);
    };
  }, [refresh]);

  useEffect(() => { if (!editorOpen) schedule.current(); }, [editorOpen]);
}
