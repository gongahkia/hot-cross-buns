import { useEffect, useState } from "react";

export interface TaskParentCandidate { id: string; title: string }

/** Parent choices are queried within one list, independently of the display cache. */
export function useTaskParentCandidates(listId: string, excludeId?: string, selectedId?: string) {
  const [query, setQuery] = useState("");
  const [state, setState] = useState<{ items: TaskParentCandidate[]; loading: boolean; error?: string }>({ items: [], loading: true });
  useEffect(() => {
    let active = true;
    setState((current) => ({ ...current, loading: true, error: undefined }));
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const result = await window.hcb!.tasks.list({ listId, parentId: null, status: "active", summary: true, query, limit: 31 });
          if (!result.ok) throw new Error(result.error.message);
          const items: TaskParentCandidate[] = result.data.items.filter((task: TaskParentCandidate) => task.id !== excludeId).slice(0, 30);
          if (selectedId && selectedId !== excludeId && !items.some((item) => item.id === selectedId)) {
            const selected = await window.hcb!.tasks.get({ id: selectedId });
            if (selected.ok && selected.data.listId === listId) items.unshift({ id: selected.data.id, title: selected.data.title });
          }
          if (active) setState({ items, loading: false });
        } catch (error) {
          if (active) setState({ items: [], loading: false, error: error instanceof Error ? error.message : "Parent tasks could not be loaded." });
        }
      })();
    }, query ? 150 : 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [listId, excludeId, selectedId, query]);
  return { ...state, query, setQuery };
}
