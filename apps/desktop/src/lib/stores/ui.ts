import { writable } from 'svelte/store';

export type ViewMode = 'list' | 'today' | 'calendar' | 'week';

export const selectedListId = writable<string | null>(null);
export const selectedTaskId = writable<string | null>(null);
export const showCompletedTasks = writable<boolean>(true);
export const currentView = writable<ViewMode>('list');
