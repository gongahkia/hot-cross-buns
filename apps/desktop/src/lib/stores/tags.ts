import { writable } from 'svelte/store';
import { invoke } from '@tauri-apps/api/core';
import type { Tag } from '$lib/types';

export const tags = writable<Tag[]>([]);

/**
 * Fetch all tags from the backend and update the store.
 */
export async function loadTags(): Promise<void> {
  const result = await invoke<Tag[]>('get_tags');
  tags.set(result);
}

/**
 * Create a new tag and append it to the store.
 */
export async function addTag(name: string, color?: string): Promise<Tag> {
  const created = await invoke<Tag>('create_tag', { name, color: color ?? null });
  tags.update((current) => [...current, created]);
  return created;
}

/**
 * Update an existing tag and reflect the change in the store.
 */
export async function editTag(
  id: string,
  updates: { name?: string; color?: string }
): Promise<Tag> {
  const updated = await invoke<Tag>('update_tag', {
    id,
    name: updates.name ?? null,
    color: updates.color ?? null,
  });
  tags.update((current) =>
    current.map((tag) => (tag.id === id ? updated : tag))
  );
  return updated;
}

/**
 * Delete a tag permanently and remove it from the store.
 */
export async function removeTag(id: string): Promise<void> {
  await invoke('delete_tag', { id });
  tags.update((current) => current.filter((tag) => tag.id !== id));
}

/**
 * Associate a tag with a task via the task_tags join table.
 */
export async function tagTask(taskId: string, tagId: string): Promise<void> {
  await invoke('add_tag_to_task', { taskId, tagId });
}

/**
 * Remove a tag association from a task.
 */
export async function untagTask(taskId: string, tagId: string): Promise<void> {
  await invoke('remove_tag_from_task', { taskId, tagId });
}
