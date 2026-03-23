import { writable } from 'svelte/store';
import { invoke } from '@tauri-apps/api/core';
import type { Area } from '$lib/types';

export const areas = writable<Area[]>([]);

function sortAreas(items: Area[]): Area[] {
  return [...items].sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.createdAt.localeCompare(b.createdAt);
  });
}

export async function loadAreas(): Promise<Area[]> {
  const result = await invoke<Area[]>('get_areas');
  const sorted = sortAreas(result);
  areas.set(sorted);
  return sorted;
}

export async function addArea(name: string, color?: string): Promise<Area> {
  const created = await invoke<Area>('create_area', { name, color: color ?? null });
  areas.update(current => sortAreas([...current, created]));
  return created;
}

export async function editArea(id: string, fields: { name?: string; color?: string; sortOrder?: number }): Promise<Area> {
  const updated = await invoke<Area>('update_area', {
    id,
    name: fields.name ?? null,
    color: fields.color ?? null,
    sortOrder: fields.sortOrder ?? null,
  });
  areas.update(current => sortAreas(current.map(a => a.id === id ? updated : a)));
  return updated;
}

export async function removeArea(id: string): Promise<void> {
  await invoke('delete_area', { id });
  areas.update(current => current.filter(a => a.id !== id));
}
