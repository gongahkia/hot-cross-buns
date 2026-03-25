import { writable } from 'svelte/store';
import { invoke } from '@tauri-apps/api/core';
import type { SavedFilter } from '$lib/types';

export const savedFilters = writable<SavedFilter[]>([]);

export async function loadSavedFilters(): Promise<void> {
  try {
    const filters = await invoke<SavedFilter[]>('get_saved_filters');
    savedFilters.set(filters);
  } catch (err) {
    console.error('Failed to load saved filters:', err);
  }
}

export async function addSavedFilter(name: string, config: string): Promise<SavedFilter> {
  const filter = await invoke<SavedFilter>('create_saved_filter', { name, config });
  await loadSavedFilters();
  return filter;
}

export async function editSavedFilter(id: string, updates: { name?: string; config?: string }): Promise<void> {
  await invoke('update_saved_filter', { id, ...updates });
  await loadSavedFilters();
}

export async function removeSavedFilter(id: string): Promise<void> {
  await invoke('delete_saved_filter', { id });
  await loadSavedFilters();
}
