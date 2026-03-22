import { writable } from 'svelte/store';
import { invoke } from '@tauri-apps/api/core';
import type { List } from '$lib/types';

export const lists = writable<List[]>([]);

/**
 * Fetch all non-deleted lists from the backend and update the store.
 */
export async function loadLists(): Promise<void> {
  const result = await invoke<List[]>('get_lists');
  lists.set(result);
}

/**
 * Create a new list and append it to the store.
 */
export async function addList(name: string, color?: string): Promise<List> {
  const created = await invoke<List>('create_list', { name, color: color ?? null });
  lists.update((current) => [...current, created]);
  return created;
}

/**
 * Update an existing list and reflect the change in the store.
 */
export async function editList(
  id: string,
  updates: { name?: string; color?: string; sortOrder?: number }
): Promise<List> {
  const updated = await invoke<List>('update_list', {
    id,
    name: updates.name ?? null,
    color: updates.color ?? null,
    sortOrder: updates.sortOrder ?? null,
  });
  lists.update((current) =>
    current.map((list) => (list.id === id ? updated : list))
  );
  return updated;
}

/**
 * Soft-delete a list and remove it from the store.
 */
export async function removeList(id: string): Promise<void> {
  await invoke('delete_list', { id });
  lists.update((current) => current.filter((list) => list.id !== id));
}
