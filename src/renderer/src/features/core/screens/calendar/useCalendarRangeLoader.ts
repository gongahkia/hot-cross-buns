import { useEffect, useRef, useState } from "react";

type Range = { start: string; end: string };

/** At most one viewport request in flight plus the latest requested viewport.
 * Existing source caches, paging and worker recurrence limits remain authoritative. */
export function useCalendarRangeLoader(range: Range, enabled: boolean, revision: number, load: (range: Range) => Promise<boolean>) {
  const [error, setError] = useState<string>();
  const latestLoad = useRef(load); latestLoad.current = load;
  const pending = useRef<{ range: Range; generation: number } | null>(null);
  const running = useRef(false), generation = useRef(0), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; pending.current = null; }; }, []);
  useEffect(() => {
    const current = ++generation.current;
    pending.current = null;
    if (!enabled) return;
    setError(undefined);
    const drain = async () => {
      if (running.current) return;
      running.current = true;
      try {
        while (mounted.current && pending.current) {
          const request = pending.current; pending.current = null;
          let loaded = false;
          try {
            loaded = await latestLoad.current(request.range);
            if (!loaded && request.generation === generation.current && mounted.current) loaded = await latestLoad.current(request.range);
          } catch { /* Surface a retryable range error below. */ }
          if (mounted.current && request.generation === generation.current) setError(loaded ? undefined : "Calendar range could not be loaded.");
        }
      } finally { running.current = false; }
    };
    const timer = setTimeout(() => { pending.current = { range, generation: current }; void drain(); }, 80);
    return () => { clearTimeout(timer); ++generation.current; pending.current = null; };
  }, [range.start, range.end, enabled, revision, load]);
  return { error, clearError: () => setError(undefined) };
}
