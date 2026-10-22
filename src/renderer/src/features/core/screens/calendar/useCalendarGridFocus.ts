import { useState, type KeyboardEvent } from "react";

/** One grid entry in the Tab order; arrows navigate cells without creating events. */
export function useCalendarGridFocus(keys: string[], columns: number, initialKey?: string) {
  const [focused, setFocused] = useState(initialKey);
  const active = focused && keys.includes(focused) ? focused : initialKey && keys.includes(initialKey) ? initialKey : keys[0];
  function onKeyDown(event: KeyboardEvent<HTMLElement>): boolean {
    const index = keys.indexOf(event.currentTarget.dataset.calendarCellKey ?? "");
    if (index < 0 || event.altKey || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return false;
    const rowStart = Math.floor(index / columns) * columns;
    const rowEnd = Math.min(keys.length - 1, rowStart + columns - 1);
    const next = event.key === "Home" ? (event.ctrlKey || event.metaKey ? 0 : rowStart)
      : event.key === "End" ? (event.ctrlKey || event.metaKey ? keys.length - 1 : rowEnd)
      : event.key === "ArrowLeft" ? Math.max(rowStart, index - 1)
      : event.key === "ArrowRight" ? Math.min(rowEnd, index + 1)
      : event.key === "ArrowUp" ? Math.max(index % columns, index - columns)
      : index + columns < keys.length ? index + columns : index;
    event.preventDefault(); event.stopPropagation();
    const target = [...(event.currentTarget.closest('[role="grid"]')?.querySelectorAll<HTMLElement>("[data-calendar-cell-key]") ?? [])]
      .find(cell => cell.dataset.calendarCellKey === keys[next]);
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ block: "nearest", inline: "nearest" });
    return true;
  }
  return { onKeyDown, cellProps: (key: string) => ({
    "data-calendar-cell-key": key,
    tabIndex: key === active ? 0 : -1,
    onFocus: () => setFocused(key)
  }) };
}
