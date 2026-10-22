import { createContext, useContext, type KeyboardEvent, type MouseEvent } from "react";
import type { CalendarEventViewModel } from "../../coreViewModels";
export type CalendarMenuTarget = { event: CalendarEventViewModel; x: number; y: number; trigger: HTMLElement; beforeAction?: () => void };
export const EventMenuContext = createContext<((target: CalendarMenuTarget) => void) | null>(null);

export function useCalendarEventMenu(event: CalendarEventViewModel, beforeAction?: () => void) {
  const show = useContext(EventMenuContext);
  return {
    onContextMenu: (e: MouseEvent<HTMLElement>) => {
      if (!show) return;
      e.preventDefault(); e.stopPropagation();
      show({ event, x: e.clientX, y: e.clientY, trigger: e.currentTarget, beforeAction });
    },
    onMenuKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      if (!show || (e.key !== "ContextMenu" && !(e.shiftKey && e.key === "F10"))) return;
      e.preventDefault(); e.stopPropagation();
      const rect = e.currentTarget.getBoundingClientRect();
      show({ event, x: rect.left + Math.min(24, rect.width / 2), y: rect.bottom, trigger: e.currentTarget, beforeAction });
    }
  };
}
