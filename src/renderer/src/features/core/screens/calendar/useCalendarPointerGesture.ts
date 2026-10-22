import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { CalendarEventViewModel } from "../../coreViewModels";
import { calendarGestureRange, calendarRangeChanged, type CalendarEventRange, type CalendarGestureKind, type CalendarGesturePoint } from "./calendarGesture";

export interface CalendarGesturePreview extends CalendarEventRange { event: CalendarEventViewModel }

/** One pointer session and one animation frame, independent of collection size. */
export function useCalendarPointerGesture(options: {
  locate: (x: number, y: number) => CalendarGesturePoint | null;
  onCommit: (event: CalendarEventViewModel, range: CalendarEventRange) => void;
  onEdge?: (x: number, y: number) => boolean;
  onFinish?: () => void;
  resizeCursor?: string;
}) {
  const latest = useRef(options); latest.current = options;
  const [preview, setPreview] = useState<CalendarGesturePreview | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const suppressClick = useRef(false);
  useEffect(() => () => cleanupRef.current?.(), []);

  function begin(pointer: ReactPointerEvent<HTMLElement>, event: CalendarEventViewModel, kind: CalendarGestureKind = "move") {
    if (pointer.button !== 0 || event.sourceKind === "task" || (kind === "move" && (pointer.target as HTMLElement).closest("button,input,a"))) return;
    const origin = latest.current.locate(pointer.clientX, pointer.clientY);
    if (!origin) return;
    pointer.preventDefault(); pointer.stopPropagation();
    cleanupRef.current?.();
    suppressClick.current = false;
    const pointerId = pointer.pointerId, x = pointer.clientX, y = pointer.clientY;
    const trigger = pointer.currentTarget;
    let moved = false, frame = 0, next: CalendarGesturePreview | null = null;
    let clientX = x, clientY = y;
    const previousCursor = document.body.style.cursor;
    const update = () => {
      frame = 0;
      if (!moved) return;
      const atEdge = latest.current.onEdge?.(clientX, clientY);
      const target = latest.current.locate(clientX, clientY);
      if (target) {
        const range = calendarGestureRange(event, kind, origin, target);
        if (!next || calendarRangeChanged(next, range)) { next = { ...range, event }; setPreview(next); }
      }
      if (atEdge) frame = requestAnimationFrame(update);
    };
    const move = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      clientX = e.clientX; clientY = e.clientY;
      if (!moved && Math.hypot(clientX - x, clientY - y) < 5) return;
      e.preventDefault(); moved = true;
      document.body.dataset.calendarDragging = "true";
      document.body.style.cursor = kind === "move" ? "grabbing" : latest.current.resizeCursor ?? "ew-resize";
      if (!frame) frame = requestAnimationFrame(update);
    };
    const cleanup = () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("blur", cancel);
      delete document.body.dataset.calendarDragging;
      document.body.style.cursor = previousCursor;
      if (trigger.hasPointerCapture(pointerId)) trigger.releasePointerCapture(pointerId);
      cleanupRef.current = null;
      latest.current.onFinish?.();
    };
    const cancel = () => { suppressClick.current = moved; cleanup(); setPreview(null); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); cancel(); } };
    const finish = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      clientX = e.clientX; clientY = e.clientY; cancelAnimationFrame(frame); update();
      suppressClick.current = moved;
      cleanup(); setPreview(null);
      if (moved && next && calendarRangeChanged(event, next)) latest.current.onCommit(event, next);
    };
    trigger.setPointerCapture(pointerId);
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", key, true);
    window.addEventListener("blur", cancel);
    cleanupRef.current = cleanup;
  }
  return { begin, preview, consumeClick: () => { const value = suppressClick.current; suppressClick.current = false; return value; } };
}
