import { writable } from 'svelte/store';

/**
 * IDs of the currently multi-selected tasks.
 *
 * Used for batch operations (delete, move, complete, tag, etc.).
 */
export const selectedTaskIds = writable<Set<string>>(new Set());

/**
 * Toggle a task in or out of the selection set.
 */
export function toggleSelection(taskId: string): void {
  selectedTaskIds.update((current) => {
    const next = new Set(current);
    if (next.has(taskId)) {
      next.delete(taskId);
    } else {
      next.add(taskId);
    }
    return next;
  });
}

/**
 * Replace the entire selection with a single task.
 */
export function selectOnly(taskId: string): void {
  selectedTaskIds.set(new Set([taskId]));
}

/**
 * Clear all selected tasks.
 */
export function clearSelection(): void {
  selectedTaskIds.set(new Set());
}
