import { useEffect, useRef, type RefObject } from "react";

/** Native scrolling first; at a boundary roll a bounded calendar window by one day/week.
 * Trackpad momentum is coalesced, with no event fetch or storage write per wheel frame. */
export function useCalendarWheelNavigation(ref: RefObject<HTMLElement | null>, axis: "horizontal" | "vertical", onStep?: (direction: -1 | 1) => void) {
  const latest = useRef(onStep); latest.current = onStep;
  useEffect(() => {
    const node = ref.current;
    if (!node || !latest.current) return;
    let accumulated = 0, lastAt = 0, lastStep = 0;
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || document.body.dataset.calendarDragging || (event.target as HTMLElement).closest('[role="dialog"],[role="menu"],input,textarea')) return;
      const horizontal = Math.abs(event.deltaX) > Math.abs(event.deltaY) || event.shiftKey;
      if (horizontal !== (axis === "horizontal")) return;
      const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? node.clientHeight : 1;
      const delta = (horizontal ? event.deltaX || event.deltaY : event.deltaY) * scale;
      const position = horizontal ? node.scrollLeft : node.scrollTop;
      const maximum = horizontal ? node.scrollWidth - node.clientWidth : node.scrollHeight - node.clientHeight;
      if ((delta > 0 && position < maximum - 2) || (delta < 0 && position > 2)) { accumulated = 0; return; }
      event.preventDefault();
      const now = performance.now();
      if (now - lastAt > 180 || Math.sign(accumulated) !== Math.sign(delta)) accumulated = 0;
      lastAt = now;
      accumulated = Math.max(-160, Math.min(160, accumulated + delta));
      if (Math.abs(accumulated) >= 80 && now - lastStep >= 120) {
        lastStep = now; latest.current?.(accumulated > 0 ? 1 : -1); accumulated = 0;
      }
    };
    node.addEventListener("wheel", wheel, { passive: false });
    return () => node.removeEventListener("wheel", wheel);
  }, [ref, axis, Boolean(onStep)]);
}
