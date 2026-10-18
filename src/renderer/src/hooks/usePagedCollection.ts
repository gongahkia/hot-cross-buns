import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import type { CollectionPage } from "@shared/collectionPages";

export interface PagedCollection<T, Page extends CollectionPage<T> = CollectionPage<T>> {
  total: number | null;
  info: Page | null;
  error?: string;
  loadedCount: number;
  version: number;
  get: (index: number) => T | undefined;
  ensure: (start: number, end: number) => void;
  retry: () => void;
}

interface PageCache<T, Page> {
  pages: Map<number, { items: T[]; touched: number; stale: boolean }>;
  pending: Set<number>; failed: Map<number, string>; wanted: Set<number>;
  total: number | null; info: Page | null; clock: number;
}

/** A small page cache, two concurrent reads, and no queue of stale scroll positions. */
export function usePagedCollection<T, Page extends CollectionPage<T> = CollectionPage<T>>(queryKey: string, load: (offset: number, limit: number) => Promise<Page>, pageSize = 100): PagedCollection<T, Page> {
  const [version, render] = useReducer((value: number) => value + 1, 0);
  const latestLoad = useRef(load);
  latestLoad.current = load;
  const active = useRef<PageCache<T, Page> | null>(null);
  const cache = useMemo<PageCache<T, Page>>(() => {
    const previous = active.current;
    return {
      pages: new Map([...(previous?.pages ?? [])].map(([offset, page]) => [offset, { ...page, stale: true }])),
      pending: new Set(), failed: new Map(), total: previous?.total ?? null, info: previous?.info ?? null,
      wanted: new Set(previous?.wanted ?? [0]), clock: previous?.clock ?? 0
    };
  }, [queryKey]);
  active.current = cache;
  const pump = useCallback(() => {
    for (const offset of cache.wanted) {
      if (cache.pending.size >= 2) break;
      if ((cache.pages.has(offset) && !cache.pages.get(offset)!.stale) || cache.pending.has(offset) || cache.failed.has(offset)) continue;
      cache.pending.add(offset);
      void latestLoad.current(offset, pageSize).then((page) => {
        if (active.current !== cache) return;
        cache.total = page.page.totalKnown;
        cache.info = page;
        cache.pages.set(offset, { items: page.items, touched: ++cache.clock, stale: false });
        while (cache.pages.size > 6) {
          const candidates = [...cache.pages.entries()].filter(([key]) => !cache.wanted.has(key));
          const oldest = candidates.sort((left, right) => left[1].touched - right[1].touched)[0];
          if (!oldest) break;
          cache.pages.delete(oldest[0]);
        }
      }, (error: unknown) => {
        if (active.current === cache) cache.failed.set(offset, error instanceof Error ? error.message : "This page could not be loaded.");
      }).finally(() => {
        cache.pending.delete(offset);
        if (active.current === cache) { render(); pump(); }
      });
    }
  }, [cache, pageSize]);
  const ensure = useCallback((start: number, end: number) => {
    const wanted = new Set<number>();
    const boundedEnd = cache.total === null ? 1 : Math.min(cache.total, end);
    for (let offset = Math.floor(Math.max(0, start) / pageSize) * pageSize; offset < boundedEnd; offset += pageSize) {
      wanted.add(offset);
      const page = cache.pages.get(offset);
      if (page) page.touched = ++cache.clock;
      // An anomalously tall viewport must not turn into an unbounded prefetch.
      if (wanted.size === 4) break;
    }
    cache.wanted = wanted;
    pump();
  }, [cache, pageSize, pump]);
  useEffect(() => { pump(); }, [pump]);
  return {
    total: cache.total, info: cache.info, error: cache.failed.values().next().value,
    loadedCount: [...cache.pages.values()].reduce((sum, page) => sum + page.items.length, 0), version,
    get: (index) => cache.pages.get(Math.floor(index / pageSize) * pageSize)?.items[index % pageSize],
    ensure,
    retry: () => { cache.failed.clear(); pump(); render(); }
  };
}
