import { writable } from 'svelte/store';

export type SortMode = 'manual' | 'priority' | 'dueDate' | 'title' | 'created';

export interface Filters {
  showCompleted: boolean;
  priorities: number[];
  tagIds: string[];
  dueBefore: string | null;
  dueAfter: string | null;
}

const defaultFilters: Filters = {
  showCompleted: false,
  priorities: [],
  tagIds: [],
  dueBefore: null,
  dueAfter: null,
};

export const currentSort = writable<SortMode>('manual');
export const currentFilters = writable<Filters>({ ...defaultFilters });

export function resetFilters(): void {
  currentFilters.set({ ...defaultFilters });
}

export function togglePriority(priority: number): void {
  currentFilters.update((f) => {
    const idx = f.priorities.indexOf(priority);
    const next = [...f.priorities];
    if (idx >= 0) {
      next.splice(idx, 1);
    } else {
      next.push(priority);
    }
    return { ...f, priorities: next };
  });
}

export function toggleTag(tagId: string): void {
  currentFilters.update((f) => {
    const idx = f.tagIds.indexOf(tagId);
    const next = [...f.tagIds];
    if (idx >= 0) {
      next.splice(idx, 1);
    } else {
      next.push(tagId);
    }
    return { ...f, tagIds: next };
  });
}
