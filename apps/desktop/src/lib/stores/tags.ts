import { get, writable } from 'svelte/store';
import { invoke } from '@tauri-apps/api/core';
import type { Tag } from '$lib/types';
import { tasks, taskMutationVersion } from '$lib/stores/tasks';

export const tags = writable<Tag[]>([]);

function sortTags(items: Tag[]): Tag[] {
  return [...items].sort((a, b) => a.name.localeCompare(b.name));
}

function updateTaskTags(
  taskId: string,
  transform: (taskTags: Tag[]) => Tag[]
): void {
  tasks.update((current) =>
    current.map((task) =>
      task.id === taskId ? { ...task, tags: transform(task.tags) } : task
    )
  );
  taskMutationVersion.update((value) => value + 1);
}

/**
 * Fetch all tags from the backend and update the store.
 */
export async function loadTags(): Promise<Tag[]> {
  const result = await invoke<Tag[]>('get_tags');
  const sorted = sortTags(result);
  tags.set(sorted);
  return sorted;
}

/**
 * Create a new tag and append it to the store.
 */
export async function addTag(name: string, color?: string): Promise<Tag> {
  const created = await invoke<Tag>('create_tag', { name, color: color ?? null });
  tags.update((current) => sortTags([...current, created]));
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
    sortTags(current.map((tag) => (tag.id === id ? updated : tag)))
  );
  return updated;
}

/**
 * Delete a tag permanently and remove it from the store.
 */
export async function removeTag(id: string): Promise<void> {
  await invoke('delete_tag', { id });
  tags.update((current) => current.filter((tag) => tag.id !== id));
  tasks.update((current) =>
    current.map((task) => ({
      ...task,
      tags: task.tags.filter((tag) => tag.id !== id),
    }))
  );
  taskMutationVersion.update((value) => value + 1);
}

/**
 * Associate a tag with a task via the task_tags join table.
 */
export async function tagTask(taskId: string, tagId: string): Promise<void> {
  await invoke('add_tag_to_task', { taskId, tagId });
  const tagToAttach = get(tags).find((tag) => tag.id === tagId);
  if (!tagToAttach) {
    return;
  }

  updateTaskTags(taskId, (taskTags) =>
    taskTags.some((tag) => tag.id === tagId) ? taskTags : [...taskTags, tagToAttach]
  );
}

/**
 * Remove a tag association from a task.
 */
export async function untagTask(taskId: string, tagId: string): Promise<void> {
  await invoke('remove_tag_from_task', { taskId, tagId });
  updateTaskTags(taskId, (taskTags) => taskTags.filter((tag) => tag.id !== tagId));
}
