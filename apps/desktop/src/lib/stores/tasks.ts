import { writable } from 'svelte/store';
import { invoke } from '@tauri-apps/api/core';
import type { Task, TaskUpdatePayload } from '$lib/types';
import { markSelectedListHydrated } from '$lib/services/startup';

export const tasks = writable<Task[]>([]);
export const taskMutationVersion = writable(0);

function flattenTasks(items: Task[]): Task[] {
  const flat: Task[] = [];

  for (const task of items) {
    flat.push(task);
    flat.push(...task.subtasks);
  }

  return flat;
}

function removeTaskTree(items: Task[], taskId: string): Task[] {
  return items.filter((task) => task.id !== taskId && task.parentTaskId !== taskId);
}

function bumpTaskMutationVersion(): void {
  taskMutationVersion.update((value) => value + 1);
}

/**
 * Fetch tasks for a given list and update the store.
 */
export async function loadTasks(
  listId: string,
  includeCompleted: boolean = false
) : Promise<Task[]> {
  const result = await invoke<Task[]>('get_tasks_by_list', {
    listId,
    includeCompleted,
  });
  const flat = flattenTasks(result);
  tasks.set(flat);
  markSelectedListHydrated();
  return flat;
}

/**
 * Create a new task and append it to the store.
 */
export async function addTask(params: {
  listId: string;
  title: string;
  content?: string;
  priority?: number;
  dueDate?: string;
  dueTimezone?: string;
  recurrenceRule?: string;
  parentTaskId?: string;
}): Promise<Task> {
  const created = await invoke<Task>('create_task', {
    listId: params.listId,
    title: params.title,
    content: params.content ?? null,
    priority: params.priority ?? null,
    dueDate: params.dueDate ?? null,
    dueTimezone: params.dueTimezone ?? null,
    recurrenceRule: params.recurrenceRule ?? null,
    parentTaskId: params.parentTaskId ?? null,
  });
  tasks.update((current) => [...current, created]);
  bumpTaskMutationVersion();
  return created;
}

/**
 * Update a task's fields and reflect the change in the store.
 */
export async function editTask(
  id: string,
  fields: Omit<TaskUpdatePayload, 'id'>
): Promise<Task> {
  const updated = await invoke<Task>('update_task', {
    id,
    title: fields.title ?? null,
    content: fields.content ?? null,
    priority: fields.priority ?? null,
    status: fields.status ?? null,
    dueDate: fields.dueDate ?? null,
    dueTimezone: fields.dueTimezone ?? null,
    recurrenceRule: fields.recurrenceRule ?? null,
    sortOrder: fields.sortOrder ?? null,
  });
  tasks.update((current) =>
    current.map((task) => (task.id === id ? updated : task))
  );
  bumpTaskMutationVersion();
  return updated;
}

/**
 * Soft-delete a task and remove it from the store.
 */
export async function removeTask(id: string): Promise<void> {
  await invoke('delete_task', { id });
  tasks.update((current) => removeTaskTree(current, id));
  bumpTaskMutationVersion();
}

/**
 * Move a task to a different list with a new sort order.
 * Removes the task from the current store view since it now belongs to another list.
 */
export async function moveTask(
  id: string,
  newListId: string,
  sortOrder: number
): Promise<Task> {
  const moved = await invoke<Task>('move_task', {
    id,
    newListId,
    newSortOrder: sortOrder,
  });
  // Remove from current view -- the task now belongs to a different list.
  tasks.update((current) => removeTaskTree(current, id));
  bumpTaskMutationVersion();
  return moved;
}

/**
 * Mark a task as complete (status = 1).
 */
export async function completeTask(id: string): Promise<Task> {
  return editTask(id, { status: 1 });
}
