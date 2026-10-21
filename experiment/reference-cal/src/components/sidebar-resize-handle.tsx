"use client";

import * as React from "react";
import type { SidebarSizingProps } from "@/components/week-view-types";

interface SidebarResizeHandleProps extends SidebarSizingProps {
  side: "left" | "right";
  onResizingChange: (resizing: boolean) => void;
}

interface ResizeSession {
  pointerId: number;
  element: HTMLDivElement;
  startX: number;
  startWidth: number;
  previousCursor: string;
}

export function SidebarResizeHandle({
  side,
  width,
  minWidth,
  maxWidth,
  onWidthChange,
  onResizingChange,
}: SidebarResizeHandleProps) {
  const session = React.useRef<ResizeSession | null>(null);
  const stop = React.useCallback(() => {
    const current = session.current;
    if (!current) return;
    session.current = null;
    delete document.body.dataset.sidebarResizing;
    if (current.previousCursor)
      document.body.style.setProperty("--cursor", current.previousCursor);
    else document.body.style.removeProperty("--cursor");
    if (current.element.hasPointerCapture(current.pointerId))
      current.element.releasePointerCapture(current.pointerId);
    onResizingChange(false);
  }, [onResizingChange]);

  React.useEffect(() => {
    window.addEventListener("blur", stop);
    return () => {
      window.removeEventListener("blur", stop);
      stop();
    };
  }, [stop]);

  const applyWidth = (value: number) =>
    onWidthChange(Math.round(Math.max(minWidth, Math.min(maxWidth, value))));

  return (
    <div
      role="separator"
      aria-label={
        side === "left" ? "Resize calendar sidebar" : "Resize context sidebar"
      }
      aria-orientation="vertical"
      aria-valuemin={minWidth}
      aria-valuemax={maxWidth}
      aria-valuenow={Math.round(width)}
      aria-valuetext={`${Math.round(width)} pixels wide`}
      tabIndex={0}
      data-side={side}
      className="sidebar-resize-handle"
      title="Drag to resize. Arrow keys also adjust the width."
      onPointerDown={(event) => {
        if (
          event.button !== 0 ||
          document.body.dataset.sidebarResizing === "true"
        )
          return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        session.current = {
          pointerId: event.pointerId,
          element: event.currentTarget,
          startX: event.clientX,
          startWidth:
            event.currentTarget
              .closest(
                '.calendar-sidebar-panel, [data-slot="sidebar-container"], [role="dialog"]',
              )
              ?.getBoundingClientRect().width ?? width,
          previousCursor: document.body.style.getPropertyValue("--cursor"),
        };
        document.body.style.setProperty("--cursor", "col-resize");
        document.body.dataset.sidebarResizing = "true";
        onResizingChange(true);
      }}
      onPointerMove={(event) => {
        const current = session.current;
        if (!current || current.pointerId !== event.pointerId) return;
        applyWidth(
          current.startWidth +
            (event.clientX - current.startX) * (side === "left" ? 1 : -1),
        );
      }}
      onPointerUp={stop}
      onPointerCancel={stop}
      onLostPointerCapture={stop}
      onKeyDown={(event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
          return;
        event.preventDefault();
        event.stopPropagation();
        if (event.key === "Home") applyWidth(minWidth);
        else if (event.key === "End") applyWidth(maxWidth);
        else
          applyWidth(
            width +
              (event.key === "ArrowRight" ? 16 : -16) *
                (side === "left" ? 1 : -1),
          );
      }}
    />
  );
}
