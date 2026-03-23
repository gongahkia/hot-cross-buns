import { writable, get } from 'svelte/store';

export const selectedTaskIds = writable<Set<string>>(new Set());
export const lastClickedTaskId = writable<string | null>(null);

export function toggleSelect(id: string) {
  selectedTaskIds.update((set) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  lastClickedTaskId.set(id);
}

export function rangeSelect(id: string, orderedIds: string[]) {
  const last = get(lastClickedTaskId);
  if (!last) { toggleSelect(id); return; }
  const startIdx = orderedIds.indexOf(last);
  const endIdx = orderedIds.indexOf(id);
  if (startIdx < 0 || endIdx < 0) { toggleSelect(id); return; }
  const [from, to] = startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
  selectedTaskIds.update((set) => {
    const next = new Set(set);
    for (let i = from; i <= to; i++) next.add(orderedIds[i]);
    return next;
  });
  lastClickedTaskId.set(id);
}

export function clearSelection() {
  selectedTaskIds.set(new Set());
  lastClickedTaskId.set(null);
}

export function selectAll(ids: string[]) {
  selectedTaskIds.set(new Set(ids));
}
