import { writable } from 'svelte/store';

export type ViewMode = 'list' | 'today' | 'upcoming' | 'calendar' | 'week' | 'smart-filter' | 'schedule' | 'timeline';
export type SmartFilterType = 'overdue' | 'due-this-week' | 'high-priority' | 'untagged';
export const selectedSmartFilter = writable<SmartFilterType>('overdue');

export const selectedListId = writable<string | null>(null);
export const selectedTaskId = writable<string | null>(null);
export const showCompletedTasks = writable<boolean>(true);
export const currentView = writable<ViewMode>('list');
