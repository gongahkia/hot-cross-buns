import { useCallback, useLayoutEffect, useMemo, useRef, useState, type Key, type ReactNode } from "react";

interface Props<T> {
  ariaLabel: string;
  items: readonly T[];
  getKey: (item: T) => Key;
  renderRow: (item: T) => ReactNode;
  estimateRowHeight?: number;
  scrollToKey?: Key | null;
}

/** A viewport-sized list that measures wrapped text and expanded rows. */
export function MeasuredVirtualList<T>({ ariaLabel, items, getKey, renderRow, estimateRowHeight = 80, scrollToKey }: Props<T>): JSX.Element {
  const viewport = useRef<HTMLDivElement>(null);
  const heights = useRef(new Map<Key, number>());
  const [revision, setRevision] = useState(0);
  const [window, setWindow] = useState({ top: 0, height: 600 });
  const [focusIndex, setFocusIndex] = useState<number | null>(null);
  const keys = useMemo(() => items.map(getKey), [items, getKey]);
  const offsets = useMemo(() => {
    const result = [0];
    for (const key of keys) result.push(result[result.length - 1] + (heights.current.get(key) ?? estimateRowHeight));
    return result;
  }, [keys, estimateRowHeight, revision]);

  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const update = () => setWindow({ top: element.scrollTop, height: element.clientHeight || 600 });
    const observer = new ResizeObserver(update);
    observer.observe(element);
    update();
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const retained = new Set(keys);
    for (const key of heights.current.keys()) if (!retained.has(key)) heights.current.delete(key);
  }, [keys]);

  useLayoutEffect(() => {
    if (scrollToKey == null || !viewport.current) return;
    const index = keys.indexOf(scrollToKey);
    if (index < 0) return;
    const element = viewport.current;
    const top = offsets[index];
    const bottom = offsets[index + 1];
    if (top < element.scrollTop) element.scrollTop = top;
    else if (bottom > element.scrollTop + element.clientHeight) element.scrollTop = bottom - element.clientHeight;
    setWindow({ top: element.scrollTop, height: element.clientHeight });
    // Only a new selection should move the user's scroll position.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollToKey]);

  const measure = useCallback((key: Key, height: number) => {
    if (height <= 0 || Math.abs((heights.current.get(key) ?? estimateRowHeight) - height) < 1) return;
    heights.current.set(key, height);
    setRevision((value) => value + 1);
  }, [estimateRowHeight]);

  const findIndex = (top: number): number => {
    let low = 0;
    let high = items.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (offsets[middle + 1] <= top) low = middle + 1;
      else high = middle;
    }
    return low;
  };
  const start = Math.max(0, findIndex(window.top) - 4);
  const end = Math.min(items.length, findIndex(window.top + window.height) + 5);

  useLayoutEffect(() => {
    if (focusIndex === null) return;
    const row = viewport.current?.querySelector<HTMLElement>(`[data-virtual-index="${focusIndex}"]`);
    const target = row?.querySelector<HTMLElement>("[data-virtual-focus]") ?? row?.querySelector<HTMLElement>("button, [tabindex='0']");
    if (target) { target.focus({ preventScroll: true }); setFocusIndex(null); }
  }, [focusIndex, start, end]);

  return (
    <div
      aria-label={ariaLabel}
      className="min-h-0 flex-1 overflow-y-auto"
      onScroll={(event) => setWindow({ top: event.currentTarget.scrollTop, height: event.currentTarget.clientHeight })}
      onKeyDown={(event) => {
        if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) || items.length === 0) return;
        const target = event.target as HTMLElement;
        if (target.matches("input, textarea, select, [contenteditable='true']") || target.closest("[role='menu']")) return;
        const current = target.closest<HTMLElement>("[data-virtual-index]");
        const index = current ? Number(current.dataset.virtualIndex) : findIndex(window.top);
        const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : Math.max(0, Math.min(items.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)));
        event.preventDefault();
        const element = event.currentTarget;
        if (offsets[next] < element.scrollTop) element.scrollTop = offsets[next];
        else if (offsets[next + 1] > element.scrollTop + element.clientHeight) element.scrollTop = offsets[next + 1] - element.clientHeight;
        setWindow({ top: element.scrollTop, height: element.clientHeight || 600 });
        setFocusIndex(next);
      }}
      ref={viewport}
      role="list"
      tabIndex={0}
    >
      <div className="relative" style={{ height: offsets[offsets.length - 1] ?? 0 }}>
        {items.slice(start, end).map((item, index) => (
          <MeasuredRow key={keys[start + index]} index={start + index} itemKey={keys[start + index]} measure={measure} top={offsets[start + index]}>
            {renderRow(item)}
          </MeasuredRow>
        ))}
      </div>
    </div>
  );
}

function MeasuredRow({ children, index, itemKey, measure, top }: { children: ReactNode; index: number; itemKey: Key; measure: (key: Key, height: number) => void; top: number }): JSX.Element {
  const element = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const row = element.current;
    if (!row) return;
    const update = () => measure(itemKey, row.getBoundingClientRect().height);
    const observer = new ResizeObserver(update);
    observer.observe(row);
    update();
    return () => observer.disconnect();
  }, [itemKey, measure]);
  return <div className="absolute inset-x-0 top-0" data-virtual-index={index} ref={element} style={{ transform: `translateY(${top}px)` }}>{children}</div>;
}
