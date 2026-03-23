import type { Task } from '$lib/types';
import type { Filters, SortMode } from '$lib/stores/filters';

function normalizedDueDate(dueDate: string | null): number {
  if (!dueDate) {
    return Number.POSITIVE_INFINITY;
  }

  const timestamp = new Date(dueDate).getTime();
  return Number.isNaN(timestamp) ? Number.POSITIVE_INFINITY : timestamp;
}

function compareDates(left: string, right: string): number {
  return new Date(left).getTime() - new Date(right).getTime();
}

export function matchesTaskFilters(task: Task, filters: Filters): boolean {
  if (filters.priorities.length > 0 && !filters.priorities.includes(task.priority)) {
    return false;
  }

  if (
    filters.tagIds.length > 0 &&
    !task.tags.some((tag) => filters.tagIds.includes(tag.id))
  ) {
    return false;
  }

  if (filters.dueAfter) {
    if (!task.dueDate || compareDates(task.dueDate, filters.dueAfter) < 0) {
      return false;
    }
  }

  if (filters.dueBefore) {
    if (!task.dueDate || compareDates(task.dueDate, filters.dueBefore) > 0) {
      return false;
    }
  }

  return true;
}

export function sortTasks(items: Task[], sortMode: SortMode): Task[] {
  const sorted = [...items];

  sorted.sort((left, right) => {
    if (sortMode === 'priority') {
      return (
        right.priority - left.priority ||
        normalizedDueDate(left.dueDate) - normalizedDueDate(right.dueDate) ||
        left.sortOrder - right.sortOrder
      );
    }

    if (sortMode === 'dueDate') {
      return (
        normalizedDueDate(left.dueDate) - normalizedDueDate(right.dueDate) ||
        right.priority - left.priority ||
        left.sortOrder - right.sortOrder
      );
    }

    if (sortMode === 'title') {
      return (
        left.title.localeCompare(right.title, undefined, { sensitivity: 'base' }) ||
        left.sortOrder - right.sortOrder
      );
    }

    if (sortMode === 'created') {
      return (
        compareDates(left.createdAt, right.createdAt) ||
        left.sortOrder - right.sortOrder
      );
    }

    return left.sortOrder - right.sortOrder;
  });

  return sorted;
}
