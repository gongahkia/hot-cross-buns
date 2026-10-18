import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { PagedCollection } from "../hooks/usePagedCollection";

export function sparseRowGeometry(count: number, estimate: number, heights: ReadonlyMap<number, number>) {
  const measured = [...heights.entries()].filter(([index]) => index < count).sort((left, right) => left[0] - right[0]);
  const deltas = [0];
  for (const [, height] of measured) deltas.push(deltas[deltas.length - 1] + height - estimate);
  const offset = (index: number): number => {
    let low = 0, high = measured.length;
    while (low < high) { const middle = (low + high) >>> 1; if (measured[middle][0] < index) low = middle + 1; else high = middle; }
    return index * estimate + deltas[low];
  };
  const indexAt = (top: number): number => {
    let low = 0, high = count;
    while (low < high) { const middle = (low + high) >>> 1; if (offset(middle + 1) <= top) low = middle + 1; else high = middle; }
    return low;
  };
  return { offset, indexAt, total: offset(count) };
}

export function PagedVirtualList<T>({ ariaLabel, collection, renderRow, emptyState, estimateRowHeight = 64, scrollToIndex, initialScrollTop = 0, onScrollPositionChange, getKey }: {
  ariaLabel: string;
  collection: PagedCollection<T>;
  renderRow: (item: T, index: number) => ReactNode;
  emptyState?: ReactNode;
  getKey?: (item: T) => string;
  estimateRowHeight?: number;
  scrollToIndex?: number | null;
  initialScrollTop?: number;
  onScrollPositionChange?: (top: number) => void;
}): JSX.Element {
  const viewport = useRef<HTMLDivElement>(null);
  const heights = useRef(new Map<number, number>());
  const rowObserver = useRef<ResizeObserver | null>(null);
  const [sizeRevision, setSizeRevision] = useState(0);
  const [window, setWindow] = useState({ top: initialScrollTop, height: 600 });
  const [focusIndex, setFocusIndex] = useState<number | null>(null);
  const count = collection.total ?? 0;
  const geometry = useMemo(() => sparseRowGeometry(count, estimateRowHeight, heights.current), [count, estimateRowHeight, sizeRevision]);
  const geometryRef = useRef(geometry);
  geometryRef.current = geometry;
  const start = Math.max(0, geometry.indexAt(window.top) - 5);
  const end = Math.min(count, geometry.indexAt(window.top + window.height) + 6);
  useEffect(() => { collection.ensure(start, Math.max(end, 1)); }, [start, end, collection.ensure, collection.version]);
  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) return;
    element.scrollTop = initialScrollTop;
    const observer = new ResizeObserver(() => setWindow({ top: element.scrollTop, height: element.clientHeight || 600 }));
    observer.observe(element);
    setWindow({ top: element.scrollTop, height: element.clientHeight || 600 });
    return () => observer.disconnect();
  }, []);
  const moveToIndex = useCallback((index: number) => {
    const element = viewport.current;
    if (!element) return;
    const current = geometryRef.current;
    if (current.offset(index) < element.scrollTop) element.scrollTop = current.offset(index);
    else if (current.offset(index + 1) > element.scrollTop + element.clientHeight) element.scrollTop = current.offset(index + 1) - element.clientHeight;
    setWindow({ top: element.scrollTop, height: element.clientHeight || 600 });
  }, []);
  useEffect(() => { if (scrollToIndex != null && scrollToIndex < count) moveToIndex(scrollToIndex); }, [scrollToIndex, count, moveToIndex]);
  useLayoutEffect(() => {
    if (focusIndex === null || collection.get(focusIndex) === undefined) return;
    const row = viewport.current?.querySelector<HTMLElement>(`[data-virtual-index="${focusIndex}"]`);
    const target = row?.querySelector<HTMLElement>("[data-virtual-focus]") ?? row?.querySelector<HTMLElement>("button, [tabindex='0']");
    if (target) { target.focus({ preventScroll: true }); setFocusIndex(null); }
  }, [focusIndex, collection.version, start, end]);
  const measure = useCallback((measurements: Array<[number, number]>) => {
    const changed = measurements.filter(([index, height]) => height > 0 && Math.abs((heights.current.get(index) ?? estimateRowHeight) - height) >= 1);
    if (!changed.length) return;
    const element = viewport.current;
    const previous = geometryRef.current;
    const anchor = previous.indexAt(element?.scrollTop ?? 0);
    for (const [index, height] of changed) {
      heights.current.delete(index);
      heights.current.set(index, height);
    }
    while (heights.current.size > 2048) heights.current.delete(heights.current.keys().next().value!);
    const next = sparseRowGeometry(count, estimateRowHeight, heights.current);
    const correction = next.offset(anchor) - previous.offset(anchor);
    if (element && correction !== 0) {
      element.scrollTop += correction;
      setWindow({ top: element.scrollTop, height: element.clientHeight || 600 });
    }
    geometryRef.current = next;
    setSizeRevision((revision) => revision + 1);
  }, [count, estimateRowHeight]);
  const measureRef = useRef(measure);
  measureRef.current = measure;
  const observeRow = useCallback((element: HTMLDivElement) => {
    // One delivery computes geometry and adjusts the scroll anchor once for
    // every resized row. Reading each row's bounds during mount forces layout
    // repeatedly while a fast scroll replaces the visible window.
    rowObserver.current ??= new ResizeObserver((entries) => measureRef.current(entries.map((entry) => [
      Number((entry.target as HTMLElement).dataset.virtualIndex),
      entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height
    ])));
    const observer = rowObserver.current;
    observer.observe(element);
    return () => observer.unobserve(element);
  }, []);
  useLayoutEffect(() => () => { rowObserver.current?.disconnect(); rowObserver.current = null; }, []);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {collection.error ? <div role="alert" className="p-3 text-sm text-danger">{collection.error} <button onClick={collection.retry} type="button">Retry</button></div> : null}
      <div aria-label={ariaLabel} role="list" tabIndex={0} className="min-h-0 flex-1 overflow-y-auto" ref={viewport}
        data-loaded-count={collection.loadedCount} data-total-count={count}
        onScroll={(event) => { setWindow({ top: event.currentTarget.scrollTop, height: event.currentTarget.clientHeight || 600 }); onScrollPositionChange?.(event.currentTarget.scrollTop); }}
        onKeyDown={(event) => {
          if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || !count || !["Home", "End", "ArrowUp", "ArrowDown"].includes(event.key)) return;
          const target = event.target as HTMLElement;
          if (target.matches("input, textarea, select, [contenteditable='true']") || target.closest("[role='menu']")) return;
          const row = target.closest<HTMLElement>("[data-virtual-index]");
          const current = row ? Number(row.dataset.virtualIndex) : geometry.indexAt(window.top);
          const next = event.key === "Home" ? 0 : event.key === "End" ? count - 1 : Math.max(0, Math.min(count - 1, current + (event.key === "ArrowDown" ? 1 : -1)));
          event.preventDefault(); moveToIndex(next); setFocusIndex(next);
        }}>
        {collection.total === null ? <p role="status" className="p-4 text-sm text-text-muted">Loading…</p> : count === 0 ? emptyState : (
          <div className="relative" style={{ height: geometry.total, overflowAnchor: "none" }}>
            {Array.from({ length: Math.max(0, end - start) }, (_, offset) => {
              const index = start + offset;
              const item = collection.get(index);
              return item === undefined
                ? <div key={index} aria-hidden className="absolute inset-x-0 rounded-hcbMd bg-surface-0/30" style={{ top: geometry.offset(index), height: estimateRowHeight }} />
                : <PagedRow key={getKey?.(item) ?? index} index={index} top={geometry.offset(index)} observe={observeRow}>{renderRow(item, index)}</PagedRow>;
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function PagedRow({ index, top, observe, children }: { index: number; top: number; observe: (element: HTMLDivElement) => () => void; children: ReactNode }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    return observe(element);
  }, [index, observe]);
  return <div className="absolute inset-x-0 top-0" data-virtual-index={index} ref={ref} style={{ transform: `translateY(${top}px)` }}>{children}</div>;
}
