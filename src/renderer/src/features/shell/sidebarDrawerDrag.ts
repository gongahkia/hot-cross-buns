import { useCallback, useEffect, useRef } from "react";
import type { PointerEvent as ReactPointerEvent, RefObject } from "react";

export const sidebarDrawerSnapThreshold = 48;

export function sidebarDrawerSnapTarget({
  deltaX,
  sidebarOnRight,
  sidebarOpen,
  threshold = sidebarDrawerSnapThreshold
}: {
  deltaX: number;
  sidebarOnRight: boolean;
  sidebarOpen: boolean;
  threshold?: number;
}): boolean | null {
  const outwardDistance = sidebarOnRight ? deltaX : -deltaX;

  if (sidebarOpen && outwardDistance >= threshold) {
    return false;
  }

  if (!sidebarOpen && outwardDistance <= -threshold) {
    return true;
  }

  return null;
}

export function useSidebarDrawerDrag({
  onSetOpen,
  sidebarOnRight,
  sidebarOpen
}: {
  onSetOpen: (open: boolean) => void;
  sidebarOnRight: boolean;
  sidebarOpen: boolean;
}): {
  onClick: () => void;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  previewRef: RefObject<HTMLDivElement | null>;
} {
  const suppressClickRef = useRef(false);
  const cleanupRef = useRef<(() => void) | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  useEffect(() => () => cleanupRef.current?.(), []);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>): void => {
    if (event.button !== 0 || !event.isPrimary) {
      return;
    }

    event.preventDefault();
    const startX = event.clientX;
    const pointerId = event.pointerId;
    const container = event.currentTarget.parentElement;
    let moved = false;

    function showPreview(clientX: number): void {
      if (!container || !previewRef.current) {
        return;
      }

      previewRef.current.style.left = `${clientX - container.getBoundingClientRect().left}px`;
      previewRef.current.style.opacity = "1";
    }

    function hidePreview(): void {
      if (previewRef.current) {
        previewRef.current.style.opacity = "0";
      }
    }

    function cleanup(): void {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
      hidePreview();
      cleanupRef.current = null;
    }

    function onPointerMove(moveEvent: PointerEvent): void {
      if (moveEvent.pointerId !== pointerId) {
        return;
      }

      moved ||= Math.abs(moveEvent.clientX - startX) >= 3;
      showPreview(moveEvent.clientX);
    }

    function onPointerUp(upEvent: PointerEvent): void {
      if (upEvent.pointerId !== pointerId) {
        return;
      }

      const target = sidebarDrawerSnapTarget({
        deltaX: upEvent.clientX - startX,
        sidebarOnRight,
        sidebarOpen
      });
      suppressClickRef.current = moved;
      cleanup();

      if (target !== null) {
        onSetOpen(target);
      }
    }

    function onPointerCancel(cancelEvent: PointerEvent): void {
      if (cancelEvent.pointerId !== pointerId) {
        return;
      }

      suppressClickRef.current = moved;
      cleanup();
    }

    cleanupRef.current?.();
    cleanupRef.current = cleanup;
    showPreview(startX);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
  }, [onSetOpen, sidebarOnRight, sidebarOpen]);

  const onClick = useCallback((): void => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }

    onSetOpen(!sidebarOpen);
  }, [onSetOpen, sidebarOpen]);

  return { onClick, onPointerDown, previewRef };
}
