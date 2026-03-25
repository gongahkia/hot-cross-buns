import { writable } from 'svelte/store';

export type ViewMode = 'list' | 'today' | 'upcoming' | 'calendar' | 'week' | 'smart-filter' | 'schedule' | 'timeline' | 'tag-filter' | 'next7days' | 'area-view' | 'saved-filter';
export type SmartFilterType = 'overdue' | 'due-this-week' | 'high-priority' | 'untagged';
export const selectedSmartFilter = writable<SmartFilterType>('overdue');

export const selectedListId = writable<string | null>(null);
export const selectedTaskId = writable<string | null>(null);
export const showCompletedTasks = writable<boolean>(true);
export const currentView = writable<ViewMode>('list');
export const selectedTagId = writable<string | null>(null);
export const selectedAreaId = writable<string | null>(null);
export const selectedSavedFilterId = writable<string | null>(null);
