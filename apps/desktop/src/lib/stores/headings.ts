import { writable } from 'svelte/store';
import { invoke } from '@tauri-apps/api/core';
import type { Heading } from '$lib/types';

export const headings = writable<Heading[]>([]);

export async function loadHeadings(listId: string): Promise<Heading[]> {
  const result = await invoke<Heading[]>('get_headings_by_list', { listId });
  headings.set(result);
  return result;
}

export async function addHeading(listId: string, name: string): Promise<Heading> {
  const created = await invoke<Heading>('create_heading', { listId, name });
  headings.update(current => [...current, created]);
  return created;
}

export async function editHeading(id: string, fields: { name?: string; sortOrder?: number }): Promise<Heading> {
  const updated = await invoke<Heading>('update_heading', {
    id,
    name: fields.name ?? null,
    sortOrder: fields.sortOrder ?? null,
  });
  headings.update(current => current.map(h => h.id === id ? updated : h));
  return updated;
}

export async function removeHeading(id: string): Promise<void> {
  await invoke('delete_heading', { id });
  headings.update(current => current.filter(h => h.id !== id));
}
